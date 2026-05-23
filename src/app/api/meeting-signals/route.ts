import { NextResponse } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import { getIntegrationContext } from "@/lib/integration-context";
import { getMeetingSignalsForAccount } from "@/lib/meeting-signals";

// Read endpoint for the drawer's Meetings section. Mirrors the
// /api/external-signals shape so the drawer can fan out the two reads in
// parallel without weird per-source plumbing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account");
  if (!accountId) {
    return NextResponse.json({ error: "Missing account" }, { status: 400 });
  }
  try {
    const ctx = await getIntegrationContext();
    const signals = await getMeetingSignalsForAccount(
      accountId,
      ctx.workspaceKey,
    );
    return NextResponse.json({ signals });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), signals: [] },
      { status: 500 },
    );
  }
}
