// Forecast Confidence panel - per-opp A/B/C/D grade from signal evidence vs
// AE forecast category. Default sort puts D-graded deals at the top so the
// manager sees "where the AE may be overcommitting" first.
//
// Pure renderer - all grading happens in lib/forecast-confidence.ts.

import Link from "next/link";
import {
  computeConfidenceGrade,
  deriveForecastCategory,
  GRADE_DESCRIPTIONS,
  GRADE_LABELS,
  isGradableOpp,
  topSignalFor,
  type ConfidenceGrade,
  type ForecastCategory,
} from "@/lib/forecast-confidence";
import type { Account, Opportunity, Rep, Signal } from "@/lib/types";
import type { SVHealthScore } from "@/lib/sv-health";
import { cn, formatCurrency } from "@/lib/utils";

export interface ForecastConfidenceRow {
  opportunity: Opportunity;
  account: Account;
  owner: Rep;
  svHealthScore: number;
  blockingCount: number;
  actionCount: number;
  forecastCategory: ForecastCategory;
  grade: ConfidenceGrade;
  topSignal?: Signal;
}

// Default grade-sort order: D first (the warnings), then C, B, A.
const GRADE_SORT_RANK: Record<ConfidenceGrade, number> = {
  D: 0,
  C: 1,
  B: 2,
  A: 3,
};

const GRADE_BADGE_CLASSES: Record<ConfidenceGrade, string> = {
  A: "bg-severity-green/10 text-severity-green border-severity-green/30",
  B: "bg-slate-100 text-slate-700 border-slate-300",
  C: "bg-severity-action/10 text-severity-action border-severity-action/30",
  D: "bg-severity-blocking/10 text-severity-blocking border-severity-blocking/30",
};

const SEVERITY_TEXT: Record<Signal["severity"], string> = {
  blocking: "text-severity-blocking",
  action: "text-severity-action",
  awareness: "text-muted",
};

// ─── Pure helper: shape the rows from raw inputs ─────────────────────────
//
// Kept in this file (not lib/forecast-confidence.ts) because it joins
// React-adjacent display concerns - Account/Rep lookups, sort order, the
// gradable-stage filter - rather than pure grading logic.

export function buildForecastConfidenceRows({
  opportunities,
  accounts,
  reps,
  signals,
  svHealthByOpp,
}: {
  opportunities: Opportunity[];
  accounts: Account[];
  reps: Rep[];
  signals: Signal[];
  svHealthByOpp: Record<string, SVHealthScore | undefined>;
}): ForecastConfidenceRow[] {
  const rows: ForecastConfidenceRow[] = [];
  for (const opp of opportunities) {
    if (!isGradableOpp(opp)) continue;
    const account = accounts.find((a) => a.id === opp.accountId);
    const owner = reps.find((r) => r.id === opp.ownerId);
    if (!account || !owner) continue;
    // If a deal has no SV Health score (e.g. no demo-scenario assetsShared
    // populated), default to 50 - the neutral midpoint. This pushes the deal
    // into C-grade unless other signals escalate it. Avoids silently dropping
    // deals from the panel.
    const svHealthScore = svHealthByOpp[opp.id]?.score ?? 50;
    const oppSignals = signals.filter((s) => s.oppId === opp.id);
    const blockingCount = oppSignals.filter(
      (s) => s.severity === "blocking",
    ).length;
    const actionCount = oppSignals.filter(
      (s) => s.severity === "action",
    ).length;
    const forecastCategory = deriveForecastCategory(opp);
    const grade = computeConfidenceGrade({
      svHealthScore,
      blockingCount,
      actionCount,
      forecastCategory,
    });
    rows.push({
      opportunity: opp,
      account,
      owner,
      svHealthScore,
      blockingCount,
      actionCount,
      forecastCategory,
      grade,
      topSignal: topSignalFor(opp.id, signals),
    });
  }
  // Default sort: grade asc (D first), then SV Health asc within tier (worst
  // first), then ACV desc (biggest dollar exposure first).
  rows.sort((a, b) => {
    const g = GRADE_SORT_RANK[a.grade] - GRADE_SORT_RANK[b.grade];
    if (g !== 0) return g;
    const h = a.svHealthScore - b.svHealthScore;
    if (h !== 0) return h;
    return b.opportunity.amount - a.opportunity.amount;
  });
  return rows;
}

// ─── Component ───────────────────────────────────────────────────────────

export function ForecastConfidencePanel({
  rows,
}: {
  rows: ForecastConfidenceRow[];
}): React.JSX.Element {
  const counts: Record<ConfidenceGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const r of rows) counts[r.grade]++;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Forecast confidence · sorted by overcommit risk
        </h2>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Each open Evaluating+ opp graded A–D from SV Health + signal evidence
          vs the AE&rsquo;s forecast category. D-grade flags deals where the
          AE&rsquo;s Commit/Best Case call isn&rsquo;t backed by the evidence.
        </p>
      </div>

      {/* Grade summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GradeStatCard grade="D" count={counts.D} />
        <GradeStatCard grade="C" count={counts.C} />
        <GradeStatCard grade="B" count={counts.B} />
        <GradeStatCard grade="A" count={counts.A} />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Opportunity</th>
              <th className="text-left px-4 py-3 font-medium">AE</th>
              <th className="text-left px-4 py-3 font-medium">Stage</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">AE Forecast</th>
              <th className="text-center px-4 py-3 font-medium">Grade</th>
              <th className="text-right px-4 py-3 font-medium">SV Health</th>
              <th className="text-left px-4 py-3 font-medium">Top signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-6 text-center text-sm text-muted"
                >
                  No open Evaluating+ opportunities to grade.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.opportunity.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <Link
                    href={`/account/${r.account.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.opportunity.name}
                  </Link>
                  <div className="text-[11px] text-muted">{r.account.name}</div>
                </td>
                <td className="px-4 py-3 text-muted">{r.owner.name}</td>
                <td className="px-4 py-3 text-muted">{r.opportunity.stage}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCurrency(r.opportunity.amount)}
                </td>
                <td className="px-4 py-3 text-muted">{r.forecastCategory}</td>
                <td className="px-4 py-3 text-center">
                  <span
                    title={GRADE_DESCRIPTIONS[r.grade]}
                    className={cn(
                      "inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-semibold border",
                      GRADE_BADGE_CLASSES[r.grade],
                    )}
                  >
                    {r.grade}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-mono">
                  {r.svHealthScore}
                </td>
                <td className="px-4 py-3">
                  {r.topSignal ? (
                    <div className="text-[12px] leading-snug">
                      <span
                        className={cn(
                          "font-medium",
                          SEVERITY_TEXT[r.topSignal.severity],
                        )}
                      >
                        {r.topSignal.title}
                      </span>
                      <div className="text-[11px] text-muted">
                        {r.topSignal.severity}
                      </div>
                    </div>
                  ) : (
                    <span className="text-[12px] text-muted">No signals</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GradeStatCard({
  grade,
  count,
}: {
  grade: ConfidenceGrade;
  count: number;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-semibold border",
            GRADE_BADGE_CLASSES[grade],
          )}
        >
          {grade}
        </span>
        <span>{GRADE_LABELS[grade]}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">
        {count}
      </div>
      <div className="text-[11px] text-muted leading-tight">
        {GRADE_DESCRIPTIONS[grade]}
      </div>
    </div>
  );
}
