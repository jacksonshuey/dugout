// Tests for the market-intel ranker (rankSignals + rankStub).
//
// Design doc: /docs/ranker-design.md §9.
//
// Mocks: the Anthropic call and the Supabase cache are both injectable
// via the deps argument on rankSignals — no vi.mock magic needed. The
// stub tests don't even need that; they call rankStub directly.

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rankSignals } from "./ranker";
import { rankStub } from "./ranker-stub";
import { buildCacheKey, formatHourBucketUTC } from "./ranker-cache";
import { getRankerSystemPrompt } from "./ranker-system-prompt";
import type {
  AccountKeyword,
  RankerInput,
  RankerResult,
} from "./ranker-types";
import type {
  ExternalSignal,
  ExternalSignalType,
} from "./external-signals";

// ─── Fixture helpers ────────────────────────────────────────────────────

function mkSignal(
  overrides: Partial<ExternalSignal> & { id: string; type: ExternalSignalType },
): ExternalSignal {
  return {
    id: overrides.id,
    account_id: overrides.account_id ?? "__workspace__",
    source: overrides.source ?? "newsletter",
    type: overrides.type,
    summary: overrides.summary ?? `Signal ${overrides.id}`,
    occurred_at: overrides.occurred_at ?? "2026-05-23T12:00:00.000Z",
    url: overrides.url ?? null,
    meta: overrides.meta ?? null,
    is_demo: overrides.is_demo ?? false,
    created_at: overrides.created_at ?? "2026-05-23T12:00:00.000Z",
  };
}

const HELIOS: AccountKeyword = {
  account_id: "acc_helios",
  name: "Helios Manufacturing",
  ticker: "HLOS",
  domain_slug: "helios",
};

function mkInput(
  signals: ExternalSignal[],
  accountKeywords: AccountKeyword[] = [HELIOS],
  overrides: Partial<RankerInput> = {},
): RankerInput {
  return {
    workspaceKey: "checkbox",
    signals,
    accountKeywords,
    now: new Date("2026-05-23T17:42:00.000Z"),
    ...overrides,
  };
}

// ─── 1. stub_is_deterministic ───────────────────────────────────────────

describe("rankStub · determinism", () => {
  test("same input → identical output across 100 runs", () => {
    const signals = [
      mkSignal({ id: "s_1", type: "product_launch", occurred_at: "2026-05-22T10:00:00.000Z" }),
      mkSignal({ id: "s_2", type: "leadership_change", occurred_at: "2026-05-22T11:00:00.000Z" }),
      mkSignal({ id: "s_3", type: "funding_round", occurred_at: "2026-05-22T12:00:00.000Z" }),
      mkSignal({ id: "s_4", type: "earnings", occurred_at: "2026-05-22T13:00:00.000Z" }),
    ];
    const input = mkInput(signals);
    const first = JSON.stringify(rankStub(input, "no_api_key"));
    for (let i = 0; i < 100; i++) {
      expect(JSON.stringify(rankStub(input, "no_api_key"))).toBe(first);
    }
  });
});

// ─── 2. severity_tier_sort_order ────────────────────────────────────────

describe("rankStub · severity tier order", () => {
  test("blocking → action → awareness when no account-named", () => {
    const signals = [
      mkSignal({ id: "s_pl", type: "product_launch" }), // awareness
      mkSignal({ id: "s_lc", type: "leadership_change" }), // blocking
      mkSignal({ id: "s_fr", type: "funding_round" }), // action
    ];
    const r = rankStub(mkInput(signals, []), "no_api_key");
    expect(r.items.map((i) => i.signal_id)).toEqual(["s_lc", "s_fr", "s_pl"]);
  });
});

// ─── 3. account_named_outranks_severity ─────────────────────────────────
// Q0 resolution: account-named is the PRIMARY key, severity secondary.
// (Was originally "tiebreaker not primary" in D-Rank's draft; flipped per
// product principle "no cold meetings — your accounts come before random
// vertical noise.")

describe("rankStub · account-named outranks severity", () => {
  test("account-named product_launch outranks unnamed leadership_change", () => {
    const signals = [
      // Unnamed blocking-tier
      mkSignal({
        id: "s_unnamed_lc",
        type: "leadership_change",
        summary: "Some random CEO at Apex Corp resigned.",
      }),
      // Account-named awareness-tier
      mkSignal({
        id: "s_helios_pl",
        type: "product_launch",
        summary: "Helios Manufacturing announced a new SKU.",
        meta: { mention: "Helios Manufacturing" },
      }),
    ];
    const r = rankStub(mkInput(signals), "no_api_key");
    expect(r.items[0].signal_id).toBe("s_helios_pl");
    expect(r.items[1].signal_id).toBe("s_unnamed_lc");
  });
});

// ─── 4. account_named_wins_within_same_tier ─────────────────────────────

describe("rankStub · account-named within same tier", () => {
  test("two funding_round signals — account-named ranks first", () => {
    const signals = [
      mkSignal({
        id: "s_other_fr",
        type: "funding_round",
        summary: "Random startup raised a Series A.",
      }),
      mkSignal({
        id: "s_helios_fr",
        type: "funding_round",
        summary: "Helios Manufacturing closed a Series B.",
        meta: { mention: "Helios Manufacturing" },
      }),
    ];
    const r = rankStub(mkInput(signals), "no_api_key");
    expect(r.items[0].signal_id).toBe("s_helios_fr");
    expect(r.items[0].related_account_ids).toEqual(["acc_helios"]);
  });
});

// ─── 5. malformed_haiku_response_triggers_stub ──────────────────────────

describe("rankSignals · malformed Haiku response", () => {
  test("non-JSON tool input triggers stub fallback", async () => {
    const signals = [
      mkSignal({ id: "s_a", type: "leadership_change" }),
      mkSignal({ id: "s_b", type: "earnings" }),
    ];
    const r = await rankSignals(mkInput(signals), {
      hasApiKey: true,
      // Return a string instead of { items: [...] } — the parser will
      // catch "tool input not an object"
      haikuCall: async () => "garbage not an object",
      cache: { supabase: noCacheSupabase() },
    });
    expect(r.source).toBe("stub");
    expect(r.stubReason).toBe("haiku_malformed_json");
    expect(r.items.length).toBeGreaterThan(0);
  });
});

// ─── 6. empty_signals_returns_empty_result_not_error ────────────────────

describe("rankSignals · empty input", () => {
  test("signals:[] returns empty stub with empty_input, no Haiku call", async () => {
    const haikuMock = vi.fn();
    const r = await rankSignals(mkInput([]), {
      hasApiKey: true,
      haikuCall: haikuMock,
      cache: { supabase: noCacheSupabase() },
    });
    expect(r.items).toEqual([]);
    expect(r.source).toBe("stub");
    expect(r.stubReason).toBe("empty_input");
    expect(haikuMock).not.toHaveBeenCalled();
  });
});

// ─── 7. cache_key_composition ───────────────────────────────────────────

describe("buildCacheKey", () => {
  test("slugifies workspace and truncates to UTC hour bucket", () => {
    const key = buildCacheKey("Checkbox", new Date("2026-05-23T17:42:00.000Z"));
    expect(key).toEqual({
      workspace_key: "checkbox",
      date_bucket: "2026-05-23-17",
    });
  });

  test("workspace with spaces and punctuation slugifies cleanly", () => {
    const key = buildCacheKey("KKR & Co.", new Date("2026-05-23T17:42:00.000Z"));
    expect(key.workspace_key).toBe("kkr-co");
  });

  test("formatHourBucketUTC is UTC-not-local", () => {
    // Same wall-clock instant: 2026-05-23T23:42 UTC is 2026-05-23 in UTC
    // and could be 2026-05-24 in some local zones. We want UTC.
    expect(formatHourBucketUTC(new Date("2026-05-23T23:42:00.000Z"))).toBe(
      "2026-05-23-23",
    );
  });
});

// ─── 8. citation_present_in_every_rationale ─────────────────────────────

describe("rationale citations", () => {
  test("stub: every item.rationale has [citation:signal_id] with matching id", () => {
    const signals = [
      mkSignal({ id: "s_a", type: "leadership_change" }),
      mkSignal({
        id: "s_b",
        type: "earnings",
        meta: { mention: "Helios Manufacturing" },
      }),
      mkSignal({ id: "s_c", type: "press_release" }),
    ];
    const r = rankStub(mkInput(signals), "no_api_key");
    for (const item of r.items) {
      const matches = [...item.rationale.matchAll(/\[citation:([^\]\s]+)\]/g)];
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0][1]).toBe(item.signal_id);
    }
  });

  test("haiku-valid: every item.rationale has [citation:signal_id] with matching id", async () => {
    const signals = [
      mkSignal({ id: "s_a", type: "leadership_change" }),
      mkSignal({ id: "s_b", type: "earnings" }),
    ];
    const r = await rankSignals(mkInput(signals), {
      hasApiKey: true,
      haikuCall: async () => ({
        items: [
          {
            signal_id: "s_a",
            rank: 1,
            rationale: "Leadership change worth a look. [citation:s_a]",
          },
          {
            signal_id: "s_b",
            rank: 2,
            rationale: "Earnings move worth tracking. [citation:s_b]",
          },
        ],
      }),
      cache: { supabase: noCacheSupabase() },
    });
    expect(r.source).toBe("haiku");
    for (const item of r.items) {
      const matches = [...item.rationale.matchAll(/\[citation:([^\]\s]+)\]/g)];
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0][1]).toBe(item.signal_id);
    }
  });
});

// ─── 9. schema_rejects_more_than_20_items ───────────────────────────────

describe("rankSignals · schema enforcement", () => {
  test("more than topN items → schema_violation fallback", async () => {
    const signals = Array.from({ length: 25 }, (_, i) =>
      mkSignal({ id: `s_${i}`, type: "press_release" }),
    );
    const r = await rankSignals(mkInput(signals), {
      hasApiKey: true,
      haikuCall: async () => ({
        items: Array.from({ length: 21 }, (_, i) => ({
          signal_id: `s_${i}`,
          rank: i + 1,
          rationale: `Item number ${i}. [citation:s_${i}]`,
        })),
      }),
      cache: { supabase: noCacheSupabase() },
    });
    expect(r.source).toBe("stub");
    expect(r.stubReason).toBe("haiku_schema_violation");
  });
});

// ─── 10. schema_rejects_invented_signal_id ──────────────────────────────

describe("rankSignals · invented signal_id", () => {
  test("Haiku cites a signal_id not in input → schema_violation fallback", async () => {
    const signals = [
      mkSignal({ id: "s_real", type: "leadership_change" }),
    ];
    const r = await rankSignals(mkInput(signals), {
      hasApiKey: true,
      haikuCall: async () => ({
        items: [
          {
            signal_id: "s_invented_by_haiku",
            rank: 1,
            rationale: "Invented. [citation:s_invented_by_haiku]",
          },
        ],
      }),
      cache: { supabase: noCacheSupabase() },
    });
    expect(r.source).toBe("stub");
    expect(r.stubReason).toBe("haiku_schema_violation");
  });
});

// ─── 11. prompt_enumerates_all_12_legacy_external_types + canonical 12 ─

describe("getRankerSystemPrompt", () => {
  test("enumerates all 12 legacy ExternalSignalType values", () => {
    const prompt = getRankerSystemPrompt({ workspaceContext: "x", topN: 20 });
    const legacy: ExternalSignalType[] = [
      "leadership_change",
      "champion_job_change",
      "ma_acquisition",
      "funding_round",
      "layoff",
      "earnings",
      "product_launch",
      "press_release",
      "competitor_mention",
      "regulatory_action",
      "partnership",
      "other",
    ];
    for (const t of legacy) {
      expect(prompt).toContain(t);
    }
  });

  test("enumerates all 12 canonical signal_types (BUILD_ALIGNMENT #2)", () => {
    const prompt = getRankerSystemPrompt({ workspaceContext: "x", topN: 20 });
    const canonical = [
      "champion_loss",
      "champion_disengagement",
      "committee_gap",
      "committee_expansion",
      "momentum_change",
      "competitive_threat",
      "shadow_research",
      "account_health_decline",
      "lifecycle_milestone",
      "account_context",
      "vertical_context",
      "data_hygiene_gap",
    ];
    for (const t of canonical) {
      expect(prompt).toContain(t);
    }
  });

  test("injects topN into the constraints section", () => {
    const prompt = getRankerSystemPrompt({ workspaceContext: "x", topN: 7 });
    expect(prompt).toContain("AT MOST 7 items");
  });
});

// ─── 12. cache_hit_skips_haiku ──────────────────────────────────────────

describe("rankSignals · cache hit", () => {
  test("cached entry → cache_hit:true, no Haiku call", async () => {
    const signals = [mkSignal({ id: "s_a", type: "leadership_change" })];
    const haikuMock = vi.fn();
    const cachedResult: RankerResult = {
      items: [
        {
          signal_id: "s_a",
          rank: 1,
          rationale: "Cached one. [citation:s_a]",
        },
      ],
      generated_at: "2026-05-23T17:00:00.000Z",
      source: "haiku",
      cache_hit: false,
    };
    const r = await rankSignals(mkInput(signals), {
      hasApiKey: true,
      haikuCall: haikuMock,
      cache: {
        supabase: hitSupabase(cachedResult),
      },
    });
    expect(r.cache_hit).toBe(true);
    expect(r.items[0].signal_id).toBe("s_a");
    expect(haikuMock).not.toHaveBeenCalled();
  });
});

// ─── 13. (bonus) stub_rationale_word_cap ────────────────────────────────

describe("rankStub · rationale word cap", () => {
  test("every stub rationale is ≤25 words", () => {
    const all: ExternalSignalType[] = [
      "leadership_change",
      "champion_job_change",
      "ma_acquisition",
      "funding_round",
      "layoff",
      "earnings",
      "product_launch",
      "press_release",
      "competitor_mention",
      "regulatory_action",
      "partnership",
      "other",
    ];
    // Generate signals for both account-named and unnamed paths across
    // every type — exercises all rationale branches.
    const signals: ExternalSignal[] = [];
    let i = 0;
    for (const t of all) {
      signals.push(mkSignal({ id: `un_${i++}`, type: t }));
      signals.push(
        mkSignal({
          id: `nm_${i++}`,
          type: t,
          summary: "Helios Manufacturing did the thing.",
          meta: { mention: "Helios Manufacturing" },
        }),
      );
    }
    const r = rankStub(
      mkInput(signals, [HELIOS], { topN: 50 }),
      "no_api_key",
    );
    for (const item of r.items) {
      const wordCount = item.rationale.trim().split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(25);
    }
  });
});

// ─── Supabase test seams ────────────────────────────────────────────────
//
// The ranker cache calls `from(TABLE).select(...).eq(...).eq(...).maybeSingle()`
// for reads, and `from(TABLE).upsert(..., { onConflict })` for writes. The
// fakes implement just those chains.

function noCacheSupabase(): SupabaseClient {
  const fake = {
    from(_t: string) {
      void _t;
      return {
        select(_cols: string) {
          void _cols;
          return {
            eq(_c1: string, _v1: string) {
              void _c1;
              void _v1;
              return {
                eq(_c2: string, _v2: string) {
                  void _c2;
                  void _v2;
                  return {
                    async maybeSingle() {
                      return { data: null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        async upsert(_row: Record<string, unknown>, _opts?: unknown) {
          void _row;
          void _opts;
          return { error: null };
        },
      };
    },
  };
  return fake as unknown as SupabaseClient;
}

function hitSupabase(cached: RankerResult): SupabaseClient {
  const row = {
    workspace_key: "checkbox",
    date_bucket: "2026-05-23-17",
    result_json: cached,
    created_at: new Date().toISOString(),
  };
  const fake = {
    from(_t: string) {
      void _t;
      return {
        select(_cols: string) {
          void _cols;
          return {
            eq(_c1: string, _v1: string) {
              void _c1;
              void _v1;
              return {
                eq(_c2: string, _v2: string) {
                  void _c2;
                  void _v2;
                  return {
                    async maybeSingle() {
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        async upsert(_r: Record<string, unknown>, _opts?: unknown) {
          void _r;
          void _opts;
          return { error: null };
        },
      };
    },
  };
  return fake as unknown as SupabaseClient;
}

// Suppress noisy console.warn from the ranker's expected fail-soft paths
// so test output stays readable. We don't assert on these log lines.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
