// Signal engine tests — one positive + one negative case per shipped rule,
// plus the four health states from computeDealHealth.
//
// All fixtures build minimal EvaluationContexts (one opp, the contacts a
// given rule needs) so each test reads as "this is exactly what trips the
// rule." TODAY is pinned at 2026-05-21 in lib/utils.ts, so all timestamps
// here are anchored to that date.

import { describe, expect, test } from "vitest";
import {
  RULES,
  computeDealHealth,
} from "./signal-engine";
import type {
  Activity,
  CallTranscript,
  Contact,
  EvaluationContext,
  Opportunity,
  Signal,
} from "./types";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_1",
    accountId: "acc_1",
    name: "Test Deal",
    ownerId: "rep_1",
    stage: "Qualified",
    amount: 100000,
    enteredStageAt: "2026-05-19T00:00:00Z", // 2d ago, under every benchmark
    createdAt: "2026-05-01T00:00:00Z",
    closeDate: "2026-12-01T00:00:00Z", // far future
    contactRoleIds: [],
    ...overrides,
  };
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c_1",
    accountId: "acc_1",
    name: "Test Contact",
    title: "Director",
    role: "Champion",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    opportunities: [],
    accounts: [],
    contacts: [],
    activities: [],
    calls: [],
    deliveries: [],
    reps: [],
    ...overrides,
  };
}

function evaluateRule(id: string, ctx: EvaluationContext): Signal[] {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`Rule not found: ${id}`);
  return rule.evaluate(ctx);
}

// ── Rules ───────────────────────────────────────────────────────────────

describe("BUDGET_APPROVAL_RISK", () => {
  // Builds a context where ALL 4 conditions are satisfied. Each
  // negative test below knocks out exactly one condition and asserts
  // the rule no longer fires.
  function buildAllFourConditions(): {
    opp: Opportunity;
    champion: Contact;
    ctx: EvaluationContext;
  } {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({
      stage: "Selected Vendor",
      contactRoleIds: [champion.id],
      assetsShared: {
        cfoLeaveBehind: true,
        cfoLeaveBehindViewed: false, // delivered but unviewed
      },
    });
    const call: CallTranscript = {
      id: "call_1",
      oppId: opp.id,
      callDate: "2026-05-18",
      durationMin: 30,
      attendees: ["rep_1", champion.id],
      summary:
        "Champion walked us through procurement — budget approval is required from the CFO before contracts move.",
      riskFlags: [],
      excerpts: [],
    };
    const ctx = makeCtx({
      opportunities: [opp],
      contacts: [champion],
      calls: [call],
      deliveries: [
        {
          oppId: opp.id,
          asset: "cfo_leave_behind",
          deliveredAt: "2026-05-14T00:00:00Z",
        },
      ],
    });
    return { opp, champion, ctx };
  }

  test("fires when all 4 conditions are met (stage + transcript + no Finance + unviewed asset)", () => {
    const { opp, ctx } = buildAllFourConditions();
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals.map((s) => s.oppId)).toEqual([opp.id]);
    expect(signals[0].signalType).toBe("committee_gap");
    expect(signals[0].severity).toBe("blocking");
    expect(signals[0].title).toBe("Budget approval risk");
    expect(signals[0].body).toContain("budget approval was mentioned");
    expect(signals[0].suggestedAction).toContain("Map Finance");
  });

  test("does NOT fire when stage is not Selected Vendor", () => {
    const { opp, ctx } = buildAllFourConditions();
    opp.stage = "Evaluating";
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals).toHaveLength(0);
  });

  test("does NOT fire when a Finance contact is on the OCR", () => {
    const { opp, ctx } = buildAllFourConditions();
    const finance = makeContact({ id: "c_f", role: "Finance/CFO" });
    opp.contactRoleIds.push(finance.id);
    ctx.contacts.push(finance);
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals).toHaveLength(0);
  });

  test("does NOT fire when no transcript mentions budget approval", () => {
    const { opp, ctx } = buildAllFourConditions();
    ctx.calls = [
      {
        id: "call_1",
        oppId: opp.id,
        callDate: "2026-05-18",
        durationMin: 30,
        attendees: ["rep_1"],
        summary: "Champion walked us through procurement timeline — no mention of finance.",
        riskFlags: [],
        excerpts: [],
      },
    ];
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals).toHaveLength(0);
  });

  test("does NOT fire when CFO leave-behind has been viewed by the buyer", () => {
    const { opp, ctx } = buildAllFourConditions();
    opp.assetsShared = {
      cfoLeaveBehind: true,
      cfoLeaveBehindViewed: true,
    };
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals).toHaveLength(0);
  });

  test("does NOT fire when CFO leave-behind was never delivered", () => {
    const { ctx } = buildAllFourConditions();
    ctx.deliveries = []; // never sent
    const signals = evaluateRule("BUDGET_APPROVAL_RISK", ctx);
    expect(signals).toHaveLength(0);
  });
});

describe("SELECTED_VENDOR_NO_PROCUREMENT", () => {
  test("fires for Selected Vendor without Procurement contact", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Selected Vendor", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "SELECTED_VENDOR_NO_PROCUREMENT",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals.map((s) => s.oppId)).toEqual([opp.id]);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when Procurement contact is present", () => {
    const proc = makeContact({ id: "c_p", role: "Procurement" });
    const opp = makeOpp({ stage: "Selected Vendor", contactRoleIds: [proc.id] });
    const signals = evaluateRule(
      "SELECTED_VENDOR_NO_PROCUREMENT",
      makeCtx({ opportunities: [opp], contacts: [proc] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("NO_FINANCE_AT_EVALUATING", () => {
  test("fires for Evaluating without Finance contact", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "NO_FINANCE_AT_EVALUATING",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when stage is not Evaluating", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Qualified", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "NO_FINANCE_AT_EVALUATING",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("NO_IT_AT_EVALUATING", () => {
  test("fires for Evaluating without IT/Security contact", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "NO_IT_AT_EVALUATING",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when IT/Security contact is present", () => {
    const it = makeContact({ id: "c_it", role: "IT/Security" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [it.id] });
    const signals = evaluateRule(
      "NO_IT_AT_EVALUATING",
      makeCtx({ opportunities: [opp], contacts: [it] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("NO_TRIAL_BRIEF_AT_DEMO_SAT", () => {
  test("fires when Demo Sat deal has no trial brief delivered", () => {
    const opp = makeOpp({ stage: "Demo Sat" });
    const signals = evaluateRule(
      "NO_TRIAL_BRIEF_AT_DEMO_SAT",
      makeCtx({ opportunities: [opp] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("momentum_change");
  });

  test("does not fire when trial brief has been delivered", () => {
    const opp = makeOpp({ stage: "Demo Sat" });
    const signals = evaluateRule(
      "NO_TRIAL_BRIEF_AT_DEMO_SAT",
      makeCtx({
        opportunities: [opp],
        deliveries: [
          {
            oppId: opp.id,
            asset: "outcome_first_trial_brief",
            deliveredAt: "2026-05-15T00:00:00Z",
          },
        ],
      }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("SINGLE_THREAD_RISK", () => {
  test("fires for Evaluating deal with exactly one contact", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "SINGLE_THREAD_RISK",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when deal has two contacts", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const gc = makeContact({ id: "c_gc", role: "GC" });
    const opp = makeOpp({
      stage: "Evaluating",
      contactRoleIds: [champion.id, gc.id],
    });
    const signals = evaluateRule(
      "SINGLE_THREAD_RISK",
      makeCtx({ opportunities: [opp], contacts: [champion, gc] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("STAGE_AGE_EXCEEDED", () => {
  test("fires when stage age exceeds benchmark (Qualified > 14d)", () => {
    // Qualified benchmark is 14 days; 30 days ago is well past.
    const opp = makeOpp({
      stage: "Qualified",
      enteredStageAt: "2026-04-15T00:00:00Z", // ~36d before TODAY
    });
    const signals = evaluateRule(
      "STAGE_AGE_EXCEEDED",
      makeCtx({ opportunities: [opp] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("momentum_change");
  });

  test("does not fire when stage age is under benchmark", () => {
    const opp = makeOpp({
      stage: "Qualified",
      enteredStageAt: "2026-05-19T00:00:00Z", // 2d, well under 14
    });
    const signals = evaluateRule(
      "STAGE_AGE_EXCEEDED",
      makeCtx({ opportunities: [opp] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("DEMO_NOT_BOOKED", () => {
  test("fires for Qualified deal with champion but no recent meeting", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Qualified", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "DEMO_NOT_BOOKED",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("momentum_change");
  });

  test("does not fire when a meeting happened in the last 7 days", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Qualified", contactRoleIds: [champion.id] });
    const meeting: Activity = {
      id: "a_1",
      oppId: opp.id,
      contactId: champion.id,
      type: "meeting",
      occurredAt: "2026-05-19T10:00:00Z", // 2d before TODAY
      summary: "Discovery call",
    };
    const signals = evaluateRule(
      "DEMO_NOT_BOOKED",
      makeCtx({
        opportunities: [opp],
        contacts: [champion],
        activities: [meeting],
      }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("ASSET_GAP_FINANCE", () => {
  test("fires when Finance contact present but no Finance brief delivered", () => {
    const finance = makeContact({ id: "c_f", role: "Finance/CFO" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [finance.id] });
    const signals = evaluateRule(
      "ASSET_GAP_FINANCE",
      makeCtx({ opportunities: [opp], contacts: [finance] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when the Finance brief has been delivered", () => {
    const finance = makeContact({ id: "c_f", role: "Finance/CFO" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [finance.id] });
    const signals = evaluateRule(
      "ASSET_GAP_FINANCE",
      makeCtx({
        opportunities: [opp],
        contacts: [finance],
        deliveries: [
          {
            oppId: opp.id,
            asset: "finance_meeting_brief",
            deliveredAt: "2026-05-15T00:00:00Z",
          },
        ],
      }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("ASSET_GAP_IT", () => {
  test("fires when an activity mentions security and IT one-pager wasn't sent", () => {
    const opp = makeOpp({ stage: "Evaluating" });
    const activity: Activity = {
      id: "a_1",
      oppId: opp.id,
      type: "call",
      occurredAt: "2026-05-15T00:00:00Z",
      summary: "Security team has questions about SSO",
    };
    const signals = evaluateRule(
      "ASSET_GAP_IT",
      makeCtx({ opportunities: [opp], activities: [activity] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("committee_gap");
  });

  test("does not fire when no IT-related activity exists", () => {
    const opp = makeOpp({ stage: "Evaluating" });
    const activity: Activity = {
      id: "a_1",
      oppId: opp.id,
      type: "email_sent",
      occurredAt: "2026-05-15T00:00:00Z",
      summary: "Followed up on pricing question",
    };
    const signals = evaluateRule(
      "ASSET_GAP_IT",
      makeCtx({ opportunities: [opp], activities: [activity] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("CHAMPION_GHOST", () => {
  test("fires when champion's last activity is 7+ days old", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const stale: Activity = {
      id: "a_old",
      oppId: opp.id,
      contactId: champion.id,
      type: "email_received",
      occurredAt: "2026-05-10T00:00:00Z", // 11d before TODAY
      summary: "Will get back to you",
    };
    const signals = evaluateRule(
      "CHAMPION_GHOST",
      makeCtx({
        opportunities: [opp],
        contacts: [champion],
        activities: [stale],
      }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("champion_disengagement");
  });

  test("does not fire when champion has recent activity", () => {
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const recent: Activity = {
      id: "a_new",
      oppId: opp.id,
      contactId: champion.id,
      type: "email_received",
      occurredAt: "2026-05-19T00:00:00Z", // 2d before TODAY
      summary: "Sounds good",
    };
    const signals = evaluateRule(
      "CHAMPION_GHOST",
      makeCtx({
        opportunities: [opp],
        contacts: [champion],
        activities: [recent],
      }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("CHAMPION_DEPARTED", () => {
  test("fires when champion contact has status departed", () => {
    const champion = makeContact({
      id: "c_ch",
      role: "Champion",
      status: "departed",
      departureNote: "Left for Ironclad",
    });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "CHAMPION_DEPARTED",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].playbookId).toBe("champion-departure");
    expect(signals[0].signalType).toBe("champion_loss");
  });

  test("does not fire when champion is active", () => {
    const champion = makeContact({
      id: "c_ch",
      role: "Champion",
      status: "active",
    });
    const opp = makeOpp({ stage: "Evaluating", contactRoleIds: [champion.id] });
    const signals = evaluateRule(
      "CHAMPION_DEPARTED",
      makeCtx({ opportunities: [opp], contacts: [champion] }),
    );
    expect(signals).toHaveLength(0);
  });
});

describe("CALL_NEGATIVE_SENTIMENT", () => {
  test("fires when latest call has risk flags", () => {
    const opp = makeOpp({ stage: "Evaluating" });
    const call: CallTranscript = {
      id: "call_1",
      oppId: opp.id,
      callDate: "2026-05-15",
      durationMin: 30,
      attendees: ["rep_1"],
      summary: "Discovery",
      riskFlags: ["competitor mentioned", "pricing pushback"],
      excerpts: [],
    };
    const signals = evaluateRule(
      "CALL_NEGATIVE_SENTIMENT",
      makeCtx({ opportunities: [opp], calls: [call] }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].signalType).toBe("momentum_change");
  });

  test("does not fire when latest call has no risk flags", () => {
    const opp = makeOpp({ stage: "Evaluating" });
    const call: CallTranscript = {
      id: "call_1",
      oppId: opp.id,
      callDate: "2026-05-15",
      durationMin: 30,
      attendees: ["rep_1"],
      summary: "Discovery",
      riskFlags: [],
      excerpts: [],
    };
    const signals = evaluateRule(
      "CALL_NEGATIVE_SENTIMENT",
      makeCtx({ opportunities: [opp], calls: [call] }),
    );
    expect(signals).toHaveLength(0);
  });
});

// ── computeDealHealth ───────────────────────────────────────────────────

describe("computeDealHealth", () => {
  function sig(severity: "blocking" | "action", ruleId = "TEST"): Signal {
    return {
      id: `${ruleId}:opp_1`,
      ruleId,
      oppId: "opp_1",
      severity,
      // signalType is required on Signal. computeDealHealth doesn't read it —
      // it keys off severity + ruleId — so any canonical value satisfies the
      // shape. Use champion_loss for the CHAMPION_DEPARTED case to match the
      // production mapping; everything else uses momentum_change as a generic
      // fixture.
      signalType: ruleId === "CHAMPION_DEPARTED" ? "champion_loss" : "momentum_change",
      title: "t",
      body: "b",
      suggestedAction: "a",
      detectedAt: "2026-05-21T00:00:00Z",
    };
  }

  test("Healthy when there are no signals", () => {
    expect(computeDealHealth(makeOpp(), [])).toBe("Healthy");
  });

  test("Monitor when there is exactly one action signal", () => {
    expect(computeDealHealth(makeOpp(), [sig("action")])).toBe("Monitor");
  });

  test("At Risk when there is exactly one blocking signal (close far out)", () => {
    expect(computeDealHealth(makeOpp(), [sig("blocking")])).toBe("At Risk");
  });

  test("At Risk when there are two action signals", () => {
    expect(
      computeDealHealth(makeOpp(), [sig("action", "R1"), sig("action", "R2")]),
    ).toBe("At Risk");
  });

  test("Critical when CHAMPION_DEPARTED fires, regardless of count", () => {
    expect(
      computeDealHealth(makeOpp(), [sig("blocking", "CHAMPION_DEPARTED")]),
    ).toBe("Critical");
  });

  test("Critical when there are two blocking signals", () => {
    expect(
      computeDealHealth(makeOpp(), [sig("blocking", "R1"), sig("blocking", "R2")]),
    ).toBe("Critical");
  });

  test("Critical when one blocking and close < 60 days", () => {
    const opp = makeOpp({ closeDate: "2026-06-15T00:00:00Z" }); // ~25d after TODAY
    expect(computeDealHealth(opp, [sig("blocking")])).toBe("Critical");
  });
});
