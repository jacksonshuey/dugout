"use client";

import { useMemo, useState } from "react";
import { BrandLogo, getBrandName, type BrandKey } from "./logos";
import {
  ACTIVE_BRANDS,
  CANONICAL_COLUMNS,
  ZIPPERED_ACCOUNTS,
  type CanonicalKey,
  type ZipperedCell,
  type ZipperedAccountRow,
} from "@/data/zippered-accounts-demo";

// Interactive object-table view of the zippered ontology. Mirrors the
// pattern of Palantir Foundry's object table: pick the integrations that
// matter, pick the columns to display, pick the accounts in scope, and
// sort by any column. Defaults to "everything visible" so the surface
// doesn't look empty on first load.
//
// State stays local — no URL persistence, no localStorage. Simple useState
// is enough for the marketing surface; if this graduates into the product
// proper we'd want shareable views.
//
// Brand filter semantics: hide cells whose contributors are entirely
// outside the visible-brand set. The value disappears, the chips disappear,
// the cell renders as "— no source from current filter". This implements
// the "what would I see if only these integrations were active" question
// honestly — it doesn't lie about provenance.

type SortDir = "asc" | "desc";
type SortKey = "name" | CanonicalKey;
interface SortState {
  key: SortKey;
  dir: SortDir;
}

export function InteractiveZipperedTable() {
  const [visibleBrands, setVisibleBrands] = useState<Set<BrandKey>>(
    () => new Set(ACTIVE_BRANDS),
  );
  const [visibleColumns, setVisibleColumns] = useState<Set<CanonicalKey>>(
    () => new Set(CANONICAL_COLUMNS.map((c) => c.key)),
  );
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(
    () => new Set(ZIPPERED_ACCOUNTS.map((a) => a.pkey)),
  );
  const [sort, setSort] = useState<SortState | null>(null);
  const [openMenu, setOpenMenu] = useState<
    "sources" | "accounts" | "columns" | null
  >(null);

  const filteredColumns = useMemo(
    () => CANONICAL_COLUMNS.filter((c) => visibleColumns.has(c.key)),
    [visibleColumns],
  );

  const filteredAccounts = useMemo(() => {
    const accts = ZIPPERED_ACCOUNTS.filter((a) => visibleAccounts.has(a.pkey));
    if (!sort) return accts;
    return [...accts].sort((a, b) => {
      const av = getSortValue(a, sort.key, visibleBrands);
      const bv = getSortValue(b, sort.key, visibleBrands);
      // Nulls sink regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [visibleAccounts, sort, visibleBrands]);

  const cycleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears
    });
  };

  const resetAll = () => {
    setVisibleBrands(new Set(ACTIVE_BRANDS));
    setVisibleColumns(new Set(CANONICAL_COLUMNS.map((c) => c.key)));
    setVisibleAccounts(new Set(ZIPPERED_ACCOUNTS.map((a) => a.pkey)));
    setSort(null);
  };

  const isFiltered =
    visibleBrands.size !== ACTIVE_BRANDS.length ||
    visibleColumns.size !== CANONICAL_COLUMNS.length ||
    visibleAccounts.size !== ZIPPERED_ACCOUNTS.length ||
    sort !== null;

  return (
    <div className="mt-14 rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-border bg-foreground/[0.02]">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
          What zippering produces · one row per account
        </div>
        <h3 className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight">
          Table View
        </h3>
      </div>

      <Toolbar
        visibleBrands={visibleBrands}
        setVisibleBrands={setVisibleBrands}
        visibleColumns={visibleColumns}
        setVisibleColumns={setVisibleColumns}
        visibleAccounts={visibleAccounts}
        setVisibleAccounts={setVisibleAccounts}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        isFiltered={isFiltered}
        onReset={resetAll}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-foreground/[0.03] border-b border-border">
            <tr>
              <SortableHeader
                label="Account"
                sortKey="name"
                sort={sort}
                onClick={() => cycleSort("name")}
                sticky
              />
              {filteredColumns.map((col) => (
                <SortableHeader
                  key={col.key}
                  label={col.label}
                  sublabel={`${col.key} · ${col.type}`}
                  sortKey={col.key}
                  sort={sort}
                  onClick={() => cycleSort(col.key)}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredAccounts.length === 0 ? (
              <tr>
                <td
                  colSpan={filteredColumns.length + 1}
                  className="px-5 sm:px-6 py-10 text-center text-sm text-muted italic"
                >
                  No accounts in current filter.
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => (
                <tr key={acc.pkey} className="hover:bg-foreground/[0.015]">
                  <th className="text-left align-top px-5 sm:px-6 py-4 font-medium sticky left-0 z-20 bg-background w-[200px] min-w-[200px] border-r border-border/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold tracking-tight">
                        {acc.name}
                      </span>
                      <HealthDot health={acc.health} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted font-mono">
                      {acc.pkey}
                    </div>
                    <div className="mt-0.5 text-[11px] text-foreground/55">
                      {acc.industry}
                    </div>
                  </th>
                  {filteredColumns.map((col) => (
                    <td key={col.key} className="align-top px-4 py-4">
                      <ZipperedCellView
                        cell={acc.cells[col.key]}
                        visibleBrands={visibleBrands}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 sm:px-6 py-3 border-t border-border bg-foreground/[0.03] text-[10px] uppercase tracking-[0.2em] font-mono text-muted flex items-baseline justify-between gap-3 flex-wrap">
        <span>
          {filteredAccounts.length} of {ZIPPERED_ACCOUNTS.length} accounts ·{" "}
          {filteredColumns.length} of {CANONICAL_COLUMNS.length} columns ·{" "}
          {visibleBrands.size} of {ACTIVE_BRANDS.length} sources
        </span>
        <span>brand chips show provenance per cell</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar — three compact dropdowns (Sources, Accounts, Columns) in one row
// plus a Reset button. Only one menu is open at a time so the layout stays
// tight even when a filter panel is expanded.
// ---------------------------------------------------------------------------

type MenuKey = "sources" | "accounts" | "columns" | null;

function Toolbar({
  visibleBrands,
  setVisibleBrands,
  visibleColumns,
  setVisibleColumns,
  visibleAccounts,
  setVisibleAccounts,
  openMenu,
  setOpenMenu,
  isFiltered,
  onReset,
}: {
  visibleBrands: Set<BrandKey>;
  setVisibleBrands: (s: Set<BrandKey>) => void;
  visibleColumns: Set<CanonicalKey>;
  setVisibleColumns: (s: Set<CanonicalKey>) => void;
  visibleAccounts: Set<string>;
  setVisibleAccounts: (s: Set<string>) => void;
  openMenu: MenuKey;
  setOpenMenu: (k: MenuKey) => void;
  isFiltered: boolean;
  onReset: () => void;
}) {
  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  const click = (k: Exclude<MenuKey, null>) =>
    setOpenMenu(openMenu === k ? null : k);

  return (
    <div className="border-b border-border bg-foreground/[0.015] px-5 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
      <FilterDropdown
        label="Sources"
        count={visibleBrands.size}
        total={ACTIVE_BRANDS.length}
        open={openMenu === "sources"}
        onToggle={() => click("sources")}
      >
        {ACTIVE_BRANDS.map((b) => {
          const on = visibleBrands.has(b);
          return (
            <label
              key={b}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-foreground/[0.04] cursor-pointer text-[12px]"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => setVisibleBrands(toggle(visibleBrands, b))}
              />
              <BrandLogo brand={b} size={14} />
              <span className="flex-1">{getBrandName(b)}</span>
            </label>
          );
        })}
      </FilterDropdown>

      <FilterDropdown
        label="Accounts"
        count={visibleAccounts.size}
        total={ZIPPERED_ACCOUNTS.length}
        open={openMenu === "accounts"}
        onToggle={() => click("accounts")}
      >
        {ZIPPERED_ACCOUNTS.map((a) => {
          const on = visibleAccounts.has(a.pkey);
          return (
            <label
              key={a.pkey}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-foreground/[0.04] cursor-pointer text-[12px]"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setVisibleAccounts(toggle(visibleAccounts, a.pkey))
                }
              />
              <HealthDot health={a.health} />
              <span className="flex-1">{a.name}</span>
              <span className="text-[10px] font-mono text-muted">
                {a.pkey}
              </span>
            </label>
          );
        })}
      </FilterDropdown>

      <FilterDropdown
        label="Columns"
        count={visibleColumns.size}
        total={CANONICAL_COLUMNS.length}
        open={openMenu === "columns"}
        onToggle={() => click("columns")}
      >
        {CANONICAL_COLUMNS.map((c) => {
          const on = visibleColumns.has(c.key);
          return (
            <label
              key={c.key}
              className="flex items-baseline gap-2 px-2 py-1.5 rounded hover:bg-foreground/[0.04] cursor-pointer text-[12px]"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setVisibleColumns(toggle(visibleColumns, c.key))
                }
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="font-medium">{c.label}</span>
                <span className="ml-2 text-[10px] font-mono text-muted">
                  {c.type}
                </span>
              </span>
            </label>
          );
        })}
      </FilterDropdown>

      {isFiltered && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto text-[11px] uppercase tracking-[0.15em] font-mono text-brand hover:underline"
        >
          Reset view
        </button>
      )}
    </div>
  );
}

function FilterDropdown({
  label,
  count,
  total,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const filtered = count < total;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[12px] font-medium transition-colors " +
          (filtered
            ? "border-brand/40 bg-brand/[0.06] text-foreground"
            : "border-border bg-background hover:border-foreground/30")
        }
        aria-expanded={open}
      >
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          {label}
        </span>
        <span>
          {count} / {total}
        </span>
        <span aria-hidden className="text-muted text-[10px]">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 w-72 max-h-80 overflow-y-auto rounded-md border border-border bg-background shadow-lg p-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header — click to cycle asc / desc / clear.
// ---------------------------------------------------------------------------

function SortableHeader({
  label,
  sublabel,
  sortKey,
  sort,
  onClick,
  sticky = false,
}: {
  label: string;
  sublabel?: string;
  sortKey: SortKey;
  sort: SortState | null;
  onClick: () => void;
  sticky?: boolean;
}) {
  const active = sort?.key === sortKey;
  const arrow = active ? (sort?.dir === "asc" ? "▲" : "▼") : "";
  const base =
    "text-left py-3 text-[10px] uppercase tracking-[0.2em] font-mono text-muted font-medium";
  const stickyCls = sticky
    ? "sticky left-0 z-20 bg-background w-[200px] min-w-[200px] px-5 sm:px-6 border-r border-border/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
    : "px-4 min-w-[160px]";
  return (
    <th className={`${base} ${stickyCls}`}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-baseline gap-1.5 group text-left"
      >
        <span className={active ? "text-foreground" : "group-hover:text-foreground transition-colors"}>
          {label}
        </span>
        <span
          aria-hidden
          className={
            active ? "text-brand text-[10px]" : "text-muted/40 text-[10px]"
          }
        >
          {arrow || "↕"}
        </span>
      </button>
      {sublabel && (
        <div className="text-[9px] text-muted/70 normal-case tracking-[0.1em] mt-0.5">
          {sublabel}
        </div>
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Cell — value + contributor chips. Filters chips by visibleBrands and
// hides value if no remaining contributor.
// ---------------------------------------------------------------------------

function ZipperedCellView({
  cell,
  visibleBrands,
}: {
  cell: ZipperedCell;
  visibleBrands: Set<BrandKey>;
}) {
  const visibleContributors = cell.contributors.filter((b) =>
    visibleBrands.has(b),
  );
  const hasValue = cell.value !== null && visibleContributors.length > 0;
  if (!hasValue) {
    if (cell.value === null) {
      return (
        <div className="text-muted/50 text-[13px] italic">no source yet</div>
      );
    }
    return (
      <div className="text-muted/50 text-[13px] italic">
        hidden by source filter
      </div>
    );
  }
  return (
    <div>
      <div className="text-[13px] text-foreground leading-snug">
        {cell.value}
      </div>
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {visibleContributors.map((b) => (
          <BrandChipWithTooltip key={b} brand={b} />
        ))}
        {visibleContributors.length > 1 && (
          <span className="ml-1 text-[9px] uppercase tracking-[0.15em] font-mono text-severity-green">
            joined
          </span>
        )}
      </div>
    </div>
  );
}

function HealthDot({
  health,
}: {
  health: "healthy" | "watch" | "critical" | "neutral";
}) {
  const cls = {
    healthy: "bg-severity-green",
    watch: "bg-amber-500",
    critical: "bg-red-500",
    neutral: "bg-foreground/30",
  }[health];
  return (
    <span
      aria-hidden
      className={`inline-block w-2 h-2 rounded-full ${cls}`}
      title={health}
    />
  );
}

// ---------------------------------------------------------------------------
// Brand chip with hover tooltip — shows the brand name above the logo on
// hover. Each chip is its own group so hovering one doesn't trigger others.
// ---------------------------------------------------------------------------

function BrandChipWithTooltip({ brand }: { brand: BrandKey }) {
  return (
    <span className="relative inline-flex items-center group/chip">
      <BrandLogo brand={brand} size={14} />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded bg-foreground text-background text-[10px] font-mono whitespace-nowrap opacity-0 group-hover/chip:opacity-100 transition-opacity duration-150 z-20 shadow-md"
      >
        {getBrandName(brand)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sort accessors — return comparable values per canonical type.
// Numbers come back as numbers; everything else as a normalized string.
// Null for empty / filter-hidden cells so they can sink to the bottom.
// ---------------------------------------------------------------------------

function getSortValue(
  acc: ZipperedAccountRow,
  key: SortKey,
  visibleBrands: Set<BrandKey>,
): string | number | null {
  if (key === "name") return acc.name.toLowerCase();
  const cell = acc.cells[key];
  const visibleContrib = cell.contributors.filter((b) => visibleBrands.has(b));
  if (cell.value === null || visibleContrib.length === 0) return null;
  const col = CANONICAL_COLUMNS.find((c) => c.key === key);
  if (!col) return cell.value.toLowerCase();
  if (col.type === "currency") {
    const n = parseFloat(cell.value.replace(/[^0-9.-]/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  if (col.type === "integer") {
    const n = parseInt(cell.value, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (col.type === "timestamp") {
    const t = Date.parse(cell.value);
    return Number.isNaN(t) ? null : t;
  }
  return cell.value.toLowerCase();
}
