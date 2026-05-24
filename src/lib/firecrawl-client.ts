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
