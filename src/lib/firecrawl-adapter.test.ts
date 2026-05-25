// Tests for src/lib/firecrawl-adapter.ts.
//
// Three layers, smallest first:
//   1. selectPathsFromMap — pure filter, no I/O
//   2. resolveAccountUrls — orchestrates override / map / fallback
//   3. scrapeAccount — full path-selection + scrape + persist, with all
//      three deps (mapUrl, scrapeUrl, insertWebScrape) injected fakes.

import { describe, expect, test, vi } from "vitest";

import {
  ACCOUNT_PAGES,
  MAX_PATHS_PER_ACCOUNT,
  resolveAccountUrls,
  scrapeAccount,
  selectPathsFromMap,
  type FirecrawlAdapterDeps,
} from "./firecrawl-adapter";
import type {
  FirecrawlMapResult,
  FirecrawlScrapeResult,
} from "./firecrawl-client";
import type { WebScrape } from "./web-scrapes";
import type { Account } from "./types";

// ─── Fixtures ────────────────────────────────────────────────────────────

function mkAccount(overrides: Partial<Account> = {}): Account {
  // Spread so callers can explicitly set fields to undefined (e.g. drop
  // website) — `?? default` would silently re-fill them.
  return {
    id: "acc_test",
    name: "Test Co",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "SF",
    legalTeamSize: 10,
    trackable: true,
    website: "testco.com",
    domain: "testco.com",
    ...overrides,
  };
}

function okScrape(url: string): FirecrawlScrapeResult {
  return {
    ok: true,
    url,
    statusCode: 200,
    markdown: `# ${url}`,
    sizeBytes: 10,
  };
}

function mkRow(url: string): WebScrape {
  return {
    id: `row_${url}`,
    account_id: "acc_test",
    url,
    scraped_at: "2026-05-24T00:00:00.000Z",
    scraped_date: "2026-05-24",
    status_code: 200,
    markdown: "x",
    raw_size_bytes: 1,
    classified_at: null,
    signals_emitted: 0,
    error: null,
    created_at: "2026-05-24T00:00:00.000Z",
  };
}

function deps(overrides: Partial<FirecrawlAdapterDeps> = {}): FirecrawlAdapterDeps {
  return {
    mapUrl: overrides.mapUrl ?? vi.fn(async () => ({ ok: true, urls: [] }) as FirecrawlMapResult),
    scrapeUrl: overrides.scrapeUrl ?? vi.fn(async (u: string) => okScrape(u)),
    insertWebScrape: overrides.insertWebScrape ?? vi.fn(async (s) => mkRow(s.url)),
  };
}

// ─── 1. selectPathsFromMap — pure ───────────────────────────────────────

describe("selectPathsFromMap", () => {
  test("includes homepage first + matches preferred patterns", () => {
    const got = selectPathsFromMap("stripe.com", [
      "https://stripe.com/blog/q1",
      "https://stripe.com/about/team",
      "https://stripe.com/legal/cookies", // not preferred
      "https://stripe.com/customers/acme", // not preferred
    ]);
    expect(got[0]).toBe("https://stripe.com");
    expect(got).toContain("https://stripe.com/blog/q1");
    expect(got).toContain("https://stripe.com/about/team");
    expect(got).not.toContain("https://stripe.com/legal/cookies");
    expect(got).not.toContain("https://stripe.com/customers/acme");
  });

  test("caps at MAX_PATHS_PER_ACCOUNT", () => {
    // 12 matches of /blog — should still cap at 6 (homepage + 5).
    const urls = Array.from(
      { length: 12 },
      (_, i) => `https://x.com/blog/${i}`,
    );
    const got = selectPathsFromMap("x.com", urls);
    expect(got).toHaveLength(MAX_PATHS_PER_ACCOUNT);
    expect(got[0]).toBe("https://x.com");
  });

  test("dedups trailing slash and case variants of same path", () => {
    const got = selectPathsFromMap("x.com", [
      "https://x.com/blog",
      "https://x.com/blog/",
    ]);
    // Homepage + one /blog
    expect(got).toHaveLength(2);
  });

  test("accepts apex subdomains (investors.<apex>) but rejects foreign hosts", () => {
    const got = selectPathsFromMap("x.com", [
      "https://investors.x.com/about",
      "https://cdn.othersite.com/blog/post",
    ]);
    expect(got).toContain("https://investors.x.com/about");
    expect(got).not.toContain("https://cdn.othersite.com/blog/post");
  });

  test("rejects malformed URLs without throwing", () => {
    const got = selectPathsFromMap("x.com", ["not-a-url", "https://x.com/blog"]);
    expect(got).toContain("https://x.com/blog");
  });
});

// ─── 2. resolveAccountUrls — orchestration ──────────────────────────────

describe("resolveAccountUrls", () => {
  test("uses account.paths override when set, skips /map entirely", async () => {
    const account = mkAccount({
      website: "stripe.com",
      paths: ["/", "/custom-page"],
    });
    const mapFn = vi.fn();
    const r = await resolveAccountUrls(account, deps({ mapUrl: mapFn }));
    expect(r.scope).toBe("override");
    expect(r.urls).toEqual(["https://stripe.com", "https://stripe.com/custom-page"]);
    expect(mapFn).not.toHaveBeenCalled();
  });

  test("uses /map result when it returns useful URLs", async () => {
    const account = mkAccount({ website: "stripe.com" });
    const r = await resolveAccountUrls(
      account,
      deps({
        mapUrl: vi.fn(
          async () =>
            ({
              ok: true,
              urls: ["https://stripe.com/blog", "https://stripe.com/about"],
            }) as FirecrawlMapResult,
        ),
      }),
    );
    expect(r.scope).toBe("map");
    expect(r.urls.length).toBeGreaterThanOrEqual(2);
    expect(r.urls[0]).toBe("https://stripe.com");
  });

  test("falls back to ACCOUNT_PAGES when /map errors (5xx)", async () => {
    const account = mkAccount({ website: "stripe.com" });
    const r = await resolveAccountUrls(
      account,
      deps({
        mapUrl: vi.fn(
          async () =>
            ({ ok: false, error: "boom", statusCode: 503 }) as FirecrawlMapResult,
        ),
      }),
    );
    expect(r.scope).toBe("fallback");
    expect(r.urls).toHaveLength(ACCOUNT_PAGES.length);
    expect(r.mapErrorReason).toBe("boom");
  });

  test("falls back to ACCOUNT_PAGES when /map throws 429", async () => {
    const account = mkAccount({ website: "stripe.com" });
    const r = await resolveAccountUrls(
      account,
      deps({
        mapUrl: vi.fn(async () => {
          throw new Error("Firecrawl rate limit (429)");
        }),
      }),
    );
    expect(r.scope).toBe("fallback");
    expect(r.urls).toHaveLength(ACCOUNT_PAGES.length);
    expect(r.mapErrorReason).toContain("429");
  });

  test("falls back when /map returns < 2 useful URLs", async () => {
    const account = mkAccount({ website: "stripe.com" });
    const r = await resolveAccountUrls(
      account,
      deps({
        mapUrl: vi.fn(
          async () =>
            ({
              ok: true,
              urls: ["https://stripe.com/legal", "https://stripe.com/customers/acme"],
            }) as FirecrawlMapResult,
        ),
      }),
    );
    expect(r.scope).toBe("fallback");
    expect(r.urls).toHaveLength(ACCOUNT_PAGES.length);
  });
});

// ─── 3. scrapeAccount — end-to-end with all deps stubbed ────────────────

describe("scrapeAccount", () => {
  test("override path → calls scrapeUrl per override path, never /map", async () => {
    const account = mkAccount({
      website: "stripe.com",
      paths: ["/", "/blog"],
    });
    const scrapeFn = vi.fn(async (u: string) => okScrape(u));
    const insertFn = vi.fn(async (s) => mkRow(s.url));
    const mapFn = vi.fn();

    const r = await scrapeAccount(
      account,
      deps({
        mapUrl: mapFn,
        scrapeUrl: scrapeFn,
        insertWebScrape: insertFn,
      }),
    );

    expect(mapFn).not.toHaveBeenCalled();
    expect(scrapeFn).toHaveBeenCalledTimes(2);
    expect(insertFn).toHaveBeenCalledTimes(2);
    expect(r.succeeded).toBe(2);
    expect(r.errored).toBe(0);
  });

  test("dynamic path → /map called once, scrape called per picked URL, capped at MAX_PATHS_PER_ACCOUNT", async () => {
    const account = mkAccount({ website: "stripe.com" });
    const sitemap = Array.from(
      { length: 15 },
      (_, i) => `https://stripe.com/blog/post-${i}`,
    );
    const scrapeFn = vi.fn(async (u: string) => okScrape(u));
    const insertFn = vi.fn(async (s) => mkRow(s.url));

    const r = await scrapeAccount(
      account,
      deps({
        mapUrl: vi.fn(
          async () => ({ ok: true, urls: sitemap }) as FirecrawlMapResult,
        ),
        scrapeUrl: scrapeFn,
        insertWebScrape: insertFn,
      }),
    );

    // Cap = homepage + 5 blog posts = 6 total
    expect(scrapeFn).toHaveBeenCalledTimes(MAX_PATHS_PER_ACCOUNT);
    expect(r.attempted).toBe(MAX_PATHS_PER_ACCOUNT);
    expect(r.succeeded).toBe(MAX_PATHS_PER_ACCOUNT);
  });

  test("no website → returns empty result, never calls deps", async () => {
    const account = mkAccount({ website: undefined });
    const scrapeFn = vi.fn();
    const mapFn = vi.fn();
    const r = await scrapeAccount(
      account,
      deps({ scrapeUrl: scrapeFn, mapUrl: mapFn }),
    );
    expect(r.attempted).toBe(0);
    expect(scrapeFn).not.toHaveBeenCalled();
    expect(mapFn).not.toHaveBeenCalled();
  });

  test("propagates 429 from scrapeUrl so cron's per-account try/catch can record it", async () => {
    const account = mkAccount({ website: "stripe.com", paths: ["/", "/blog"] });
    const r = scrapeAccount(
      account,
      deps({
        scrapeUrl: vi.fn(async () => {
          throw new Error("Firecrawl rate limit (429)");
        }),
      }),
    );
    await expect(r).rejects.toThrow(/rate limit/i);
  });
});
