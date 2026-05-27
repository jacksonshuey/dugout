"use client";

import { useMemo, useState } from "react";
import {
  CANONICAL_OBJECTS,
  getCanonicalObject,
} from "@/data/canonical-objects";
import {
  getUniqueSources,
  totalRawFieldCount,
  getRawObjectsBySource,
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

// Sources → canonical objects Sankey diagram with inline expansion.
//
// Single view (no separate Drill-in mode). Each source pill on the left
// is clickable: clicking unravels that source's mappings below the
// Sankey, showing which raw API objects feed which canonical objects.
// Click a canonical object on the right to expand it the same way -
// showing every source that feeds it and the join-resolution rule per
// field.
//
// Multiple sources / canonical objects can be expanded at once;
// expansions render as cards below the SVG so the Sankey itself stays
// compact. Clicking the same pill again collapses its card.

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

export interface ConnectivityGraphProps {
  // Optional callback when the user clicks a canonical object pill. If
  // omitted, clicking expands the canonical's detail card inline below
  // the Sankey. Parents can use this to do something else (e.g.
  // navigation).
  onSelectObject?: (canonicalKey: string) => void;
}

// Single-expansion: only one source OR one canonical can be open at a
// time. Clicking a different pill collapses the previously expanded one
// (drops up its contents, returns to primary position) and expands the
// new one. Clicking the same pill collapses it.
export type Expanded =
  | { kind: "source"; key: string }
  | { kind: "canonical"; key: string }
  | null;

export function ConnectivityGraph(_props: ConnectivityGraphProps = {}) {
  const [expanded, setExpanded] = useState<Expanded>(null);
  // Within an expanded source, which raw API object's fields are open.
  // Only meaningful when expanded?.kind === "source".
  const [expandedRawObject, setExpandedRawObject] = useState<string | null>(
    null,
  );

  function toggleSource(source: string) {
    setExpandedRawObject(null);
    setExpanded((prev) =>
      prev?.kind === "source" && prev.key === source
        ? null
        : { kind: "source", key: source },
    );
  }
  function toggleObject(key: string) {
    setExpandedRawObject(null);
    setExpanded((prev) =>
      prev?.kind === "canonical" && prev.key === key
        ? null
        : { kind: "canonical", key },
    );
  }
  function toggleRawObject(obj: string) {
    setExpandedRawObject((prev) => (prev === obj ? null : obj));
  }

  return (
    <div className="space-y-4">
      <StatsStrip />
      <OverviewGraph
        expanded={expanded}
        expandedRawObject={expandedRawObject}
        onToggleSource={toggleSource}
        onToggleObject={toggleObject}
        onToggleRawObject={toggleRawObject}
      />
    </div>
  );
}

// ── Stats strip ───────────────────────────────────────────────────

function StatsStrip() {
  const joins = joinPointFields();
  const orphans = unmappedRawFields();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
      <StatCard
        label="Raw fields"
        value={String(totalRawFieldCount())}
        sub="Documented across all sources"
      />
      <StatCard
        label="Canonical fields"
        value={String(
          CANONICAL_OBJECTS.reduce((n, o) => n + o.fields.length, 0),
        )}
        sub={`${CANONICAL_OBJECTS.length} canonical objects`}
      />
      <StatCard
        label="Mappings"
        value={String(totalMappingCount())}
        sub={`${joins.length} join points need rules`}
        tone="brand"
      />
      <StatCard
        label="Orphans"
        value={String(orphans.length)}
        sub="Raw fields with no canonical home"
        tone="muted"
      />
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

// ── Overview Sankey ───────────────────────────────────────────────

interface OverviewEdge {
  source: string;
  canonical: string;
  weight: number;
}

function OverviewGraph({
  expanded,
  expandedRawObject,
  onToggleSource,
  onToggleObject,
  onToggleRawObject,
}: {
  expanded: Expanded;
  expandedRawObject: string | null;
  onToggleSource: (source: string) => void;
  onToggleObject: (key: string) => void;
  onToggleRawObject: (obj: string) => void;
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

  const PADDING = 16;
  const COL_W = 200;
  const NODE_H = 36;
  const NODE_GAP = 8;
  const COL_GAP = 360;
  const SRC_X = 24;
  const CAN_X = SRC_X + COL_W + COL_GAP;
  const WIDTH = CAN_X + COL_W + 24;
  // Dropdown rows are full-height pills - same shape as source pills -
  // so they align row-for-row with the unmoved sources/canonicals.
  const DROP_ROW_STEP = NODE_H + NODE_GAP;

  // When a source is expanded it slides to the top of its column and
  // the OTHER sources are hidden - the column becomes a dedicated
  // detail view for that source: pill, then raw-object rows, then
  // (optionally) field rows when a raw object is itself expanded.
  // Click the source again to collapse and bring everyone back.
  const sourceRows = useMemo(() => {
    if (expanded?.kind === "source") {
      return [{ source: expanded.key, y: PADDING }];
    }
    return sources.map((s, i) => ({
      source: s,
      y: PADDING + i * DROP_ROW_STEP,
    }));
  }, [sources, expanded, DROP_ROW_STEP]);

  // Mirrored for canonical: when expanded, the canonical column shows
  // only that object + its field-row dropdown below.
  const canonicalRows = useMemo(() => {
    if (expanded?.kind === "canonical") {
      const co = CANONICAL_OBJECTS.find((o) => o.key === expanded.key);
      if (!co) return [];
      return [{ obj: co, y: PADDING }];
    }
    return CANONICAL_OBJECTS.map((o, i) => ({
      obj: o,
      y: PADDING + i * DROP_ROW_STEP,
    }));
  }, [expanded, DROP_ROW_STEP]);

  // Dropdown row counts to figure out the vertical extent the SVG needs.
  const expandedSourceDropdownRows = useMemo(() => {
    if (expanded?.kind !== "source") return 0;
    return getRawObjectsBySource(expanded.key).length;
  }, [expanded]);

  const expandedCanonicalDropdownRows = useMemo(() => {
    if (expanded?.kind !== "canonical") return 0;
    const co = getCanonicalObject(expanded.key);
    return co?.fields.length ?? 0;
  }, [expanded]);

  // Source dropdown lives in the source column at y=PADDING+DROP_ROW_STEP
  // and beyond. If a raw object is expanded, its fields are stacked
  // beneath at FIELD_ROW_STEP each, so the dropdown's bottom grows.
  const FIELD_ROW_H = 22;
  const FIELD_ROW_GAP = 2;
  const FIELD_ROW_STEP = FIELD_ROW_H + FIELD_ROW_GAP;
  const expandedRawObjectFieldCount = useMemo(() => {
    if (expanded?.kind !== "source" || !expandedRawObject) return 0;
    const rawObjects = getRawObjectsBySource(expanded.key);
    return rawObjects.find((r) => r.object === expandedRawObject)?.fields.length ?? 0;
  }, [expanded, expandedRawObject]);

  const sourceDropdownBottom =
    expanded?.kind === "source"
      ? PADDING +
        (1 + expandedSourceDropdownRows) * DROP_ROW_STEP +
        expandedRawObjectFieldCount * FIELD_ROW_STEP +
        (expandedRawObjectFieldCount > 0 ? 8 : 0)
      : 0;
  const canonicalDropdownBottom =
    expanded?.kind === "canonical"
      ? PADDING + (1 + expandedCanonicalDropdownRows) * DROP_ROW_STEP
      : 0;

  const sourceBottom =
    sourceRows.length > 0
      ? sourceRows[sourceRows.length - 1].y + NODE_H
      : PADDING;
  const canonicalBottom =
    canonicalRows.length > 0
      ? canonicalRows[canonicalRows.length - 1].y + NODE_H
      : PADDING;
  const HEIGHT =
    Math.max(
      sourceBottom,
      canonicalBottom,
      sourceDropdownBottom,
      canonicalDropdownBottom,
    ) + PADDING;

  // viewBox no longer grows horizontally — expanded pill slides up to
  // the top of its column instead of out to the side. Vertical growth
  // accommodates dropdown rows + optional field rows.
  const viewBoxMinX = 0;
  const viewBoxWidth = WIDTH;

  const maxWeight = Math.max(...edges.map((e) => e.weight), 1);

  function edgeActive(srcKey: string, canKey: string): boolean {
    if (!hover) return true;
    if (hover.kind === "source") return hover.key === srcKey;
    return hover.key === canKey;
  }

  // Compute pop-out positions
  const expandedSourceRow =
    expanded?.kind === "source"
      ? sourceRows.find((r) => r.source === expanded.key)
      : undefined;
  const expandedCanonicalRow =
    expanded?.kind === "canonical"
      ? canonicalRows.find((r) => r.obj.key === expanded.key)
      : undefined;

  // For an expanded source, breakdown of its raw objects + canonical
  // targets + the actual field list per object (so the user can drill
  // into subfields without leaving the Sankey).
  const sourceDropdown = useMemo(() => {
    if (expanded?.kind !== "source") return null;
    const rawObjects = getRawObjectsBySource(expanded.key);
    return rawObjects.map((ro) => {
      const destMap = new Map<string, number>();
      const mappedFieldKeys = new Set<string>();
      for (const [s, o, f, co] of FIELD_MAPPINGS) {
        if (s !== expanded.key || o !== ro.object) continue;
        destMap.set(co, (destMap.get(co) ?? 0) + 1);
        mappedFieldKeys.add(f);
      }
      const dests = Array.from(destMap.entries())
        .map(([k, n]) => `${k}·${n}`)
        .join(", ");
      const mappedCount = Array.from(destMap.values()).reduce(
        (n, v) => n + v,
        0,
      );
      return {
        object: ro.object,
        totalFields: ro.fields.length,
        mappedCount,
        destinations: dests || "—",
        fields: ro.fields.map((f) => ({
          key: f.key,
          type: f.type,
          isMapped: mappedFieldKeys.has(f.key),
        })),
      };
    });
  }, [expanded]);

  // For an expanded canonical, fields + contributor count
  const canonicalDropdown = useMemo(() => {
    if (expanded?.kind !== "canonical") return null;
    const co = getCanonicalObject(expanded.key);
    if (!co) return null;
    return co.fields.map((f) => {
      const contribs = contributorsFor(co.key, f.key);
      return {
        key: f.key,
        type: f.type,
        unit: f.unit,
        isArray: f.isArray ?? false,
        contribCount: contribs.length,
        sources: Array.from(new Set(contribs.map((c) => c.source))),
      };
    });
  }, [expanded]);

  return (
    <div className="w-full rounded-lg border border-border bg-foreground/[0.02] p-2">
      <svg
        viewBox={`${viewBoxMinX} 0 ${viewBoxWidth} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full h-auto"
        style={{ transition: "all 200ms ease" }}
      >
        {/* Edges */}
        {edges.map((e, i) => {
          const src = sourceRows.find((r) => r.source === e.source);
          const can = canonicalRows.find((r) => r.obj.key === e.canonical);
          if (!src || !can) return null;
          // No horizontal pop-shift now — expanded source/canonical
          // slides up to the top of its column instead of out to the
          // side. Curves originate/terminate at the column edges.
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
          const isExpanded =
            expanded?.kind === "source" && expanded.key === r.source;
          const nodeX = SRC_X;
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
              transform={`translate(${nodeX}, ${r.y})`}
              onMouseEnter={() => setHover({ kind: "source", key: r.source })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onToggleSource(r.source)}
              style={{
                cursor: "pointer",
                opacity: active ? 1 : 0.35,
                transition:
                  "transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms",
              }}
            >
              <rect
                x={0}
                y={0}
                width={COL_W}
                height={NODE_H}
                rx={8}
                fill={color}
                fillOpacity={isExpanded ? 0.22 : 0.12}
                stroke={color}
                strokeOpacity={isExpanded ? 1 : 0.6}
                strokeWidth={isExpanded ? 2 : 1}
              />
              <text
                x={14}
                y={NODE_H / 2 - 6}
                dominantBaseline="middle"
                fontSize="13"
                fontWeight="600"
                fill="currentColor"
              >
                {r.source}
              </text>
              <text
                x={14}
                y={NODE_H / 2 + 10}
                dominantBaseline="middle"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {count} mapped field{count === 1 ? "" : "s"}
              </text>
              <text
                x={COL_W - 14}
                y={NODE_H / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="12"
                fill={color}
                fillOpacity="0.85"
              >
                {isExpanded ? "−" : "+"}
              </text>
            </g>
          );
        })}

        {/* Source dropdown rendered inside the source column. Each
            raw-object row is clickable; clicking one expands it to
            show its actual API fields beneath as smaller rows. The
            subsequent raw-object rows reflow downward. */}
        {expandedSourceRow && sourceDropdown && (
          <g key={`src-drop-${expanded?.key}`}>
            {(() => {
              const color = colorForSource(expanded!.key);
              const FIELD_ROW_H = 22;
              const FIELD_ROW_GAP = 2;
              const FIELD_ROW_STEP = FIELD_ROW_H + FIELD_ROW_GAP;
              const elements: React.ReactNode[] = [];
              let y = expandedSourceRow.y + DROP_ROW_STEP;
              sourceDropdown.forEach((row, i) => {
                const isOpen = expandedRawObject === row.object;
                elements.push(
                  <g
                    key={row.object}
                    transform={`translate(${SRC_X}, ${y})`}
                  >
                    <g
                      className="cg-drop-row"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={COL_W}
                        height={NODE_H}
                        rx={8}
                        fill={color}
                        fillOpacity={isOpen ? 0.2 : 0.12}
                        stroke={color}
                        strokeOpacity={isOpen ? 1 : 0.6}
                        strokeWidth={isOpen ? 1.5 : 1}
                        style={{ cursor: "pointer" }}
                        onClick={() => onToggleRawObject(row.object)}
                      />
                      <text
                        x={14}
                        y={NODE_H / 2 - 6}
                        dominantBaseline="middle"
                        fontSize="13"
                        fontWeight="600"
                        fill="currentColor"
                        style={{ pointerEvents: "none" }}
                      >
                        {row.object}
                      </text>
                      <text
                        x={14}
                        y={NODE_H / 2 + 10}
                        dominantBaseline="middle"
                        fontSize="10"
                        fontFamily="ui-monospace, monospace"
                        fill="currentColor"
                        fillOpacity="0.55"
                        style={{ pointerEvents: "none" }}
                      >
                        {row.mappedCount}/{row.totalFields} → {row.destinations}
                      </text>
                      <text
                        x={COL_W - 14}
                        y={NODE_H / 2}
                        dominantBaseline="middle"
                        textAnchor="end"
                        fontSize="12"
                        fill={color}
                        fillOpacity="0.85"
                        style={{ pointerEvents: "none" }}
                      >
                        {isOpen ? "−" : "+"}
                      </text>
                    </g>
                  </g>,
                );
                y += DROP_ROW_STEP;
                // If this raw object is expanded, render its field rows
                // beneath it with a small indent + smaller font.
                if (isOpen) {
                  row.fields.forEach((f, fi) => {
                    elements.push(
                      <g
                        key={`${row.object}-${f.key}`}
                        transform={`translate(${SRC_X + 12}, ${y})`}
                      >
                        <g
                          className="cg-drop-row"
                          style={{ animationDelay: `${fi * 20}ms` }}
                        >
                          <rect
                            x={0}
                            y={0}
                            width={COL_W - 12}
                            height={FIELD_ROW_H}
                            rx={4}
                            fill="var(--background)"
                            stroke={color}
                            strokeOpacity={f.isMapped ? 0.35 : 0.15}
                          />
                          <text
                            x={10}
                            y={FIELD_ROW_H / 2}
                            dominantBaseline="middle"
                            fontSize="10"
                            fontFamily="ui-monospace, monospace"
                            fill="currentColor"
                            fillOpacity={f.isMapped ? 1 : 0.45}
                          >
                            {f.key}
                          </text>
                          <text
                            x={COL_W - 12 - 8}
                            y={FIELD_ROW_H / 2}
                            dominantBaseline="middle"
                            textAnchor="end"
                            fontSize="9"
                            fontFamily="ui-monospace, monospace"
                            fill="currentColor"
                            fillOpacity={f.isMapped ? 0.6 : 0.35}
                          >
                            {f.type}
                            {f.isMapped ? "" : " · unmapped"}
                          </text>
                        </g>
                      </g>,
                    );
                    y += FIELD_ROW_STEP;
                  });
                  y += 4; // small gap after field block
                }
              });
              return elements;
            })()}
          </g>
        )}

        {/* Canonical nodes */}
        {canonicalRows.map((r) => {
          const count = rawFieldsContributingTo(r.obj.key).length;
          const isExpanded =
            expanded?.kind === "canonical" && expanded.key === r.obj.key;
          const nodeX = CAN_X;
          const active =
            !hover ||
            (hover.kind === "canonical" && hover.key === r.obj.key) ||
            (hover.kind === "source" &&
              edges.some(
                (e) => e.source === hover.key && e.canonical === r.obj.key,
              ));
          return (
            <g
              key={r.obj.key}
              transform={`translate(${nodeX}, ${r.y})`}
              onMouseEnter={() =>
                setHover({ kind: "canonical", key: r.obj.key })
              }
              onMouseLeave={() => setHover(null)}
              onClick={() => onToggleObject(r.obj.key)}
              style={{
                cursor: "pointer",
                opacity: active ? 1 : 0.35,
                transition:
                  "transform 560ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms",
              }}
            >
              <rect
                x={0}
                y={0}
                width={COL_W}
                height={NODE_H}
                rx={8}
                fill={isExpanded ? "var(--brand)" : "var(--background)"}
                fillOpacity={isExpanded ? 0.12 : 1}
                stroke="var(--brand)"
                strokeOpacity={isExpanded ? 1 : 0.5}
                strokeWidth={isExpanded ? 2 : 1}
              />
              <text
                x={14}
                y={NODE_H / 2 - 6}
                dominantBaseline="middle"
                fontSize="13"
                fontWeight="600"
                fill="currentColor"
              >
                {r.obj.label}
              </text>
              <text
                x={14}
                y={NODE_H / 2 + 10}
                dominantBaseline="middle"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {r.obj.fields.length} fields · {count} raw contrib
              </text>
              <text
                x={COL_W - 14}
                y={NODE_H / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="12"
                fill="var(--brand)"
                fillOpacity="0.85"
              >
                {isExpanded ? "−" : "+"}
              </text>
            </g>
          );
        })}

        {/* Canonical dropdown - same outer/inner-g pattern as above so
            the position transform doesn't collide with the keyframe. */}
        {expandedCanonicalRow && canonicalDropdown && (
          <g key={`can-drop-${expanded?.key}`}>
            {canonicalDropdown.map((row, i) => {
              const baseY =
                expandedCanonicalRow.y + (i + 1) * DROP_ROW_STEP;
              const isJoin = row.contribCount > 1;
              const isOrphan = row.contribCount === 0;
              return (
                <g
                  key={row.key}
                  transform={`translate(${CAN_X}, ${baseY})`}
                >
                  <g
                    className="cg-drop-row"
                    style={{ animationDelay: `${i * 55}ms` }}
                  >
                    {/* Match the canonical pill's default styling -
                        brand stroke at 0.5, white fill - so the row
                        reads as a member of the same column. Join
                        fields get a brand tint to flag the attention. */}
                    <rect
                      x={0}
                      y={0}
                      width={COL_W}
                      height={NODE_H}
                      rx={8}
                      fill={isJoin ? "var(--brand)" : "var(--background)"}
                      fillOpacity={isJoin ? 0.08 : 1}
                      stroke="var(--brand)"
                      strokeOpacity={isOrphan ? 0.25 : 0.5}
                    />
                    <text
                      x={14}
                      y={NODE_H / 2 - 6}
                      dominantBaseline="middle"
                      fontSize="13"
                      fontFamily="ui-monospace, monospace"
                      fontWeight={isJoin ? 700 : 600}
                      fill="currentColor"
                      fillOpacity={isOrphan ? 0.45 : 1}
                    >
                      {row.key}
                      {row.isArray ? "[]" : ""}
                    </text>
                    <text
                      x={14}
                      y={NODE_H / 2 + 10}
                      dominantBaseline="middle"
                      fontSize="10"
                      fontFamily="ui-monospace, monospace"
                      fill={isJoin ? "var(--brand)" : "currentColor"}
                      fillOpacity={isOrphan ? 0.45 : isJoin ? 0.9 : 0.55}
                    >
                      {row.type}
                      {row.unit ? ` · ${row.unit}` : ""}
                      {" · "}
                      {isOrphan
                        ? "unmapped"
                        : `${row.contribCount} src${row.contribCount === 1 ? "" : "s"}`}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        )}
      </svg>
      <div className="mt-2 px-1 text-[11px] text-muted text-center">
        Click any source or canonical object to unravel its mappings inline.
      </div>
    </div>
  );
}

