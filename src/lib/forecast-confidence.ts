// Forecast Confidence - grades each open opportunity A/B/C/D from signal
// evidence vs the AE's forecast category. Pure derivation, no I/O.
//
// The question this answers: "for each deal the AE is committing to, does the
// signal evidence back that call?" When the AE forecasts Commit/Best Case on a
// deal where SV Health is low or blocking signals exist, the manager wants to
// see that mismatch surfaced - that's the D-grade case.
//
// Grade rubric (per the manager-view brief):
//   A - SV Health ≥ 80 AND no blocking signals AND AE forecast = Commit | Best Case
//   B - SV Health 60-79 AND ≤ 1 action signal AND AE forecast = Commit | Best Case
//       OR  SV Health ≥ 80 AND AE forecast = Pipeline
//   C - SV Health 40-59 OR ≥ 2 action signals
//   D - SV Health < 40 OR (any blocking signal AND AE forecast = Commit | Best Case)
//
// Resolution order matters: D-grade checks first (the warning), then A, then B,
// then C as the catch-all. This keeps the "AE may be overcommitting" case
// dominant - if both A and D would technically match (they shouldn't, but
// defensively), D wins.

import type { Opportunity, Signal, Stage } from "@/lib/types";

// Salesforce-aligned forecast categories. We model the four standard ones plus
// "Closed" which doesn't apply to open-pipeline grading (filtered out before
// grade computation).
export type ForecastCategory =
  | "Commit"
  | "Best Case"
  | "Pipeline"
  | "Omitted"
  | "Closed";

export type ConfidenceGrade = "A" | "B" | "C" | "D";

// Stage → forecast category default. Used when an opp has no explicit
// `forecastCategory` field set - i.e. every seeded opp today. The mapping is
// the conservative AE default in most SFDC orgs: late-stage deals roll up to
// Commit/Best Case, mid-stage to Pipeline, early to Omitted.
//
// This is the fallback only - if/when `Opportunity.forecastCategory` is
// populated upstream, the explicit value wins. Documented as a tuning knob in
// the panel UI ("derived from stage when AE hasn't categorized").
const STAGE_TO_FORECAST: Record<Stage, ForecastCategory> = {
  Intro: "Omitted",
  Qualified: "Omitted",
  "Demo Sat": "Pipeline",
  Evaluating: "Pipeline",
  "Selected Vendor": "Best Case",
  Contracting: "Commit",
};

export function deriveForecastCategory(opp: Opportunity): ForecastCategory {
  // Support an upstream-provided value via a permissive cast - same pattern the
  // SV Health module uses for `assetsShared` (see lib/sv-health.ts §"Asset
  // shape"). When the field arrives via SFDC sync, no schema change required.
  const explicit = (opp as Opportunity & { forecastCategory?: ForecastCategory })
    .forecastCategory;
  if (explicit) return explicit;
  return STAGE_TO_FORECAST[opp.stage];
}

// Stages eligible for forecast grading. Anything earlier than Evaluating is
// too speculative to grade - the AE hasn't taken a real position yet.
const GRADABLE_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "Evaluating",
  "Selected Vendor",
  "Contracting",
]);

export function isGradableOpp(opp: Opportunity): boolean {
  return GRADABLE_STAGES.has(opp.stage);
}

// ─── Grade computation ──────────────────────────────────────────────────

export interface GradeInputs {
  svHealthScore: number; // 0-100
  blockingCount: number;
  actionCount: number;
  forecastCategory: ForecastCategory;
}

function isCommitting(cat: ForecastCategory): boolean {
  return cat === "Commit" || cat === "Best Case";
}

export function computeConfidenceGrade(inputs: GradeInputs): ConfidenceGrade {
  const { svHealthScore, blockingCount: rawBlockingCount, actionCount, forecastCategory } = inputs;

  // Guard: blockingCount must be a number. Real callers can pass undefined when
  // signal aggregation has a missing field - the type says `number` but runtime
  // data is untrustworthy. Degrade gracefully to "C" (Watch) and log so the
  // caller knows something went wrong, rather than letting `undefined >= 1` and
  // `undefined === 0` both evaluate to false and silently produce wrong grades.
  const blockingCount: number | null =
    typeof rawBlockingCount === "number" ? rawBlockingCount : null;
  if (blockingCount === null) {
    console.warn(
      `forecast-confidence: blockingCount must be a number, got ${typeof rawBlockingCount} - returning safe default "C"`,
    );
    return "C";
  }

  const committing = isCommitting(forecastCategory);

  // D (warning) - checked first so the overcommitment case dominates.
  // Either signal evidence is dire (SV < 40) regardless of the AE's call,
  // OR the AE is committing on a deal with a blocking signal.
  if (svHealthScore < 40) return "D";
  if (blockingCount >= 1 && committing) return "D";

  // A - signal evidence matches a confident AE call.
  if (svHealthScore >= 80 && blockingCount === 0 && committing) return "A";

  // B - two paths:
  //   1. Mid-health + low-friction action volume + AE committing
  //   2. High health but AE has it in Pipeline (under-commit; still B)
  if (
    svHealthScore >= 60 &&
    svHealthScore < 80 &&
    actionCount <= 1 &&
    blockingCount === 0 &&
    committing
  ) {
    return "B";
  }
  if (svHealthScore >= 80 && forecastCategory === "Pipeline") return "B";

  // C - catch-all: mid-band health, action volume building, or pipeline-call
  // when health is mid. Matches the spec's "SV Health 40-59 OR ≥ 2 action
  // signals" trigger, but also acts as the fallback for any combo that didn't
  // land an A or B.
  return "C";
}

// ─── Top-signal selection ──────────────────────────────────────────────
//
// For the table's "Top Signal" column we surface the single most-severe
// signal on the opp. Severity order: blocking > action > awareness. Within a
// tier we take the first by detectedAt desc - most recent wins.

const SEVERITY_RANK: Record<Signal["severity"], number> = {
  blocking: 3,
  action: 2,
  awareness: 1,
};

export function topSignalFor(
  oppId: string,
  signals: Signal[],
): Signal | undefined {
  return signals
    .filter((s) => s.oppId === oppId)
    .sort((a, b) => {
      const r = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (r !== 0) return r;
      return a.detectedAt < b.detectedAt ? 1 : -1;
    })[0];
}

// ─── Grade descriptions for UI ──────────────────────────────────────────
//
// Short, plain-language labels for badges + tooltips. Kept here so the
// component layer stays a thin renderer.
export const GRADE_LABELS: Record<ConfidenceGrade, string> = {
  A: "Strong",
  B: "Solid",
  C: "Watch",
  D: "Overcommit risk",
};

export const GRADE_DESCRIPTIONS: Record<ConfidenceGrade, string> = {
  A: "High SV Health, no blocking signals, AE forecast is confident.",
  B: "Mid-to-high health with limited friction, or healthy deal under-committed.",
  C: "Mid-band health or rising action volume - worth a closer look.",
  D: "Signal evidence does not support an AE Commit/Best Case call.",
};
