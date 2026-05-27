"use client";

import { useMemo, useState } from "react";
import {
  CANONICAL_OBJECTS,
  getCanonicalObject,
  type CanonicalField,
} from "@/data/canonical-objects";
import {
  getUniqueSources,
  totalRawFieldCount,
  type RawObject,
} from "@/data/raw-fields";
import {
  FIELD_MAPPINGS,
  contributorsFor,
  joinPointFields,
  rawFieldsContributingTo,
  sourceContributionCounts,
  totalMappingCount,
  unmappedRawFields,
} from "@/data/object-mappings";

// Object-oriented zipper visualization. Two modes:
//
// 1. Overview: source systems (left) -> canonical objects (right). Edge
//    weight = number of raw fields contributing. Click an object to
//    drill in.
//
// 2. Drill-in: pick a canonical object. Three-column SVG: contributing
//    sources -> raw fields (grouped by source.object) -> canonical
//    fields. Join-point canonical fields (multiple raw contributors)
//    highlighted in the brand color.

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

function colorForSource(source: string): string {
  return SOURCE_COLORS[source] ?? "#6B7280";
}

type Mode = "overview" | "drilldown";

export function ConnectivityGraph() {
  const [mode, setMode] = useState<Mode>("overview");
  const [selectedObject, setSelectedObject] = useState<string>(
    CANONICAL_OBJECTS[0]?.key ?? "Account",
  );

  function openDrilldown(canonicalKey: string) {
    setSelectedObject(canonicalKey);
    setMode("drilldown");
  }

  return (
    <div className="space-y-4">
      <Header
        mode={mode}
        onModeChange={setMode}
        selectedObject={selectedObject}
        onSelectedObjectChange={setSelectedObject}
      />
      {mode === "overview" ? (
        <OverviewGraph onSelectObject={openDrilldown} />
      ) : (
        <DrilldownGraph canonicalKey={selectedObject} />
      )}
      <StatsStrip mode={mode} canonicalKey={selectedObject} />
    </div>
  );
}

function Header({
  mode,
  onModeChange,
  selectedObject,
  onSelectedObjectChange,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  selectedObject: string;
  onSelectedObjectChange: (k: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div
        role="tablist"
        aria-label="Graph mode"
        className="inline-flex items-center rounded-lg border border-border overflow-hidden text-sm"
      >
        <ModeButton
          active={mode === "overview"}
          onClick={() => onModeChange("overview")}
          label="Overview"
        />
        <ModeButton
          active={mode === "drilldown"}
          onClick={() => onModeChange("drilldown")}
          label="Drill-in"
        />
      </div>
      {mode === "drilldown" && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>Object:</span>
          <select
            value={selectedObject}
            onChange={(e) => onSelectedObjectChange(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {CANONICAL_OBJECTS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        "px-3 py-1.5 transition-colors " +
        (active
          ? "bg-brand text-white"
          : "bg-background text-muted hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

// ── Overview graph ────────────────────────────────────────────────

interface OverviewEdge {
  source: string;
  canonical: string;
  weight: number;
}

function OverviewGraph({
  onSelectObject,
}: {
  onSelectObject: (canonicalKey: string) => void;
}) {
  const sources = useMemo(() => getUniqueSources(), []);
  const sourceCounts = useMemo(() => sourceContributionCounts(), []);

  const edges = useMemo<OverviewEdge[]>(() => {
    const map = new Map<string, number>();
    for (const [src, , , co] of FIELD_MAPPINGS) {
      const k = `${src}::${co}`;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const out: OverviewEdge[] = [];
    for (const [k, weight] of map) {
      const [src, can] = k.split("::");
      out.push({ source: src, canonical: can, weight });
    }
    return out;
  }, []);

  const [hover, setHover] = useState<
    { kind: "source" | "canonical"; key: string } | null
  >(null);

  // Layout: two columns
  const PADDING = 24;
  const COL_W = 200;
  const NODE_H = 48;
  const NODE_GAP = 12;
  const COL_GAP = 360;
  const SRC_X = 24;
  const CAN_X = SRC_X + COL_W + COL_GAP;
  const WIDTH = CAN_X + COL_W + 24;

  const sourceRows = sources.map((s, i) => ({
    source: s,
    y: PADDING + i * (NODE_H + NODE_GAP),
  }));
  const canonicalRows = CANONICAL_OBJECTS.map((o, i) => ({
    obj: o,
    y: PADDING + i * (NODE_H + NODE_GAP),
  }));

  const maxRows = Math.max(sourceRows.length, canonicalRows.length);
  const HEIGHT = PADDING * 2 + maxRows * (NODE_H + NODE_GAP) - NODE_GAP;

  const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

  function edgeActive(srcKey: string, canKey: string): boolean {
    if (!hover) return true;
    if (hover.kind === "source") return hover.key === srcKey;
    return hover.key === canKey;
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-foreground/[0.02] p-2">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block"
        style={{ minWidth: WIDTH }}
      >
        {/* Edges */}
        {edges.map((e, i) => {
          const src = sourceRows.find((r) => r.source === e.source);
          const can = canonicalRows.find((r) => r.obj.key === e.canonical);
          if (!src || !can) return null;
          const startX = SRC_X + COL_W;
          const startY = src.y + NODE_H / 2;
          const endX = CAN_X;
          const endY = can.y + NODE_H / 2;
          const midX = (startX + endX) / 2;
          const color = colorForSource(e.source);
          const active = edgeActive(e.source, e.canonical);
          const strokeWidth = Math.max(1, (e.weight / maxWeight) * 5);
          return (
            <path
              key={i}
              d={`M ${startX} ${startY} C ${midX} ${startY} ${midX} ${endY} ${endX} ${endY}`}
              stroke={color}
              strokeOpacity={active ? 0.5 : 0.08}
              strokeWidth={strokeWidth}
              fill="none"
              style={{ transition: "stroke-opacity 120ms" }}
            />
          );
        })}

        {/* Source nodes */}
        {sourceRows.map((r) => {
          const color = colorForSource(r.source);
          const count = sourceCounts.get(r.source) ?? 0;
          const active =
            !hover ||
            (hover.kind === "source" && hover.key === r.source) ||
            (hover.kind === "canonical" &&
              edges.some(
                (e) => e.source === r.source && e.canonical === hover.key,
              ));
          return (
            <g
              key={r.source}
              onMouseEnter={() => setHover({ kind: "source", key: r.source })}
              onMouseLeave={() => setHover(null)}
              style={{ opacity: active ? 1 : 0.35, transition: "opacity 120ms" }}
            >
              <rect
                x={SRC_X}
                y={r.y}
                width={COL_W}
                height={NODE_H}
                rx={8}
                fill={color}
                fillOpacity="0.12"
                stroke={color}
                strokeOpacity="0.6"
              />
              <text
                x={SRC_X + 14}
                y={r.y + NODE_H / 2 - 6}
                dominantBaseline="middle"
                fontSize="13"
                fontWeight="600"
                fill="currentColor"
              >
                {r.source}
              </text>
              <text
                x={SRC_X + 14}
                y={r.y + NODE_H / 2 + 10}
                dominantBaseline="middle"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {count} mapped field{count === 1 ? "" : "s"}
              </text>
            </g>
          );
        })}

        {/* Canonical nodes */}
        {canonicalRows.map((r) => {
          const count = rawFieldsContributingTo(r.obj.key).length;
          const active =
            !hover ||
            (hover.kind === "canonical" && hover.key === r.obj.key) ||
            (hover.kind === "source" &&
              edges.some(
                (e) =>
                  e.source === hover.key && e.canonical === r.obj.key,
              ));
          return (
            <g
              key={r.obj.key}
              onMouseEnter={() =>
                setHover({ kind: "canonical", key: r.obj.key })
              }
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectObject(r.obj.key)}
              style={{
                cursor: "pointer",
                opacity: active ? 1 : 0.35,
                transition: "opacity 120ms",
              }}
            >
              <rect
                x={CAN_X}
                y={r.y}
                width={COL_W}
                height={NODE_H}
                rx={8}
                fill="var(--background)"
                stroke="var(--brand)"
                strokeOpacity="0.5"
              />
              <text
                x={CAN_X + 14}
                y={r.y + NODE_H / 2 - 6}
                dominantBaseline="middle"
                fontSize="13"
                fontWeight="600"
                fill="currentColor"
              >
                {r.obj.label}
              </text>
              <text
                x={CAN_X + 14}
                y={r.y + NODE_H / 2 + 10}
                dominantBaseline="middle"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {r.obj.fields.length} fields · {count} raw contrib
              </text>
              <text
                x={CAN_X + COL_W - 14}
                y={r.y + NODE_H / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="10"
                fill="var(--brand)"
                fillOpacity="0.7"
              >
                ↗
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Drill-in graph ────────────────────────────────────────────────

function DrilldownGraph({ canonicalKey }: { canonicalKey: string }) {
  const canonical = getCanonicalObject(canonicalKey);

  // Gather raw contributions for this canonical object, grouped by (source, object).
  const contribs = useMemo(
    () => rawFieldsContributingTo(canonicalKey),
    [canonicalKey],
  );

  // Build the source / raw-field columns from contribs.
  type RawGroup = { source: string; object: string; fields: string[] };
  const rawGroups = useMemo<RawGroup[]>(() => {
    const m = new Map<string, RawGroup>();
    for (const c of contribs) {
      const k = `${c.source}::${c.rawObject}`;
      if (!m.has(k))
        m.set(k, { source: c.source, object: c.rawObject, fields: [] });
      m.get(k)!.fields.push(c.rawField);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.source.localeCompare(b.source) || a.object.localeCompare(b.object),
    );
  }, [contribs]);

  // Canonical fields with their contribution counts (for join highlighting).
  const canonicalFieldStats = useMemo(() => {
    if (!canonical) return [];
    return canonical.fields.map((f) => ({
      field: f,
      contributors: contributorsFor(canonical.key, f.key),
    }));
  }, [canonical]);

  if (!canonical) return <div className="text-sm text-muted">Object not found.</div>;

  // Layout constants.
  const PADDING = 24;
  const SRC_W = 140;
  const SRC_H = 36;
  const RAW_W = 200;
  const RAW_H = 22;
  const CAN_W = 240;
  const CAN_H = 24;
  const ROW_GAP = 4;
  const SRC_GAP = 12;
  const CAN_GAP = 6;
  const COL_GAP_1 = 80;
  const COL_GAP_2 = 220;

  const SRC_X = PADDING;
  const RAW_X = SRC_X + SRC_W + COL_GAP_1;
  const CAN_X = RAW_X + RAW_W + COL_GAP_2;
  const WIDTH = CAN_X + CAN_W + PADDING;

  // Position raw fields: stacked per group, source label centered on group.
  type RawPos = { source: string; object: string; field: string; y: number };
  type SourcePos = { source: string; y: number; centerY: number };
  const rawPositions: RawPos[] = [];
  const sourcePositions: SourcePos[] = [];
  let rawCursor = PADDING;
  // Group source positions by aggregating their groups
  const sourceBlocks = new Map<
    string,
    { startY: number; endY: number }
  >();
  for (const g of rawGroups) {
    const blockStart = rawCursor;
    for (const f of g.fields) {
      rawPositions.push({ source: g.source, object: g.object, field: f, y: rawCursor });
      rawCursor += RAW_H + ROW_GAP;
    }
    const blockEnd = rawCursor - ROW_GAP;
    rawCursor += SRC_GAP;
    const existing = sourceBlocks.get(g.source);
    if (existing) {
      existing.endY = blockEnd;
    } else {
      sourceBlocks.set(g.source, { startY: blockStart, endY: blockEnd });
    }
  }
  for (const [src, blk] of sourceBlocks) {
    const cy = (blk.startY + blk.endY) / 2;
    sourcePositions.push({ source: src, centerY: cy, y: cy - SRC_H / 2 });
  }

  // Canonical column positions.
  type CanPos = { field: CanonicalField; y: number; joinCount: number };
  const canPositions: CanPos[] = [];
  let canCursor = PADDING;
  for (const s of canonicalFieldStats) {
    canPositions.push({ field: s.field, y: canCursor, joinCount: s.contributors.length });
    canCursor += CAN_H + CAN_GAP;
  }

  const HEIGHT = Math.max(rawCursor, canCursor) + PADDING;

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-foreground/[0.02] p-2">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block"
        style={{ minWidth: WIDTH }}
      >
        {/* Edges: source -> raw field (short fanout) */}
        {rawPositions.map((r, i) => {
          const src = sourcePositions.find((s) => s.source === r.source)!;
          const startX = SRC_X + SRC_W;
          const startY = src.centerY;
          const endX = RAW_X;
          const endY = r.y + RAW_H / 2;
          const midX = (startX + endX) / 2;
          const color = colorForSource(r.source);
          return (
            <path
              key={`sr-${i}`}
              d={`M ${startX} ${startY} C ${midX} ${startY} ${midX} ${endY} ${endX} ${endY}`}
              stroke={color}
              strokeOpacity="0.45"
              strokeWidth="1.2"
              fill="none"
            />
          );
        })}

        {/* Edges: raw field -> canonical field */}
        {rawPositions.map((r, i) => {
          const canon = canPositions.find((c) =>
            FIELD_MAPPINGS.some(
              ([s, o, f, co, cf]) =>
                s === r.source &&
                o === r.object &&
                f === r.field &&
                co === canonicalKey &&
                cf === c.field.key,
            ),
          );
          if (!canon) return null;
          const startX = RAW_X + RAW_W;
          const startY = r.y + RAW_H / 2;
          const endX = CAN_X;
          const endY = canon.y + CAN_H / 2;
          const midX = (startX + endX) / 2;
          const color = colorForSource(r.source);
          return (
            <path
              key={`rc-${i}`}
              d={`M ${startX} ${startY} C ${midX} ${startY} ${midX} ${endY} ${endX} ${endY}`}
              stroke={color}
              strokeOpacity="0.6"
              strokeWidth="1.5"
              fill="none"
            />
          );
        })}

        {/* Source pills */}
        {sourcePositions.map((s) => {
          const color = colorForSource(s.source);
          return (
            <g key={s.source}>
              <rect
                x={SRC_X}
                y={s.y}
                width={SRC_W}
                height={SRC_H}
                rx={6}
                fill={color}
                fillOpacity="0.12"
                stroke={color}
                strokeOpacity="0.6"
              />
              <text
                x={SRC_X + 10}
                y={s.y + SRC_H / 2}
                dominantBaseline="middle"
                fontSize="12"
                fontWeight="600"
                fill="currentColor"
              >
                {s.source}
              </text>
            </g>
          );
        })}

        {/* Raw field pills */}
        {rawPositions.map((r, i) => {
          const color = colorForSource(r.source);
          return (
            <g key={`raw-${i}`}>
              <rect
                x={RAW_X}
                y={r.y}
                width={RAW_W}
                height={RAW_H}
                rx={4}
                fill="var(--background)"
                stroke={color}
                strokeOpacity="0.35"
              />
              <text
                x={RAW_X + 8}
                y={r.y + RAW_H / 2}
                dominantBaseline="middle"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
              >
                {r.object}.{r.field}
              </text>
            </g>
          );
        })}

        {/* Canonical field pills */}
        {canPositions.map((c, i) => {
          const isJoin = c.joinCount > 1;
          return (
            <g key={`can-${i}`}>
              <rect
                x={CAN_X}
                y={c.y}
                width={CAN_W}
                height={CAN_H}
                rx={4}
                fill={isJoin ? "var(--brand)" : "var(--background)"}
                fillOpacity={isJoin ? 0.12 : 1}
                stroke="var(--brand)"
                strokeOpacity={isJoin ? 0.7 : 0.3}
                strokeWidth={isJoin ? 1.5 : 1}
              />
              <text
                x={CAN_X + 10}
                y={c.y + CAN_H / 2}
                dominantBaseline="middle"
                fontSize="11"
                fontFamily="ui-monospace, monospace"
                fontWeight={isJoin ? 600 : 400}
                fill="currentColor"
              >
                {c.field.key}
                {c.field.isArray ? "[]" : ""}
              </text>
              {c.joinCount > 1 && (
                <text
                  x={CAN_X + CAN_W - 10}
                  y={c.y + CAN_H / 2}
                  dominantBaseline="middle"
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  fill="var(--brand)"
                  fillOpacity="0.9"
                >
                  ⚠ {c.joinCount} sources
                </text>
              )}
              {c.joinCount === 0 && (
                <text
                  x={CAN_X + CAN_W - 10}
                  y={c.y + CAN_H / 2}
                  dominantBaseline="middle"
                  textAnchor="end"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  fill="currentColor"
                  fillOpacity="0.35"
                >
                  unmapped
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Stats strip ───────────────────────────────────────────────────

function StatsStrip({
  mode,
  canonicalKey,
}: {
  mode: Mode;
  canonicalKey: string;
}) {
  if (mode === "overview") {
    const joins = joinPointFields();
    const unmapped = unmappedRawFields();
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <StatCard label="Raw fields" value={String(totalRawFieldCount())} sub="Documented across all sources" />
        <StatCard label="Canonical fields" value={String(CANONICAL_OBJECTS.reduce((n, o) => n + o.fields.length, 0))} sub={`${CANONICAL_OBJECTS.length} canonical objects`} />
        <StatCard label="Mappings" value={String(totalMappingCount())} sub={`${joins.length} join points need rules`} />
        <StatCard label="Orphans" value={String(unmapped.length)} sub="Raw fields with no canonical home" tone="muted" />
      </div>
    );
  }
  const obj = getCanonicalObject(canonicalKey);
  if (!obj) return null;
  const contribs = rawFieldsContributingTo(canonicalKey);
  const joinPointCount = obj.fields.filter(
    (f) => contributorsFor(canonicalKey, f.key).length > 1,
  ).length;
  const unmappedCanonical = obj.fields.filter(
    (f) => contributorsFor(canonicalKey, f.key).length === 0,
  ).length;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
      <StatCard label="Canonical fields" value={String(obj.fields.length)} sub={obj.label + " has " + obj.fields.length + " fields"} />
      <StatCard label="Raw contributors" value={String(contribs.length)} sub="Across all contributing sources" />
      <StatCard label="Join points" value={String(joinPointCount)} sub="Canonical fields with >1 source" tone="brand" />
      <StatCard label="Unmapped canonical" value={String(unmappedCanonical)} sub="Canonical fields without raw contributors" tone="muted" />
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "brand" | "muted";
}) {
  const accent =
    tone === "brand"
      ? "border-brand/40 bg-brand/[0.04]"
      : tone === "muted"
        ? "border-border bg-foreground/[0.02]"
        : "border-border bg-background";
  return (
    <div className={`rounded-md border ${accent} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      <div className="text-[10px] text-muted mt-0.5 leading-snug">{sub}</div>
    </div>
  );
}

// Unused export retained intentionally - keeps the test surface for the
// raw catalog small (RawObject only).
export type { RawObject };
