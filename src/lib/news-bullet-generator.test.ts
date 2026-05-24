// Tests for src/lib/news-bullet-generator.ts.
//
// The generator has two surfaces:
//   1. `fallbackBullet(article)`           — pure helper, no I/O
//   2. `generateBullet(input, deps)`       — Haiku-backed, fail-soft
//
// We exercise both. The Haiku call is mocked via `deps.haikuCall = vi.fn()`.

import { describe, expect, test, vi } from "vitest";

import {
  fallbackBullet,
  generateBullet,
} from "./news-bullet-generator";
import type { ArticleInput, WorkspaceRelevance } from "./news-filter-types";

// ─── Fixtures ────────────────────────────────────────────────────────────

function mkArticle(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    url: overrides.url ?? "https://example.com/article",
    title: overrides.title ?? "Anthropic ships Claude 4.6 with longer context",
    description: overrides.description ?? null,
    source_name: overrides.source_name ?? "Example News",
    source_domain: overrides.source_domain ?? "example.com",
    published_at: overrides.published_at ?? "2026-05-24T12:00:00.000Z",
    author: overrides.author ?? null,
  };
}

function mkInput(article: ArticleInput, relevance: WorkspaceRelevance = "high") {
  return {
    article,
    workspace_relevance: relevance,
    account_name: "Anthropic",
  };
}

// ─── 1. fallbackBullet — pure helper ─────────────────────────────────────

describe("fallbackBullet", () => {
  test("short title returned as-is with source=fallback", () => {
    const r = fallbackBullet(mkArticle({ title: "Acme acquires Beta" }));
    expect(r.bullet).toBe("Acme acquires Beta");
    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBeUndefined();
  });

  test("200-char title is truncated to ≤100 chars ending with …", () => {
    const longTitle = "A".repeat(200);
    const r = fallbackBullet(mkArticle({ title: longTitle }));
    expect(r.bullet.length).toBeLessThanOrEqual(100);
    expect(r.bullet.endsWith("…")).toBe(true);
    expect(r.source).toBe("fallback");
  });

  test("empty title returns empty bullet string (source=fallback)", () => {
    const r = fallbackBullet(mkArticle({ title: "" }));
    // The trimmed empty title is short enough to fit, so it's returned as-is.
    expect(r.bullet).toBe("");
    expect(r.source).toBe("fallback");
  });
});

// ─── 2. generateBullet · no API key ──────────────────────────────────────

describe("generateBullet · no api key", () => {
  test("falls back to title with fallbackReason=no_api_key", async () => {
    const article = mkArticle({ title: "Stripe launches new instant payouts product" });
    const haikuCall = vi.fn();

    const r = await generateBullet(mkInput(article), {
      hasApiKey: false,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("no_api_key");
    expect(r.bullet).toBe("Stripe launches new instant payouts product");
    expect(haikuCall).not.toHaveBeenCalled();
  });
});

// ─── 3. generateBullet · Haiku success ───────────────────────────────────

describe("generateBullet · haiku success", () => {
  test("returns the Haiku-emitted bullet with source=haiku and no fallbackReason", async () => {
    const bullet = "Anthropic ships Claude 4.6 with 200K context";
    const haikuCall = vi.fn(async () => ({ bullet }));

    const r = await generateBullet(
      mkInput(mkArticle({ title: "Anthropic ships Claude 4.6 with longer context window" })),
      { hasApiKey: true, haikuCall },
    );

    expect(r.bullet).toBe(bullet);
    expect(r.source).toBe("haiku");
    expect(r.fallbackReason).toBeUndefined();
    expect(haikuCall).toHaveBeenCalledTimes(1);
  });

  test("trims surrounding whitespace on the Haiku bullet", async () => {
    const haikuCall = vi.fn(async () => ({
      bullet: "  Stripe launches instant payouts in 7 new markets  ",
    }));

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.bullet).toBe("Stripe launches instant payouts in 7 new markets");
    expect(r.source).toBe("haiku");
  });
});

// ─── 4. Haiku overlong → fallback ────────────────────────────────────────

describe("generateBullet · haiku overlong", () => {
  test("Haiku returns >100 chars → fallback with fallbackReason=haiku_overlong", async () => {
    const overlong = "x".repeat(150);
    const haikuCall = vi.fn(async () => ({ bullet: overlong }));

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_overlong");
    expect(r.bullet.length).toBeLessThanOrEqual(100);
  });
});

// ─── 5. Haiku schema violation → fallback ────────────────────────────────

describe("generateBullet · haiku schema violation", () => {
  test("tool input missing `bullet` field → fallback with haiku_schema_violation", async () => {
    const haikuCall = vi.fn(async () => ({ wrong_field: "x" }));

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_schema_violation");
  });

  test("tool input is null → fallback with haiku_schema_violation", async () => {
    const haikuCall = vi.fn(async () => null);

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_schema_violation");
  });

  test("bullet field is an empty string → fallback with haiku_schema_violation", async () => {
    const haikuCall = vi.fn(async () => ({ bullet: "" }));

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_schema_violation");
  });
});

// ─── 6. Haiku timeout → fallback ─────────────────────────────────────────

describe("generateBullet · haiku timeout", () => {
  test("error message contains 'aborted' → fallbackReason=haiku_timeout", async () => {
    const haikuCall = vi.fn(async () => {
      throw new Error("Request aborted by AbortController");
    });

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_timeout");
  });

  test("error message contains 'timeout' → fallbackReason=haiku_timeout", async () => {
    const haikuCall = vi.fn(async () => {
      throw new Error("Request timeout after 8s");
    });

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.fallbackReason).toBe("haiku_timeout");
  });
});

// ─── 7. Haiku 5xx → fallback ─────────────────────────────────────────────

describe("generateBullet · haiku 5xx", () => {
  test("generic Error (non-timeout) maps to haiku_5xx via classifyError fallthrough", async () => {
    // classifyError() collapses anything-not-a-timeout to haiku_5xx; this is
    // the documented "4xx + network → 5xx" behavior mirrored from ranker.ts.
    const haikuCall = vi.fn(async () => {
      throw new Error("Internal server error 503");
    });

    const r = await generateBullet(mkInput(mkArticle()), {
      hasApiKey: true,
      haikuCall,
    });

    expect(r.source).toBe("fallback");
    expect(r.fallbackReason).toBe("haiku_5xx");
  });
});
