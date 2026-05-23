import { NextResponse } from "next/server";
import { getSignalsForAccount } from "@/lib/external-signals";
import { requireUiSession } from "@/lib/ui-auth-server";

// Read endpoint for the drawer. GET ?account=acc_xxx returns the signal
// timeline for that account, sorted newest first.

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
    const signals = await getSignalsForAccount(accountId);
    return NextResponse.json({ signals });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), signals: [] },
      { status: 500 },
    );
  }
}
