// Selected Vendor Health Score tests — covers the three tier scenarios from
// metrics.md, the tier boundary conditions, and the Helios worked example.
//
// TODAY is pinned at 2026-05-21 in lib/utils.ts; all ISO dates here are
// anchored to that so the math is deterministic.

import { describe, expect, test } from "vitest";
import { computeSVHealthScore, tierForScore } from "./sv-health";
import type {
  Account,
  Contact,
  Opportunity,
  Signal,
} from "./types";
import type { ExternalSignal } from "./external-signals";

// ─── Fixtures ───────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc_1",
    name: "Test Account",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "San Francisco, CA",
    legalTeamSize: 50,
    ...overrides,
  };
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_1",
    accountId: "acc_1",
    name: "Test Deal",
    ownerId: "rep_1",
    stage: "Selected Vendor",
    amount: 100_000,
    // Stage entered 5 days ago — well under the 30d p75 benchmark.
    enteredStageAt: "2026-05-16T00:00:00Z",
    createdAt: "2026-05-01T00:00:00Z",
    closeDate: "2026-08-01T00:00:00Z",
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

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig_1",
    ruleId: "TEST_RULE",
    oppId: "opp_1",
    severity: "action",
    signalType: "momentum_change",
    title: "Test signal",
    body: "Test body",
    suggestedAction: "Do the thing.",
    detectedAt: "2026-05-20T00:00:00Z", // 1d before TODAY
    ...overrides,
  };
}

// Helper: build the assetsShared field via a permissive cast so we can drive
// the enablement component in tests. Mirrors how Agent B3 will eventually
// supply this once the field is wired on Opportunity.
function withAssets(
  opp: Opportunity,
  flags: { cfoLeaveBehind?: boolean; itZeroLift?: boolean; financeBrief?: boolean },
): Opportunity {
  return { ...opp, assetsShared: flags } as Opportunity;
}

const noExternal: ExternalSignal[] = [];

// ─── Scenarios ──────────────────────────────────────────────────────────

describe("computeSVHealthScore — healthy scenario (~85)", () => {
  test("all five roles + all assets + fresh stage + active champion → healthy", () => {
    const account = makeAccount();
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const ebSponsor = makeContact({ id: "c_eb", role: "Executive Sponsor" });
    const finance = makeContact({ id: "c_f", role: "Finance/CFO" });
    const it = makeContact({ id: "c_it", role: "IT/Security" });
    const legal = makeContact({ id: "c_l", role: "GC" });

    const opp = withAssets(
      makeOpp({
        contactRoleIds: [champion.id, ebSponsor.id, finance.id, it.id, legal.id],
        // 2 days into stage — timeInStage = 100 * (1 - 2/30) ≈ 93
        enteredStageAt: "2026-05-19T00:00:00Z",
      }),
      { cfoLeaveBehind: true, itZeroLift: true, financeBrief: true },
    );

    // Champion touched 1 day ago via a positive momentum signal
    const signals = [
      makeSignal({
        id: "sig_pos",
        severity: "awareness",
        signalType: "momentum_change",
        detectedAt: "2026-05-20T00:00:00Z",
      }),
    ];

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion, ebSponsor, finance, it, legal],
      signals,
      externalSignals: noExternal,
    });

    // Expected: 0.2*93 + 0.3*100 + 0.2*100 + 0.2*93 - 0 ≈ 87
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.tier).toBe("healthy");
    expect(result.components.committeeCoverage).toBe(100);
    expect(result.components.enablementDeployment).toBe(100);
    expect(result.components.riskPenalty).toBe(0);
    expect(result.drivers).toEqual(["All key signals healthy"]);
  });
});

describe("computeSVHealthScore — watch scenario (~55-65)", () => {
  test("3/5 roles + 2/3 assets + champion 5d silent → watch or at_risk", () => {
    const account = makeAccount();
    const champion = makeContact({ id: "c_ch", role: "Champion" });
    const ebSponsor = makeContact({ id: "c_eb", role: "Executive Sponsor" });
    const finance = makeContact({ id: "c_f", role: "Finance/CFO" });

    const opp = withAssets(
      makeOpp({
        contactRoleIds: [champion.id, ebSponsor.id, finance.id],
        enteredStageAt: "2026-05-11T00:00:00Z", // 10d ago → ~67
      }),
      { cfoLeaveBehind: true, financeBrief: true }, // 2/3 → 67
    );

    // Most recent signal is 5d old — champion engagement = 100 * (1 - 5/14) ≈ 64
    const signals = [
      makeSignal({
        id: "sig_old",
        severity: "awareness",
        detectedAt: "2026-05-16T00:00:00Z",
      }),
    ];

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion, ebSponsor, finance],
      signals,
      externalSignals: noExternal,
    });

    // Expected: 0.2*67 + 0.3*60 + 0.2*67 + 0.2*64 ≈ 13.3+18+13.3+12.9 = ~58
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThanOrEqual(70);
    expect(["watch", "at_risk"]).toContain(result.tier);
    expect(result.components.committeeCoverage).toBe(60);
    expect(result.components.riskPenalty).toBe(0);
    expect(result.drivers.length).toBeGreaterThan(0);
    expect(result.drivers).not.toContain("All key signals healthy");
  });
});

describe("computeSVHealthScore — critical scenario (~10)", () => {
  test("only champion + 0 assets + champion 14d silent + blocking → critical", () => {
    const account = makeAccount();
    const champion = makeContact({ id: "c_ch", role: "Champion" });

    const opp = makeOpp({
      contactRoleIds: [champion.id],
      enteredStageAt: "2026-04-21T00:00:00Z", // 30d → timeInStage = 0
    });

    const signals: Signal[] = [
      makeSignal({
        id: "sig_block",
        severity: "blocking",
        signalType: "champion_disengagement",
        detectedAt: "2026-05-07T00:00:00Z", // 14d ago
      }),
    ];

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion],
      signals,
      externalSignals: noExternal,
    });

    // Expected: 0.2*0 + 0.3*20 + 0.2*0 + 0.2*0 - 20 = -14 → clamped to 0
    expect(result.score).toBeLessThanOrEqual(20);
    expect(result.tier).toBe("critical");
    expect(result.components.riskPenalty).toBe(-20);
    expect(result.components.committeeCoverage).toBe(20);
    expect(result.components.enablementDeployment).toBe(0);
    expect(result.evidenceSignalIds).toContain("sig_block");
  });
});

describe("computeSVHealthScore — Helios worked example", () => {
  test("matches metrics.md worked example (~10, critical)", () => {
    const account = makeAccount({ id: "acc_unitedhealth", name: "Helios Manufacturing" });
    const champion = makeContact({ id: "c_helios_ch", role: "Champion" });
    const eb = makeContact({ id: "c_helios_eb", role: "Executive Sponsor" });
    // Finance, IT, Legal are deliberately absent — matches the worked example.

    const opp = withAssets(
      makeOpp({
        id: "opp_helios",
        accountId: "acc_unitedhealth",
        name: "Helios",
        amount: 185_000,
        contactRoleIds: [champion.id, eb.id],
        enteredStageAt: "2026-04-28T00:00:00Z", // 23 days before TODAY (2026-05-21)
      }),
      // CFO Leave-Behind shared (count it); IT shared but not viewed (per
      // metrics.md spec, "Shared" requires view, so structurally we treat IT
      // as not-shared); Finance Brief never sent.
      { cfoLeaveBehind: true },
    );

    // Champion disengagement correlation active (3 sources in metrics.md) →
    // blocking signal that triggers the -20 risk penalty in v1.
    const signals: Signal[] = [
      makeSignal({
        id: "sig_helios_champ",
        oppId: "opp_helios",
        severity: "blocking",
        signalType: "champion_disengagement",
        // Champion touch 9 days before TODAY = 2026-05-12
        detectedAt: "2026-05-12T00:00:00Z",
      }),
    ];

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion, eb],
      signals,
      externalSignals: noExternal,
    });

    // metrics.md worked example math (rounded per component):
    //   timeInStage   = 100 * (1 - 23/30) ≈ 23  → 0.2 *  23 =  4.6
    //   committee     = 2/5 * 100         =  40 → 0.3 *  40 = 12.0
    //   enablement    = 1/3 * 100         ≈  33 → 0.2 *  33 =  6.6
    //   champion      = 100 * (1 - 9/14)  ≈  36 → 0.2 *  36 =  7.2
    //   risk penalty                                          = -20
    //   total = 4.6 + 12 + 6.6 + 7.2 - 20 = 10.4 → 10 (Critical)
    expect(result.score).toBeGreaterThanOrEqual(8);
    expect(result.score).toBeLessThanOrEqual(13);
    expect(result.tier).toBe("critical");
    expect(result.components.riskPenalty).toBe(-20);
    // 23 days / 30 day benchmark → ~23. Allow ±2 for the rounding model.
    expect(result.components.timeInStage).toBeGreaterThan(20);
    expect(result.components.timeInStage).toBeLessThan(27);
    expect(result.components.committeeCoverage).toBe(40);
    // Champion 9d silent → ~36 (allow ±2).
    expect(result.components.championEngagement).toBeGreaterThan(33);
    expect(result.components.championEngagement).toBeLessThan(40);
    expect(result.evidenceSignalIds).toContain("sig_helios_champ");

    // Driver strings should call out the specific gaps in plain language.
    expect(result.drivers.length).toBeGreaterThanOrEqual(1);
    expect(result.drivers.length).toBeLessThanOrEqual(3);
    // No emojis, no exclamation marks (BUILD_ALIGNMENT principle #8).
    for (const d of result.drivers) {
      expect(d).not.toMatch(/!/);
      expect(d).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────

describe("computeSVHealthScore — edge cases", () => {
  test("0-day stage age yields timeInStage = 100", () => {
    const account = makeAccount();
    const champion = makeContact({ role: "Champion" });
    const opp = makeOpp({
      contactRoleIds: [champion.id],
      enteredStageAt: "2026-05-21T00:00:00Z", // today
    });

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion],
      signals: [],
      externalSignals: noExternal,
    });

    expect(result.components.timeInStage).toBe(100);
  });

  test("14+ day champion silence yields championEngagement = 0", () => {
    const account = makeAccount();
    const champion = makeContact({ role: "Champion" });
    const opp = makeOpp({
      contactRoleIds: [champion.id],
      enteredStageAt: "2026-04-01T00:00:00Z", // 50d ago
    });

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion],
      signals: [
        makeSignal({
          id: "sig_old",
          severity: "awareness",
          detectedAt: "2026-04-25T00:00:00Z", // 26d ago — well past 14d floor
        }),
      ],
      externalSignals: noExternal,
    });

    expect(result.components.championEngagement).toBe(0);
  });

  test("all 5 roles engaged yields committeeCoverage = 100", () => {
    const account = makeAccount();
    const champion = makeContact({ id: "c1", role: "Champion" });
    const eb = makeContact({ id: "c2", role: "Executive Sponsor" });
    const finance = makeContact({ id: "c3", role: "Finance/CFO" });
    const it = makeContact({ id: "c4", role: "IT/Security" });
    const legalOps = makeContact({ id: "c5", role: "Legal Ops" });

    const opp = makeOpp({
      contactRoleIds: [champion.id, eb.id, finance.id, it.id, legalOps.id],
    });

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion, eb, finance, it, legalOps],
      signals: [],
      externalSignals: noExternal,
    });

    expect(result.components.committeeCoverage).toBe(100);
  });

  test("missing assetsShared field falls back to 0", () => {
    const account = makeAccount();
    const champion = makeContact({ role: "Champion" });
    // Plain opportunity — no assetsShared field set.
    const opp = makeOpp({ contactRoleIds: [champion.id] });

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion],
      signals: [],
      externalSignals: noExternal,
    });

    expect(result.components.enablementDeployment).toBe(0);
  });

  test("no signals: champion engagement falls back to stage-entry as touch proxy", () => {
    const account = makeAccount();
    const champion = makeContact({ role: "Champion" });
    const opp = makeOpp({
      contactRoleIds: [champion.id],
      enteredStageAt: "2026-05-14T00:00:00Z", // 7d ago
    });

    const result = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: [champion],
      signals: [],
      externalSignals: noExternal,
    });

    // 7d / 14d floor → ~50
    expect(result.components.championEngagement).toBeGreaterThan(45);
    expect(result.components.championEngagement).toBeLessThan(55);
  });
});

// ─── tierForScore boundaries ───────────────────────────────────────────

describe("tierForScore boundaries", () => {
  test("80 → healthy, 79 → watch", () => {
    expect(tierForScore(80)).toBe("healthy");
    expect(tierForScore(79)).toBe("watch");
  });

  test("60 → watch, 59 → at_risk", () => {
    expect(tierForScore(60)).toBe("watch");
    expect(tierForScore(59)).toBe("at_risk");
  });

  test("40 → at_risk, 39 → critical", () => {
    expect(tierForScore(40)).toBe("at_risk");
    expect(tierForScore(39)).toBe("critical");
  });

  test("100 → healthy, 0 → critical", () => {
    expect(tierForScore(100)).toBe("healthy");
    expect(tierForScore(0)).toBe("critical");
  });
});
