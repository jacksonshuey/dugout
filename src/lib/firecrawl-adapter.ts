import { scrapeUrl } from "./firecrawl-client";
import { insertWebScrape } from "./web-scrapes";
import type { Account } from "./types";

// Firecrawl adapter — per-account orchestrator. For each tracked account,
// scrapes a fixed set of content paths off the account's website and
// stores each result as a row in `web_scrapes`. The classify-pending
// sweeper picks up the new rows and runs Haiku on them out-of-band.
//
// We don't classify inline — that's the explicit architectural choice
// (mirrors the AgentMail webhook → sweeper pattern). The cron's only job
// is to fill the queue.
//
// Concurrency: pages are scraped in parallel per account (4 calls at once)
// but accounts are processed sequentially. 11 accounts × ~5s/page = ~55s
// at the upper bound, well under maxDuration=300.

// Content paths most likely to surface material signals. Order matters
// only for log readability — execution is parallel.
//
// We deliberately keep this list small + generic so it works across the
// 11 seeded accounts (which span pharma, infra, fintech, energy,
// healthcare, etc.) without per-account configuration. Sites that route
// these paths differently (e.g. `/newsroom` instead of `/news`) just
// return a 404 status from Firecrawl, which the client surfaces as
// `ok: false` and the adapter records as an error row.
export const ACCOUNT_PAGES: readonly string[] = [
  "/",
  "/about",
  "/news",
  "/leadership",
];

export interface AccountScrapeResult {
  account_id: string;
  account_name: string;
  attempted: number;
  succeeded: number;
  errored: number;
  deduped: number;
  pages: Array<{
    url: string;
    status: "stored" | "error" | "dedup";
    statusCode: number | null;
    error?: string;
  }>;
}

function buildUrl(website: string, path: string): string {
  const base = website.startsWith("http") ? website : `https://${website}`;
  const trimmed = base.replace(/\/$/, "");
  return path === "/" ? trimmed : `${trimmed}${path}`;
}

async function scrapeAndStore(
  account: Account,
  url: string,
): Promise<AccountScrapeResult["pages"][number]> {
  // scrapeUrl throws ONLY on hard rate-limit (Firecrawl 429). That throw
  // is what tells the cron handler to break out of the per-account loop
  // and stop burning credits. Don't catch it here — let it propagate up
  // through Promise.all → scrapeAccount → cron handler's catch → break.
  // Network/transport errors come back as `{ ok: false }` already.
  const result = await scrapeUrl(url);

  if (!result.ok) {
    // Soft failure (404, target 5xx, parse error). Insert an error row so
    // we have a paper trail — useful for spotting which paths are wrong
    // for a given account. dedup hit (same-day re-scrape) returns null;
    // any other DB error rethrows so the run halts loudly rather than
    // showing up as a fake "dedup" in the logs.
    const row = await insertWebScrape({
      account_id: account.id,
      url,
      status_code: result.statusCode,
      markdown: null,
      raw_size_bytes: 0,
      error: result.error,
    });
    return {
      url,
      status: row === null ? "dedup" : "error",
      statusCode: result.statusCode,
      error: result.error,
    };
  }

  const row = await insertWebScrape({
    account_id: account.id,
    url,
    status_code: result.statusCode,
    markdown: result.markdown,
    raw_size_bytes: result.sizeBytes,
  });

  return {
    url,
    status: row === null ? "dedup" : "stored",
    statusCode: result.statusCode,
  };
}

export async function scrapeAccount(
  account: Account,
): Promise<AccountScrapeResult> {
  if (!account.website) {
    return {
      account_id: account.id,
      account_name: account.name,
      attempted: 0,
      succeeded: 0,
      errored: 0,
      deduped: 0,
      pages: [],
    };
  }

  const urls = ACCOUNT_PAGES.map((p) => buildUrl(account.website!, p));
  // Parallelize per account. allSettled (not all) so a hard 429 on one
  // page doesn't leave the other three rejections unhandled — we await
  // every page, then re-throw the first 429 if any so the cron handler
  // breaks the per-account loop and stops burning credits.
  const settled = await Promise.allSettled(
    urls.map((u) => scrapeAndStore(account, u)),
  );
  const rateLimited = settled.find(
    (s): s is PromiseRejectedResult =>
      s.status === "rejected" &&
      s.reason instanceof Error &&
      /rate.?limit|429/i.test(s.reason.message),
  );
  if (rateLimited) throw rateLimited.reason;

  const pages: AccountScrapeResult["pages"] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return { url: urls[i]!, status: "error", statusCode: null, error: reason };
  });

  return {
    account_id: account.id,
    account_name: account.name,
    attempted: pages.length,
    succeeded: pages.filter((p) => p.status === "stored").length,
    errored: pages.filter((p) => p.status === "error").length,
    deduped: pages.filter((p) => p.status === "dedup").length,
    pages,
  };
}
