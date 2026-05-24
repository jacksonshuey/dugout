// Tests for src/lib/news-filter-stage1.ts.
//
// Stage 1 is pure (no I/O), so no mocking is required — we just feed it
// articles and assert the verdict/rule.
//
// Real production garbage URLs are exercised below to lock in the rejection
// behavior we shipped after the diagnostic sample on 2026-05-24. Adding new
// blacklist entries later should NOT break any "legitimate articles pass"
// case here.

import { describe, expect, test } from "vitest";

import {
  DOMAIN_BLACKLIST,
  MIN_TITLE_LENGTH,
  NEWS_EVENT_VERBS,
  TITLE_REJECT_PATTERNS,
  stage1Filter,
} from "./news-filter-stage1";
import type { ArticleInput } from "./news-filter-types";

// ─── Fixture helper ──────────────────────────────────────────────────────

function mkArticle(overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    url: overrides.url ?? "https://example.com/article",
    title: overrides.title ?? "Acme Corp launches new platform for enterprise customers",
    description: overrides.description ?? null,
    source_name: overrides.source_name ?? "Example News",
    source_domain: overrides.source_domain ?? "example.com",
    published_at: overrides.published_at ?? "2026-05-24T12:00:00.000Z",
    author: overrides.author ?? null,
  };
}

// ─── 1. Real production garbage rows — should ALL reject ─────────────────

describe("stage1Filter · real production garbage", () => {
  test("stylebyemilyhenderson.com lifestyle article rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "stylebyemilyhenderson.com",
        source_name: "Style by Emily Henderson",
        title: "Weekend Packing: My Favorite Things To Wear Right Now",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:stylebyemilyhenderson.com");
  });

  test("football-italia.net Serie A article rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "football-italia.net",
        source_name: "Football Italia",
        title: "Serie A: Bologna vs. Inter – probable line-ups, where to watch on TV",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:football-italia.net");
  });

  test("streetartutopia.com listicle rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "streetartutopia.com",
        source_name: "Street Art Utopia",
        title: "Fixing the World (12 Photos)",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:streetartutopia.com");
  });

  test("pymnts.com Weekender digest rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "pymnts.com",
        source_name: "PYMNTS",
        title: "The Weekender: When Banks Start Dressing for the Job They Want",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:pymnts.com");
  });

  test("c-sharpcorner.com developer-content-farm article rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "c-sharpcorner.com",
        source_name: "C# Corner",
        title: "What Are Long-Horizon AI Agents and How Do They Work in Real Life?",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:c-sharpcorner.com");
  });

  test("abc.net.au regional politics article rejects (domain blacklist)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "abc.net.au",
        source_name: "ABC News (Au)",
        title: "One Nation set to become federal opposition, poll predicts",
      }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("domain_blacklist:abc.net.au");
  });
});

// ─── 2. Legitimate articles pass through stage 1 ─────────────────────────

describe("stage1Filter · legitimate articles pass", () => {
  test("infoq.com BigQuery announcement passes", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "infoq.com",
        source_name: "InfoQ",
        title: "Google Cloud Introduces Cross-Engine Iceberg Support in BigQuery",
      }),
    );
    expect(r.verdict).toBe("passed");
    expect(r.rule).toBe("passthrough");
  });

  test("theinformation.com Azure layoffs passes", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "theinformation.com",
        source_name: "The Information",
        title: "Microsoft cuts 4,000 Azure roles",
      }),
    );
    expect(r.verdict).toBe("passed");
  });

  test("techcrunch.com OpenAI funding passes", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "techcrunch.com",
        source_name: "TechCrunch",
        title: "OpenAI raises $5B at $300B valuation, sources say",
      }),
    );
    expect(r.verdict).toBe("passed");
  });

  test("bloomberg.com exec departure passes", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "bloomberg.com",
        source_name: "Bloomberg",
        title: "Snowflake CFO Mike Scarpelli to step down at year end",
      }),
    );
    expect(r.verdict).toBe("passed");
  });
});

// ─── 3. Title pattern unit tests ─────────────────────────────────────────

describe("stage1Filter · TITLE_REJECT_PATTERNS", () => {
  // We loop the exported pattern set defensively so that adding a new pattern
  // upstream cannot silently land without a smoke test. The targeted
  // pattern-by-pattern tests below give precise positive/negative coverage.

  test("every pattern entry has both a regex and a tag", () => {
    for (const { re, tag } of TITLE_REJECT_PATTERNS) {
      expect(re).toBeInstanceOf(RegExp);
      expect(typeof tag).toBe("string");
      expect(tag.length).toBeGreaterThan(0);
    }
  });

  test("the_weekender pattern: positive vs. negative", () => {
    // Positive — use a non-blacklisted source so we isolate the title check.
    const positive = stage1Filter(
      mkArticle({
        source_domain: "example.com",
        source_name: "Example",
        title: "The Weekender: Why CFOs love spreadsheets",
      }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_the_weekender_pattern");

    // Negative — the phrase appears mid-title, not anchored at start.
    const negative = stage1Filter(
      mkArticle({
        title: "How startups use the Weekender model to launch products",
      }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("lifestyle pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Travel: My favorite hotels in southern France" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_lifestyle_pattern");

    const negative = stage1Filter(
      mkArticle({ title: "Acme Corp launches new platform for enterprises" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("sports_league pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Premier League: Arsenal beat Chelsea 3-1 at Emirates" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_sports_league_pattern");

    // "NFL" appears mid-title — not anchored — should pass.
    const negative = stage1Filter(
      mkArticle({ title: "Streaming platform signs NFL rights deal worth billions" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("sports_fixtures pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Probable line-ups for Saturday's Champions League draw" }),
    );
    expect(positive.verdict).toBe("rejected");

    const negative = stage1Filter(
      mkArticle({ title: "Acme Corp announces new fixture for product launch" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("listicle pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "7 things every founder should know about pricing" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_listicle_pattern");

    const negative = stage1Filter(
      mkArticle({ title: "Acme Corp raises 7 things to consider before IPO" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("astrology pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Daily horoscope for Tuesday across all signs" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_astrology_pattern");

    const negative = stage1Filter(
      mkArticle({ title: "Anthropic raises Series C to fund Claude research" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("recipe pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Best holiday recipes for hosting a crowd" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_recipe_pattern");

    const negative = stage1Filter(
      mkArticle({ title: "Anthropic announces new context window for Claude" }),
    );
    expect(negative.verdict).toBe("passed");
  });

  test("wedding pattern: positive vs. negative", () => {
    const positive = stage1Filter(
      mkArticle({ title: "Inside the most expensive celebrity wedding of the year" }),
    );
    expect(positive.verdict).toBe("rejected");
    expect(positive.rule).toBe("title_wedding_pattern");

    const negative = stage1Filter(
      mkArticle({ title: "Stripe acquires payments platform for SMB merchants" }),
    );
    expect(negative.verdict).toBe("passed");
  });
});

// ─── 4. Short-title sanity rejection ─────────────────────────────────────

describe("stage1Filter · short-title sanity", () => {
  test('"Apple Inc" (no verb, ≤3 words) rejects', () => {
    // Title length is 9 which is below MIN_TITLE_LENGTH (12), so this hits
    // the title_too_short rule first. We assert the verdict regardless.
    const r = stage1Filter(mkArticle({ title: "Apple Inc" }));
    expect(r.verdict).toBe("rejected");
    expect(MIN_TITLE_LENGTH).toBe(12);
  });

  test('"Apple Incorporated" (3 words but no verb) rejects via entity_name_only', () => {
    // "Apple Incorporated Today" is 23 chars, 3 words, no news verb.
    const r = stage1Filter(mkArticle({ title: "Apple Incorporated Today" }));
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("title_entity_name_only");
  });

  test('"Apple Inc launches Vision Pro" (5 words, has "launches" verb) passes', () => {
    const r = stage1Filter(mkArticle({ title: "Apple Inc launches Vision Pro" }));
    expect(r.verdict).toBe("passed");
    expect(NEWS_EVENT_VERBS.has("launches")).toBe(true);
  });
});

// ─── 5. No source identity ───────────────────────────────────────────────

describe("stage1Filter · no source identity", () => {
  test("empty source_name AND empty source_domain → rejected", () => {
    const r = stage1Filter(
      mkArticle({ source_name: "", source_domain: "" }),
    );
    expect(r.verdict).toBe("rejected");
    expect(r.rule).toBe("no_source_identity");
  });

  test("having source_name alone is sufficient identity (does not trigger no_source_identity)", () => {
    const r = stage1Filter(
      mkArticle({ source_name: "Reuters", source_domain: "" }),
    );
    // Should NOT be no_source_identity. May still pass through to other checks.
    expect(r.rule).not.toBe("no_source_identity");
  });
});

// ─── 6. Subdomain handling ───────────────────────────────────────────────
//
// stage1Filter uses `DOMAIN_BLACKLIST.has(sourceDomain)` — exact equality on
// the lowercased source_domain. A subdomain like
// "news.stylebyemilyhenderson.com" therefore does NOT match the
// "stylebyemilyhenderson.com" blacklist entry. We pin that behavior so a
// future change to suffix matching surfaces here for review (and so RevOps
// can use this test as a reference when they ask "what does the matcher
// actually do?").

describe("stage1Filter · domain matching is exact equality", () => {
  test("blacklisted bare domain rejects", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "stylebyemilyhenderson.com",
        title: "A perfectly reasonable headline about Acme Corp",
      }),
    );
    expect(r.verdict).toBe("rejected");
  });

  test("subdomain of a blacklisted domain does NOT auto-reject (exact match only)", () => {
    const r = stage1Filter(
      mkArticle({
        source_domain: "news.stylebyemilyhenderson.com",
        title: "A perfectly reasonable headline about Acme Corp",
      }),
    );
    // Document the current behavior: this article passes stage 1.
    // If we later move to suffix matching, this assertion will flip and the
    // domain set entries should be re-audited.
    expect(r.verdict).toBe("passed");
  });

  test("DOMAIN_BLACKLIST is non-empty and includes known noise sources", () => {
    expect(DOMAIN_BLACKLIST.size).toBeGreaterThan(0);
    expect(DOMAIN_BLACKLIST.has("pymnts.com")).toBe(true);
    expect(DOMAIN_BLACKLIST.has("weather.com")).toBe(true);
  });
});
