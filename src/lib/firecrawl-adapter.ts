import { mapUrl, scrapeUrl, type FirecrawlMapResult } from "./firecrawl-client";
import { insertWebScrape, type WebScrape } from "./web-scrapes";
import type { Account } from "./types";

// Firecrawl adapter - per-account orchestrator. For each tracked account,
// scrapes a fixed set of content paths off the account's website and
// stores each result as a row in `web_scrapes`. The classify-pending
// sweeper picks up the new rows and runs Haiku on them out-of-band.
//
// We don't classify inline - that's the explicit architectural choice
// (mirrors the AgentMail webhook → sweeper pattern). The cron's only job
// is to fill the queue.
//
// Concurrency: pages are scraped in parallel per account (4 calls at once)
// but accounts are processed sequentially. 11 accounts × ~5s/page = ~55s
// at the upper bound, well under maxDuration=300.

// Content paths most likely to surface material signals. Order matters
// only for log readability - execution is parallel.
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

// Cap on dynamic-scope paths per account. Tuned for cost: 11 accounts × 6
// paths × 30 days ≈ 1980 scrape credits/mo + ~330 /map credits/mo (one map
// call per account per day). Up from 1320/mo on the old 4-path hardcode -
// roughly 1.75x for coverage that actually finds /blog on Stripe,
// /newsroom on Boeing, etc. See route.ts §"Scope" comment for the live
// number.
export const MAX_PATHS_PER_ACCOUNT = 6;

// Path patterns we want to keep when filtering /map output. Substring +
// case-insensitive match against the URL path. Order doesn't matter -
// dedup + cap happen after.
//
// Bias: surface news/PR/leadership pages (where material signals live)
// over deep product/marketing trees. Homepage gets included unconditionally
// by selectPathsFromMap (always first path).
const PREFERRED_PATH_PATTERNS: readonly string[] = [
  "/about",
  "/news",
  "/blog",
  "/newsroom",
  "/press",
  "/investors",
  "/investor-relations",
  "/leadership",
  "/team",
  "/company",
  "/products",
];

// Deps injection seam for testing. Production wiring uses the real
// firecrawl-client + web-scrapes functions; tests pass fakes.
export interface FirecrawlAdapterDeps {
  mapUrl: typeof mapUrl;
  scrapeUrl: typeof scrapeUrl;
  insertWebScrape: typeof insertWebScrape;
}

const DEFAULT_DEPS: FirecrawlAdapterDeps = {
  mapUrl,
  scrapeUrl,
  insertWebScrape,
};

// Re-exported for tests that want a typed reference to the persisted row.
export type { WebScrape };

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

// Heuristic filter over /map output. Keeps the homepage + URLs whose path
// matches one of PREFERRED_PATH_PATTERNS, caps to MAX_PATHS_PER_ACCOUNT,
// dedups, returns absolute URLs.
//
// Exported for unit testing. Bail-out (< 2 useful URLs) is handled by the
// caller - this just returns what it found.
export function selectPathsFromMap(
  website: string,
  mapUrls: readonly string[],
  cap: number = MAX_PATHS_PER_ACCOUNT,
): string[] {
  const homepage = buildUrl(website, "/");
  const seen = new Set<string>([homepage]);
  const picked: string[] = [homepage];

  // Normalize host of `website` so we can drop foreign-host URLs that
  // sometimes appear in /map output (CDN buckets, subdomain redirects).
  let targetHost: string | null = null;
  try {
    targetHost = new URL(homepage).host.replace(/^www\./, "");
  } catch {
    targetHost = null;
  }

  for (const raw of mapUrls) {
    if (picked.length >= cap) break;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }

    if (targetHost) {
      const host = parsed.host.replace(/^www\./, "");
      // Allow exact + subdomain matches of the apex (e.g. investors.<apex>),
      // skip anything else (CDN, doc subdomain on a foreign host, etc).
      if (host !== targetHost && !host.endsWith(`.${targetHost}`)) continue;
    }

    const pathLower = parsed.pathname.toLowerCase();
    const matches = PREFERRED_PATH_PATTERNS.some((pat) =>
      pathLower.includes(pat),
    );
    if (!matches) continue;

    // Use the normalized URL (no trailing slash, no fragment) for dedup so
    // `/news` and `/news/` collapse to one entry.
    const normalized = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    picked.push(normalized);
  }

  return picked;
}

async function scrapeAndStore(
  account: Account,
  url: string,
  deps: FirecrawlAdapterDeps,
): Promise<AccountScrapeResult["pages"][number]> {
  // scrapeUrl throws ONLY on hard rate-limit (Firecrawl 429). That throw
  // is what tells the cron handler to break out of the per-account loop
  // and stop burning credits. Don't catch it here - let it propagate up
  // through Promise.all → scrapeAccount → cron handler's catch → continue.
  // Network/transport errors come back as `{ ok: false }` already.
  const result = await deps.scrapeUrl(url);

  if (!result.ok) {
    // Soft failure (404, target 5xx, parse error). Insert an error row so
    // we have a paper trail - useful for spotting which paths are wrong
    // for a given account. dedup hit (same-day re-scrape) returns null;
    // any other DB error rethrows so the run halts loudly rather than
    // showing up as a fake "dedup" in the logs.
    const row = await deps.insertWebScrape({
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

  const row = await deps.insertWebScrape({
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

// Resolve which URLs to scrape for an account. Order of precedence:
//   1. account.paths override (production opt-out for sites that don't
//      play nice with /map - e.g. JS-only landing pages with no sitemap).
//   2. dynamic /map result, filtered through selectPathsFromMap.
//   3. fallback to ACCOUNT_PAGES hardcoded list (when /map returns < 2
//      useful URLs, errors, or 429s).
//
// `scope` is returned alongside `urls` so the caller (cron) can log which
// path was taken - useful for spotting when /map is consistently failing
// for a given site.
export async function resolveAccountUrls(
  account: Account,
  deps: FirecrawlAdapterDeps = DEFAULT_DEPS,
): Promise<{
  urls: string[];
  scope: "override" | "map" | "fallback";
  mapErrorReason?: string;
}> {
  const website = account.website!;

  if (account.paths && account.paths.length > 0) {
    return {
      urls: account.paths.map((p) => buildUrl(website, p)),
      scope: "override",
    };
  }

  // /map call is cheap (1 credit, fast). On 429 it throws; on other
  // errors it returns `{ ok: false }`. We always fall back to the
  // hardcoded set rather than skipping the account entirely - losing
  // scope per-account would create silent coverage gaps.
  let mapResult: FirecrawlMapResult;
  try {
    mapResult = await deps.mapUrl(website, { limit: 20 });
  } catch (e) {
    // 429 on /map → fall back to hardcoded paths for this account.
    // The 429 reaching scrapeUrl below would still throw and bubble; the
    // cron's per-account try/catch handles that. We don't rethrow here
    // because dynamic scope failing is recoverable - full scrape failing
    // is the case that needs to halt this account.
    return {
      urls: ACCOUNT_PAGES.map((p) => buildUrl(website, p)),
      scope: "fallback",
      mapErrorReason: e instanceof Error ? e.message : String(e),
    };
  }

  if (!mapResult.ok) {
    return {
      urls: ACCOUNT_PAGES.map((p) => buildUrl(website, p)),
      scope: "fallback",
      mapErrorReason: mapResult.error,
    };
  }

  const picked = selectPathsFromMap(website, mapResult.urls);
  // /map returned but we got nothing useful (only the homepage matched).
  // Hardcoded fallback is strictly better than scraping just `/`.
  if (picked.length < 2) {
    return {
      urls: ACCOUNT_PAGES.map((p) => buildUrl(website, p)),
      scope: "fallback",
      mapErrorReason: `only ${picked.length} URL(s) matched preferred patterns`,
    };
  }

  return { urls: picked, scope: "map" };
}

export async function scrapeAccount(
  account: Account,
  deps: FirecrawlAdapterDeps = DEFAULT_DEPS,
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

  const { urls } = await resolveAccountUrls(account, deps);

  // Parallelize per account. allSettled (not all) so a hard 429 on one
  // page doesn't leave the other rejections unhandled - we await every
  // page, then re-throw the first 429 if any so the cron handler's
  // per-account try/catch records it and continues with the next account.
  const settled = await Promise.allSettled(
    urls.map((u) => scrapeAndStore(account, u, deps)),
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
