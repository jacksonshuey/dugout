// Firecrawl client — typed wrapper around POST https://api.firecrawl.dev/v2/scrape.
// Spec source: https://docs.firecrawl.dev/api-reference/v2-endpoint/scrape
//
// We use the markdown format with onlyMainContent enabled — that's the
// sweet spot for LLM ingestion: navs/footers/cookie banners stripped,
// content kept readable. Firecrawl's `onlyCleanContent` runs an extra
// LLM pass to remove boilerplate; we skip it (extra latency + cost on
// Firecrawl's side for marginal gain when Haiku is doing classification
// anyway).
//
// 404s / 500s on the scraped URL come back as `success: true` with the
// target's statusCode in metadata — we surface that as `ok: false` so
// the adapter can decide whether to store an error row or skip.
//
// 429 from Firecrawl itself (we exceeded our rate limit) throws — the
// adapter catches and records the per-account error.

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const REQUEST_TIMEOUT_MS = 30_000;
// /map is a sitemap+crawl-graph lookup, typically much faster than /scrape
// (no page render). 25s is generous — most calls return in <3s.
const MAP_REQUEST_TIMEOUT_MS = 25_000;

export interface FirecrawlScrapeOptions {
  // 1000–300000ms per Firecrawl spec; default 60000.
  // We pass 25000 to stay under our own client timeout.
  timeout?: number;
  // Strip navs/footers/cookie banners. Default true.
  onlyMainContent?: boolean;
}

export interface FirecrawlScrapeSuccess {
  ok: true;
  url: string;
  statusCode: number;
  markdown: string;
  title?: string;
  sizeBytes: number;
}

export interface FirecrawlScrapeFailure {
  ok: false;
  url: string;
  statusCode: number | null;
  error: string;
}

export type FirecrawlScrapeResult =
  | FirecrawlScrapeSuccess
  | FirecrawlScrapeFailure;

interface FirecrawlResponse {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      statusCode?: number;
      title?: string | string[];
      sourceURL?: string;
      url?: string;
      error?: string | null;
    };
  };
}

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error("FIRECRAWL_API_KEY not set");
  }
  return key.trim();
}

// Acceptable target page status codes. Anything outside this range we treat
// as a soft failure — the page either doesn't exist (404) or is broken
// (5xx) and there's nothing to classify.
function isUsableStatus(code: number | null | undefined): boolean {
  return typeof code === "number" && code >= 200 && code < 400;
}

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0];
  return undefined;
}

export async function scrapeUrl(
  url: string,
  options: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const key = getApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: options.onlyMainContent ?? true,
        timeout: options.timeout ?? 25_000,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      url,
      statusCode: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  clearTimeout(timer);

  if (res.status === 429) {
    // Firecrawl-side throttling. Surface as a hard error so the adapter
    // can stop scraping further accounts this run rather than burning
    // through credits while every call fails.
    throw new Error("Firecrawl rate limit (429)");
  }

  let body: FirecrawlResponse;
  try {
    body = (await res.json()) as FirecrawlResponse;
  } catch (e) {
    return {
      ok: false,
      url,
      statusCode: res.status,
      error: `Firecrawl response not JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!res.ok || body.success === false) {
    return {
      ok: false,
      url,
      statusCode: res.status,
      error: body.error ?? `Firecrawl HTTP ${res.status}`,
    };
  }

  const metaStatus = body.data?.metadata?.statusCode ?? null;
  const markdown = body.data?.markdown ?? "";

  if (!isUsableStatus(metaStatus)) {
    return {
      ok: false,
      url,
      statusCode: metaStatus,
      error:
        body.data?.metadata?.error ??
        `Target returned status ${metaStatus ?? "unknown"}`,
    };
  }

  return {
    ok: true,
    url,
    statusCode: metaStatus as number,
    markdown,
    title: firstString(body.data?.metadata?.title),
    sizeBytes: Buffer.byteLength(markdown, "utf8"),
  };
}

// ─── /map endpoint ───────────────────────────────────────────────────────
//
// POST https://api.firecrawl.dev/v2/map
// Spec: https://docs.firecrawl.dev/api-reference/v2-endpoint/map
//
// Returns up to `limit` URLs discovered from the target's sitemap.xml +
// crawl graph. Much cheaper + faster than /scrape (no page render, no
// markdown extraction). We use it from the adapter to discover the actual
// content paths a site exposes — replaces the hardcoded
// `["/", "/about", "/news", "/leadership"]` set that fails on sites that
// route differently (Stripe uses /blog, Boeing uses /newsroom, etc).
//
// Returns a tagged union mirroring scrapeUrl so callers branch identically.
// 429 throws so the adapter's per-account try/catch can record it and
// continue with the next account.

export interface FirecrawlMapOptions {
  // Cap on the returned URL list. Default 20 — enough to filter down to
  // ~6 high-signal pages after substring matching.
  limit?: number;
  // Optional server-side search filter Firecrawl applies before returning
  // results. We don't use it today (we filter locally for transparency),
  // but it's exposed for callers that want it.
  search?: string;
}

export type FirecrawlMapResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: string; statusCode?: number };

interface FirecrawlMapResponse {
  success?: boolean;
  error?: string;
  links?: Array<string | { url?: string }>;
}

export async function mapUrl(
  url: string,
  opts: FirecrawlMapOptions = {},
): Promise<FirecrawlMapResult> {
  const key = getApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAP_REQUEST_TIMEOUT_MS);

  const limit = opts.limit ?? 20;

  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_BASE}/map`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        limit,
        ...(opts.search ? { search: opts.search } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  clearTimeout(timer);

  if (res.status === 429) {
    // Same posture as scrapeUrl — surface as a throw so the adapter's
    // try/catch records it as a per-account skip and moves on.
    throw new Error("Firecrawl rate limit (429)");
  }

  let body: FirecrawlMapResponse;
  try {
    body = (await res.json()) as FirecrawlMapResponse;
  } catch (e) {
    return {
      ok: false,
      statusCode: res.status,
      error: `Firecrawl /map response not JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (!res.ok || body.success === false) {
    return {
      ok: false,
      statusCode: res.status,
      error: body.error ?? `Firecrawl /map HTTP ${res.status}`,
    };
  }

  // Firecrawl v2 returns `links` as an array. Historically responses have
  // shipped as either `["https://..."]` or `[{ url: "https://..." }]`
  // depending on the request — accept both shapes defensively.
  const raw = Array.isArray(body.links) ? body.links : [];
  const urls = raw
    .map((entry): string | null => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof entry.url === "string") {
        return entry.url;
      }
      return null;
    })
    .filter((u): u is string => typeof u === "string" && u.length > 0);

  return { ok: true, urls: urls.slice(0, limit) };
}
