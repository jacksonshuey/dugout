// Public entry point for the market-intel ranker.
//
//   rankSignals(input): Promise<RankerResult>
//
// Owns the cache check, Haiku call, JSON validation, and stub fallback.
// All 8 failure modes from design §8 are handled here; the calling page
// must never see a thrown error (the outer try/catch is the safety net).
//
// Provider: Anthropic Haiku 4.5, single tool-use round-trip. We do NOT
// reuse anthropic-ask.ts because the /ask agent loop is a multi-turn
// chat-tool dance — this ranker is single-shot with one forced tool call,
// closer in shape to the newsletter-adapter classifier than to /ask.
//
// Design doc: /docs/ranker-design.md §5 + §8.

import Anthropic from "@anthropic-ai/sdk";

import { HAS_ANTHROPIC_KEY, getAnthropicClient } from "./anthropic-ask";
import {
  buildCacheKey,
  getCachedRanking,
  writeCachedRanking,
  type RankerCacheDeps,
} from "./ranker-cache";
import { rankStub } from "./ranker-stub";
import { getRankerSystemPrompt } from "./ranker-system-prompt";
import type {
  RankedItem,
  RankerInput,
  RankerResult,
  StubReason,
} from "./ranker-types";

// Haiku model id — centralized here so a model bump is one line.
const HAIKU_MODEL = "claude-haiku-4-5";

// Hard request timeout (ms). The SDK retries 5xx with backoff; this is the
// total wall-clock budget for the entire request including retries.
const HAIKU_TIMEOUT_MS = 15_000;

// Topology caps.
const DEFAULT_TOP_N = 20;
const MAX_TOP_N = 50;

// ─── Tool schema ────────────────────────────────────────────────────────

// One tool, forced. The schema's maxItems caps Haiku at topN; we also
// post-validate length defensively because Anthropic occasionally returns
// more items than the schema allows.
function buildToolSchema(topN: number) {
  return {
    name: "submit_ranking",
    description:
      "Submit the ranked list. Call this exactly once with the final ordering.",
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          minItems: 0,
          maxItems: topN,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["signal_id", "rank", "rationale"],
            properties: {
              signal_id: { type: "string", minLength: 1 },
              rank: { type: "integer", minimum: 1, maximum: topN },
              rationale: { type: "string", minLength: 10, maxLength: 220 },
              related_account_ids: {
                type: "array",
                items: { type: "string", minLength: 1 },
                maxItems: 5,
              },
            },
          },
        },
      },
    },
  };
}

// ─── User message construction ──────────────────────────────────────────

function buildUserMessage(input: RankerInput, workspaceName: string): string {
  const minifiedSignals = input.signals.map((s) => {
    const meta = (s.meta ?? {}) as { mention?: unknown };
    const mention =
      typeof meta.mention === "string" ? meta.mention : null;
    // Newsletter signals carry an inbound_email_id; the email's
    // received_at is captured on the signal itself as `occurred_at` for
    // newsletter rows (newsletter-adapter copies email.received_at into
    // occurred_at). For surfaces that need the ingestion time distinct
    // from the underlying event time we forward `received_at` from meta
    // when present; otherwise it stays null.
    const received_at =
      typeof (meta as { received_at?: unknown }).received_at === "string"
        ? ((meta as { received_at?: string }).received_at ?? null)
        : null;
    return {
      id: s.id,
      source: s.source,
      signal_type: s.type,
      summary: s.summary,
      occurred_at: s.occurred_at,
      received_at,
      workspace_relevance: s.workspace_relevance ?? null,
      mention,
    };
  });
  return [
    `Workspace: ${workspaceName}`,
    `Now (UTC): ${input.now.toISOString()}`,
    `Lookback: 48h`,
    ``,
    `Tracked accounts (${input.accountKeywords.length}):`,
    JSON.stringify(input.accountKeywords),
    ``,
    `Signals to rank (${input.signals.length}):`,
    JSON.stringify(minifiedSignals),
  ].join("\n");
}

// ─── Validation ─────────────────────────────────────────────────────────

const CITATION_RE = /\[citation:([^\]\s]+)\]/g;

interface ValidationOk {
  ok: true;
  items: RankedItem[];
}
interface ValidationErr {
  ok: false;
  reason: string;
}

function validateItems(
  rawItems: unknown,
  inputSignals: RankerInput["signals"],
  topN: number,
): ValidationOk | ValidationErr {
  if (!Array.isArray(rawItems)) {
    return { ok: false, reason: "items not an array" };
  }
  if (rawItems.length > topN) {
    return { ok: false, reason: `items.length=${rawItems.length} > topN=${topN}` };
  }
  // Items cannot exceed signals count — Q7 resolution (folded into
  // haiku_schema_violation, not a new StubReason).
  if (rawItems.length > inputSignals.length) {
    return {
      ok: false,
      reason: `items.length=${rawItems.length} > signals.length=${inputSignals.length}`,
    };
  }

  const validIds = new Set(inputSignals.map((s) => s.id));
  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();
  const items: RankedItem[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!raw || typeof raw !== "object") {
      return { ok: false, reason: `item[${i}] not an object` };
    }
    const obj = raw as Record<string, unknown>;
    const signal_id = obj.signal_id;
    const rank = obj.rank;
    const rationale = obj.rationale;
    if (typeof signal_id !== "string" || signal_id.length === 0) {
      return { ok: false, reason: `item[${i}].signal_id missing or not string` };
    }
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > topN) {
      return { ok: false, reason: `item[${i}].rank invalid (${String(rank)})` };
    }
    if (typeof rationale !== "string" || rationale.length === 0) {
      return { ok: false, reason: `item[${i}].rationale missing or not string` };
    }
    if (!validIds.has(signal_id)) {
      return {
        ok: false,
        reason: `item[${i}].signal_id "${signal_id}" not in input signals (invented id)`,
      };
    }
    if (seenIds.has(signal_id)) {
      return { ok: false, reason: `item[${i}].signal_id "${signal_id}" duplicated` };
    }
    if (seenRanks.has(rank)) {
      return { ok: false, reason: `item[${i}].rank ${rank} duplicated` };
    }
    seenIds.add(signal_id);
    seenRanks.add(rank);

    // Citation present + id matches signal_id.
    // Use matchAll instead of exec() so the global regex's lastIndex is not
    // retained across loop iterations or successive validateItems calls.
    const matches = [...rationale.matchAll(CITATION_RE)].map((m) => m[1]);
    if (matches.length === 0) {
      return {
        ok: false,
        reason: `item[${i}].rationale missing [citation:...] marker`,
      };
    }
    if (!matches.includes(signal_id)) {
      return {
        ok: false,
        reason: `item[${i}].rationale citation id does not match signal_id`,
      };
    }

    let related: string[] | undefined;
    const rel = obj.related_account_ids;
    if (Array.isArray(rel)) {
      const filtered = rel.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      related = filtered.length > 0 ? filtered : undefined;
    }

    items.push({
      signal_id,
      rank,
      rationale,
      related_account_ids: related,
    });
  }

  return { ok: true, items };
}

// ─── Classify SDK errors → StubReason ───────────────────────────────────

function classifyError(e: unknown): StubReason {
  if (e instanceof Anthropic.APIError && e.status >= 500 && e.status < 600) {
    return "haiku_5xx";
  }
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) {
    return "haiku_timeout";
  }
  // Any other API error (4xx, network) — treat as 5xx category for fail-soft
  // purposes. The /ask path special-cases 401/429 with user-facing copy;
  // the ranker is invisible plumbing so we collapse to "degraded."
  return "haiku_5xx";
}

// ─── Main entry ─────────────────────────────────────────────────────────

export interface RankSignalsDeps {
  // Test seam: inject a fake call so tests don't hit the network.
  haikuCall?: (args: {
    systemPrompt: string;
    userMessage: string;
    toolSchema: ReturnType<typeof buildToolSchema>;
    timeoutMs: number;
  }) => Promise<unknown>; // returns the tool_use.input payload, or throws
  cache?: RankerCacheDeps;
  // Workspace display name shown in the prompt's user message. Falls back
  // to workspaceKey when not supplied so the prompt always has SOMETHING.
  workspaceName?: string;
  workspaceContext?: string;
  // Primary vertical — gates the AI-topic relevance bonus in the prompt.
  // Defaults to "tech_ai" since that's Checkbox's primary lens; callers
  // for other verticals should pass their slug explicitly.
  primaryVertical?: string;
  // Test seam for HAS_ANTHROPIC_KEY — defaults to the env-derived value.
  hasApiKey?: boolean;
}

export async function rankSignals(
  input: RankerInput,
  deps: RankSignalsDeps = {},
): Promise<RankerResult> {
  // Outer safety net — see design §8 final paragraph. The market-intel
  // page must never 500 on a ranker bug.
  try {
    return await rankSignalsInner(input, deps);
  } catch (e) {
    console.warn(
      `[ranker] unhandled_error: ${e instanceof Error ? e.message : String(e)}`,
    );
    return rankStub(input, "haiku_schema_violation");
  }
}

async function rankSignalsInner(
  input: RankerInput,
  deps: RankSignalsDeps,
): Promise<RankerResult> {
  // Short-circuit: empty input. No Haiku, no cache write.
  if (input.signals.length === 0) {
    console.warn(`[ranker] empty_input — short-circuit`);
    return {
      items: [],
      generated_at: input.now.toISOString(),
      source: "stub",
      stubReason: "empty_input",
      cache_hit: false,
    };
  }

  const workspaceName = deps.workspaceName ?? input.workspaceKey;
  const topN = (() => {
    const requested = input.topN ?? DEFAULT_TOP_N;
    if (!Number.isFinite(requested) || requested < 1) return DEFAULT_TOP_N;
    return Math.min(MAX_TOP_N, Math.floor(requested));
  })();

  const key = buildCacheKey(workspaceName, input.now);

  // Cache check — failures return null and proceed to compute path.
  const cached = await getCachedRanking(key, deps.cache);
  if (cached) {
    return { ...cached, cache_hit: true };
  }

  const hasKey = deps.hasApiKey ?? HAS_ANTHROPIC_KEY;
  if (!hasKey) {
    const result = rankStub(input, "no_api_key");
    console.warn(`[ranker] no_api_key — stub serving ${result.items.length} items`);
    return result;
  }

  const systemPrompt = getRankerSystemPrompt({
    workspaceContext:
      deps.workspaceContext ?? `Workspace: ${workspaceName}. Industry, ICP, and strategic priorities omitted from this prompt — see Dugout workspace config.`,
    topN,
    primaryVertical: deps.primaryVertical ?? "tech_ai",
  });
  const userMessage = buildUserMessage(input, workspaceName);
  const toolSchema = buildToolSchema(topN);

  let toolInput: unknown;
  try {
    const call =
      deps.haikuCall ??
      (async (args) => callHaikuReal(args));
    toolInput = await call({
      systemPrompt,
      userMessage,
      toolSchema,
      timeoutMs: HAIKU_TIMEOUT_MS,
    });
  } catch (e) {
    const reason = classifyError(e);
    const tagMsg = e instanceof Error ? e.message : String(e);
    if (reason === "haiku_5xx") {
      const status = e instanceof Anthropic.APIError ? e.status : "n/a";
      console.warn(
        `[ranker] haiku_5xx status=${status} — stub serving (input ${input.signals.length} signals): ${tagMsg}`,
      );
    } else {
      console.warn(`[ranker] ${reason} after ${HAIKU_TIMEOUT_MS / 1000}s — stub: ${tagMsg}`);
    }
    return rankStub(input, reason);
  }

  // Parse the tool input. Haiku returns { items: [...] }.
  let rawItems: unknown;
  try {
    if (!toolInput || typeof toolInput !== "object") {
      throw new Error("tool input not an object");
    }
    rawItems = (toolInput as Record<string, unknown>).items;
  } catch (e) {
    console.warn(
      `[ranker] haiku_malformed_json: ${e instanceof Error ? e.message : String(e)}`,
    );
    return rankStub(input, "haiku_malformed_json");
  }

  const validated = validateItems(rawItems, input.signals, topN);
  if (!validated.ok) {
    console.warn(`[ranker] haiku_schema_violation: ${validated.reason}`);
    return rankStub(input, "haiku_schema_violation");
  }

  const result: RankerResult = {
    items: validated.items,
    generated_at: input.now.toISOString(),
    source: "haiku",
    cache_hit: false,
  };

  await writeCachedRanking(key, result, deps.cache);
  return result;
}

// ─── Real Anthropic call ─────────────────────────────────────────────────
//
// Single tool-use round trip. We force tool_choice to "submit_ranking" so
// Haiku cannot emit a free-text reply.

async function callHaikuReal(args: {
  systemPrompt: string;
  userMessage: string;
  toolSchema: ReturnType<typeof buildToolSchema>;
  timeoutMs: number;
}): Promise<unknown> {
  const client = getAnthropicClient();
  if (!client) throw new Error("Anthropic client unavailable");

  // Wall-clock timeout enforced via AbortController + a Promise.race. The
  // SDK has its own retries; this caps the total budget.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 2000,
        temperature: 0.3,
        system: args.systemPrompt,
        tools: [
          {
            name: args.toolSchema.name,
            description: args.toolSchema.description,
            input_schema: args.toolSchema.input_schema as unknown as Anthropic.Tool.InputSchema,
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
