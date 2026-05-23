// SV Health Hero — Hero Surface #0 per discovery/information-requirements.md.
//
// Two component variants share a common card. Both are pure-presentation:
// take props in, render JSX out. No fetch, no Supabase, no side effects (per
// BUILD_ALIGNMENT principle #7 — UI components don't reach for the DB).
//
//   SVHealthHero          — single-opp, full-width. Used by /account/[slug].
//   SVHealthHeroDashboard — three opps side-by-side. The demo opening shot.
//
// Voice rules (BUILD_ALIGNMENT principle #8): driver strings render verbatim
// from `score.drivers`. No exclamations, no emojis added in this file. If a
// driver string reads badly, that's an upstream (B1 / sv-health.ts) fix.
//
// Tier color palette (per the U2 spec):
//   healthy  → emerald
//   watch    → amber
//   at_risk  → orange
//   critical → red

import Link from "next/link";
import type { Account, Opportunity } from "@/lib/types";
import type { SVHealthScore, SVHealthTier } from "@/lib/sv-health";
import { cn, formatCurrency } from "@/lib/utils";

// ─── Tier styling ──────────────────────────────────────────────────────

type TierStyle = {
  label: string;
  badge: string; // pill — background + border + text
  border: string; // card outer border accent
  text: string; // big-number color
  bar: string; // component bar fill
};

const TIER_STYLES: Record<SVHealthTier, TierStyle> = {
  healthy: {
    label: "HEALTHY",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-300",
    border: "border-emerald-300",
    text: "text-emerald-700",
    bar: "bg-emerald-500",
  },
  watch: {
    label: "WATCH",
    badge: "bg-amber-50 text-amber-700 border-amber-300",
    border: "border-amber-300",
    text: "text-amber-700",
    bar: "bg-amber-500",
  },
  at_risk: {
    label: "AT RISK",
    badge: "bg-orange-50 text-orange-700 border-orange-300",
    border: "border-orange-300",
    text: "text-orange-700",
    bar: "bg-orange-500",
  },
  critical: {
    label: "CRITICAL",
    badge: "bg-red-50 text-red-700 border-red-300",
    border: "border-red-300",
    text: "text-red-700",
    bar: "bg-red-500",
  },
};

// ─── Component metadata ────────────────────────────────────────────────
//
// The 5 components rendered for every score per metrics.md §"Component
// definitions" + BUILD_ALIGNMENT principle "Components count is exactly 5".
// Weights match the formula in metrics.md and sv-health.ts:
//   0.20 time-in-stage + 0.30 committee + 0.20 enablement + 0.20 champion
//   − riskPenalty (0 or −20, subtractive)

type ComponentRow = {
  key: keyof SVHealthScore["components"];
  label: string;
  weightLabel: string;
  // True when the value is subtracted from the running total rather than
  // contributing 0–100. Drives a different visual treatment.
  subtractive?: true;
};

const COMPONENT_ROWS: ComponentRow[] = [
  { key: "timeInStage", label: "Time in stage", weightLabel: "20%" },
  { key: "committeeCoverage", label: "Buying committee", weightLabel: "30%" },
  { key: "enablementDeployment", label: "Enablement deployed", weightLabel: "20%" },
  { key: "championEngagement", label: "Champion engagement", weightLabel: "20%" },
  { key: "riskPenalty", label: "Risk penalty", weightLabel: "subtracted", subtractive: true },
];

// ─── Single-opp variant ────────────────────────────────────────────────

export function SVHealthHero({
  opportunity,
  score,
}: {
  opportunity: Opportunity;
  score: SVHealthScore;
}): React.JSX.Element {
  const tier = TIER_STYLES[score.tier];
  const evidenceCount = score.evidenceSignalIds.length;

  return (
    <section
      className={cn(
        "rounded-2xl border-2 bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden",
        tier.border,
      )}
    >
      {/* Header strip */}
      <div className="px-6 pt-5 pb-4 border-b border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
          Selected Vendor Health Score
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <h2 className="text-base font-semibold tracking-tight">
            {opportunity.name}
          </h2>
          <div className="text-xs text-muted">
            {formatCurrency(opportunity.amount)} · {opportunity.stage}
          </div>
        </div>
      </div>

      {/* Score + tier */}
      <div className="px-6 py-5 flex items-center gap-6">
        <div className="flex flex-col items-center">
          <div
            className={cn(
              "w-24 h-24 rounded-2xl border-2 flex items-center justify-center",
              tier.border,
            )}
          >
            <span className={cn("text-5xl font-semibold tabular-nums leading-none", tier.text)}>
              {score.score}
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono mt-2">
            of 100
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <span
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wider border",
              tier.badge,
            )}
          >
            {tier.label}
          </span>
          <DriversList drivers={score.drivers} />
        </div>
      </div>

      {/* Components — exactly 5 rendered, even when 0 */}
      <div className="px-6 pb-5">
        <div className="text-[10px] uppercase tracking-wider text-muted font-mono mb-3">
          Components
        </div>
        <div className="space-y-2">
          {COMPONENT_ROWS.map((row) => (
            <ComponentBar
              key={row.key}
              row={row}
              value={score.components[row.key]}
              tier={tier}
            />
          ))}
        </div>
      </div>

      {/* Evidence chain footer (BUILD_ALIGNMENT principle #6) */}
      <Link
        href={`/account/${opportunity.accountId}#timeline`}
        className="block border-t border-border bg-slate-50 px-6 py-3 text-xs text-muted hover:bg-slate-100 hover:text-foreground transition-colors"
      >
        <span className="font-mono">◇</span>{" "}
        <span className="font-medium text-foreground">
          {evidenceCount} contributing signal{evidenceCount === 1 ? "" : "s"}
        </span>{" "}
        — view evidence chain →
      </Link>
    </section>
  );
}

// ─── Three-up dashboard variant ────────────────────────────────────────

export function SVHealthHeroDashboard({
  scenarios,
}: {
  scenarios: {
    label: "healthy" | "watch" | "critical";
    account: Account;
    opportunity: Opportunity;
    score: SVHealthScore;
  }[];
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Hero #0 · Selected Vendor Health
          </div>
          <h2 className="text-lg font-semibold tracking-tight mt-1">
            Three open opportunities, three different stories
          </h2>
          <p className="text-sm text-muted mt-0.5">
            Same stage. Same field set in Salesforce. The score reads the
            evidence behind it.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {scenarios.map((s) => (
          <DashboardCard
            key={s.account.id}
            account={s.account}
            opportunity={s.opportunity}
            score={s.score}
          />
        ))}
      </div>
    </section>
  );
}

function DashboardCard({
  account,
  opportunity,
  score,
}: {
  account: Account;
  opportunity: Opportunity;
  score: SVHealthScore;
}): React.JSX.Element {
  const tier = TIER_STYLES[score.tier];
  const evidenceCount = score.evidenceSignalIds.length;

  return (
    <Link
      href={`/account/${account.id}`}
      className={cn(
        "block rounded-2xl border-2 bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden",
        "hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-shadow",
        tier.border,
      )}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
          {opportunity.stage}
        </div>
        <div className="mt-0.5 text-sm font-semibold tracking-tight truncate">
          {account.name}
        </div>
        <div className="text-[11px] text-muted truncate">
          {formatCurrency(opportunity.amount)} · {opportunity.name}
        </div>
      </div>

      {/* Score + badge */}
      <div className="px-4 py-4 flex items-center gap-4">
        <div
          className={cn(
            "w-16 h-16 rounded-xl border-2 flex items-center justify-center shrink-0",
            tier.border,
          )}
        >
          <span className={cn("text-3xl font-semibold tabular-nums leading-none", tier.text)}>
            {score.score}
          </span>
        </div>
        <div className="space-y-1.5 min-w-0">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border",
              tier.badge,
            )}
          >
            {tier.label}
          </span>
          <DriversList drivers={score.drivers.slice(0, 2)} compact />
        </div>
      </div>

      {/* Mini component bars */}
      <div className="px-4 pb-3 space-y-1.5">
        {COMPONENT_ROWS.map((row) => (
          <ComponentBar
            key={row.key}
            row={row}
            value={score.components[row.key]}
            tier={tier}
            compact
          />
        ))}
      </div>

      {/* Evidence footer */}
      <div className="border-t border-border bg-slate-50 px-4 py-2 text-[11px] text-muted">
        <span className="font-mono">◇</span>{" "}
        <span className="font-medium text-foreground">
          {evidenceCount}
        </span>{" "}
        contributing signal{evidenceCount === 1 ? "" : "s"}
      </div>
    </Link>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function DriversList({
  drivers,
  compact,
}: {
  drivers: string[];
  compact?: boolean;
}): React.JSX.Element {
  if (drivers.length === 0) return <></>;
  return (
    <ul
      className={cn(
        "space-y-0.5 text-foreground",
        compact ? "text-[11px]" : "text-sm",
      )}
    >
      {drivers.map((d, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="text-muted shrink-0">·</span>
          <span className="leading-snug">{d}</span>
        </li>
      ))}
    </ul>
  );
}

function ComponentBar({
  row,
  value,
  tier,
  compact,
}: {
  row: ComponentRow;
  value: number;
  tier: TierStyle;
  compact?: boolean;
}): React.JSX.Element {
  // Subtractive component (risk penalty) gets a different render — fill
  // from the right in red, value shown as a signed integer.
  if (row.subtractive) {
    // value is 0 or -20; map to a 0-100 "penalty intensity" bar (0 = no
    // penalty, 100 = full -20 penalty applied).
    const intensity = Math.min(100, Math.abs(value) * 5);
    return (
      <div
        className={cn(
          "grid items-center gap-2",
          compact ? "grid-cols-[110px_1fr_56px] text-[10px]" : "grid-cols-[160px_1fr_72px] text-xs",
        )}
      >
        <span className="text-muted truncate">{row.label}</span>
        <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="absolute right-0 top-0 h-full bg-red-500/70 rounded-full"
            style={{ width: `${intensity}%` }}
          />
        </div>
        <span
          className={cn(
            "text-right tabular-nums font-mono",
            value < 0 ? "text-red-700 font-medium" : "text-muted",
          )}
        >
          {value === 0 ? "0" : `${value}`}
          {!compact && (
            <span className="text-muted font-normal ml-1">
              {row.weightLabel}
            </span>
          )}
        </span>
      </div>
    );
  }

  // Standard 0-100 component bar. Color follows the parent tier so the card
  // reads as one tonal block.
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "grid items-center gap-2",
        compact ? "grid-cols-[110px_1fr_56px] text-[10px]" : "grid-cols-[160px_1fr_72px] text-xs",
      )}
    >
      <span className="text-muted truncate">{row.label}</span>
      <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn("absolute left-0 top-0 h-full rounded-full", tier.bar)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-right tabular-nums font-mono text-foreground">
        {Math.round(clamped)}
        {!compact && (
          <span className="text-muted font-normal ml-1">
            {row.weightLabel}
          </span>
        )}
      </span>
    </div>
  );
}
