import { NextResponse } from "next/server";
import { accounts } from "@/data/seed";
import { ingestAccount, type PerSourceResult } from "@/lib/ingestion";
import { insertSignalsDedup } from "@/lib/external-signals";

// Daily ingestion of external signals across all adapters (NewsAPI today,
// SEC EDGAR for public-co accounts with a ticker).
//
// Triggered by:
//   - Vercel cron (configured in vercel.json, daily at 8am UTC)
//   - Manual "Refresh signals" button in the UI
//
// We only run against accounts flagged trackable:true in seed (real companies
// where NewsAPI returns useful results). Fictional accounts get their signals
// from the demo seed only — wasting LLM + API calls on them returns nothing
// and burns budget.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel hobby cap

interface AccountResult {
  accountId: string;
  companyName: string;
  status: "success" | "error";
  inserted?: number;
  skipped?: number;
  bySource?: PerSourceResult;
  error?: string;
  durationMs: number;
}

interface CronResult {
  ranAt: string;
  totalDurationMs: number;
  results: AccountResult[];
  summary: { inserted: number; skipped: number; errored: number };
}

async function processAccount(
  account: (typeof accounts)[number],
): Promise<AccountResult> {
  const t0 = Date.now();
  try {
    const { signals, bySource } = await ingestAccount(account);
    const { inserted, skipped } = await insertSignalsDedup(signals);
    return {
      accountId: account.id,
      companyName: account.name,
      status: "success",
      inserted,
      skipped,
      bySource,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      accountId: account.id,
      companyName: account.name,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - t0,
    };
  }
}

async function runIngestion(filterAccountId?: string): Promise<CronResult> {
  const startedAt = Date.now();
  const trackable = accounts.filter(
    (a) => a.trackable && (!filterAccountId || a.id === filterAccountId),
  );

  // Parallelize per-account ingestion. Inside ingestAccount the news + SEC
  // adapters also run in parallel. Three trackable accounts × two adapters
  // finishes in ~5-10s end-to-end, well under the Vercel Hobby 60s cap.
  const results = await Promise.all(trackable.map(processAccount));

  return {
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startedAt,
    results,
    summary: {
      inserted: results.reduce((s, r) => s + (r.inserted ?? 0), 0),
      skipped: results.reduce((s, r) => s + (r.skipped ?? 0), 0),
      errored: results.filter((r) => r.status === "error").length,
    },
  };
}

// Verify request is from Vercel cron. Vercel auto-injects
// Authorization: Bearer ${CRON_SECRET} when the env var is set.
// Fail-closed: if the secret isn't configured, refuse all requests
// rather than silently exposing paid Anthropic + NewsAPI work to the
// public. The UI's Refresh button goes through the
// refreshAccountSignals server action, not this endpoint.
function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${required}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account") ?? undefined;
  try {
    const result = await runIngestion(accountId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
