"use client";

import { cn } from "@/lib/utils";
import type { Stage } from "@/lib/types";
import type { DealHealth } from "@/lib/types";

// Console sidebar - primary navigation. Three views + four filter facets.
// Each filter is multi-select via toggle pills.

export type ConsoleView = "pipeline" | "today";

export interface FilterState {
  owners: string[]; // rep ids
  stages: Stage[];
  healths: DealHealth[];
  severities: ("blocking" | "action" | "awareness")[];
}

export const EMPTY_FILTERS: FilterState = {
  owners: [],
  stages: [],
  healths: [],
  severities: [],
};

export const ALL_STAGES: Stage[] = [
  "Intro",
  "Qualified",
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
];

export const ALL_HEALTHS: DealHealth[] = ["Critical", "At Risk", "Monitor", "Healthy"];

export const ALL_SEVERITIES: ("blocking" | "action" | "awareness")[] = [
  "blocking",
  "action",
];

export function Sidebar({
  view,
  filters,
  dealCount,
  openTaskCount,
  onViewChange,
  onFiltersChange,
  footer,
}: {
  view: ConsoleView;
  filters: FilterState;
  // `reps` was used by the Owner filter; the filter was removed so the prop
  // is no longer accepted. Callers may still pass it in via spread (harmless).
  dealCount: number;
  openTaskCount: number;
  onViewChange: (v: ConsoleView) => void;
  onFiltersChange: (f: FilterState) => void;
  // Optional content rendered inside the sidebar's scrollable area
  // below the filters. Used by Console's Pipeline view to embed the
  // pre-meeting brief in the same column without breaking sticky/scroll.
  footer?: React.ReactNode;
}) {
  const hasAnyFilter =
    filters.owners.length > 0 ||
    filters.stages.length > 0 ||
    filters.healths.length > 0 ||
    filters.severities.length > 0;

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-slate-50/50 sticky top-12 h-[calc(100vh-3rem)] overflow-y-auto">
      <div className="p-3 pt-6 space-y-5">
        {/* Views */}
        <div className="space-y-0.5">
          {(
            [
              ["pipeline", "Pipeline", "All deals + health"],
            ] as const
          ).map(([id, label, sub]) => (
            <button
              key={id}
              onClick={() => onViewChange(id)}
              className={cn(
                "w-full text-left px-2.5 py-1.5 rounded-md transition-colors",
                view === id
                  ? "bg-foreground/[0.06] text-foreground"
                  : "hover:bg-foreground/[0.03] text-foreground/80",
              )}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="text-[11px] text-muted leading-tight">{sub}</div>
            </button>
          ))}
        </div>

        {/* Filters moved into the table's column headers (Stage / Health
            / Severity dropdowns). Sidebar is now: tabs → pre-meeting
            brief → bottom stats. Clear-all link only renders when at
            least one filter is active. */}
        {hasAnyFilter && (
          <div className="flex items-center justify-between px-2.5">
            <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
              Active filters
            </span>
            <button
              onClick={() => onFiltersChange(EMPTY_FILTERS)}
              className="text-[10px] text-muted hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
        {footer && <div>{footer}</div>}
      </div>

      <div className="sticky bottom-0 border-t border-border bg-slate-50/95 backdrop-blur p-3 text-[11px] text-muted">
        <div>
          <span className="font-mono font-medium text-foreground">{dealCount}</span> deals
        </div>
        <div>
          <span className="font-mono font-medium text-foreground">{openTaskCount}</span> open tasks
        </div>
      </div>
    </aside>
  );
}

export function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2.5 space-y-1.5">
      <div className="text-[11px] text-muted font-medium">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function Pill({
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
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "text-[11px] px-2 py-0.5 rounded border transition-colors capitalize",
        active
          ? "border-brand bg-brand text-white"
          : "border-border bg-background text-muted hover:text-foreground hover:border-foreground/30",
      )}
    >
      {children}
    </button>
  );
}
