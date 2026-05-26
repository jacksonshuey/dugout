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

const ALL_STAGES: Stage[] = [
  "Intro",
  "Qualified",
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
];

const ALL_HEALTHS: DealHealth[] = ["Critical", "At Risk", "Monitor", "Healthy"];

const ALL_SEVERITIES: ("blocking" | "action" | "awareness")[] = [
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
}: {
  view: ConsoleView;
  filters: FilterState;
  // `reps` was used by the Owner filter; the filter was removed so the prop
  // is no longer accepted. Callers may still pass it in via spread (harmless).
  dealCount: number;
  openTaskCount: number;
  onViewChange: (v: ConsoleView) => void;
  onFiltersChange: (f: FilterState) => void;
}) {
  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

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
              ["today", "Actions", "Open tasks, by severity"],
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

        {/* Filters */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2.5">
            <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
              Filters
            </span>
            {hasAnyFilter && (
              <button
                onClick={() => onFiltersChange(EMPTY_FILTERS)}
                className="text-[10px] text-muted hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          <FilterGroup label="Stage">
            {ALL_STAGES.map((s) => (
              <Pill
                key={s}
                active={filters.stages.includes(s)}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    stages: toggle(filters.stages, s),
                  })
                }
              >
                {s}
              </Pill>
            ))}
          </FilterGroup>

          <FilterGroup label="Health">
            {ALL_HEALTHS.map((h) => (
              <Pill
                key={h}
                active={filters.healths.includes(h)}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    healths: toggle(filters.healths, h),
                  })
                }
              >
                {h}
              </Pill>
            ))}
          </FilterGroup>

          <FilterGroup label="Severity">
            {ALL_SEVERITIES.map((s) => (
              <Pill
                key={s}
                active={filters.severities.includes(s)}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    severities: toggle(filters.severities, s),
                  })
                }
              >
                {s}
              </Pill>
            ))}
          </FilterGroup>
        </div>
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

function FilterGroup({
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

function Pill({
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
