// Public entry point for the email content filter.
//
//   filterEmail(input, deps): Promise<FilterResult>
//
// Orchestrates Stage 1 → Stage 2 → routing + fail-closed handling. Every
// branch writes an audit row (best-effort; audit failures are logged but
// the routing decision is honored).
//
// Provider: Anthropic Haiku 4.5, single tool-use round-trip. Mirrors the
// ranker's pattern — single-shot, forced tool_choice, schema-validated
// post-hoc. We do NOT reuse anthropic-ask.ts directly because the
// HAS_ANTHROPIC_KEY + getAnthropicClient() pair from there is already the
// right surface; we just import it.
//
// Fail-CLOSED at the gate: any Haiku failure (5xx, timeout, malformed,
// schema violation, low-confidence, no-api-key) routes to `needs_review`.
// Opposite to the ranker's fail-OPEN posture — false positives in
// /market-intel are worse than missed items per design §0.
//
// Design doc: /docs/filter-design.md §6 + §8.

import Anthropic from "@anthropic-ai/sdk";

import { HAS_ANTHROPIC_KEY, getAnthropicClient } from "./anthropic-ask";
import { runStage1 } from "./email-filter-stage1";
import {
  STAGE2_PROMPT_VERSION,
  getStage2SystemPrompt,
} from "./email-filter-stage2-prompt";
import {
  writeDecision,
  type EmailFilterDecisionsDeps,
} from "./email-filter-decisions";
import type {
  FilterInput,
  FilterResult,
  Stage2FailureReason,
  Stage2Output,
  Stage2Verdict,
} from "./email-filter-types";
import type { InboundEmail } from "./inbound-email";
import {
  WORKSPACE_RELEVANCE_TOOL_PROPERTY,
  WORKSPACE_RELEVANCE_VALUES,
  coerceWorkspaceRelevance,
  type WorkspaceRelevance,
} from "./workspace-relevance";

// Haiku model id — centralized here so a model bump is one line.
const HAIKU_MODEL = "claude-haiku-4-5";

// Hard request timeout (ms). The SDK retries 5xx with backoff; this is the
// total wall-clock budget for the entire request including retries.
const HAIKU_TIMEOUT_MS = 15_000;

// Routing threshold: verdicts at or above this confidence are honored.
// Below this, we route to needs_review regardless of which verdict the
// model picked (design §0 + §4).
export const CONFIDENCE_THRESHOLD = 0.7;

// Body excerpt cap for the user message. Lower than the classifier's 12K
// because the gate doesn't need full context (design §4 user message).
const STAGE2_BODY_MAX_CHARS = 8_000;

const VALID_VERDICTS: ReadonlyArray<Stage2Verdict> = [
  "newsworthy",
  "logistics",
  "promotional",
  "other",
];

// ─── Tool schema ─────────────────────────────────────────────────────────

function buildToolSchema() {
  return {
    name: "submit_verdict",
    description: "Submit the gate verdict. Call this exactly once.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["verdict", "workspace_relevance", "confidence", "reasoning"],
      properties: {
        verdict: {
          type: "string",
          enum: VALID_VERDICTS as unknown as string[],
        },
        // Added in the Phase 3 unification — every email decision now
        // carries one of the four workspace-relevance tiers so downstream
        // ranker code has a consistent hint regardless of source.
        workspace_relevance: WORKSPACE_RELEVANCE_TOOL_PROPERTY,
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        reasoning: {
          type: "string",
          minLength: 10,
          maxLength: 200,
        },
      },
    },
  };
}

// ─── HTML → plaintext (mirror of newsletter-adapter) ─────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function emailBodyForGate(email: InboundEmail): string {
  const text =
    email.text_body && email.text_body.length > 100
      ? email.text_body
      : email.html_body
        ? stripHtml(email.html_body)
        : (email.text_body ?? "");
  return text.slice(0, STAGE2_BODY_MAX_CHARS);
}

// ─── User message construction ──────────────────────────────────────────

function buildUserMessage(input: FilterInput, bodyExcerpt: string): string {
  const { email, publisherInfo } = input;
  return [
    `Publisher: ${publisherInfo.display_name} (${publisherInfo.publisher_canonical_name})`,
    `Sender domain: ${email.from_domain}`,
    `From address: ${email.from_address}`,
    `Subject: ${email.subject ?? "(no subject)"}`,
    `Received: ${email.received_at}`,
    ``,
    `Body (first ${bodyExcerpt.length} chars, HTML stripped):`,
    bodyExcerpt,
  ].join("\n");
}

// ─── Validation ──────────────────────────────────────────────────────────

interface ValidationOk {
  ok: true;
  output: Stage2Output;
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
  const verdict = obj.verdict;
  const confidence = obj.confidence;
  const reasoning = obj.reasoning;

  if (typeof verdict !== "string" || !VALID_VERDICTS.includes(verdict as Stage2Verdict)) {
    return { ok: false, reason: `verdict invalid (${String(verdict)})` };
  }
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return { ok: false, reason: `confidence invalid (${String(confidence)})` };
  }
  // The prompt asks for ≤200 chars but Haiku 4.5 routinely overshoots to
  // 200-300. The validator's job is to catch malformed output (truncated,
  // wrong type), not to fail-close on minor stylistic overshoot. Cap at 500
  // — generous enough for natural variance, bounded enough to detect a
  // runaway response.
  if (
    typeof reasoning !== "string" ||
    reasoning.length < 10 ||
    reasoning.length > 500
  ) {
    return {
      ok: false,
      reason: `reasoning invalid (length=${typeof reasoning === "string" ? reasoning.length : "n/a"})`,
    };
  }

  // Coerce workspace_relevance. Missing/invalid → "low" (defensive
  // default; the AE Brief filter still hides low/none rows). When verdict
  // is anything but 'newsworthy' we coerce to "none" since logistics/
  // promotional/other content has no workspace-relevance signal.
  const coerced = coerceWorkspaceRelevance(obj.workspace_relevance);
  const workspace_relevance: WorkspaceRelevance =
    verdict === "newsworthy" ? (coerced ?? "low") : "none";

  return {
    ok: true,
    output: {
      verdict: verdict as Stage2Verdict,
      workspace_relevance,
      confidence,
      reasoning,
    },
  };
}

// Re-export the canonical value list so callers/tests can assert against
// the same source-of-truth without importing both modules.
export const STAGE2_WORKSPACE_RELEVANCE_VALUES = WORKSPACE_RELEVANCE_VALUES;

// ─── Classify SDK errors → Stage2FailureReason ──────────────────────────

function classifyError(e: unknown): Stage2FailureReason {
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
  // "no tool_use block" is thrown by callHaikuReal when Anthropic returns a
  // response that parses as JSON but lacks the forced tool call. Audit
  // histograms should bucket this distinctly from network 5xx so prompt
  // drift is visible in reason counts.
  if (msg.includes("no tool_use block")) {
    return "haiku_malformed_json";
  }
  // Any other API error (4xx, network) — treat as 5xx category for fail-
  // closed purposes. Matches the ranker's collapse.
  return "haiku_5xx";
}

// ─── Main entry ─────────────────────────────────────────────────────────

export interface FilterEmailDeps {
  // Test seam: inject a fake call so tests don't hit the network. Returns
  // the tool_use.input payload, or throws.
  haikuCall?: (args: {
    systemPrompt: string;
    userMessage: string;
    toolSchema: ReturnType<typeof buildToolSchema>;
    timeoutMs: number;
  }) => Promise<unknown>;
  // Test seam for HAS_ANTHROPIC_KEY — defaults to the env-derived value.
  hasApiKey?: boolean;
  // Test seam for the audit table.
  audit?: EmailFilterDecisionsDeps;
}

export async function filterEmail(
  input: FilterInput,
  deps: FilterEmailDeps = {},
): Promise<FilterResult> {
  // Outer safety net — see design §8 final paragraph. The cron sweeper
  // and webhook must never 500 on a filter bug.
  try {
    return await filterEmailInner(input, deps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[email-filter] unhandled_error: ${msg} id=${input.email.id}`);
    // Best-effort audit row.
    await writeDecision(
      {
        inbound_email_id: input.email.id,
        stage: 2,
        verdict: "other",
        confidence: 0,
        reasoning: `fail-closed: unhandled_error: ${msg.slice(0, 160)}`,
        model: HAIKU_MODEL,
        prompt_version: STAGE2_PROMPT_VERSION,
      },
      deps.audit,
    );
    return {
      decision: "needs_review",
      stage1: { accepted: true, body_chars: 0, link_ratio: 0, list_id: null },
      stage2_failure: "haiku_schema_violation",
      publisherInfo: input.publisherInfo,
    };
  }
}

async function filterEmailInner(
  input: FilterInput,
  deps: FilterEmailDeps,
): Promise<FilterResult> {
  const { email, publisherInfo, headers } = input;

  // ── Stage 1: deterministic rules ─────────────────────────────────────
  const stage1 = runStage1(email, headers);

  if (!stage1.accepted) {
    console.log(
      `[email-filter] rejected stage1 reason=${stage1.reason} detail=${stage1.detail} id=${email.id}`,
    );
    const decision_id = await writeDecision(
      {
        inbound_email_id: email.id,
        stage: 1,
        verdict: "stage1_rejected",
        confidence: null,
        reasoning: stage1.detail,
        model: null,
        prompt_version: STAGE2_PROMPT_VERSION,
      },
      deps.audit,
    );
    return {
      decision: "rejected",
      stage1,
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  // ── Stage 2: check API key, then call Haiku ──────────────────────────
  const hasKey = deps.hasApiKey ?? HAS_ANTHROPIC_KEY;
  if (!hasKey) {
    console.warn(
      `[email-filter] needs_review stage2_failure=no_api_key id=${email.id}`,
    );
    const decision_id = await writeDecision(
      {
        inbound_email_id: email.id,
        stage: 2,
        verdict: "other",
        confidence: 0,
        reasoning: "no_api_key — Stage 2 skipped",
        model: null,
        prompt_version: STAGE2_PROMPT_VERSION,
      },
      deps.audit,
    );
    return {
      decision: "needs_review",
      stage1,
      stage2_failure: "no_api_key",
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  const systemPrompt = getStage2SystemPrompt({ publisherInfo });
  const bodyExcerpt = emailBodyForGate(email);
  const userMessage = buildUserMessage(input, bodyExcerpt);
  const toolSchema = buildToolSchema();

  // ── Haiku call (fail-closed) ─────────────────────────────────────────
  let toolInput: unknown;
  try {
    const call =
      deps.haikuCall ?? (async (args) => callHaikuReal(args));
    toolInput = await call({
      systemPrompt,
      userMessage,
      toolSchema,
      timeoutMs: HAIKU_TIMEOUT_MS,
    });
  } catch (e) {
    const reason = classifyError(e);
    const tagMsg = e instanceof Error ? e.message : String(e);
    const status = e instanceof Anthropic.APIError ? e.status : null;
    if (reason === "haiku_5xx") {
      console.warn(
        `[email-filter] needs_review stage2_failure=haiku_5xx status=${status ?? "n/a"} id=${email.id} — ${tagMsg}`,
      );
    } else {
      console.warn(
        `[email-filter] needs_review stage2_failure=${reason} id=${email.id} — ${tagMsg}`,
      );
    }
    const decision_id = await writeDecision(
      {
        inbound_email_id: email.id,
        stage: 2,
        verdict: "other",
        confidence: 0,
        reasoning:
          reason === "haiku_5xx"
            ? `fail-closed: haiku_5xx status=${status ?? "n/a"}`
            : `fail-closed: ${reason}`,
        model: HAIKU_MODEL,
        prompt_version: STAGE2_PROMPT_VERSION,
      },
      deps.audit,
    );
    return {
      decision: "needs_review",
      stage1,
      stage2_failure: reason,
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  // ── Validate ─────────────────────────────────────────────────────────
  const validated = validateStage2Output(toolInput);
  if (!validated.ok) {
    console.warn(
      `[email-filter] needs_review stage2_failure=haiku_schema_violation id=${email.id} reason=${validated.reason}`,
    );
    const decision_id = await writeDecision(
      {
        inbound_email_id: email.id,
        stage: 2,
        verdict: "other",
        confidence: 0,
        reasoning: `fail-closed: haiku_schema_violation: ${validated.reason.slice(0, 160)}`,
        model: HAIKU_MODEL,
        prompt_version: STAGE2_PROMPT_VERSION,
      },
      deps.audit,
    );
    return {
      decision: "needs_review",
      stage1,
      stage2_failure: "haiku_schema_violation",
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  const stage2 = validated.output;

  // Always write the audit row with the model's actual verdict + reasoning,
  // even when low-confidence routes to needs_review. The audit preserves
  // "what would the gate have said if we'd trusted it?" — important for
  // tuning the threshold later.
  const decision_id = await writeDecision(
    {
      inbound_email_id: email.id,
      stage: 2,
      verdict: stage2.verdict,
      confidence: stage2.confidence,
      reasoning: stage2.reasoning,
      model: HAIKU_MODEL,
      prompt_version: STAGE2_PROMPT_VERSION,
    },
    deps.audit,
  );

  // ── Route based on confidence + verdict ──────────────────────────────
  if (stage2.confidence < CONFIDENCE_THRESHOLD) {
    console.warn(
      `[email-filter] needs_review low_confidence verdict=${stage2.verdict} conf=${stage2.confidence.toFixed(2)} id=${email.id}`,
    );
    return {
      decision: "needs_review",
      stage1,
      stage2,
      stage2_failure: "low_confidence",
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  if (stage2.verdict === "newsworthy") {
    console.log(
      `[email-filter] proceed verdict=newsworthy conf=${stage2.confidence.toFixed(2)} id=${email.id}`,
    );
    return {
      decision: "proceed",
      stage1,
      stage2,
      publisherInfo,
      decision_id: decision_id ?? undefined,
    };
  }

  console.log(
    `[email-filter] rejected stage2 verdict=${stage2.verdict} conf=${stage2.confidence.toFixed(2)} id=${email.id}`,
  );
  return {
    decision: "rejected",
    stage1,
    stage2,
    publisherInfo,
    decision_id: decision_id ?? undefined,
  };
}

// ─── Real Anthropic call ─────────────────────────────────────────────────
//
// Single tool-use round trip, forced tool_choice. AbortController caps the
// total wall clock independent of the SDK's per-attempt timeout/retries.

async function callHaikuReal(args: {
  systemPrompt: string;
  userMessage: string;
  toolSchema: ReturnType<typeof buildToolSchema>;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Anthropic client unavailable");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 1000,
        temperature: 0,
        system: args.systemPrompt,
        tools: [
          {
            name: args.toolSchema.name,
            description: args.toolSchema.description,
            input_schema:
              args.toolSchema
                .input_schema as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: args.toolSchema.name },
        messages: [{ role: "user", content: args.userMessage }],
      },
      { signal: ac.signal },
    );
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === args.toolSchema.name,
    );
    if (!toolUse) {
      throw new Error("Haiku returned no tool_use block");
    }
    return toolUse.input;
  } finally {
    clearTimeout(timer);
  }
}
