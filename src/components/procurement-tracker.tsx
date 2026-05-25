"use client";

// Selected Vendor Procurement Tracker — the per-opp surface that makes the
// buying-committee gap visible at a glance. This is Hero Surface #2 per
// `orgs/_default/discovery/information-requirements.md`, drill-down view of
// the `committeeCoverage` component scored in `src/lib/sv-health.ts`.
//
// Design rules (per BUILD_ALIGNMENT.md):
//   - Pure presentation. No fetch, no Supabase — parent passes data.
//   - Evidence chain mandatory (#6): every cell + claim cites the signal(s)
//     or asset-state that justify it. The footer surfaces the
//     `committee_gap` signals + their `sourceTool` / `sourceEventId` so an AE
//     can drill "the system says X" → "here are the 3 tools that observed X."
//   - Voice plain (#8): cell labels are `viewed` / `sent, not viewed` /
//     `not sent`. No emojis, no marketing copy.
//   - Signal types (#2): only `committee_gap` (and `committee_expansion` for
//     positive case) referenced. No invented types.
//   - Role enum (synthesis.md §4.6): canonical slot names internally
//     (`champion`, `economic_buyer`, `finance`, `legal`, `it_security`,
//     `procurement`). Display labels are friendlier ("Economic Buyer").

import { useState } from "react";
import type { Contact, Opportunity } from "@/lib/types";
import type { UnifiedSignal } from "@/lib/unify-signals";
import { cn, daysBetween, formatDate } from "@/lib/utils";

// ─── Role + asset shape ────────────────────────────────────────────────

type RoleSlot =
  | "champion"
  | "economic_buyer"
  | "finance"
  | "legal"
  | "it_security"
  | "procurement";

const ROLE_ROWS: { slot: RoleSlot; label: string }[] = [
  { slot: "champion", label: "Champion" },
  { slot: "economic_buyer", label: "Economic Buyer" },
  { slot: "finance", label: "Finance" },
  { slot: "legal", label: "Legal" },
  { slot: "it_security", label: "IT / Security" },
  { slot: "procurement", label: "Procurement" },
];

// The 3 Priority #2 enablement assets per metrics.md §"Enablement-asset
// deployment score". Column order matches metrics.md so this tracker reads
// in the same sequence as the SV Health Score breakdown.
type AssetCol = "cfoLeaveBehind" | "itZeroLift" | "financeBrief";

const ASSET_COLS: { id: AssetCol; label: string }[] = [
  { id: "cfoLeaveBehind", label: "CFO Leave-Behind" },
  { id: "itZeroLift", label: "IT Zero Lift" },
  { id: "financeBrief", label: "Finance Brief" },
];

// Which roles actually need to view each asset. Roles outside the relevance
// set render as `—` (N/A) rather than `not sent` — Finance not viewing the
// IT Zero Lift isn't a gap; it's not their asset.
const ROLE_ASSET_RELEVANCE: Record<AssetCol, RoleSlot[]> = {
  cfoLeaveBehind: ["champion", "economic_buyer", "finance"],
  itZeroLift: ["champion", "it_security"],
  financeBrief: ["champion", "economic_buyer", "finance"],
};

// Stage benchmark per metrics.md §"Time-in-stage score" (SV_STAGE_AGE_P75_DAYS).
const STAGE_BENCHMARK_DAYS = 30;

// ─── Contacts shape ────────────────────────────────────────────────────
//
// Matches the `/api/account-context` response (see ContactsByRole in
// unify-signals.ts). The route returns Contact[] under canonical role keys;
// we read by the same key here so the wiring is a pass-through.

function pickContact(
  contactsByRole: Record<string, Contact[]>,
  slot: RoleSlot,
): Contact | null {
  const list = contactsByRole[slot];
  if (!list || list.length === 0) return null;
  // Pick the first non-departed contact, else the first contact at all.
  const active = list.find((c) => c.status !== "departed");
  return active ?? list[0] ?? null;
}

// ─── Cell state ────────────────────────────────────────────────────────
//
// Four states per cell, per spec:
//   - `viewed`        — asset shared AND viewed (green check)
//   - `sent_unviewed` — asset shared but not viewed (amber)
//   - `not_sent`      — asset not shared (red ✗)
//   - `na`            — role doesn't need to view this asset (em-dash)
//
// The shared/viewed booleans live on opportunity.assetsShared (per
// OpportunityAssetsShared in types.ts). View-state is per-asset today, not
// per-contact — when Dock is wired the contact-level view ledger becomes
// available and we'll color cells per (role, asset) rather than per-asset.

type CellState = "viewed" | "sent_unviewed" | "not_sent" | "na";

function cellStateFor(
  assets: Opportunity["assetsShared"],
  asset: AssetCol,
  role: RoleSlot,
): CellState {
  if (!ROLE_ASSET_RELEVANCE[asset].includes(role)) return "na";
  const shared = assets?.[asset] === true;
  if (!shared) return "not_sent";
  const viewedKey = `${asset}Viewed` as keyof NonNullable<
    Opportunity["assetsShared"]
  >;
  const viewed = assets?.[viewedKey] === true;
  return viewed ? "viewed" : "sent_unviewed";
}

// ─── Component ─────────────────────────────────────────────────────────

export function ProcurementTracker({
  opportunity,
  contactsByRole,
  signals,
}: {
  opportunity: Opportunity;
  contactsByRole: Record<string, Contact[]>;
  signals: UnifiedSignal[];
}): React.ReactElement {
  // Day counter. enteredStageAt is required on Opportunity; daysBetween
  // returns a number (Math.floor on Invalid Date → NaN, guarded below).
  const daysInStage = daysBetween(opportunity.enteredStageAt);
  const safeDays = Number.isFinite(daysInStage) && daysInStage >= 0
    ? daysInStage
    : 0;
  const pastBenchmark = safeDays > STAGE_BENCHMARK_DAYS;

  // Engagement counts for the matrix summary line. A role is "engaged" if a
  // contact exists in that slot AND at least one relevant asset has been
  // viewed by anyone. Per v1: view-state is per-asset not per-contact, so
  // "engaged" means present + some asset coverage exists for their slot.
  // When per-contact view ledgers land (Dock wired), tighten to per-cell.
  const presentRoles = ROLE_ROWS.filter(
    (r) => pickContact(contactsByRole, r.slot) !== null,
  );
  const missingRoleCount = ROLE_ROWS.length - presentRoles.length;

  // Asset gaps — assets relevant to at least one role on the deal that are
  // either not sent or sent-unviewed. This is the "2 critical assets
  // unviewed by buyer" claim in the footer.
  const assetGaps = ASSET_COLS.filter((a) => {
    const shared = opportunity.assetsShared?.[a.id] === true;
    const viewedKey = `${a.id}Viewed` as keyof NonNullable<
      Opportunity["assetsShared"]
    >;
    const viewed = opportunity.assetsShared?.[viewedKey] === true;
    return !shared || !viewed;
  });

  // Contributing signals — committee_gap is the canonical type per
  // synthesis.md §1 for "buying-committee member absent from deal." We also
  // accept committee_expansion as the positive corroboration (a new member
  // surfaced) so the footer reflects both observations.
  const contributingSignals = signals.filter(
    (s) =>
      s.signalType === "committee_gap" ||
      s.signalType === "committee_expansion",
  );

  // Distinct source tools that observed a committee_gap (the negative case
  // — that's what the footer claim text "N contributing signals" refers to).
  const gapSignals = contributingSignals.filter(
    (s) => s.signalType === "committee_gap",
  );
  const gapSourceTools = Array.from(
    new Set(gapSignals.map((s) => s.sourceTool)),
  ).sort();

  return (
    <div className="rounded-2xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold tracking-tight">
            Selected Vendor — Procurement Tracker
          </h3>
          <span
            className={cn(
              "text-xs font-mono",
              pastBenchmark
                ? "text-severity-action"
                : "text-muted",
            )}
          >
            Day {safeDays} of {STAGE_BENCHMARK_DAYS}-day benchmark
            {pastBenchmark && " (past benchmark)"}
          </span>
        </div>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted">
              <th
                scope="col"
                className="text-left font-semibold px-4 py-2 border-b border-border"
              >
                Role
              </th>
              <th
                scope="col"
                className="text-left font-semibold px-3 py-2 border-b border-border"
              >
                Person
              </th>
              <th
                scope="col"
                className="text-left font-semibold px-3 py-2 border-b border-border"
              >
                Last touch
              </th>
              {ASSET_COLS.map((a) => (
                <th
                  key={a.id}
                  scope="col"
                  className="text-left font-semibold px-3 py-2 border-b border-border whitespace-nowrap"
                >
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ROWS.map((row) => {
              const contact = pickContact(contactsByRole, row.slot);
              const isMissing = contact === null;
              return (
                <tr
                  key={row.slot}
                  className="border-b border-border last:border-0 hover:bg-slate-50/50"
                >
                  <td className="px-4 py-2.5 align-top font-medium text-foreground">
                    {row.label}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {isMissing ? (
                      <span className="text-severity-blocking text-xs italic">
                        (missing)
                      </span>
                    ) : (
                      <div className="text-xs">
                        <div className="text-foreground">{contact.name}</div>
                        <div className="text-muted">{contact.title}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-xs text-muted">
                    {/* Last-touch column. v1 has no per-contact touch ledger
                        (Dock visit + Gong attendance + Outreach reply when
                        wired), so we show a placeholder em-dash for missing
                        contacts and "—" for present ones too. When the
                        ledger is wired this column reads from there. */}
                    —
                  </td>
                  {ASSET_COLS.map((a) => {
                    const state = cellStateFor(
                      opportunity.assetsShared,
                      a.id,
                      row.slot,
                    );
                    return (
                      <td
                        key={a.id}
                        className="px-3 py-2.5 align-top whitespace-nowrap"
                      >
                        <CellBadge
                          state={state}
                          asset={a.label}
                          role={row.label}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — summary claim + contributing signals (the evidence chain
          load-bearing piece per BUILD_ALIGNMENT principle #6) */}
      <div className="px-5 py-4 border-t border-border space-y-3">
        <div className="text-sm text-foreground">
          {missingRoleCount === 0
            ? "All 6 required roles engaged."
            : `${missingRoleCount} of ${ROLE_ROWS.length} required roles unengaged.`}
          {assetGaps.length > 0 && (
            <>
              {" "}
              {assetGaps.length} of {ASSET_COLS.length} assets unviewed by
              buyer.
            </>
          )}
        </div>
        <ContributingSignals
          gapSignals={gapSignals}
          sourceTools={gapSourceTools}
        />
      </div>
    </div>
  );
}

// ─── Cell badge ────────────────────────────────────────────────────────

function CellBadge({
  state,
  asset,
  role,
}: {
  state: CellState;
  asset: string;
  role: string;
}) {
  if (state === "na") {
    return (
      <span
        className="text-muted"
        title={`${asset} not required for ${role}`}
        aria-label={`${asset} not applicable for ${role}`}
      >
        —
      </span>
    );
  }
  if (state === "viewed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-severity-green text-xs font-medium"
        title={`${asset} viewed by ${role}`}
      >
        <span aria-hidden>✓</span>
        viewed
      </span>
    );
  }
  if (state === "sent_unviewed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-severity-action text-xs font-medium"
        title={`${asset} sent but not opened by ${role}`}
      >
        sent, not viewed
      </span>
    );
  }
  // not_sent
  return (
    <span
      className="inline-flex items-center gap-1 text-severity-blocking text-xs font-medium"
      title={`${asset} never sent to ${role}`}
    >
      <span aria-hidden>✗</span>
      not sent
    </span>
  );
}

// ─── Contributing signals (evidence chain) ─────────────────────────────
//
// Lists `committee_gap` signals grouped by sourceTool. Each tool name is a
// button that expands an inline panel showing the per-signal evidence —
// sourceEventId + occurredAt + summary. This is how an AE answers "the
// system says Finance hasn't engaged — what's the proof?"

function ContributingSignals({
  gapSignals,
  sourceTools,
}: {
  gapSignals: UnifiedSignal[];
  sourceTools: string[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (gapSignals.length === 0) {
    return (
      <div className="text-xs text-muted italic">
        No contributing committee-gap signals on file for this account.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">
        {gapSignals.length} contributing signal
        {gapSignals.length === 1 ? "" : "s"} across{" "}
        {sourceTools.length} source
        {sourceTools.length === 1 ? "" : "s"}:
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sourceTools.map((tool) => {
          const toolSignals = gapSignals.filter((s) => s.sourceTool === tool);
          const isOpen = expanded === tool;
          return (
            <button
              key={tool}
              type="button"
              onClick={() => setExpanded(isOpen ? null : tool)}
              aria-expanded={isOpen}
              className={cn(
                "text-[11px] font-mono px-2 py-0.5 rounded border transition-colors",
                isOpen
                  ? "bg-severity-action-bg text-severity-action border-severity-action/30"
                  : "bg-slate-50 text-muted border-border hover:text-foreground",
              )}
              title={`${toolSignals.length} signal${
                toolSignals.length === 1 ? "" : "s"
              } from ${tool}`}
            >
              {tool} ({toolSignals.length})
            </button>
          );
        })}
      </div>
      {expanded && (
        <div className="rounded-md border border-border bg-slate-50/40 p-2.5 space-y-1.5">
          {gapSignals
            .filter((s) => s.sourceTool === expanded)
            .map((s) => (
              <div key={s.id} className="text-xs space-y-0.5">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-muted truncate max-w-[60%]">
                    {s.sourceEventId ?? s.id}
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {formatDate(s.occurredAt)}
                  </span>
                </div>
                <div className="text-foreground">{s.summary}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
