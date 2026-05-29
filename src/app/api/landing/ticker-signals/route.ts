import { NextResponse } from "next/server";
import {
  getHighRelevanceSignals,
  getWorkspaceSignals,
} from "@/lib/external-signals";
import { getLiveAccountNews } from "@/lib/live-account-news";
import { accounts } from "@/data/seed";
import { LEGACY_ACCOUNT_ALIASES } from "@/data/legacy-account-aliases";

// Lightweight JSON feed for the landing-page client-side ticker poller.
// The ticker calls this every 30s to surface fresher items between the
// page's 60s ISR cycle. Returns two kinds of items so the ticker stays
// visually alive even when tracked accounts haven't been mentioned in a
// while:
//   - kind="account": newsletter signal tagged to a tracked company
//   - kind="workspace": market-wide intel (no specific account)
//
// Resolves `account_id` -> display name on the server so the client
// doesn't need to import the seed bundle. Fails soft to an empty array so
// a Supabase outage doesn't break the poller loop or surface an error to
// visitors.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOOKBACK_HOURS = 72;
const MAX_TICKER_ITEMS = 30;

export interface TickerItem {
  id: string;
  kind: "account" | "workspace";
  summary: string;
  accountName: string;
  occurredAt: string;
}

export async function GET() {
  try {
    const lookbackMs = LOOKBACK_HOURS * 60 * 60 * 1000;
    const sinceIso = new Date(Date.now() - lookbackMs).toISOString();

    // Live, real account news from SEC EDGAR (the seed companies' own filings)
    // is the primary, always-fresh source. Supabase pools (newsletter/web
    // ingestion) merge in when present, but their absence must not empty the
    // ticker — so each source is isolated and fails soft to [].
    const [liveAccountNews, accountSignals, workspaceSignals] =
      await Promise.all([
        getLiveAccountNews().catch(() => []),
        getHighRelevanceSignals(lookbackMs).catch(() => []),
        getWorkspaceSignals(sinceIso, MAX_TICKER_ITEMS).catch(() => []),
      ]);

    const nameById = new Map<string, string>(
      accounts.map((a) => [a.id, a.name]),
    );
    // Backfill any old codename pkeys that still exist in Supabase signals
    // so the chip renders the company name instead of "acc_atlas" etc.
    for (const [legacyId, name] of Object.entries(LEGACY_ACCOUNT_ALIASES)) {
      if (!nameById.has(legacyId)) nameById.set(legacyId, name);
    }

    // Merge live SEC headlines with any account-tagged Supabase rows, dedup by
    // id (SEC ids are deterministic per filing).
    const accountSource = [...liveAccountNews, ...accountSignals];
    const seen = new Set<string>();
    const accountItems: TickerItem[] = [];
    for (const s of accountSource) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      accountItems.push({
        id: s.id,
        kind: "account",
        summary: s.summary,
        accountName: nameById.get(s.account_id) ?? s.account_id,
        occurredAt: s.occurred_at,
      });
    }

    const workspaceItems: TickerItem[] = workspaceSignals.map((s) => ({
      id: s.id,
      kind: "workspace" as const,
      summary: s.summary,
      accountName: "Market intel",
      occurredAt: s.occurred_at,
    }));

    // Merge and sort by occurred_at desc so freshest leads regardless of
    // kind. Cap at MAX_TICKER_ITEMS so the marquee animation stays smooth.
    const items = [...accountItems, ...workspaceItems]
      .sort((a, b) =>
        a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
      )
      .slice(0, MAX_TICKER_ITEMS);

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
