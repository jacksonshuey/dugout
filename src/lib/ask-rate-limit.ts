// Per-session + global rate limiting for /ask (D1).
//
// Jackson is funding OpenAI + Anthropic tokens personally. These caps
// exist to keep a runaway demo (or a curious URL-sharer) from burning the
// monthly budget in a single afternoon.
//
// Caps (per directive #3 of the D1 brief):
//   - 20 questions / hour  / session_id   (interactive abuse)
//   - 100 questions / day  / session_id   (daily session cap)
//   - 500 questions / day  (global kill switch)
//
// At cap: the route returns 429 with retry_after_seconds. The UI shows a
// clear "you've hit a cap" message. We do NOT silently downgrade to stub
// at cap — Jackson wants hard stops, not invisible degradation.
//
// Supabase-unavailable posture: we treat it as "allow, log a warning."
// Failing closed would mean a Supabase outage takes /ask offline; that
// hurts the demo more than the marginal token cost of letting a few
// uncaptured requests through. The warning surfaces in route logs so the
// gap is visible.
//
// Schema: ask_request_log (see supabase/migrations/20260524_ask_request_log.sql)

import { supabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AskProvider, AskModel } from "@/lib/ask-agent";

// ─── Caps (exported for tests + UI copy) ─────────────────────────────────

export const ASK_RATE_LIMITS = {
  hourlyPerSession: 20,
  dailyPerSession: 100,
  dailyGlobal: 500,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Public API ─────────────────────────────────────────────────────────

export type CheckAndRecordArgs = {
  sessionId: string;
  workspaceId?: string;
  provider: AskProvider;
  model: AskModel;
  questionChars: number;
};

export type CheckAndRecordResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "hourly" | "daily" | "global";
      retryAfterSeconds: number;
    };

// Test seam: tests inject a fake SupabaseClient instead of touching the
// real one. Production callers pass nothing → we use the singleton.
export type RateLimitDeps = {
  supabase?: SupabaseClient;
  now?: () => Date;
};

export async function checkAndRecordAskRequest(
  args: CheckAndRecordArgs,
  deps: RateLimitDeps = {},
): Promise<CheckAndRecordResult> {
  try {
    return await checkAndRecordInner(args, deps);
  } catch (e) {
    // Defense-in-depth catch — any unexpected Supabase or network failure
    // degrades to allow rather than blocking the demo. Visible in logs.
    console.warn(
      `[ask-rate-limit] Unexpected error, allowing request: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { allowed: true };
  }
}

async function checkAndRecordInner(
  args: CheckAndRecordArgs,
  deps: RateLimitDeps,
): Promise<CheckAndRecordResult> {
  const now = deps.now ? deps.now() : new Date();
  const nowMs = now.getTime();

  // Resolve the Supabase client. If it's not configured (no env vars), we
  // log once and allow through — see the "Supabase-unavailable posture"
  // note in the file header.
  let sb: SupabaseClient;
  try {
    sb = deps.supabase ?? supabaseAdmin();
  } catch (e) {
    console.warn(
      `[ask-rate-limit] Supabase unavailable, allowing request: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { allowed: true };
  }

  // Pre-check the caps in priority order: global → daily-session → hourly.
  // We check global first so a single cap-breach response is consistent
  // across sessions (everyone gets "global" at the same wall-clock).
  const hourAgo = new Date(nowMs - HOUR_MS).toISOString();
  const dayAgo = new Date(nowMs - DAY_MS).toISOString();

  // Global daily count.
  const { count: globalCount, error: globalErr } = await sb
    .from("ask_request_log")
    .select("*", { count: "exact", head: true })
    .gte("occurred_at", dayAgo);

  if (globalErr) {
    console.warn(
      `[ask-rate-limit] Global cap query failed, allowing: ${globalErr.message}`,
    );
    return { allowed: true };
  }

  if ((globalCount ?? 0) >= ASK_RATE_LIMITS.dailyGlobal) {
    return {
      allowed: false,
      reason: "global",
      retryAfterSeconds: Math.ceil(secondsUntilNextDayWindow(nowMs)),
    };
  }

  // Per-session daily count.
  const { count: dailyCount, error: dailyErr } = await sb
    .from("ask_request_log")
    .select("*", { count: "exact", head: true })
    .eq("session_id", args.sessionId)
    .gte("occurred_at", dayAgo);

  if (dailyErr) {
    console.warn(
      `[ask-rate-limit] Daily cap query failed, allowing: ${dailyErr.message}`,
    );
    return { allowed: true };
  }

  if ((dailyCount ?? 0) >= ASK_RATE_LIMITS.dailyPerSession) {
    return {
      allowed: false,
      reason: "daily",
      retryAfterSeconds: Math.ceil(secondsUntilNextDayWindow(nowMs)),
    };
  }

  // Per-session hourly count.
  const { count: hourlyCount, error: hourlyErr } = await sb
    .from("ask_request_log")
    .select("*", { count: "exact", head: true })
    .eq("session_id", args.sessionId)
    .gte("occurred_at", hourAgo);

  if (hourlyErr) {
    console.warn(
      `[ask-rate-limit] Hourly cap query failed, allowing: ${hourlyErr.message}`,
    );
    return { allowed: true };
  }

  if ((hourlyCount ?? 0) >= ASK_RATE_LIMITS.hourlyPerSession) {
    return {
      allowed: false,
      reason: "hourly",
      retryAfterSeconds: Math.ceil(secondsUntilNextHourWindow(nowMs)),
    };
  }

  // All caps clear — record the request and allow. We write the row BEFORE
  // the agent runs so a request that crashes mid-agent still counts
  // against the cap. (Worst case: a few "completed" rows that didn't
  // actually finish — fine for cap math.)
  const { error: insertErr } = await sb.from("ask_request_log").insert({
    session_id: args.sessionId,
    workspace_id: args.workspaceId ?? null,
    occurred_at: now.toISOString(),
    provider: args.provider,
    model: args.model,
    question_chars: args.questionChars,
    status: "completed",
  });

  if (insertErr) {
    console.warn(
      `[ask-rate-limit] Insert failed (allowing anyway): ${insertErr.message}`,
    );
  }

  return { allowed: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────

// Hourly cap uses a sliding window — once the oldest in-window request
// ages out, capacity returns. We don't have cheap access to the oldest
// timestamp in this code path without an extra query, so we return the
// full hour as a conservative retry hint. A few minutes of over-quote on
// the UI is fine; under-quote would be a worse UX.
function secondsUntilNextHourWindow(_nowMs: number): number {
  void _nowMs;
  return 60 * 60;
}

// Daily windows are also sliding. Conservative full-day retry hint for
// the same reason as above.
function secondsUntilNextDayWindow(_nowMs: number): number {
  void _nowMs;
  return 24 * 60 * 60;
}
