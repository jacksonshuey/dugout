// Tests for src/lib/firecrawl-client.ts.
//
// The client is a thin HTTP wrapper around Firecrawl v2 (/scrape + /map).
// We stub `globalThis.fetch` per-test (vi.stubGlobal) rather than mocking
// at the module level — keeps each test's expectations local + readable.
//
// FIRECRAWL_API_KEY is set in beforeEach so getApiKey() doesn't throw.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mapUrl, scrapeUrl } from "./firecrawl-client";

function mockJsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── scrapeUrl ───────────────────────────────────────────────────────────

describe("scrapeUrl", () => {
  test("returns ok=true with markdown on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          success: true,
          data: {
            markdown: "# Hello\n\nWorld.",
            metadata: { statusCode: 200, title: "Hello", sourceURL: "https://x.com" },
          },
        }),
      ),
    );
    const r = await scrapeUrl("https://x.com");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markdown).toContain("Hello");
      expect(r.statusCode).toBe(200);
      expect(r.sizeBytes).toBeGreaterThan(0);
    }
  });

  test("throws on Firecrawl 429 (caller's responsibility)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 429 })),
    );
    await expect(scrapeUrl("https://x.com")).rejects.toThrow(/rate limit/i);
  });
});

// ─── mapUrl — new in Phase 4 ─────────────────────────────────────────────

describe("mapUrl", () => {
  test("returns ok=true with extracted urls (string-array shape)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        success: true,
        links: [
          "https://stripe.com/",
          "https://stripe.com/about",
          "https://stripe.com/blog/2026/q1",
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await mapUrl("https://stripe.com", { limit: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.urls).toHaveLength(3);
      expect(r.urls[0]).toBe("https://stripe.com/");
    }

    // Sanity: hit /map endpoint with the right body.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("https://api.firecrawl.dev/v2/map");
    const body = JSON.parse((call[1] as RequestInit).body as string) as {
      url: string;
      limit: number;
    };
    expect(body.url).toBe("https://stripe.com");
    expect(body.limit).toBe(20);
  });

  test("accepts the object-array shape ({ url: ... })", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          success: true,
          links: [
            { url: "https://stripe.com/" },
            { url: "https://stripe.com/blog" },
          ],
        }),
      ),
    );
    const r = await mapUrl("https://stripe.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.urls).toEqual(["https://stripe.com/", "https://stripe.com/blog"]);
  });

  test("caps results at the requested limit", async () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://x.com/p/${i}`);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ success: true, links: urls })),
    );
    const r = await mapUrl("https://x.com", { limit: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.urls).toHaveLength(5);
  });

  test("throws on 429 (same posture as scrapeUrl)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 429 })),
    );
    await expect(mapUrl("https://x.com")).rejects.toThrow(/rate limit/i);
  });

  test("returns ok=false on 5xx with statusCode passed through", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(mockJsonResponse({ success: false, error: "boom" }, { status: 503 })),
    );
    const r = await mapUrl("https://x.com");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.statusCode).toBe(503);
      expect(r.error).toBe("boom");
    }
  });

  test("returns ok=false on network/transport error (fetch throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    );
    const r = await mapUrl("https://x.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ECONNRESET");
  });

  test("returns ok=true with empty array if links field is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockJsonResponse({ success: true })),
    );
    const r = await mapUrl("https://x.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.urls).toEqual([]);
  });
});
