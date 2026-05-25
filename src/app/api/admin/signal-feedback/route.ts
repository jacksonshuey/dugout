import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { suppressSignal } from "@/lib/external-signals";
import { markOverridden } from "@/lib/email-filter-decisions";
import { STAGE2_PROMPT_VERSION } from "@/lib/email-filter-stage2-prompt";
import { requireUiSession } from "@/lib/ui-auth-server";

// POST /api/admin/signal-feedback
//
// Body: { signal_id: string, reason: string }
//
// Q0 resolution (docs/filter-design.md §12):
//   1. WRITE an `email_filter_decisions` audit row with
//      `manually_overridden=true, override_reason=<reason>`. This preserves
//      the audit trail so RevOps can pattern-mine common override reasons
//      and tune the filter.
//   2. SUPPRESS the signal from /market-intel by setting
//      `external_signals.suppressed_at = now()`. Without visible UX
//      effect, the feedback button is dead.
//
// Both writes touch only Dugout-owned tables - no external-system
// mutations - so the suppression stays inside the read-only-v1 boundary
// (BUILD_ALIGNMENT #9).
//
// Auth: requireUiSession() - same gate as other paid routes. The auth
// failure short-circuits before we touch Supabase.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackBody {
  signal_id?: unknown;
  reason?: unknown;
}

export async function POST(req: Request) {
  const guard = await requireUiSession();
  if (guard) return guard;

  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be JSON" },
      { status: 400 },
    );
  }

  const signal_id =
    typeof body.signal_id === "string" && body.signal_id.length > 0
      ? body.signal_id
      : null;
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!signal_id) {
    return NextResponse.json(
      { error: "signal_id required" },
      { status: 400 },
    );
  }
  if (reason.length < 1) {
    return NextResponse.json(
      { error: "reason required" },
      { status: 400 },
    );
  }

  // Look up the signal's inbound_email_id (when present). Older rows that
  // pre-date the source-attribution migration have NULL inbound_email_id;
  // we still suppress those, but the audit row is best-effort.
  let inbound_email_id: string | null = null;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("external_signals")
      .select("id, inbound_email_id")
      .eq("id", signal_id)
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: `lookup failed: ${error.message}` },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "signal not found" }, { status: 404 });
    }
    const row = data as { id: string; inbound_email_id: string | null };
    inbound_email_id = row.inbound_email_id;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Suppress the signal (always, even when inbound_email_id is NULL).
  let suppressed = 0;
  try {
    suppressed = await suppressSignal(signal_id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Audit row (best-effort; failures log + continue).
  let decision_id: string | null = null;
  if (inbound_email_id) {
    decision_id = await markOverridden(
      inbound_email_id,
      reason,
      STAGE2_PROMPT_VERSION,
    );
  }

  return NextResponse.json({
    ok: true,
    suppressed_count: suppressed,
    decision_id,
    inbound_email_id,
  });
}
