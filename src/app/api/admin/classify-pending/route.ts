import { NextResponse } from "next/server";
import { runClassifyPendingSweep } from "@/lib/classify-pending-sweep";
import { requireUiSession } from "@/lib/ui-auth-server";

// POST /api/admin/classify-pending
//
// Manual drain of the classify-pending queues from the admin UI — same code
// path as the daily cron, just gated by the UI session cookie instead of
// CRON_SECRET. Use this from the inbox status page when the cron hasn't fired
// recently or you want to flush a new batch on demand.
//
// Optional query param `inboundOnly=1` skips the web_scrapes queue so the
// operator can drain inbox emails in isolation when debugging the newsletter
// pipeline.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const guard = await requireUiSession();
  if (guard) return guard;

  const url = new URL(req.url);
  const inboundOnly = url.searchParams.get("inboundOnly") === "1";

  try {
    const result = await runClassifyPendingSweep({
      includeWebScrapes: !inboundOnly,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
