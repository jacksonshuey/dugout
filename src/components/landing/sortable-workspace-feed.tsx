"use client";

import { useMemo } from "react";
import type { ExternalSignal } from "@/lib/external-signals";

// "Top news of the week" feed. The server hands us recent workspace signals;
// we surface the top stories from the past 7 days ranked by AI-determined
// impact_score (0-100) set by the upstream Haiku classifier, falling back to a
// (workspace_relevance × type magnitude) heuristic for legacy rows missing
// impact_score. If nothing landed in the last week, we fall back to the
// highest-impact items overall so the section never goes empty.

const TYPE_MAGNITUDE: Record<string, number> = {
  ma_acquisition: 5,
  leadership_change: 5,
  champion_job_change: 4,
  funding_round: 4,
  layoff: 4,
  earnings: 3,
  regulatory_action: 3,
  product_launch: 2,
  press_release: 2,
  partnership: 2,
  competitor_mention: 1,
  other: 0,
};

// Window for the "Magnitude" sort: the top stories from the past N days.
const MAGNITUDE_WINDOW_DAYS = 7;

// Fallback impact score (0-100) for signals whose Haiku classifier hadn't
// yet been migrated to emit impact_score. Roughly aligned with the rubric
// in impact-score.ts so legacy rows still sort sensibly.
function derivedImpactScore(signal: ExternalSignal): number {
  const tierBase =
    ({ high: 70, medium: 50, low: 30, none: 10 } as const)[
      signal.workspace_relevance ?? "none"
    ] ?? 10;
  const typeBoost = (TYPE_MAGNITUDE[signal.type] ?? 0) * 4;
  return Math.min(100, tierBase + typeBoost);
}

function effectiveImpactScore(signal: ExternalSignal): number {
  return signal.impact_score ?? derivedImpactScore(signal);
}

function compareRecency(a: ExternalSignal, b: ExternalSignal): number {
  return (
    new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  );
}

function compareMagnitude(a: ExternalSignal, b: ExternalSignal): number {
  const ia = effectiveImpactScore(a);
  const ib = effectiveImpactScore(b);
  if (ia !== ib) return ib - ia;
  return compareRecency(a, b);
}

function isWithinMagnitudeWindow(signal: ExternalSignal, nowMs: number): boolean {
  const ageMs = nowMs - new Date(signal.occurred_at).getTime();
  return ageMs <= MAGNITUDE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function SortableWorkspaceFeed({
  signals,
}: {
  signals: ExternalSignal[];
}) {
  const topOfWeek = useMemo(() => {
    const nowMs = Date.now();
    const withinWeek = signals.filter((s) => isWithinMagnitudeWindow(s, nowMs));
    // Top news of the week, ranked by impact. Fall back to the highest-impact
    // items overall if nothing landed in the last week, so it never empties.
    const pool = withinWeek.length > 0 ? withinWeek : [...signals];
    return pool.sort(compareMagnitude);
  }, [signals]);

  if (signals.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-6 text-sm text-muted">
        Workspace inbox is quiet right now. Newer items will land here as
        the pipeline tags them.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {topOfWeek.map((signal) => (
        <FeedRow key={signal.id} signal={signal} />
      ))}
    </div>
  );
}

function FeedRow({ signal }: { signal: ExternalSignal }) {
  const publisher =
    signal.publisher_canonical_name ??
    signal.email_subject?.split(" - ")[0] ??
    signal.source.replace(/_/g, " ");
  const typeLabel = signal.type.replace(/_/g, " ");
  const ageLabel = relativeAge(signal.occurred_at);
  const relevance = signal.workspace_relevance;
  return (
    <div className="rounded-lg border border-border bg-background p-3 flex items-start gap-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 rounded border border-border bg-foreground/[0.04] text-muted shrink-0 inline-flex items-center justify-center max-w-[200px] truncate px-2">
        {publisher}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium tracking-tight leading-snug line-clamp-2">
          {signal.summary}
        </div>
        <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
          <span className="font-mono uppercase tracking-[0.08em]">
            {typeLabel}
          </span>
          <span aria-hidden>·</span>
          <span>{ageLabel}</span>
          {relevance && relevance !== "none" && (
            <>
              <span aria-hidden>·</span>
              <span
                className={`font-mono uppercase tracking-[0.08em] ${
                  relevance === "high" ? "text-brand" : "text-foreground/70"
                }`}
              >
                {relevance} relevance
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeAge(isoTimestamp: string): string {
  const ageH = Math.max(
    1,
    Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 3600000),
  );
  return ageH < 24 ? `${ageH}h ago` : `${Math.floor(ageH / 24)}d ago`;
}
