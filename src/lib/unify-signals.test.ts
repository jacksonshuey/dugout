// Unit tests for the unify-signals helpers. Pure-function coverage:
//   - mapping tables emit canonical signal_types
//   - directions stay in {negative, positive, neutral}
//   - severities stay in {blocking, action, awareness}
//   - correlations only fire on ≥2 distinct source_tools
//   - severity elevation respects the +1 tier rule at sourceCount ≥ 3
//   - groupContactsByRole bins each ContactRole into the right slot

import { describe, expect, test } from "vitest";
import {
  computeCorrelations,
  directionForEngineType,
  elevatedSeverity,
  emptyContactsByRole,
  groupContactsByRole,
  mapExternalSignal,
  mapMeetingSignal,
  unifyEngineSignal,
  unifyExternalSignal,
  unifyMeetingSignal,
  type UnifiedSignal,
} from "./unify-signals";
import type { Contact, Signal, SignalSeverity } from "./types";
import type { ExternalSignal } from "./external-signals";
import type { MeetingSignalRow } from "./meeting-signals";

const CANONICAL_TYPES = new Set([
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
]);
const CANONICAL_DIRECTIONS = new Set(["negative", "positive", "neutral"]);
const CANONICAL_SEVERITIES: SignalSeverity[] = ["blocking", "action", "awareness"];

// ── mapExternalSignal ───────────────────────────────────────────────────

describe("mapExternalSignal", () => {
  function makeExt(
    overrides: Partial<ExternalSignal> = {},
  ): ExternalSignal {
    return {
      id: "ext_1",
      account_id: "acc_1",
      source: "newsapi",
      type: "leadership_change",
      summary: "CEO change",
      occurred_at: "2026-05-20T00:00:00Z",
      url: null,
      meta: null,
      is_demo: false,
      created_at: "2026-05-20T00:00:00Z",
      ...overrides,
    };
  }

  test("emits account_context for any per-account external signal", () => {
    const r = mapExternalSignal(makeExt({ type: "leadership_change" }));
    expect(r.signalType).toBe("account_context");
  });

  test("M&A is blocking + negative", () => {
    const r = mapExternalSignal(makeExt({ type: "ma_acquisition" }));
    expect(r.severity).toBe("blocking");
    expect(r.direction).toBe("negative");
  });

  test("funding_round is positive", () => {
    const r = mapExternalSignal(makeExt({ type: "funding_round" }));
    expect(r.direction).toBe("positive");
  });

  test("earnings is neutral", () => {
    const r = mapExternalSignal(makeExt({ type: "earnings" }));
    expect(r.direction).toBe("neutral");
  });

  test("output always in canonical sets", () => {
    const types: ExternalSignal["type"][] = [
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
    for (const t of types) {
      const r = mapExternalSignal(makeExt({ type: t }));
      expect(CANONICAL_TYPES.has(r.signalType)).toBe(true);
      expect(CANONICAL_DIRECTIONS.has(r.direction)).toBe(true);
      expect(CANONICAL_SEVERITIES).toContain(r.severity);
    }
  });
});

// ── mapMeetingSignal ────────────────────────────────────────────────────

describe("mapMeetingSignal", () => {
  function makeMs(
    type: MeetingSignalRow["signal_type"],
  ): MeetingSignalRow {
    return {
      id: "ms_1",
      workspace_key: "ws",
      account_id: "acc_1",
      note_id: "note_1",
      meeting_title: "Discovery",
      meeting_date: "2026-05-20T00:00:00Z",
      granola_url: null,
      signal_type: type,
      severity: "action",
      summary: "x",
      raw_excerpt: null,
      classifier: "haiku",
      meta: {},
      created_at: "2026-05-20T00:00:00Z",
    };
  }

  test("finance_mentioned_not_engaged → committee_gap, negative", () => {
    const r = mapMeetingSignal(makeMs("finance_mentioned_not_engaged"));
    expect(r.signalType).toBe("committee_gap");
    expect(r.direction).toBe("negative");
  });

  test("new_stakeholder_introduced → committee_expansion, positive", () => {
    const r = mapMeetingSignal(makeMs("new_stakeholder_introduced"));
    expect(r.signalType).toBe("committee_expansion");
    expect(r.direction).toBe("positive");
  });

  test("champion_role_change → champion_loss", () => {
    expect(mapMeetingSignal(makeMs("champion_role_change")).signalType).toBe(
      "champion_loss",
    );
  });

  test("competitor_mentioned → competitive_threat", () => {
    expect(mapMeetingSignal(makeMs("competitor_mentioned")).signalType).toBe(
      "competitive_threat",
    );
  });

  test("all granola types produce canonical signal_type + direction", () => {
    const types: MeetingSignalRow["signal_type"][] = [
      "finance_mentioned_not_engaged",
      "new_stakeholder_introduced",
      "champion_role_change",
      "competitor_mentioned",
      "legal_review_requested",
      "timeline_signal",
      "budget_concern",
    ];
    for (const t of types) {
      const r = mapMeetingSignal(makeMs(t));
      expect(CANONICAL_TYPES.has(r.signalType)).toBe(true);
      expect(CANONICAL_DIRECTIONS.has(r.direction)).toBe(true);
    }
  });
});

// ── unifyEngineSignal ───────────────────────────────────────────────────

describe("unifyEngineSignal", () => {
  const baseSignal: Signal = {
    id: "RULE:opp_1",
    ruleId: "RULE",
    oppId: "opp_1",
    severity: "blocking",
    signalType: "committee_gap",
    title: "Finance gate unmanned",
    body: "body",
    suggestedAction: "send brief",
    detectedAt: "2026-05-20T00:00:00Z",
  };

  test("returns null when opp belongs to a different account", () => {
    const map = new Map([["opp_1", "acc_other"]]);
    expect(unifyEngineSignal(baseSignal, map, "acc_target")).toBeNull();
  });

  test("emits a UnifiedSignal with canonical fields for the matching account", () => {
    const map = new Map([["opp_1", "acc_target"]]);
    const u = unifyEngineSignal(baseSignal, map, "acc_target");
    expect(u).not.toBeNull();
    expect(u!.sourceTool).toBe("signal_engine");
    expect(u!.sourceEventId).toBe("RULE");
    expect(u!.signalType).toBe("committee_gap");
    expect(u!.severity).toBe("blocking");
    expect(u!.direction).toBe("negative");
  });

  test("direction inference: committee_expansion is positive", () => {
    expect(directionForEngineType("committee_expansion")).toBe("positive");
  });
  test("direction inference: lifecycle_milestone is neutral", () => {
    expect(directionForEngineType("lifecycle_milestone")).toBe("neutral");
  });
});

// ── unifyExternalSignal + unifyMeetingSignal smoke tests ───────────────

describe("unifyExternalSignal", () => {
  test("preserves source_tool + source_event_id + summary", () => {
    const ext: ExternalSignal = {
      id: "ext_42",
      account_id: "acc_1",
      source: "sec_edgar",
      type: "regulatory_action",
      summary: "8-K filing",
      occurred_at: "2026-05-19T00:00:00Z",
      url: "https://example.com/edgar/123",
      meta: { foo: "bar" },
      is_demo: false,
      created_at: "2026-05-19T00:00:00Z",
    };
    const u = unifyExternalSignal(ext);
    expect(u.sourceTool).toBe("sec_edgar");
    expect(u.sourceEventId).toBe("https://example.com/edgar/123");
    expect(u.summary).toBe("8-K filing");
    expect(u.signalType).toBe("account_context");
    expect(u.severity).toBe("action"); // regulatory_action floor
  });
});

describe("unifyMeetingSignal", () => {
  test("uses note_id as source_event_id, falls back to created_at", () => {
    const ms: MeetingSignalRow = {
      id: "ms_1",
      workspace_key: "ws",
      account_id: "acc_1",
      note_id: "note_abc",
      meeting_title: "Discovery",
      meeting_date: null,
      granola_url: null,
      signal_type: "finance_mentioned_not_engaged",
      severity: "blocking",
      summary: "buyer named CFO not on call",
      raw_excerpt: null,
      classifier: "haiku",
      meta: {},
      created_at: "2026-05-20T00:00:00Z",
    };
    const u = unifyMeetingSignal(ms);
    expect(u.sourceTool).toBe("granola");
    expect(u.sourceEventId).toBe("note_abc");
    expect(u.occurredAt).toBe("2026-05-20T00:00:00Z"); // falls back to created_at
    expect(u.signalType).toBe("committee_gap");
  });
});

// ── elevatedSeverity ────────────────────────────────────────────────────

describe("elevatedSeverity", () => {
  test("two sources, both awareness → awareness", () => {
    expect(elevatedSeverity(["awareness", "awareness"], 2)).toBe("awareness");
  });
  test("two sources, one action one awareness → action (max)", () => {
    expect(elevatedSeverity(["action", "awareness"], 2)).toBe("action");
  });
  test("three sources, all awareness → action (elevated one tier)", () => {
    expect(elevatedSeverity(["awareness", "awareness", "awareness"], 3)).toBe(
      "action",
    );
  });
  test("three sources, max=action → blocking (elevated, capped)", () => {
    expect(elevatedSeverity(["action", "awareness", "awareness"], 3)).toBe(
      "blocking",
    );
  });
  test("four sources, max=blocking → blocking (cap holds)", () => {
    expect(
      elevatedSeverity(["blocking", "action", "awareness", "awareness"], 4),
    ).toBe("blocking");
  });
});

// ── computeCorrelations ─────────────────────────────────────────────────

describe("computeCorrelations", () => {
  function mkSig(
    overrides: Partial<UnifiedSignal>,
  ): UnifiedSignal {
    return {
      id: "s_x",
      sourceTool: "signal_engine",
      sourceEventId: null,
      signalType: "committee_gap",
      severity: "action",
      direction: "negative",
      occurredAt: "2026-05-20T00:00:00Z",
      summary: "x",
      ...overrides,
    };
  }

  test("does not emit when only one source_tool is present", () => {
    const out = computeCorrelations([
      mkSig({ id: "a", sourceTool: "signal_engine" }),
      mkSig({ id: "b", sourceTool: "signal_engine" }),
    ]);
    expect(out).toHaveLength(0);
  });

  test("emits when ≥2 distinct source_tools agree on same signal_type", () => {
    const out = computeCorrelations([
      mkSig({ id: "a", sourceTool: "signal_engine" }),
      mkSig({ id: "b", sourceTool: "granola" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].correlationType).toBe("committee_gap");
    expect(out[0].sourceCount).toBe(2);
    expect(out[0].sourceTools).toEqual(["granola", "signal_engine"]);
    expect(out[0].signalIds).toEqual(["a", "b"]);
  });

  test("elevates severity when 3+ sources agree", () => {
    const out = computeCorrelations([
      mkSig({ id: "a", sourceTool: "signal_engine", severity: "awareness" }),
      mkSig({ id: "b", sourceTool: "granola", severity: "awareness" }),
      mkSig({ id: "c", sourceTool: "newsapi", severity: "awareness" }),
    ]);
    expect(out[0].derivedSeverity).toBe("action");
  });

  test("orders correlations by lastReinforcedAt desc", () => {
    const out = computeCorrelations([
      mkSig({
        id: "a",
        sourceTool: "signal_engine",
        signalType: "committee_gap",
        occurredAt: "2026-05-10T00:00:00Z",
      }),
      mkSig({
        id: "b",
        sourceTool: "granola",
        signalType: "committee_gap",
        occurredAt: "2026-05-20T00:00:00Z",
      }),
      mkSig({
        id: "c",
        sourceTool: "signal_engine",
        signalType: "champion_loss",
        occurredAt: "2026-05-15T00:00:00Z",
      }),
      mkSig({
        id: "d",
        sourceTool: "newsapi",
        signalType: "champion_loss",
        occurredAt: "2026-05-17T00:00:00Z",
      }),
    ]);
    expect(out).toHaveLength(2);
    // committee_gap reinforced 5/20 should come first.
    expect(out[0].correlationType).toBe("committee_gap");
    expect(out[1].correlationType).toBe("champion_loss");
  });
});

// ── groupContactsByRole ─────────────────────────────────────────────────

describe("groupContactsByRole", () => {
  function c(role: Contact["role"], id = "c1"): Contact {
    return {
      id,
      accountId: "acc_1",
      name: "Test",
      title: "Test",
      role,
    };
  }

  test("empty input returns all-empty slots", () => {
    const out = emptyContactsByRole();
    for (const k of Object.keys(out)) {
      expect(out[k as keyof typeof out]).toEqual([]);
    }
  });

  test("each canonical role lands in its expected slot", () => {
    const out = groupContactsByRole([
      c("Champion", "1"),
      c("Executive Sponsor", "2"),
      c("Finance/CFO", "3"),
      c("IT/Security", "4"),
      c("GC", "5"),
      c("Legal Ops", "6"),
      c("Procurement", "7"),
      c("End User", "8"),
    ]);
    expect(out.champion.map((x) => x.id)).toEqual(["1"]);
    expect(out.economic_buyer.map((x) => x.id)).toEqual(["2"]);
    expect(out.finance.map((x) => x.id)).toEqual(["3"]);
    expect(out.it_security.map((x) => x.id)).toEqual(["4"]);
    expect(out.legal.map((x) => x.id).sort()).toEqual(["5", "6"]);
    expect(out.procurement.map((x) => x.id)).toEqual(["7"]);
    expect(out.influencer.map((x) => x.id)).toEqual(["8"]);
  });
});
