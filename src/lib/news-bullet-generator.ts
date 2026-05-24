// Haiku-powered bullet rewriter for kept NewsAPI articles.
//
//   generateBullet(input, deps?): Promise<BulletGenOutput>
//
// Takes a kept article + its filter decision and produces a crisp ≤100-char
// AE-scanning bullet that lands in external_signals.summary. Mirrors the
// ranker.ts shape: single forced tool-use round-trip with a deterministic
// fail-soft to the article title (truncated) on every error path.
//
// The orchestrator (L1.c) MUST NEVER see a thrown error from this module —
// the outer try/catch is the safety net. For low_signal verdicts the
// orchestrator should bypass us entirely and call `fallbackBullet` directly.
//
// Provider: Anthropic Haiku 4.5, single forced tool call. We do NOT reuse
// anthropic-ask.ts (multi-turn chat) — this is single-shot like ranker.ts.

import Anthropic from "@anthropic-ai/sdk";

import { HAS_ANTHROPIC_KEY, getAnthropicClient } from "./anthropic-ask";
import type { ArticleInput, WorkspaceRelevance } from "./news-filter-types";

// Haiku model id — centralized so a model bump is one line.
const HAIKU_MODEL = "claude-haiku-4-5";

// Hard request timeout (ms). Bullet generation is cheap; 8s is generous.
const HAIKU_TIMEOUT_MS = 8_000;

// Bullet length cap — also enforced in the tool schema and post-validated.
const BULLET_MAX_CHARS = 100;
const BULLET_MIN_CHARS = 12;

// ─── Public types ───────────────────────────────────────────────────────

export interface BulletGenInput {
  article: ArticleInput;
  workspace_relevance: WorkspaceRelevance;
  account_name: string;
}

export interface BulletGenOutput {
  bullet: string;
  source: "haiku" | "fallback";
  fallbackReason?:
    | "no_api_key"
    | "haiku_5xx"
    | "haiku_timeout"
    | "haiku_schema_violation"
    | "haiku_overlong";
}

export interface BulletGenDeps {
  // Test seam: inject a fake call so tests don't hit the network.
  haikuCall?: (args: {
    systemPrompt: string;
    userMessage: string;
    toolSchema: unknown;
    timeoutMs: number;
  }) => Promise<unknown>;
  hasApiKey?: boolean;
}

// ─── Tool schema ────────────────────────────────────────────────────────

const TOOL_NAME = "submit_bullet";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Submit the rewritten bullet. Call this exactly once with the final ≤100-char line.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["bullet"],
    properties: {
      bullet: {
        type: "string",
        minLength: BULLET_MIN_CHARS,
        maxLength: BULLET_MAX_CHARS,
      },
    },
  },
};

// ─── System prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You rewrite a news article title into a crisp ≤100-char bullet for a B2B sales account executive scanning their pre-meeting briefing.",
  "",
  "Rules:",
  "- One line. ≤100 chars including punctuation. Plain prose, no markdown, no emoji, no exclamation marks.",
  "- Lead with the entity name + verb. Drop fluff (\"today announced that...\", \"in a statement\"). Keep dollar amounts, dates, and proper nouns.",
  "- If the article names a specific company, lead with that company's name.",
  "- Match the AE's voice: factual, terse, no marketing tone.",
  "- Do not invent facts. If the title already fits within 100 chars and reads well, keep it as-is.",
  "- You MUST emit your answer via the submit_bullet tool. Free-text replies are invalid.",
].join("\n");

// ─── User message construction ──────────────────────────────────────────

function buildUserMessage(input: BulletGenInput): string {
  const { article } = input;
  return [
    `Article title: ${article.title}`,
    `Source: ${article.source_name}`,
    `Description: ${article.description ?? "(no description)"}`,
    ``,
    `Rewrite as a ≤100-char AE bullet.`,
  ].join("\n");
}

// ─── Classify SDK errors → fallbackReason ───────────────────────────────

type HaikuFailReason = "haiku_5xx" | "haiku_timeout" | "haiku_schema_violation";

function classifyError(e: unknown): HaikuFailReason {
  if (e instanceof Anthropic.APIError && e.status >= 500 && e.status < 600) {
    return "haiku_5xx";
  }
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) {
    return "haiku_timeout";
  }
  // 4xx + network → collapse to 5xx category, same posture as ranker.ts.
  return "haiku_5xx";
}

// ─── Fallback helper ────────────────────────────────────────────────────
//
// Pure (no Date.now, no fetch) per BUILD_ALIGNMENT #7. Exported for L1.c
// to call directly on low_signal verdicts where we don't want to spend a
// Haiku call, and for tests.

export function fallbackBullet(article: ArticleInput): BulletGenOutput {
  const title = (article.title ?? "").trim();
  const bullet =
    title.length <= BULLET_MAX_CHARS
      ? title
      : title.slice(0, BULLET_MAX_CHARS - 1).trimEnd() + "…";
  return { bullet, source: "fallback" };
}

// ─── Main entry ─────────────────────────────────────────────────────────

export async function generateBullet(
  input: BulletGenInput,
  deps: BulletGenDeps = {},
): Promise<BulletGenOutput> {
  // Outer safety net — orchestrator must never see a throw from us.
  try {
    return await generateBulletInner(input, deps);
  } catch (e) {
    console.warn(
      `[news-bullet] unhandled_error: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { ...fallbackBullet(input.article), fallbackReason: "haiku_schema_violation" };
  }
}

async function generateBulletInner(
  input: BulletGenInput,
  deps: BulletGenDeps,
): Promise<BulletGenOutput> {
  const hasKey = deps.hasApiKey ?? HAS_ANTHROPIC_KEY;
  if (!hasKey) {
    return { ...fallbackBullet(input.article), fallbackReason: "no_api_key" };
  }

  const systemPrompt = SYSTEM_PROMPT;
  const userMessage = buildUserMessage(input);

  let toolInput: unknown;
  try {
    const call = deps.haikuCall ?? (async (args) => callHaikuReal(args));
    toolInput = await call({
      systemPrompt,
      userMessage,
      toolSchema: TOOL_SCHEMA,
      timeoutMs: HAIKU_TIMEOUT_MS,
    });
  } catch (e) {
    const reason = classifyError(e);
    const tagMsg = e instanceof Error ? e.message : String(e);
    if (reason === "haiku_5xx") {
      const status = e instanceof Anthropic.APIError ? e.status : "n/a";
      console.warn(`[news-bullet] haiku_5xx status=${status} — fallback: ${tagMsg}`);
    } else {
      console.warn(`[news-bullet] ${reason} after ${HAIKU_TIMEOUT_MS / 1000}s — fallback: ${tagMsg}`);
    }
    return { ...fallbackBullet(input.article), fallbackReason: reason };
  }

  // Parse the tool input. Haiku returns { bullet: "..." }.
  if (!toolInput || typeof toolInput !== "object") {
    console.warn(`[news-bullet] haiku_schema_violation: tool input not an object`);
    return { ...fallbackBullet(input.article), fallbackReason: "haiku_schema_violation" };
  }
  const raw = (toolInput as Record<string, unknown>).bullet;
  if (typeof raw !== "string" || raw.length === 0) {
    console.warn(`[news-bullet] haiku_schema_violation: bullet missing or not string`);
    return { ...fallbackBullet(input.article), fallbackReason: "haiku_schema_violation" };
  }

  const bullet = raw.trim();
  if (bullet.length === 0) {
    return { ...fallbackBullet(input.article), fallbackReason: "haiku_schema_violation" };
  }
  // Defensive: Anthropic occasionally violates maxLength. Fail-soft to title.
  if (bullet.length > BULLET_MAX_CHARS) {
    console.warn(
      `[news-bullet] haiku_overlong: ${bullet.length} chars > ${BULLET_MAX_CHARS}`,
    );
    return { ...fallbackBullet(input.article), fallbackReason: "haiku_overlong" };
  }

  return { bullet, source: "haiku" };
}

// ─── Real Anthropic call ─────────────────────────────────────────────────
//
// Single tool-use round trip. We force tool_choice to "submit_bullet" so
// Haiku cannot emit a free-text reply.

async function callHaikuReal(args: {
  systemPrompt: string;
  userMessage: string;
  toolSchema: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Anthropic client unavailable");

  const schema = args.toolSchema as typeof TOOL_SCHEMA;

  // Wall-clock timeout via AbortController. The SDK has its own retries;
  // this caps the total budget.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 200,
        temperature: 0.3,
        system: args.systemPrompt,
        tools: [
          {
            name: schema.name,
            description: schema.description,
            input_schema: schema.input_schema as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: schema.name },
        messages: [{ role: "user", content: args.userMessage }],
      },
      { signal: ac.signal },
    );
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === schema.name,
    );
    if (!toolUse) {
      throw new Error("Haiku returned no tool_use block");
    }
    return toolUse.input;
  } finally {
    clearTimeout(timer);
  }
}
