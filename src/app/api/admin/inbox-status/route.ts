import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUiSession } from "@/lib/ui-auth-server";

// GET /api/admin/inbox-status
//
// Operator dashboard for the inbound-email pipeline. Returns the counts that
// answer "why isn't fresh news showing up" in seconds instead of forcing a
// spelunk through Vercel logs:
//
//   received_last_24h    - total inbound_emails rows written in the last 24h
//   classified_last_24h  - rows with classified_at within the last 24h
//   pending              - rows with classified_at IS NULL (never tried)
//   errored              - rows whose last classifier attempt set classifier_error
//   signals_last_24h     - external_signals rows produced in the last 24h
//
// Auth: requireUiSession() — same gate as the other admin routes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const guard = await requireUiSession();
  if (guard) return guard;

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const sb = supabaseAdmin();

  try {
    const [received, classified, pending, errored, signals] = await Promise.all(
      [
        sb
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .gte("received_at", since),
        sb
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .gte("classified_at", since),
        sb
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .is("classified_at", null),
        sb
          .from("inbound_emails")
          .select("id", { count: "exact", head: true })
          .not("classifier_error", "is", null),
        sb
          .from("external_signals")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since),
      ],
    );

    return NextResponse.json({
      as_of: new Date().toISOString(),
      received_last_24h: received.count ?? 0,
      classified_last_24h: classified.count ?? 0,
      pending: pending.count ?? 0,
      errored: errored.count ?? 0,
      signals_last_24h: signals.count ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
