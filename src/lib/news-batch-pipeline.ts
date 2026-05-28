import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chat } from "./claude";
import {
  WORKSPACE_ACCOUNT_ID,
  insertSignal,
  type ExternalSignalType,
} from "./external-signals";
import {
  coerceWorkspaceRelevance,
  WORKSPACE_RELEVANCE_VALUES,
  type WorkspaceRelevance,
} from "./workspace-relevance";
import {
  BATCH_SIZE,
  claimNextBatch,
  insertBatchRecord,
  type AgentStep,
  type BatchEmail,
  type NewsBatchRecord,
} from "./news-batches";

// The batch-of-3 news orchestrator: a four-agent chain that fires whenever
// three inbound emails have accumulated. Each agent hands a typed payload to
// the next:
//
//   summarize(emails)          → BatchSummary   (combined summary + sources)
//   gate(summary)              → NewsVerdict    (does this pass as news?)
//   categorize(summary)        → Categorization (which news category)
//   append(summary, category)  → { signalId }   (entry in the display dataset)
//
// Runs ALONGSIDE the per-email pipeline (inbound-pipeline.ts) — it never
// replaces it. The agents are injectable so the orchestration logic can be
// tested without hitting an LLM or Supabase.

const HAIKU_MODEL = "claude-haiku-4-5";
const HAIKU_TIMEOUT_MS = 15_000;
// Per-email body budget fed to the summarizer. Three emails at 2.5k chars
// keeps the combined prompt well inside a cheap Haiku/Sonnet call.
const MAX_BODY_CHARS = 2_500;
// Safety cap on how many batches one trigger drains in a single pass, so a
// large backlog can't turn one webhook into an unbounded LLM spend loop.
const MAX_BATCHES_PER_RUN = 4;

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

// Agent 1 → Agent 2/3/4. Carries the combined summary plus the "data location"
// (which emails it came from) so downstream agents and the display dataset can
// trace every entry back to its sources.
export interface BatchSummary {
  emailIds: string[];
  emailSubjects: string[];
  sources: string[];
  summary: string;
}

// Agent 2 → orchestrator. The news gate.
export interface NewsVerdict {
  isNews: boolean;
  reasoning: string;
}

// Agent 3 → Agent 4.
export interface Categorization {
  category: ExternalSignalType;
  workspaceRelevance: WorkspaceRelevance;
}

export interface BatchAgents {
  summarize(emails: BatchEmail[]): Promise<BatchSummary>;
  gate(summary: BatchSummary): Promise<NewsVerdict>;
  categorize(summary: BatchSummary): Promise<Categorization>;
  append(
    summary: BatchSummary,
    category: Categorization,
  ): Promise<{ signalId: string | null }>;
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

// Forced single-tool call → returns the validated tool input. Deterministic
// (temperature 0). Same shape the newsletter adapter uses for structured
// extraction.
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

function sourcesOf(emails: BatchEmail[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const s = e.publisher_canonical_name ?? e.from_domain;
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ─── Real agents ─────────────────────────────────────────────────────────────

// Agent 1: read the three emails and produce one combined summary. Sonnet
// (via chat()) for the synthesis quality — it has to find the through-line
// across three potentially unrelated newsletters.
async function summarize(emails: BatchEmail[]): Promise<BatchSummary> {
  const blocks = emails
    .map((e, i) => {
      const body = (e.text_body ?? "").trim().slice(0, MAX_BODY_CHARS);
      const src = e.publisher_canonical_name ?? e.from_domain;
      return `EMAIL ${i + 1} — source: ${src}\nSubject: ${e.subject ?? "(none)"}\n${body}`;
    })
    .join("\n\n---\n\n");

  const summary = await chat({
    system:
      "You summarize batches of newsletter emails for a B2B sales-intelligence feed. " +
      "Produce ONE tight paragraph (max 80 words) capturing the most material, " +
      "newsworthy development across the emails. Lead with the concrete event. " +
      "If the emails share no common thread, summarize the single most significant item. " +
      "No preamble, no bullet points, no markdown — just the paragraph.",
    prompt: `Summarize the material news across these ${emails.length} emails:\n\n${blocks}`,
    maxTokens: 400,
    temperature: 0.2,
  });

  return {
    emailIds: emails.map((e) => e.id),
    emailSubjects: emails.map((e) => e.subject ?? ""),
    sources: sourcesOf(emails),
    summary: summary.trim(),
  };
}

// Agent 2: the news gate. Does the combined summary describe a genuine,
// material business/market development — or is it promotional/logistical noise?
async function gate(summary: BatchSummary): Promise<NewsVerdict> {
  const result = await haikuToolUse<{ is_news: boolean; reasoning: string }>({
    prompt:
      "Decide whether the following summary describes genuine, material news " +
      "(a real business or market development a sales rep would care about) as " +
      "opposed to promotional content, event logistics, or generic filler.\n\n" +
      `SUMMARY:\n${summary.summary}`,
    toolName: "submit_verdict",
    description: "Record whether the summary passes as material news.",
    inputSchema: {
      type: "object",
      properties: {
        is_news: {
          type: "boolean",
          description:
            "true if the summary describes a genuine, material development; false if promotional/logistical/filler.",
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

// Agent 3: categorize the news into one of the canonical signal categories.
async function categorize(summary: BatchSummary): Promise<Categorization> {
  const result = await haikuToolUse<{
    category: string;
    workspace_relevance: string;
  }>({
    prompt:
      "Categorize this news summary into exactly one category, and rate how " +
      "relevant it is to a B2B sales workspace.\n\n" +
      `SUMMARY:\n${summary.summary}`,
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

// Agent 4: append the passed entry to the display dataset. Writes an
// external_signals row (workspace-scoped, so it renders in the live feed) and
// returns its id for the news_batches audit record. The source emails are
// carried in meta so every entry traces back to its origin.
async function append(
  summary: BatchSummary,
  category: Categorization,
): Promise<{ signalId: string | null }> {
  const row = await insertSignal({
    account_id: WORKSPACE_ACCOUNT_ID,
    source: "newsletter",
    type: category.category,
    summary: summary.summary,
    occurred_at: new Date().toISOString(),
    publisher_canonical_name: summary.sources[0] ?? null,
    workspace_relevance: category.workspaceRelevance,
    meta: {
      origin: "news-batch",
      batch_email_ids: summary.emailIds,
      batch_sources: summary.sources,
    },
  });
  return { signalId: row.id };
}

export const realAgents: BatchAgents = { summarize, gate, categorize, append };

// ─── Orchestration ───────────────────────────────────────────────────────────

// Run one batch of emails through the chain and return the display-dataset
// record. Does NOT persist — the caller (runPendingBatches) writes it so the
// claim → process → record lifecycle stays in one place. Pure relative to the
// injected agents, which makes the gate/reject/append branches unit-testable.
export async function processBatch(
  emails: BatchEmail[],
  agents: BatchAgents = realAgents,
): Promise<NewsBatchRecord> {
  const steps: AgentStep[] = [];

  // Agent 1 — Summarize.
  const t1 = Date.now();
  const summary = await agents.summarize(emails);
  steps.push({
    agent: "summarize",
    label: "Summarize batch",
    status: "ok",
    started_at: new Date(t1).toISOString(),
    duration_ms: Date.now() - t1,
    input_preview: `${emails.length} emails · ${emails
      .map((e) => e.subject ?? "(no subject)")
      .join(" · ")}`,
    output_preview: preview(summary.summary),
  });

  const base = {
    email_ids: summary.emailIds,
    email_subjects: summary.emailSubjects,
    news_sources: summary.sources,
    batch_summary: summary.summary,
  };

  // Agent 2 — News gate.
  const t2 = Date.now();
  const verdict = await agents.gate(summary);
  steps.push({
    agent: "gate",
    label: "News gate",
    status: "ok",
    started_at: new Date(t2).toISOString(),
    duration_ms: Date.now() - t2,
    input_preview: preview(summary.summary),
    output_preview: `${verdict.isNews ? "PASS — material news" : "REJECT — not news"}: ${verdict.reasoning}`,
  });

  if (!verdict.isNews) {
    const skippedAt = new Date().toISOString();
    steps.push(
      {
        agent: "categorize",
        label: "Categorize",
        status: "skipped",
        started_at: skippedAt,
        duration_ms: 0,
        input_preview: "—",
        output_preview: "skipped — gate rejected the batch",
      },
      {
        agent: "append",
        label: "Append to feed",
        status: "skipped",
        started_at: skippedAt,
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

  // Agent 3 — Categorize.
  const t3 = Date.now();
  const category = await agents.categorize(summary);
  steps.push({
    agent: "categorize",
    label: "Categorize",
    status: "ok",
    started_at: new Date(t3).toISOString(),
    duration_ms: Date.now() - t3,
    input_preview: preview(summary.summary),
    output_preview: `${category.category} · ${category.workspaceRelevance} relevance`,
  });

  // Agent 4 — Append.
  const t4 = Date.now();
  const { signalId } = await agents.append(summary, category);
  steps.push({
    agent: "append",
    label: "Append to feed",
    status: "ok",
    started_at: new Date(t4).toISOString(),
    duration_ms: Date.now() - t4,
    input_preview: `${category.category} · sources: ${summary.sources.join(", ")}`,
    output_preview: signalId
      ? `signal ${signalId.slice(0, 8)}… written to the live feed`
      : "appended to feed",
  });

  return {
    ...base,
    is_news: true,
    gate_reasoning: verdict.reasoning,
    category: category.category,
    signal_id: signalId,
    status: "appended",
    steps,
  };
}

// Drain accumulated emails into batches of BATCH_SIZE, running the chain on
// each and persisting the resulting record. Returns the records produced this
// pass (empty when fewer than BATCH_SIZE emails are pending). Fails soft:
// a chain error is recorded as a 'error' batch rather than thrown, so one bad
// batch never blocks the next or bubbles into the webhook response.
export async function runPendingBatches(opts?: {
  maxBatches?: number;
  agents?: BatchAgents;
}): Promise<NewsBatchRecord[]> {
  const max = opts?.maxBatches ?? MAX_BATCHES_PER_RUN;
  const agents = opts?.agents ?? realAgents;
  const produced: NewsBatchRecord[] = [];

  for (let i = 0; i < max; i++) {
    const emails = await claimNextBatch(BATCH_SIZE);
    if (!emails) break;

    let record: NewsBatchRecord;
    try {
      record = await processBatch(emails, agents);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record = {
        email_ids: emails.map((x) => x.id),
        email_subjects: emails.map((x) => x.subject ?? ""),
        news_sources: sourcesOf(emails),
        batch_summary: "",
        is_news: false,
        gate_reasoning: msg,
        category: null,
        signal_id: null,
        status: "error",
        steps: [
          {
            agent: "summarize",
            label: "Agent chain",
            status: "error",
            started_at: new Date().toISOString(),
            duration_ms: 0,
            input_preview: `${emails.length} emails`,
            output_preview: `error: ${msg}`,
          },
        ],
      };
    }
    await insertBatchRecord(record);
    produced.push(record);
  }

  return produced;
}
