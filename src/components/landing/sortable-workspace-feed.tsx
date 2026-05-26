"use client";

import { useMemo, useState } from "react";
import type { ExternalSignal } from "@/lib/external-signals";

// Sortable workspace inbox feed. Client component because the sort state
// lives on the client; the server hands us the full list of recent
// signals and we re-order in memory. Three sort axes:
//
//   - Recency: occurred_at desc (default)
//   - Relevance: signals mentioning a tracked account first (the AE's
//     own company list), then workspace_relevance tier
//     (high > medium > low > none), tie-broken by recency
//   - Magnitude: top stories from the past 7 days, ranked by AI-determined
//     impact_score (0-100) set by the upstream Haiku classifier. Falls
//     back to a (workspace_relevance × type magnitude) heuristic for
//     legacy rows missing impact_score.
//
// Filtering UI doubles as a visible "live system" demonstration — the
// reordering happens instantly on click, which is the cheapest way to
// signal interactivity without spinning anything up server-side.

type SortKey = "recency" | "relevance" | "magnitude";

const RELEVANCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

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

function signalText(s: ExternalSignal): string {
  return `${s.summary} ${s.email_subject ?? ""}`.toLowerCase();
}

function mentionsAccount(signal: ExternalSignal, needles: string[]): boolean {
  if (needles.length === 0) return false;
  const haystack = signalText(signal);
  return needles.some((n) => haystack.includes(n));
}

function makeCompareRelevance(needles: string[]) {
  return (a: ExternalSignal, b: ExternalSignal): number => {
    const ma = mentionsAccount(a, needles);
    const mb = mentionsAccount(b, needles);
    if (ma !== mb) return ma ? -1 : 1;
    const ra = RELEVANCE_RANK[a.workspace_relevance ?? "none"] ?? 0;
    const rb = RELEVANCE_RANK[b.workspace_relevance ?? "none"] ?? 0;
    if (ra !== rb) return rb - ra;
    return compareRecency(a, b);
  };
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
  trackedAccountNames = [],
}: {
  signals: ExternalSignal[];
  // Names + tickers of the AE's tracked accounts. Used by the "Relevance"
  // sort to float signals that mention a tracked company to the top.
  trackedAccountNames?: string[];
}) {
  const [sortBy, setSortBy] = useState<SortKey>("recency");

  const needles = useMemo(
    () =>
      trackedAccountNames
        .map((n) => n.trim().toLowerCase())
        .filter((n) => n.length > 0),
    [trackedAccountNames],
  );

  const sorted = useMemo(() => {
    if (sortBy === "magnitude") {
      const nowMs = Date.now();
      return signals
        .filter((s) => isWithinMagnitudeWindow(s, nowMs))
        .sort(compareMagnitude);
    }
    const copy = [...signals];
    if (sortBy === "relevance") copy.sort(makeCompareRelevance(needles));
    else copy.sort(compareRecency);
    return copy;
  }, [signals, sortBy, needles]);

  if (signals.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-6 text-sm text-muted">
        Workspace inbox is quiet right now. Newer items will land here as
        the pipeline tags them.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted mr-1">
          Sort
        </span>
        <SortButton
          active={sortBy === "recency"}
          onClick={() => setSortBy("recency")}
        >
          Recency
        </SortButton>
        <SortButton
          active={sortBy === "relevance"}
          onClick={() => setSortBy("relevance")}
        >
          Relevance
        </SortButton>
        <SortButton
          active={sortBy === "magnitude"}
          onClick={() => setSortBy("magnitude")}
        >
          Magnitude
        </SortButton>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 && sortBy === "magnitude" ? (
          <div className="rounded-lg border border-border bg-foreground/[0.02] p-6 text-sm text-muted">
            No high-impact stories in the past {MAGNITUDE_WINDOW_DAYS} days.
            Switch back to Recency or Relevance for the full feed.
          </div>
        ) : (
          sorted.map((signal) => <FeedRow key={signal.id} signal={signal} />)
        )}
      </div>
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] font-mono uppercase tracking-[0.1em] py-1 px-2.5 rounded border transition-colors ${
        active
          ? "border-brand/40 bg-brand/10 text-brand"
          : "border-border bg-background text-muted hover:text-foreground hover:border-foreground/30"
      }`}
    >
      {children}
    </button>
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
