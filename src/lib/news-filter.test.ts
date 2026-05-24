// Tests for src/lib/news-filter.ts (the orchestrator).
//
// We exercise the public entry `filterArticle(input, deps)` and inject:
//   - `stage2HaikuCall` to simulate Haiku responses / failures
//   - `bulletDeps: { hasApiKey: false }` so the bullet generator takes its
//     pure fallback path (no need to also mock the inner Haiku call)
//   - `hasApiKey` to bypass the env-driven HAS_ANTHROPIC_KEY check
//
// No network. No Supabase. Pure tests.

import { describe, expect, test, vi } from "vitest";

import { filterArticle } from "./news-filter";
import {
  PROMPT_VERSION,
  type ArticleInput,
  type FilterContext,
} from "./news-filter-types";

// ─── Fixtures ────────────────────────────────────────────────────────────

function mkArticle(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    url: overrides.url ?? "https://example.com/article",
    title:
      overrides.title ??
      "Anthropic launches Claude 4.7 with a million-token context window",
    description: overrides.description ?? "Anthropic announced a new model.",
    source_name: overrides.source_name ?? "TechCrunch",
    source_domain: overrides.source_domain ?? "techcrunch.com",
    published_at: overrides.published_at ?? "2026-05-24T12:00:00.000Z",
    author: overrides.author ?? null,
  };
}

function mkContext(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    account_name: overrides.account_name ?? "Anthropic",
    account_industry: overrides.account_industry ?? "AI / ML",
    account_id: overrides.account_id ?? "acc_1",
    workspace_name: overrides.workspace_name ?? "Checkbox",
    primary_vertical: overrides.primary_vertical ?? "tech_ai",
  };
}

// Default Haiku result used by the "kept" tests. Tests override per-case.
function haikuOk(overrides: Partial<{
  verdict: string;
  workspace_relevance: string;
  confidence: number;
  reasoning: string;
}> = {}) {
  return {
    verdict: overrides.verdict ?? "newsworthy",
    workspace_relevance: overrides.workspace_relevance ?? "high",
    confidence: overrides.confidence ?? 0.9,
    reasoning:
      overrides.reasoning ??
      "Direct product launch by the target account; high relevance.",
  };
}

// Minimal fake of `Anthropic.APIError` for 5xx classification. The real
// classifier uses `instanceof Anthropic.APIError`, but for the 5xx branch
// we don't need exact instance match: `classifyError` falls through to
// `haiku_5xx` for any non-timeout error. We surface this via a plain Error.
class FakeAPIError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
    this.name = "APIError";
  }
}

// ─── 1. Stage 1 reject short-circuits ────────────────────────────────────

describe("filterArticle · stage 1 short-circuit", () => {
  test("blacklisted domain → no Haiku call, decision.stage=1, no bullet field", async () => {
    const stage2HaikuCall = vi.fn();
    const r = await filterArticle(
      {
        article: mkArticle({
          source_domain: "pymnts.com",
          source_name: "PYMNTS",
          title: "The Weekender: When Banks Start Dressing for the Job They Want",
        }),
        context: mkContext(),
      },
      { hasApiKey: true, stage2HaikuCall, bulletDeps: { hasApiKey: false } },
    );

    expect(stage2HaikuCall).not.toHaveBeenCalled();
    expect(r.decision.stage).toBe(1);
    expect(r.decision.verdict).toBe("rejected");
    expect(r.decision.workspace_relevance).toBe("none");
    expect(r.decision.rule).toBeTruthy();
    expect(r.decision.rule).toContain("domain_blacklist");
    expect(r.decision.model).toBeNull();
    expect(r.decision.confidence).toBeNull();
    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
    expect(r.bullet).toBeUndefined();
  });
});

// ─── 2. Stage 2 newsworthy + high relevance ──────────────────────────────

describe("filterArticle · stage 2 newsworthy", () => {
  test("kept with high relevance → bullet generated, decision.stage=2", async () => {
    const stage2HaikuCall = vi.fn(async () =>
      haikuOk({ verdict: "newsworthy", workspace_relevance: "high", confidence: 0.9 }),
    );

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        // Force the bullet generator into its fallback (uses article title).
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(stage2HaikuCall).toHaveBeenCalledTimes(1);
    expect(r.decision.stage).toBe(2);
    expect(r.decision.verdict).toBe("newsworthy");
    expect(r.decision.workspace_relevance).toBe("high");
    expect(r.decision.confidence).toBe(0.9);
    expect(r.decision.model).toBe("claude-haiku-4-5");
    expect(r.decision.rule).toBeNull();
    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
    // Bullet from fallback = the article title (≤100 chars in this fixture).
    expect(r.bullet).toBe(
      "Anthropic launches Claude 4.7 with a million-token context window",
    );
  });
});

// ─── 3. Stage 2 low_signal + low relevance ───────────────────────────────

describe("filterArticle · stage 2 low_signal", () => {
  test("low_signal kept → bullet still generated, preserved on output", async () => {
    const stage2HaikuCall = vi.fn(async () =>
      haikuOk({ verdict: "low_signal", workspace_relevance: "low", confidence: 0.55 }),
    );

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.stage).toBe(2);
    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.workspace_relevance).toBe("low");
    expect(r.decision.confidence).toBe(0.55);
    expect(r.bullet).toBeTruthy();
    expect(typeof r.bullet).toBe("string");
  });
});

// ─── 4. Stage 2 rejected ─────────────────────────────────────────────────

describe("filterArticle · stage 2 rejected", () => {
  test("Haiku says rejected → bullet is UNSET (per L1.c spec)", async () => {
    const stage2HaikuCall = vi.fn(async () =>
      haikuOk({
        verdict: "rejected",
        workspace_relevance: "none",
        confidence: 0.85,
        reasoning: "Off-topic press release, no account relevance.",
      }),
    );

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.stage).toBe(2);
    expect(r.decision.verdict).toBe("rejected");
    expect(r.decision.workspace_relevance).toBe("none");
    expect(r.decision.model).toBe("claude-haiku-4-5");
    expect(r.bullet).toBeUndefined();
  });
});

// ─── 5. Stage 2 5xx fail-soft ────────────────────────────────────────────

describe("filterArticle · stage 2 fail-soft (5xx)", () => {
  test("5xx-like error → low_signal/low + reasoning has stage2_failsoft + model=fallback", async () => {
    const stage2HaikuCall = vi.fn(async () => {
      throw new FakeAPIError(503, "Service Unavailable");
    });

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.workspace_relevance).toBe("low");
    expect(r.decision.confidence).toBe(0);
    expect(r.decision.model).toBe("fallback");
    expect(r.decision.reasoning).toContain("stage2_failsoft");
    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
    // Fail-soft path STILL generates a bullet via the fallback generator.
    expect(r.bullet).toBeTruthy();
    expect(r.bullet).toBe(
      "Anthropic launches Claude 4.7 with a million-token context window",
    );
  });
});

// ─── 6. Stage 2 timeout fail-soft ────────────────────────────────────────

describe("filterArticle · stage 2 fail-soft (timeout)", () => {
  test("timeout error → low_signal/low fail-soft, reasoning notes haiku_timeout", async () => {
    const stage2HaikuCall = vi.fn(async () => {
      throw new Error("timeout after 10s");
    });

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.workspace_relevance).toBe("low");
    expect(r.decision.reasoning).toContain("stage2_failsoft");
    expect(r.decision.reasoning).toContain("haiku_timeout");
    expect(r.decision.model).toBe("fallback");
  });

  test("aborted error → also haiku_timeout fail-soft", async () => {
    const stage2HaikuCall = vi.fn(async () => {
      throw new Error("Request aborted by AbortController");
    });

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.reasoning).toContain("haiku_timeout");
  });
});

// ─── 7. Stage 2 schema-violation fail-soft ───────────────────────────────

describe("filterArticle · stage 2 fail-soft (schema violation)", () => {
  test("invalid verdict enum value → fail-soft with haiku_schema_violation", async () => {
    const stage2HaikuCall = vi.fn(async () => ({
      verdict: "invalid",
      workspace_relevance: "high",
      confidence: 0.9,
      reasoning: "Some reasoning that is long enough.",
    }));

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.workspace_relevance).toBe("low");
    expect(r.decision.model).toBe("fallback");
    expect(r.decision.reasoning).toContain("stage2_failsoft");
    expect(r.decision.reasoning).toContain("haiku_schema_violation");
  });

  test("invalid workspace_relevance enum → schema violation fail-soft", async () => {
    const stage2HaikuCall = vi.fn(async () => ({
      verdict: "newsworthy",
      workspace_relevance: "extreme", // not in enum
      confidence: 0.9,
      reasoning: "Some valid-length reasoning here.",
    }));

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.reasoning).toContain("haiku_schema_violation");
  });

  test("confidence out of [0,1] range → schema violation fail-soft", async () => {
    const stage2HaikuCall = vi.fn(async () => ({
      verdict: "newsworthy",
      workspace_relevance: "high",
      confidence: 1.5,
      reasoning: "Some valid-length reasoning here.",
    }));

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.reasoning).toContain("haiku_schema_violation");
  });
});

// ─── 8. No API key short-circuit ─────────────────────────────────────────

describe("filterArticle · no api key", () => {
  test("hasApiKey=false → skips Haiku, fail-soft to low_signal, bullet from fallback", async () => {
    const stage2HaikuCall = vi.fn();

    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: false,
        stage2HaikuCall,
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(stage2HaikuCall).not.toHaveBeenCalled();
    expect(r.decision.verdict).toBe("low_signal");
    expect(r.decision.workspace_relevance).toBe("low");
    expect(r.decision.confidence).toBe(0);
    expect(r.decision.model).toBe("fallback");
    expect(r.decision.reasoning).toContain("no_api_key");
    expect(r.bullet).toBeTruthy();
  });
});

// ─── 9. prompt_version is always set ─────────────────────────────────────

describe("filterArticle · prompt_version always populated", () => {
  test("stage 1 rejection path carries prompt_version", async () => {
    const r = await filterArticle(
      {
        article: mkArticle({ source_domain: "pymnts.com", source_name: "PYMNTS" }),
        context: mkContext(),
      },
      { hasApiKey: true, bulletDeps: { hasApiKey: false } },
    );

    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
  });

  test("stage 2 newsworthy path carries prompt_version", async () => {
    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall: async () => haikuOk(),
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
  });

  test("stage 2 fail-soft path carries prompt_version", async () => {
    const r = await filterArticle(
      { article: mkArticle(), context: mkContext() },
      {
        hasApiKey: true,
        stage2HaikuCall: async () => {
          throw new Error("timeout");
        },
        bulletDeps: { hasApiKey: false },
      },
    );

    expect(r.decision.prompt_version).toBe(PROMPT_VERSION);
  });
});
