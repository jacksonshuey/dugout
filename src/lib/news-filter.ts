// Public entry point for the news content filter.
//
//   filterArticle(input, deps?): Promise<FilterArticleOutput>
//
// Orchestrates Stage 1 (deterministic) → Stage 2 (Haiku) → bullet generation.
// Does NOT touch Supabase — the caller (news-adapter) inserts the signal and
// writes the audit row using the returned {decision, bullet}.
//
// Provider: Anthropic Haiku 4.5, single tool-use round-trip for Stage 2.
// Mirrors ranker.ts + email-filter.ts: forced tool_choice, schema-validated
// post-hoc, AbortController wall-clock cap.
//
// Fail-CLOSED-but-soft posture for Stage 2: any Haiku failure (no key, 5xx,
// timeout, schema violation, unhandled exception) collapses to verdict
// `low_signal` + workspace_relevance `low`. We do NOT drop on infra failure
// — that would lose signal during Anthropic incidents. The article still
// flows through with a deterministic-fallback bullet so the AE Brief filter
// (which keeps only high/medium) just hides it; account drawer still gets it.

import Anthropic from "@anthropic-ai/sdk";

import { HAS_ANTHROPIC_KEY, getAnthropicClient } from "./anthropic-ask";
import {
  fallbackBullet,
  generateBullet,
  type BulletGenDeps,
} from "./news-bullet-generator";
import {
  getNewsStage2SystemPrompt,
  getNewsStage2UserMessage,
} from "./news-filter-stage2-prompt";
import { stage1Filter } from "./news-filter-stage1";
import {
  PROMPT_VERSION,
  type ArticleInput,
  type FilterContext,
  type NewsFilterDecision,
  type NewsVerdict,
  type Stage2Result,
  type WorkspaceRelevance,
} from "./news-filter-types";

const HAIKU_MODEL = "claude-haiku-4-5";

// Wall-clock budget for the Stage 2 call. Tighter than email-filter's 15s
// because the news cron processes many articles per account and the Vercel
// Hobby per-function cap is 60s.
const STAGE2_TIMEOUT_MS = 10_000;

const VALID_VERDICTS: ReadonlyArray<NewsVerdict> = [
  "newsworthy",
  "low_signal",
  "rejected",
];
const VALID_RELEVANCE: ReadonlyArray<WorkspaceRelevance> = [
  "high",
  "medium",
  "low",
  "none",
];

// ─── Tool schema ────────────────────────────────────────────────────────

const TOOL_NAME = "submit_verdict";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description: "Submit the gate verdict. Call this exactly once.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["verdict", "workspace_relevance", "confidence", "reasoning"],
    properties: {
      verdict: { type: "string", enum: VALID_VERDICTS as unknown as string[] },
      workspace_relevance: {
        type: "string",
        enum: VALID_RELEVANCE as unknown as string[],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string", minLength: 5, maxLength: 220 },
    },
  },
};

// ─── Public types ───────────────────────────────────────────────────────

export interface FilterArticleInput {
  article: ArticleInput;
  context: FilterContext;
}

export interface FilterArticleOutput {
  decision: NewsFilterDecision;
  // Only populated when decision.verdict !== 'rejected'.
  bullet?: string;
}

export interface FilterArticleDeps {
  // Test seam: inject a fake Stage 2 Haiku call. Returns the tool_use.input
  // object the SDK would have returned, or throws.
  stage2HaikuCall?: (args: {
    systemPrompt: string;
    userMessage: string;
    toolSchema: unknown;
    timeoutMs: number;
  }) => Promise<unknown>;
  // Test seam for the bullet generator.
  bulletDeps?: BulletGenDeps;
  // Test seam for HAS_ANTHROPIC_KEY.
  hasApiKey?: boolean;
}

// ─── Validation ─────────────────────────────────────────────────────────

interface ValidationOk {
  ok: true;
  output: Stage2Result;
}
interface ValidationErr {
  ok: false;
  reason: string;
}

function validateStage2Output(raw: unknown): ValidationOk | ValidationErr {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "tool input not an object" };
  }
  const obj = raw as Record<string, unknown>;
  const { verdict, workspace_relevance: relevance, confidence, reasoning } = obj;

  if (
    typeof verdict !== "string" ||
    !VALID_VERDICTS.includes(verdict as NewsVerdict)
  ) {
    return { ok: false, reason: `verdict invalid (${String(verdict)})` };
  }
  if (
    typeof relevance !== "string" ||
    !VALID_RELEVANCE.includes(relevance as WorkspaceRelevance)
  ) {
    return {
      ok: false,
      reason: `workspace_relevance invalid (${String(relevance)})`,
    };
  }
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return { ok: false, reason: `confidence invalid (${String(confidence)})` };
  }
  if (
    typeof reasoning !== "string" ||
    reasoning.length < 5 ||
    reasoning.length > 220
  ) {
    return {
      ok: false,
      reason: `reasoning invalid (length=${typeof reasoning === "string" ? reasoning.length : "n/a"})`,
    };
  }

  return {
    ok: true,
    output: {
      verdict: verdict as NewsVerdict,
      workspace_relevance: relevance as WorkspaceRelevance,
      confidence,
      reasoning,
      model: HAIKU_MODEL,
    },
  };
}

// ─── Error classification ───────────────────────────────────────────────

type Stage2FailReason =
  | "no_api_key"
  | "haiku_5xx"
  | "haiku_timeout"
  | "haiku_schema_violation"
  | "unhandled";

function classifyError(e: unknown): Stage2FailReason {
  if (e instanceof Anthropic.APIError && e.status >= 500 && e.status < 600) {
    return "haiku_5xx";
  }
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted")
  ) {
    return "haiku_timeout";
  }
  // 4xx + network → collapse to 5xx category. Same posture as ranker.ts.
  return "haiku_5xx";
}

// ─── Failsoft helper ────────────────────────────────────────────────────

function buildFailsoftDecision(reason: Stage2FailReason): NewsFilterDecision {
  return {
    verdict: "low_signal",
    workspace_relevance: "low",
    stage: 2,
    rule: null,
    confidence: 0,
    reasoning: `stage2_failsoft: ${reason}`,
    model: "fallback",
    prompt_version: PROMPT_VERSION,
  };
}

async function failsoft(
  article: ArticleInput,
  context: FilterContext,
  reason: Stage2FailReason,
  deps: FilterArticleDeps,
): Promise<FilterArticleOutput> {
  const decision = buildFailsoftDecision(reason);
  const bullet = await runBulletGen(article, decision.workspace_relevance, context, deps);
  return { decision, bullet };
}

// ─── Main entry ─────────────────────────────────────────────────────────

export async function filterArticle(
  input: FilterArticleInput,
  deps: FilterArticleDeps = {},
): Promise<FilterArticleOutput> {
  // Outer safety net — mirrors ranker.ts. The cron + adapter must never see
  // a thrown error from the filter pipeline.
  try {
    return await filterArticleInner(input, deps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[news-filter] stage2_failsoft: unhandled url=${input.article.url} — ${msg}`,
    );
    return failsoft(input.article, input.context, "unhandled", deps);
  }
}

async function filterArticleInner(
  input: FilterArticleInput,
  deps: FilterArticleDeps,
): Promise<FilterArticleOutput> {
  const { article, context } = input;

  // ── Stage 1: deterministic rules ────────────────────────────────────
  const stage1 = stage1Filter(article);
  if (stage1.verdict === "rejected") {
    return {
      decision: {
        verdict: "rejected",
        workspace_relevance: "none",
        stage: 1,
        rule: stage1.rule,
        confidence: null,
        reasoning: stage1.reason,
        model: null,
        prompt_version: PROMPT_VERSION,
      },
    };
  }

  // ── Stage 2: API key check ──────────────────────────────────────────
  const hasKey = deps.hasApiKey ?? HAS_ANTHROPIC_KEY;
  if (!hasKey) {
    console.warn(
      `[news-filter] stage2_failsoft: no_api_key url=${article.url}`,
    );
    return failsoft(article, context, "no_api_key", deps);
  }

  // ── Stage 2: Haiku call ─────────────────────────────────────────────
  let toolInput: unknown;
  try {
    const call =
      deps.stage2HaikuCall ?? (async (args) => callHaikuReal(args));
    toolInput = await call({
      systemPrompt: getNewsStage2SystemPrompt(),
      userMessage: getNewsStage2UserMessage({ article, context }),
      toolSchema: TOOL_SCHEMA,
      timeoutMs: STAGE2_TIMEOUT_MS,
    });
  } catch (e) {
    const reason = classifyError(e);
    const tagMsg = e instanceof Error ? e.message : String(e);
    const status = e instanceof Anthropic.APIError ? e.status : null;
    console.warn(
      `[news-filter] stage2_failsoft: ${reason}${status !== null ? ` status=${status}` : ""} url=${article.url} — ${tagMsg}`,
    );
    return failsoft(article, context, reason, deps);
  }

  // ── Stage 2: post-validation ────────────────────────────────────────
  const validated = validateStage2Output(toolInput);
  if (!validated.ok) {
    console.warn(
      `[news-filter] stage2_failsoft: haiku_schema_violation url=${article.url} reason=${validated.reason}`,
    );
    return failsoft(article, context, "haiku_schema_violation", deps);
  }

  const stage2 = validated.output;

  // Stage 2 reported a hard reject — honor it. No bullet needed (adapter
  // doesn't generate one for rejected verdicts).
  if (stage2.verdict === "rejected") {
    return {
      decision: {
        verdict: "rejected",
        // Prompt enforces "none" on reject; coerce defensively.
        workspace_relevance: "none",
        stage: 2,
        rule: null,
        confidence: stage2.confidence,
        reasoning: stage2.reasoning,
        model: stage2.model,
        prompt_version: PROMPT_VERSION,
      },
    };
  }

  // Kept article — build decision and generate bullet.
  const decision: NewsFilterDecision = {
    verdict: stage2.verdict,
    workspace_relevance: stage2.workspace_relevance,
    stage: 2,
    rule: null,
    confidence: stage2.confidence,
    reasoning: stage2.reasoning,
    model: stage2.model,
    prompt_version: PROMPT_VERSION,
  };
  const bullet = await runBulletGen(article, decision.workspace_relevance, context, deps);
  return { decision, bullet };
}

// ─── Bullet generation wrapper ──────────────────────────────────────────
//
// generateBullet is itself fail-soft, but wrap defensively so an unexpected
// throw cannot escape the filter pipeline.

async function runBulletGen(
  article: ArticleInput,
  workspace_relevance: WorkspaceRelevance,
  context: FilterContext,
  deps: FilterArticleDeps,
): Promise<string> {
  try {
    const out = await generateBullet(
      { article, workspace_relevance, account_name: context.account_name },
      deps.bulletDeps,
    );
    return out.bullet;
  } catch (e) {
    console.warn(
      `[news-filter] bullet_unhandled url=${article.url} — ${e instanceof Error ? e.message : String(e)}`,
    );
    return fallbackBullet(article).bullet;
  }
}

// ─── Real Anthropic call ────────────────────────────────────────────────
//
// Single tool-use round trip with forced tool_choice. AbortController caps
// total wall clock independent of the SDK's per-attempt retries.

async function callHaikuReal(args: {
  systemPrompt: string;
  userMessage: string;
  toolSchema: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Anthropic client unavailable");

  const schema = args.toolSchema as typeof TOOL_SCHEMA;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 400,
        temperature: 0.3,
        system: args.systemPrompt,
        tools: [
          {
            name: schema.name,
            description: schema.description,
            input_schema:
              schema.input_schema as unknown as Anthropic.Tool.InputSchema,
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
    if (!toolUse) throw new Error("Haiku returned no tool_use block");
    return toolUse.input;
  } finally {
    clearTimeout(timer);
  }
}
