import { NextResponse } from "next/server";
import { getHighRelevanceSignals } from "@/lib/external-signals";
import { accounts } from "@/data/seed";

// Lightweight JSON feed for the landing-page client-side ticker poller.
// The ticker calls this every 30s to surface fresher items between the
// page's 60s ISR cycle. Resolves `account_id` -> display name on the
// server so the client doesn't need to import the seed bundle. Fails
// soft to an empty array so a Supabase outage doesn't break the poller
// loop or surface an error to visitors.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOKBACK_HOURS = 72;

export interface TickerItem {
  id: string;
  summary: string;
  accountName: string;
  occurredAt: string;
}

export async function GET() {
  try {
    const signals = await getHighRelevanceSignals(
      LOOKBACK_HOURS * 60 * 60 * 1000,
    );
    const nameById = new Map(accounts.map((a) => [a.id, a.name]));
    const items: TickerItem[] = signals.map((s) => ({
      id: s.id,
      summary: s.summary,
      accountName: nameById.get(s.account_id) ?? s.account_id,
      occurredAt: s.occurred_at,
    }));
    return NextResponse.json(
      { items },
      {
        headers: {
          "cache-control": "no-store, must-revalidate",
        },
      },
    );
  } catch (e) {
    console.error("[ticker-signals] fetch failed", e);
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
