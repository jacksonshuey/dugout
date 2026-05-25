// Forecast Confidence — grade boundary tests. Each case targets the smallest
// possible delta around a grade threshold to lock the rubric in place.

import { describe, expect, test } from "vitest";
import {
  computeConfidenceGrade,
  deriveForecastCategory,
  isGradableOpp,
  topSignalFor,
  type GradeInputs,
} from "./forecast-confidence";
import type { Opportunity, Signal } from "./types";

function inputs(overrides: Partial<GradeInputs> = {}): GradeInputs {
  return {
    svHealthScore: 70,
    blockingCount: 0,
    actionCount: 0,
    forecastCategory: "Commit",
    ...overrides,
  };
}

describe("computeConfidenceGrade", () => {
  test("A — high health, no blocking, AE committing", () => {
    expect(
      computeConfidenceGrade(inputs({ svHealthScore: 85, forecastCategory: "Commit" })),
    ).toBe("A");
    expect(
      computeConfidenceGrade(inputs({ svHealthScore: 80, forecastCategory: "Best Case" })),
    ).toBe("A");
  });

  test("B — mid-high health, low action volume, AE committing", () => {
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 70, actionCount: 1, forecastCategory: "Commit" }),
      ),
    ).toBe("B");
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 60, actionCount: 0, forecastCategory: "Best Case" }),
      ),
    ).toBe("B");
  });

  test("B — high health but AE under-commits (Pipeline)", () => {
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 85, forecastCategory: "Pipeline" }),
      ),
    ).toBe("B");
  });

  test("C — mid-band health, no other escalators", () => {
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 50, forecastCategory: "Commit" }),
      ),
    ).toBe("C");
  });

  test("C — high health but rising action volume", () => {
    // 2 action signals — over the B threshold but health/blocking don't push D.
    expect(
      computeConfidenceGrade(
        inputs({
          svHealthScore: 75,
          actionCount: 2,
          forecastCategory: "Commit",
        }),
      ),
    ).toBe("C");
  });

  test("D — SV Health below 40 regardless of AE call", () => {
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 39, forecastCategory: "Pipeline" }),
      ),
    ).toBe("D");
    expect(
      computeConfidenceGrade(
        inputs({ svHealthScore: 10, forecastCategory: "Commit" }),
      ),
    ).toBe("D");
  });

  test("D — blocking signal present AND AE committing (overcommit)", () => {
    expect(
      computeConfidenceGrade(
        inputs({
          svHealthScore: 75, // would otherwise be B
          blockingCount: 1,
          forecastCategory: "Commit",
        }),
      ),
    ).toBe("D");
  });

  test("blocking on a Pipeline call drops to C, not D", () => {
    // The D-rubric for blocking explicitly requires Commit/Best Case. A
    // blocking signal with a Pipeline call is a Watch (C), not an overcommit
    // warning — the AE is already cautious.
    expect(
      computeConfidenceGrade(
        inputs({
          svHealthScore: 70,
          blockingCount: 1,
          forecastCategory: "Pipeline",
        }),
      ),
    ).toBe("C");
  });

  test("undefined blockingCount → safe-default C (guard fires)", () => {
    // If a real-world row has a missing blockingCount field, runtime value is
    // undefined despite the TypeScript type saying `number`. The guard must
    // return "C" rather than silently mis-grading via coerced comparisons.
    const badInputs = inputs({ blockingCount: undefined as unknown as number });
    expect(computeConfidenceGrade(badInputs)).toBe("C");
  });
});

describe("deriveForecastCategory", () => {
  test("uses explicit field when present", () => {
    const opp = {
      stage: "Evaluating",
      forecastCategory: "Commit",
    } as unknown as Opportunity;
    expect(deriveForecastCategory(opp)).toBe("Commit");
  });

  test("falls back to stage default when field absent", () => {
    const opp = { stage: "Contracting" } as unknown as Opportunity;
    expect(deriveForecastCategory(opp)).toBe("Commit");
  });
});

describe("isGradableOpp", () => {
  test("gradable: Evaluating, Selected Vendor, Contracting", () => {
    expect(isGradableOpp({ stage: "Evaluating" } as Opportunity)).toBe(true);
    expect(isGradableOpp({ stage: "Selected Vendor" } as Opportunity)).toBe(true);
    expect(isGradableOpp({ stage: "Contracting" } as Opportunity)).toBe(true);
  });

  test("not gradable: Intro, Qualified, Demo Sat", () => {
    expect(isGradableOpp({ stage: "Intro" } as Opportunity)).toBe(false);
    expect(isGradableOpp({ stage: "Qualified" } as Opportunity)).toBe(false);
    expect(isGradableOpp({ stage: "Demo Sat" } as Opportunity)).toBe(false);
  });
});

describe("topSignalFor", () => {
  const sig = (overrides: Partial<Signal>): Signal => ({
    id: "s",
    ruleId: "R",
    oppId: "opp_1",
    severity: "awareness",
    signalType: "account_context",
    title: "t",
    body: "b",
    suggestedAction: "a",
    detectedAt: "2026-05-01",
    ...overrides,
  });

  test("prefers blocking over action over awareness", () => {
    const signals = [
      sig({ id: "a", severity: "action" }),
      sig({ id: "w", severity: "awareness" }),
      sig({ id: "b", severity: "blocking" }),
    ];
    expect(topSignalFor("opp_1", signals)?.id).toBe("b");
  });

  test("within tier, most recent wins", () => {
    const signals = [
      sig({ id: "old", severity: "action", detectedAt: "2026-05-01" }),
      sig({ id: "new", severity: "action", detectedAt: "2026-05-15" }),
    ];
    expect(topSignalFor("opp_1", signals)?.id).toBe("new");
  });

  test("ignores signals on other opps", () => {
    const signals = [
      sig({ id: "other", oppId: "opp_other", severity: "blocking" }),
      sig({ id: "mine", severity: "action" }),
    ];
    expect(topSignalFor("opp_1", signals)?.id).toBe("mine");
  });

  test("returns undefined when no signals match", () => {
    expect(topSignalFor("opp_1", [])).toBeUndefined();
  });
});
