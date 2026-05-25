// Tests for entity-level signal dedup (F1).
//
// The dedup is conservative: same entity + similar headline (Jaccard ≥ 0.6)
// collapses to one (newest wins). Distinct stories about the same entity
// survive. Null-entity signals are never collapsed.

import { describe, expect, it } from "vitest";
import {
  dedupByEntity,
  HEADLINE_SIMILARITY_THRESHOLD,
  jaccardSimilarity,
  normalizeEntity,
  normalizeHeadline,
} from "./signal-entity-dedup";
import type { ExternalSignal } from "./external-signals";

// ─── Fixture helper ─────────────────────────────────────────────────────

function mkSignal(
  overrides: Partial<ExternalSignal> & { id: string; summary: string },
): ExternalSignal {
  return {
    id: overrides.id,
    account_id: overrides.account_id ?? "__workspace__",
    source: overrides.source ?? "newsletter",
    type: overrides.type ?? "other",
    summary: overrides.summary,
    occurred_at: overrides.occurred_at ?? "2026-05-23T12:00:00.000Z",
    url: overrides.url ?? null,
    meta: overrides.meta ?? null,
    is_demo: overrides.is_demo ?? false,
    created_at: overrides.created_at ?? "2026-05-23T12:00:00.000Z",
  };
}

// ─── dedupByEntity ──────────────────────────────────────────────────────

describe("dedupByEntity", () => {
  it("returns empty array for empty input", () => {
    expect(dedupByEntity([])).toEqual([]);
  });

  it("returns single signal unchanged", () => {
    const sig = mkSignal({ id: "s1", summary: "OpenAI raises $5B Series F" });
    expect(dedupByEntity([sig])).toEqual([sig]);
  });

  it("keeps two unrelated signals (different entities)", () => {
    const a = mkSignal({ id: "s1", summary: "OpenAI raises $5B Series F" });
    const b = mkSignal({ id: "s2", summary: "Anthropic ships Claude 5" });
    const out = dedupByEntity([a, b]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("collapses three similar OpenAI funding-round signals to the newest", () => {
    // Token overlap engineered to land above 0.6 — three near-paraphrases
    // of the same headline differing only in the lead verb. Real-world
    // newsletter retellings cluster like this.
    const a = mkSignal({
      id: "old",
      summary: "OpenAI raises 5B Series F round led by SoftBank",
      occurred_at: "2026-05-20T10:00:00.000Z",
    });
    const b = mkSignal({
      id: "mid",
      summary: "OpenAI closes 5B Series F round led by SoftBank",
      occurred_at: "2026-05-21T10:00:00.000Z",
    });
    const c = mkSignal({
      id: "new",
      summary: "OpenAI announces 5B Series F round led by SoftBank",
      occurred_at: "2026-05-22T10:00:00.000Z",
    });

    const out = dedupByEntity([a, b, c]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
  });

  it("keeps distinct stories about the same entity (Jaccard < threshold)", () => {
    const funding = mkSignal({
      id: "fund",
      summary: "OpenAI raises $5B Series F",
    });
    const product = mkSignal({
      id: "prod",
      summary: "OpenAI launches Sora 2 video model",
    });
    const out = dedupByEntity([funding, product]);
    expect(out).toHaveLength(2);
    // Sanity-check that the headlines really are below threshold so this
    // test's intent matches its mechanism.
    const sim = jaccardSimilarity(
      normalizeHeadline(funding.summary),
      normalizeHeadline(product.summary),
    );
    expect(sim).toBeLessThan(HEADLINE_SIMILARITY_THRESHOLD);
  });

  it("(positive) keeps newer signal when both occurred_at are valid ISO strings", () => {
    // Both sides are proper ISO strings — the newer one should win.
    const older = mkSignal({
      id: "older",
      summary: "OpenAI raises 5B Series F round led by SoftBank",
      occurred_at: "2026-05-20T00:00:00.000Z",
    });
    const newer = mkSignal({
      id: "newer",
      summary: "OpenAI closes 5B Series F round led by SoftBank",
      occurred_at: "2026-05-21T00:00:00.000Z",
    });
    const out = dedupByEntity([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("newer");
  });

  it("(negative) keeps incumbent when incoming signal has undefined occurred_at", () => {
    // If occurred_at is missing on the incoming signal, the prior string
    // comparison would coerce undefined to "undefined" which sorts after ISO
    // timestamps, wrongly replacing the incumbent. The guard must prevent this.
    //
    // Note: mkSignal applies a default for occurred_at via ??, so we build the
    // signal object directly to ensure occurred_at is truly undefined.
    const incumbent = mkSignal({
      id: "incumbent",
      summary: "OpenAI raises 5B Series F round led by SoftBank",
      occurred_at: "2026-05-20T00:00:00.000Z",
    });
    const missingDate: ExternalSignal = {
      id: "missing-date",
      account_id: "__workspace__",
      source: "newsletter",
      type: "other",
      summary: "OpenAI closes 5B Series F round led by SoftBank",
      occurred_at: undefined as unknown as string,
      url: null,
      meta: null,
      is_demo: false,
      created_at: "2026-05-20T00:00:00.000Z",
    };
    const out = dedupByEntity([incumbent, missingDate]);
    expect(out).toHaveLength(1);
    // Must NOT have been replaced by the undefined-dated signal.
    expect(out[0].id).toBe("incumbent");
  });

  it("does not collapse signals where normalizeEntity returns null", () => {
    // Both summaries lead with a lowercase word so the entity regex finds
    // nothing → normalizeEntity returns null → conservative dedup keeps
    // both even if headlines overlap heavily.
    const a = mkSignal({
      id: "s1",
      summary: "regulatory shifts coming next quarter",
    });
    const b = mkSignal({
      id: "s2",
      summary: "regulatory shifts coming next quarter for banks",
    });
    expect(normalizeEntity(a.summary)).toBeNull();
    const out = dedupByEntity([a, b]);
    expect(out).toHaveLength(2);
  });
});

// ─── jaccardSimilarity ──────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaccardSimilarity("openai raises series f", "openai raises series f")).toBe(1);
  });

  it("returns 0.0 for disjoint strings", () => {
    expect(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("returns 0 when both inputs are empty", () => {
    expect(jaccardSimilarity("", "")).toBe(0);
  });

  it("computes partial overlap correctly", () => {
    // {a,b,c} vs {b,c,d}: intersection 2, union 4 → 0.5
    expect(jaccardSimilarity("a b c", "b c d")).toBeCloseTo(0.5, 5);
  });
});

// ─── normalizeEntity ────────────────────────────────────────────────────

describe("normalizeEntity", () => {
  it("extracts the first capitalized token", () => {
    expect(normalizeEntity("OpenAI raises $5B")).toBe("openai");
  });

  it("skips leading 'The' and uses the next entity word", () => {
    expect(normalizeEntity("The OpenAI funding round")).toBe("openai");
  });

  it("returns null when there is no capitalized entity", () => {
    expect(normalizeEntity("regulatory shifts")).toBeNull();
  });
});

// ─── normalizeHeadline ──────────────────────────────────────────────────

describe("normalizeHeadline", () => {
  it("lowercases, strips punctuation, and drops stopwords", () => {
    expect(normalizeHeadline("The Quick Brown Fox!")).toBe("quick brown fox");
  });
});
