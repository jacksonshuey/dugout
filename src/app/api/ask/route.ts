import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUiSession } from "@/lib/ui-auth-server";
import {
  isValidProviderModel,
  runAskAgent,
  type AskModel,
  type AskProvider,
  type ToolCallRecord,
} from "@/lib/ask-agent";
import {
  ASK_RATE_LIMITS,
  checkAndRecordAskRequest,
} from "@/lib/ask-rate-limit";
import type { Citation } from "@/lib/ask-tools";

// POST /api/ask — natural-language query layer (U4 + D1).
//
// Pipeline:
//   1. requireUiSession() — cookie gate (matches every other /api/* route)
//   2. Parse body { question, accountSlug?, provider?, model? }
//   3. Resolve session id from `dugout-ask-session` cookie (set on first
//      hit; client-generated UUID), used as the rate-limit identity
//   4. checkAndRecordAskRequest() — 20/hr session, 100/day session,
//      500/day global. At cap: 429 with retry_after_seconds. HARD STOP.
//      No stub fallback at cap (per directive #3).
//   5. runAskAgent() — provider-agnostic loop. Provider-side failure
//      falls back to stub WITH stubReason set (per directive — provider
//      failures are different from cap-breaches).
//
// Defaults: provider=stub, model=stub-deterministic. The dropdown ensures
// real callers pass an explicit provider/model.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Request / response shapes ──────────────────────────────────────────

type AskRequestBody = {
  question?: string;
  accountSlug?: string;
  provider?: AskProvider;
  model?: AskModel;
};

type AskResponseBody = {
  answer: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  model: AskModel;
  provider: AskProvider;
  accountSlug: string | null;
  warnings?: string[];
  stubReason?: string;
};

const ASK_SESSION_COOKIE = "dugout-ask-session";
// Cap session ids so a malicious cookie value can't blow up the rate-limit
// query. 64 chars is generous for a UUID-style identifier (36 chars).
const MAX_SESSION_ID_LEN = 64;

// ─── Route handler ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: AskRequestBody;
  try {
    body = (await req.json()) as AskRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json(
      { error: "Missing 'question' in request body" },
      { status: 400 },
    );
  }

  // Default to stub when the caller doesn't pick a provider — keeps the
  // pre-D1 demo working for any old client that POSTs just { question }.
  const provider: AskProvider = body.provider ?? "stub";
  const model: AskModel = body.model ?? "stub-deterministic";

  // Defense in depth — the dropdown should never emit a bad combo, but
  // refuse it server-side if it ever does.
  if (!isValidProviderModel(provider, model)) {
    return NextResponse.json(
      { error: `Invalid provider/model combination: ${provider}/${model}` },
      { status: 400 },
    );
  }

  // Resolve the rate-limit session id from a dedicated cookie. New
  // visitors get a UUID minted server-side here; the response sets the
  // cookie so the next request hits the same bucket.
  const c = await cookies();
  let sessionId = c.get(ASK_SESSION_COOKIE)?.value ?? "";
  let mintedSession = false;
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LEN) {
    sessionId = crypto.randomUUID();
    mintedSession = true;
  }

  // Rate-limit check. Hard stop at cap — no stub fallback.
  const gate = await checkAndRecordAskRequest({
    sessionId,
    provider,
    model,
    questionChars: question.length,
  });

  if (!gate.allowed) {
    const messageByReason: Record<typeof gate.reason, string> = {
      hourly: `You've hit the per-session hourly cap (${ASK_RATE_LIMITS.hourlyPerSession} questions/hour). Try again in about an hour.`,
      daily: `You've hit the per-session daily cap (${ASK_RATE_LIMITS.dailyPerSession} questions/day). Try again tomorrow.`,
      global: `Dugout's global daily request cap (${ASK_RATE_LIMITS.dailyGlobal}) is exhausted. The cap protects shared API tokens; it resets on a rolling 24h window.`,
    };
    const res = NextResponse.json(
      {
        error: messageByReason[gate.reason],
        reason: gate.reason,
        retry_after_seconds: gate.retryAfterSeconds,
      },
      { status: 429 },
    );
    res.headers.set("Retry-After", String(gate.retryAfterSeconds));
    return res;
  }

  // Run the agent. runAskAgent handles its own provider-side fallback to
  // stub (with stubReason set) so we never throw here.
  const result = await runAskAgent({
    question,
    accountSlug: body.accountSlug,
    provider,
    model,
  });

  const payload: AskResponseBody = {
    answer: result.answer,
    citations: result.citations,
    toolCalls: result.toolCalls,
    model: result.model,
    provider: result.provider,
    accountSlug: result.accountSlug,
  };
  if (result.warnings.length > 0) payload.warnings = result.warnings;
  if (result.stubReason) payload.stubReason = result.stubReason;

  const res = NextResponse.json(payload);
  if (mintedSession) attachSessionCookie(res, sessionId);
  return res;
}

function attachSessionCookie(res: NextResponse, sessionId: string): void {
  res.cookies.set({
    name: ASK_SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // 30 days. The rate-limit windows are 1h and 24h; a 30d cookie just
    // means the same browser stays bucketed for a month even across many
    // visits, which is the right behavior for cap purposes.
    maxAge: 60 * 60 * 24 * 30,
  });
}
