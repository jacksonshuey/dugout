import { NextResponse } from "next/server";
import { accounts } from "@/data/seed";
import {
  scrapeAccount,
  type AccountScrapeResult,
} from "@/lib/firecrawl-adapter";

// Daily Firecrawl scrape cron — for each tracked account, discovers
// content paths via Firecrawl /map (filtered through PREFERRED_PATH_PATTERNS
// in firecrawl-adapter.ts) and scrapes up to MAX_PATHS_PER_ACCOUNT pages.
// Writes raw markdown rows into `web_scrapes`. Does NOT classify inline —
// classify-pending sweeps the unclassified rows on its own schedule.
//
// Auth: CRON_SECRET (Vercel injects "Authorization: Bearer ${CRON_SECRET}").
//
// Scope (post-Phase-4): 11 trackable accounts × (1 /map + up to 6 /scrape)
// per run. /map is 1 credit; /scrape is 1 credit. Worst case ≈ 11 × 7 = 77
// credits/day → ~2310 credits/month. Up from the old 4-path hardcode at
// 11 × 4 = 44/day (~1320/mo) — ~1.75x cost for coverage that actually
// finds /blog on Stripe and /newsroom on Boeing.
//
// Per-account fault isolation: a 429 on one account no longer halts the
// run. Each account's scrape is wrapped in try/catch; 429 → record + skip
// (next 6am picks it up), other errors → log + continue.
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
    accountsRateLimited: number;
    accountsErrored: number;
  };
  accounts: Array<{
    account_id: string;
    account_name: string;
    status: "scraped" | "rate_limited" | "errored";
    error?: string;
  }>;
  perAccount: Array<
    | AccountScrapeResult
    | { account_id: string; account_name: string; hard_error: string }
  >;
}

// Constant-time string compare to avoid leaking CRON_SECRET length via timing.
// Matches the pattern in cron/granola/route.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  const header = req.headers.get("authorization") ?? "";
  return timingSafeEqual(header, `Bearer ${required}`);
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
  const accountSummaries: CronResult["accounts"] = [];
  let pagesAttempted = 0;
  let pagesStored = 0;
  let pagesErrored = 0;
  let pagesDeduped = 0;
  let accountsRateLimited = 0;
  let accountsErrored = 0;

  // Sequential across accounts so we yield between rate-limit-sensitive
  // calls. Pages within an account fan out wide (see firecrawl-adapter).
  //
  // Per-account fault isolation: 429 from Firecrawl on Stripe must NOT
  // halt the loop for Boeing/Moderna/etc. Old behavior was to break out
  // on first throw; that meant a single throttled account skipped every
  // account ordered after it, leaving stale data for 24h until next run.
  // New behavior: catch + record + continue. A 429 on this account just
  // means it's skipped this run; next 6am picks it up.
  for (const account of trackable) {
    try {
      const result = await scrapeAccount(account);
      perAccount.push(result);
      accountSummaries.push({
        account_id: account.id,
        account_name: account.name,
        status: "scraped",
      });
      pagesAttempted += result.attempted;
      pagesStored += result.succeeded;
      pagesErrored += result.errored;
      pagesDeduped += result.deduped;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const isRateLimit = /rate.?limit|429/i.test(error);
      if (isRateLimit) {
        console.warn(
          `[cron/firecrawl] rate-limited on ${account.name} (${account.id}), skipping — next run picks up`,
          error,
        );
        accountsRateLimited++;
        accountSummaries.push({
          account_id: account.id,
          account_name: account.name,
          status: "rate_limited",
          error,
        });
      } else {
        console.warn(
          `[cron/firecrawl] error on ${account.name} (${account.id}), continuing`,
          error,
        );
        accountsErrored++;
        accountSummaries.push({
          account_id: account.id,
          account_name: account.name,
          status: "errored",
          error,
        });
      }
      perAccount.push({
        account_id: account.id,
        account_name: account.name,
        hard_error: error,
      });
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
      accountsRateLimited,
      accountsErrored,
    },
    accounts: accountSummaries,
    perAccount,
  };

  console.log(
    `[cron/firecrawl] swept ${result.accountsProcessed} accounts: ${pagesStored} stored, ${pagesErrored} errored, ${pagesDeduped} deduped, ${accountsRateLimited} rate-limited, ${accountsErrored} errored in ${result.totalDurationMs}ms`,
  );
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
