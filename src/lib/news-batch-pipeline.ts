import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chat } from "./claude";
import { type ExternalSignalType } from "./external-signals";
import {
  coerceWorkspaceRelevance,
  WORKSPACE_RELEVANCE_VALUES,
  type WorkspaceRelevance,
} from "./workspace-relevance";
import {
  insertAgentRun,
  type AgentStep,
  type ChainEmail,
  type AgentRunRecord,
} from "./news-batches";

// The per-email agent chain: a four-agent pipeline that runs on EACH inbound
// email. Gate-first so we only pay for a summary on emails worth it:
//
//   gate(email)            → NewsVerdict     (is this material news? cheap)
//   summarize(email)       → string          (only if the gate passes)
//   categorize(summary)    → Categorization  (which news category)
//   append                 → display entry   (records the run; the visual reads it)
//
// Why per-email and not batched: batching only saves tokens by MERGING three
// emails into one summary, which blends unrelated newsletters into mush. Per
// email keeps each entry clean; running the cheap gate first recovers the
// token savings honestly (rejected junk never gets summarized).
//
// The chain does NOT write external_signals — classifyNewsletter (the existing
// per-email pipeline) owns the live signal feed, so writing here too would
// double every entry. The chain's output is the agent-run record, which is
// what the "Inside the agent" visual displays.
//
// Agents are injectable so the orchestration logic is testable without an LLM.

const HAIKU_MODEL = "claude-haiku-4-5";
const HAIKU_TIMEOUT_MS = 15_000;
// Body budget fed to the gate + summarizer for a single email.
const MAX_BODY_CHARS = 4_000;

const CATEGORIES: readonly ExternalSignalType[] = [
  "leadership_change",
  "champion_job_change",
  "ma_acquisition",
  "funding_round",
  "layoff",
  "earnings",
  "product_launch",
  "press_release",
  "competitor_mention",
  "regulatory_action",
  "partnership",
  "other",
];

// ─── Agent handoff types ─────────────────────────────────────────────────────

export interface NewsVerdict {
  isNews: boolean;
  reasoning: string;
}

export interface Categorization {
  category: ExternalSignalType;
  workspaceRelevance: WorkspaceRelevance;
}

// The three LLM agents. "append" isn't here — it's a local write the
// orchestrator performs (recording the run), shown as the 4th step.
export interface ChainAgents {
  gate(email: ChainEmail): Promise<NewsVerdict>;
  summarize(email: ChainEmail): Promise<string>;
  categorize(summary: string): Promise<Categorization>;
}

// ─── Anthropic plumbing (mirrors newsletter-adapter.ts) ──────────────────────

function getEnvOrFile(name: string): string | null {
  const env = process.env[name];
  if (env && env.trim().length > 0) return env.trim();
  try {
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(new RegExp(`^${escaped}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function anthropicClient(): Anthropic {
  const key = getEnvOrFile("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: HAIKU_TIMEOUT_MS });
}

async function haikuToolUse<T>(args: {
  prompt: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): Promise<T> {
  const client = anthropicClient();
  const res = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 512,
    temperature: 0,
    messages: [{ role: "user", content: args.prompt }],
    tools: [
      {
        name: args.toolName,
        description: args.description,
        input_schema: args.inputSchema as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: args.toolName },
  });
  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`${args.toolName}: model returned no tool_use block`);
  }
  return toolUse.input as T;
}

function preview(s: string, n = 220): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function sourceOf(email: ChainEmail): string {
  return email.publisher_canonical_name ?? email.from_domain;
}

function bodyText(email: ChainEmail): string {
  return (email.text_body ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BODY_CHARS);
}

// ─── Real agents ─────────────────────────────────────────────────────────────

// Agent 1: the news gate, on the RAW email. Cheap Haiku call that runs first so
// promotional/logistical junk never reaches the (pricier) summarizer.
async function gate(email: ChainEmail): Promise<NewsVerdict> {
  const result = await haikuToolUse<{ is_news: boolean; reasoning: string }>({
    prompt:
      "Decide whether this email describes genuine, material news (a real " +
      "business or market development a sales rep would care about) versus " +
      "promotional content, event logistics, or generic filler.\n\n" +
      `SUBJECT: ${email.subject ?? "(none)"}\nFROM: ${sourceOf(email)}\n\n${bodyText(email)}`,
    toolName: "submit_verdict",
    description: "Record whether the email passes as material news.",
    inputSchema: {
      type: "object",
      properties: {
        is_news: {
          type: "boolean",
          description:
            "true if the email describes a genuine, material development; false if promotional/logistical/filler.",
        },
        reasoning: {
          type: "string",
          description: "One sentence justifying the verdict.",
        },
      },
      required: ["is_news", "reasoning"],
    },
  });
  return { isNews: !!result.is_news, reasoning: result.reasoning ?? "" };
}

// Agent 2: distill the single email into one tight summary. Sonnet for quality.
async function summarize(email: ChainEmail): Promise<string> {
  const summary = await chat({
    system:
      "You summarize a single newsletter email for a B2B sales-intelligence feed. " +
      "Produce ONE tight sentence or two (max 60 words) capturing the most material, " +
      "newsworthy development. Lead with the concrete event. No preamble, no bullets, " +
      "no markdown — just the summary.",
    prompt: `SUBJECT: ${email.subject ?? "(none)"}\nSOURCE: ${sourceOf(email)}\n\n${bodyText(email)}`,
    maxTokens: 300,
    temperature: 0.2,
  });
  return summary.trim();
}

// Agent 3: categorize into one canonical signal category + relevance tier.
async function categorize(summary: string): Promise<Categorization> {
  const result = await haikuToolUse<{
    category: string;
    workspace_relevance: string;
  }>({
    prompt:
      "Categorize this news summary into exactly one category, and rate how " +
      "relevant it is to a B2B sales workspace.\n\n" +
      `SUMMARY:\n${summary}`,
    toolName: "submit_category",
    description: "Record the news category and workspace relevance.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [...CATEGORIES],
          description: "The single best-fit news category.",
        },
        workspace_relevance: {
          type: "string",
          enum: [...WORKSPACE_RELEVANCE_VALUES],
          description:
            "How relevant the development is to a B2B sales workspace overall.",
        },
      },
      required: ["category", "workspace_relevance"],
    },
  });
  const category = (CATEGORIES as readonly string[]).includes(result.category)
    ? (result.category as ExternalSignalType)
    : "other";
  return {
    category,
    workspaceRelevance:
      coerceWorkspaceRelevance(result.workspace_relevance) ?? "none",
  };
}

export const realAgents: ChainAgents = { gate, summarize, categorize };

// ─── Orchestration ───────────────────────────────────────────────────────────

// Run one email through the chain and return the agent-run record (the display
// dataset row + step trace). Does NOT persist — runAgentChainForEmail does.
// Pure relative to the injected agents, so the gate/reject/append branches are
// unit-testable without an LLM.
export async function processEmail(
  email: ChainEmail,
  agents: ChainAgents = realAgents,
): Promise<AgentRunRecord> {
  const source = sourceOf(email);
  const steps: AgentStep[] = [];
  const base = {
    email_ids: [email.id],
    email_subjects: [email.subject ?? ""],
    news_sources: source ? [source] : [],
    batch_summary: "",
  };

  // Agent 1 — News gate (runs first; cheap; gates the expensive summary).
  const t1 = Date.now();
  const verdict = await agents.gate(email);
  steps.push({
    agent: "gate",
    label: "News gate",
    status: "ok",
    started_at: new Date(t1).toISOString(),
    duration_ms: Date.now() - t1,
    input_preview: `${email.subject ?? "(no subject)"} · ${source}`,
    output_preview: `${verdict.isNews ? "PASS — material news" : "REJECT — not news"}: ${verdict.reasoning}`,
  });

  if (!verdict.isNews) {
    const at = new Date().toISOString();
    steps.push(
      {
        agent: "summarize",
        label: "Summarize",
        status: "skipped",
        started_at: at,
        duration_ms: 0,
        input_preview: "—",
        output_preview: "skipped — gate rejected the email (no summary tokens spent)",
      },
      {
        agent: "categorize",
        label: "Categorize",
        status: "skipped",
        started_at: at,
        duration_ms: 0,
        input_preview: "—",
        output_preview: "skipped",
      },
      {
        agent: "append",
        label: "Append to feed",
        status: "skipped",
        started_at: at,
        duration_ms: 0,
        input_preview: "—",
        output_preview: "skipped — nothing appended",
      },
    );
    return {
      ...base,
      is_news: false,
      gate_reasoning: verdict.reasoning,
      category: null,
      signal_id: null,
      status: "rejected",
      steps,
    };
  }

  // Agent 2 — Summarize (only reached when the gate passed).
  const t2 = Date.now();
  const summary = await agents.summarize(email);
  steps.push({
    agent: "summarize",
    label: "Summarize",
    status: "ok",
    started_at: new Date(t2).toISOString(),
    duration_ms: Date.now() - t2,
    input_preview: preview(`${email.subject ?? ""} — ${bodyText(email)}`),
    output_preview: preview(summary),
  });
  base.batch_summary = summary;

  // Agent 3 — Categorize.
  const t3 = Date.now();
  const category = await agents.categorize(summary);
  steps.push({
    agent: "categorize",
    label: "Categorize",
    status: "ok",
    started_at: new Date(t3).toISOString(),
    duration_ms: Date.now() - t3,
    input_preview: preview(summary),
    output_preview: `${category.category} · ${category.workspaceRelevance} relevance`,
  });

  // Agent 4 — Append the entry to the display feed. The actual write is the
  // insertAgentRun() in runAgentChainForEmail; this step records that action.
  steps.push({
    agent: "append",
    label: "Append to feed",
    status: "ok",
    started_at: new Date().toISOString(),
    duration_ms: 0,
    input_preview: `${category.category} · ${source}`,
    output_preview: `entry appended · ${category.category}`,
  });

  return {
    ...base,
    is_news: true,
    gate_reasoning: verdict.reasoning,
    category: category.category,
    signal_id: null,
    status: "appended",
    steps,
  };
}

// Run the chain for a single inbound email and persist the result. Fails soft:
// a chain error is recorded as an 'error' run rather than thrown, so a bad run
// never affects the webhook response or the per-email classifier.
export async function runAgentChainForEmail(
  email: ChainEmail,
  agents: ChainAgents = realAgents,
): Promise<AgentRunRecord> {
  let record: AgentRunRecord;
  try {
    record = await processEmail(email, agents);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const source = sourceOf(email);
    record = {
      email_ids: [email.id],
      email_subjects: [email.subject ?? ""],
      news_sources: source ? [source] : [],
      batch_summary: "",
      is_news: false,
      gate_reasoning: msg,
      category: null,
      signal_id: null,
      status: "error",
      steps: [
        {
          agent: "gate",
          label: "Agent chain",
          status: "error",
          started_at: new Date().toISOString(),
          duration_ms: 0,
          input_preview: email.subject ?? "(no subject)",
          output_preview: `error: ${msg}`,
        },
      ],
    };
  }
  await insertAgentRun(record);
  return record;
}
