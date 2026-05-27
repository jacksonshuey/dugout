"use client";

// Generic table renderer for any canonical object. Reads the row set
// from CANONICAL_ROWS and the field schema from CANONICAL_OBJECTS, so a
// single component covers Account, Contact, Deal, Meeting, Email, Call,
// Sequence, Filing, NewsArticle, SupportTicket, Invoice, User, Activity.
//
// Designed to render inside a workspace panel that's potentially as
// narrow as 1/8 of the screen, so the column list is configurable and
// values truncate aggressively.

import { useMemo, useState } from "react";
import {
  getCanonicalObject,
  type CanonicalField,
  type CanonicalObject,
} from "@/data/canonical-objects";
import { CANONICAL_ROWS, type CanonicalRow } from "@/data/canonical-rows";

const SOURCE_COLORS: Record<string, string> = {
  Salesforce: "#00A1E0",
  HubSpot: "#FF7A59",
  Outreach: "#F97316",
  Gong: "#7C3AED",
  Nooks: "#6D28D9",
  "Chili Piper": "#EF4444",
  "Swyft AI": "#10B981",
  Apollo: "#0F766E",
  ZoomInfo: "#2A2A6B",
  Dock: "#18181B",
  Zendesk: "#03363D",
  Xero: "#13B5EA",
  Webflow: "#4353FF",
  "SEC EDGAR": "#475569",
  NewsAPI: "#DC2626",
};

export function CanonicalTable({
  canonicalKey,
  selectedColumnKeys,
  onColumnsChange,
}: {
  canonicalKey: string;
  // The columns currently rendered. If null, default to first 6 fields.
  selectedColumnKeys: readonly string[] | null;
  onColumnsChange: (next: readonly string[]) => void;
}) {
  const obj = getCanonicalObject(canonicalKey);
  const rows = CANONICAL_ROWS[canonicalKey] ?? [];

  const visibleColumns = useMemo<readonly CanonicalField[]>(() => {
    if (!obj) return [];
    if (selectedColumnKeys && selectedColumnKeys.length > 0) {
      const map = new Map(obj.fields.map((f) => [f.key, f]));
      return selectedColumnKeys
        .map((k) => map.get(k))
        .filter((f): f is CanonicalField => Boolean(f));
    }
    // Default: source provenance + first 5 informative fields. Skip pure FK
    // fields when defaulting (id, *_id) since they're rarely the most useful
    // glance.
    return obj.fields
      .filter((f) => f.key !== "id" && !f.key.endsWith("_id"))
      .slice(0, 5);
  }, [obj, selectedColumnKeys]);

  if (!obj) {
    return (
      <div className="p-6 text-sm text-muted">
        No canonical object named {canonicalKey}.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelToolbar
        obj={obj}
        selectedColumnKeys={selectedColumnKeys}
        visibleColumns={visibleColumns}
        rowCount={rows.length}
        onColumnsChange={onColumnsChange}
      />
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-xs text-muted">
            No sample rows for {obj.label} yet.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-foreground/[0.03] text-[10px] uppercase tracking-wider text-muted font-semibold sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 w-[120px]">Sources</th>
                {visibleColumns.map((f) => (
                  <th key={f.key} className="text-left px-3 py-2 font-mono">
                    {f.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.__id} className="hover:bg-foreground/[0.02]">
                  <td className="px-3 py-2 align-top">
                    <SourceChips sources={r.__sources} />
                  </td>
                  {visibleColumns.map((f) => (
                    <td key={f.key} className="px-3 py-2 align-top">
                      <CellValue value={r[f.key]} field={f} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PanelToolbar({
  obj,
  selectedColumnKeys,
  visibleColumns,
  rowCount,
  onColumnsChange,
}: {
  obj: CanonicalObject;
  selectedColumnKeys: readonly string[] | null;
  visibleColumns: readonly CanonicalField[];
  rowCount: number;
  onColumnsChange: (next: readonly string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="border-b border-border bg-background flex items-center justify-between gap-2 px-3 py-2 shrink-0">
      <div className="min-w-0">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted">
          {rowCount} row{rowCount === 1 ? "" : "s"} · {visibleColumns.length}{" "}
          col{visibleColumns.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((p) => !p)}
          className="text-[11px] px-2 py-1 rounded border border-border hover:border-brand hover:text-brand transition-colors font-mono"
          aria-expanded={pickerOpen}
        >
          Columns ▾
        </button>
        {pickerOpen && (
          <ColumnPicker
            obj={obj}
            selectedColumnKeys={selectedColumnKeys ?? visibleColumns.map((f) => f.key)}
            onClose={() => setPickerOpen(false)}
            onColumnsChange={onColumnsChange}
          />
        )}
      </div>
    </div>
  );
}

function ColumnPicker({
  obj,
  selectedColumnKeys,
  onClose,
  onColumnsChange,
}: {
  obj: CanonicalObject;
  selectedColumnKeys: readonly string[];
  onClose: () => void;
  onColumnsChange: (next: readonly string[]) => void;
}) {
  const selectedSet = new Set(selectedColumnKeys);
  function toggle(key: string) {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Preserve obj.fields order in output
    onColumnsChange(obj.fields.map((f) => f.key).filter((k) => next.has(k)));
  }
  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden
      />
      <div className="absolute right-0 mt-1 w-64 max-h-72 overflow-auto bg-background border border-border rounded-md shadow-lg z-40">
        <div className="px-3 py-2 border-b border-border text-[10px] font-mono uppercase tracking-[0.15em] text-muted">
          {obj.label} fields
        </div>
        <ul>
          {obj.fields.map((f) => {
            const on = selectedSet.has(f.key);
            return (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => toggle(f.key)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-foreground/[0.04] text-left"
                >
                  <span
                    aria-hidden
                    className={
                      "w-3 h-3 rounded-sm border " +
                      (on
                        ? "border-brand bg-brand"
                        : "border-border bg-background")
                    }
                  >
                    {on && (
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        className="w-3 h-3"
                      >
                        <path d="M2 6 L5 9 L10 3" />
                      </svg>
                    )}
                  </span>
                  <span className="font-mono">{f.key}</span>
                  <span className="ml-auto text-[10px] text-muted">
                    {f.type}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

function SourceChips({ sources }: { sources: readonly string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {sources.map((src) => {
        const color = SOURCE_COLORS[src] ?? "#6B7280";
        return (
          <span
            key={src}
            title={src}
            className="inline-block w-3 h-3 rounded-full border border-background"
            style={{ background: color }}
          />
        );
      })}
    </div>
  );
}

function CellValue({
  value,
  field,
}: {
  value: unknown;
  field: CanonicalField;
}) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted italic text-[10px]">—</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span
        className={
          value ? "text-severity-action" : "text-muted"
        }
      >
        {value ? "true" : "false"}
      </span>
    );
  }
  if (field.type === "float" && field.unit === "USD") {
    const n = Number(value);
    return <span className="font-mono">${n.toLocaleString()}</span>;
  }
  if (field.type === "int" && field.unit === "USD") {
    const n = Number(value);
    return <span className="font-mono">${n.toLocaleString()}</span>;
  }
  if (field.type === "int" || field.type === "float") {
    return <span className="font-mono">{String(value)}</span>;
  }
  if (field.type === "date") {
    const s = String(value);
    return <span className="font-mono">{s.slice(0, 10)}</span>;
  }
  if (field.type === "enum") {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.05em] px-1.5 py-0.5 rounded bg-foreground/[0.04] border border-border">
        {String(value)}
      </span>
    );
  }
  return (
    <span className="truncate max-w-[220px] inline-block">
      {String(value)}
    </span>
  );
}
