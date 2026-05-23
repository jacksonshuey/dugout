import { NextResponse } from "next/server";
import { accounts } from "@/data/seed";
import {
  scrapeAccount,
  type AccountScrapeResult,
} from "@/lib/firecrawl-adapter";

// Daily Firecrawl scrape cron — for each tracked account, hits the fixed
// content path set (see ACCOUNT_PAGES in firecrawl-adapter.ts) and writes
// raw markdown rows into `web_scrapes`. Does NOT classify inline —
// classify-pending sweeps the unclassified rows on its own schedule.
//
// Auth: CRON_SECRET (Vercel injects "Authorization: Bearer ${CRON_SECRET}").
//
// Scope: 11 trackable accounts × 4 pages each = ~44 Firecrawl calls per
// run. At Firecrawl's free-tier 1 credit/call, ~1320 credits/month.
//
// Timing: ~5s per account scraped in parallel-per-page, sequential across
// accounts. 11 × ~5s ≈ 55s under happy path. maxDuration=300 to leave
// headroom for slow targets.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface CronResult {
  ranAt: string;
  totalDurationMs: number;
  accountsProcessed: number;
  summary: {
    pagesAttempted: number;
    pagesStored: number;
    pagesErrored: number;
    pagesDeduped: number;
    accountsHardFailed: number;
  };
  perAccount: Array<
    | AccountScrapeResult
    | { account_id: string; account_name: string; hard_error: string }
  >;
}

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  return req.headers.get("authorization") === `Bearer ${required}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FIRECRAWL_API_KEY) {
    return NextResponse.json(
      { error: "Server not configured: FIRECRAWL_API_KEY missing" },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const trackable = accounts.filter((a) => a.trackable && a.website);

  const perAccount: CronResult["perAccount"] = [];
  let pagesAttempted = 0;
  let pagesStored = 0;
  let pagesErrored = 0;
  let pagesDeduped = 0;
  let accountsHardFailed = 0;

  // Sequential across accounts so we yield between rate-limit-sensitive
  // calls. Pages within an account fan out 4-wide (see firecrawl-adapter).
  for (const account of trackable) {
    try {
      const result = await scrapeAccount(account);
      perAccount.push(result);
      pagesAttempted += result.attempted;
      pagesStored += result.succeeded;
      pagesErrored += result.errored;
      pagesDeduped += result.deduped;
    } catch (e) {
      // Hard failure usually means Firecrawl 429 — bail rather than
      // burning credits scraping every account when each call will fail.
      const error = e instanceof Error ? e.message : String(e);
      console.warn(
        `[cron/firecrawl] hard failure on ${account.id}, stopping run`,
        error,
      );
      perAccount.push({
        account_id: account.id,
        account_name: account.name,
        hard_error: error,
      });
      accountsHardFailed++;
      break;
    }
  }

  const result: CronResult = {
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startedAt,
    accountsProcessed: perAccount.length,
    summary: {
      pagesAttempted,
      pagesStored,
      pagesErrored,
      pagesDeduped,
      accountsHardFailed,
    },
    perAccount,
  };

  console.log(
    `[cron/firecrawl] swept ${result.accountsProcessed} accounts: ${pagesStored} pages stored, ${pagesErrored} errored, ${pagesDeduped} deduped in ${result.totalDurationMs}ms`,
  );
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
