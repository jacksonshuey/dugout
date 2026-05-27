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
  type CanonicalContribution,
} from "@/data/object-mappings";
import { BrandLogo, type BrandKey } from "@/components/landing/logos";

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

function sourceToBrandKey(source: string): BrandKey {
  return source
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "") as BrandKey;
}

export interface ConnectivityGraphProps {
  // Optional callback when the user clicks a canonical object pill. If
  // omitted, clicking expands the canonical's detail card inline below
  // the Sankey. Parents can use this to do something else (e.g.
  // navigation).
  onSelectObject?: (canonicalKey: string) => void;
}

export function ConnectivityGraph(_props: ConnectivityGraphProps = {}) {
  // Sources currently expanded into their detail card. A Set so multiple
  // can be open at once; toggle the same key to close.
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set(),
  );
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(
    new Set(),
  );

  function toggleSource(source: string) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  function toggleObject(key: string) {
    setExpandedObjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <StatsStrip />
      <OverviewGraph
        expandedSources={expandedSources}
        expandedObjects={expandedObjects}
        onToggleSource={toggleSource}
        onToggleObject={toggleObject}
      />
      {(expandedSources.size > 0 || expandedObjects.size > 0) && (
        <div className="space-y-3">
          {Array.from(expandedSources).map((src) => (
            <SourceDetailCard
              key={`src-${src}`}
              source={src}
              onClose={() => toggleSource(src)}
            />
          ))}
          {Array.from(expandedObjects).map((key) => (
            <CanonicalDetailCard
              key={`obj-${key}`}
              canonicalKey={key}
              onClose={() => toggleObject(key)}
            />
          ))}
        </div>
      )}
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
  expandedSources,
  expandedObjects,
  onToggleSource,
  onToggleObject,
}: {
  expandedSources: Set<string>;
  expandedObjects: Set<string>;
  onToggleSource: (source: string) => void;
  onToggleObject: (key: string) => void;
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
    <div className="w-full rounded-lg border border-border bg-foreground/[0.02] p-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full h-auto"
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
          const isExpanded = expandedSources.has(r.source);
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
              onClick={() => onToggleSource(r.source)}
              style={{
                cursor: "pointer",
                opacity: active ? 1 : 0.35,
                transition: "opacity 120ms",
              }}
            >
              <rect
                x={SRC_X}
                y={r.y}
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
              <text
                x={SRC_X + COL_W - 14}
                y={r.y + NODE_H / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="12"
                fill="currentColor"
                fillOpacity="0.7"
              >
                {isExpanded ? "−" : "+"}
              </text>
            </g>
          );
        })}

        {/* Canonical nodes */}
        {canonicalRows.map((r) => {
          const count = rawFieldsContributingTo(r.obj.key).length;
          const isExpanded = expandedObjects.has(r.obj.key);
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
              onMouseEnter={() =>
                setHover({ kind: "canonical", key: r.obj.key })
              }
              onMouseLeave={() => setHover(null)}
              onClick={() => onToggleObject(r.obj.key)}
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
                fill={isExpanded ? "var(--brand)" : "var(--background)"}
                fillOpacity={isExpanded ? 0.12 : 1}
                stroke="var(--brand)"
                strokeOpacity={isExpanded ? 1 : 0.5}
                strokeWidth={isExpanded ? 2 : 1}
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
                fontSize="12"
                fill="var(--brand)"
                fillOpacity="0.85"
              >
                {isExpanded ? "−" : "+"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 px-1 text-[11px] text-muted text-center">
        Click any source or canonical object to expand its mappings below.
      </div>
    </div>
  );
}

// ── Source detail card ────────────────────────────────────────────

function SourceDetailCard({
  source,
  onClose,
}: {
  source: string;
  onClose: () => void;
}) {
  const color = colorForSource(source);
  const brand = sourceToBrandKey(source);
  // For this source, list each raw object and the canonical destinations
  // its fields feed. e.g., Salesforce.Opportunity → Deal (18 fields),
  // Salesforce.Task → Activity (10), Call (3).
  const rawObjects = getRawObjectsBySource(source);
  const breakdown = useMemo(() => {
    const out: {
      rawObject: string;
      totalFields: number;
      mappedFields: number;
      destinations: { canonicalObject: string; fieldCount: number }[];
    }[] = [];
    for (const ro of rawObjects) {
      const destMap = new Map<string, number>();
      for (const [s, o, , co] of FIELD_MAPPINGS) {
        if (s !== source || o !== ro.object) continue;
        destMap.set(co, (destMap.get(co) ?? 0) + 1);
      }
      const destinations = Array.from(destMap.entries()).map(
        ([canonicalObject, fieldCount]) => ({ canonicalObject, fieldCount }),
      );
      destinations.sort((a, b) => b.fieldCount - a.fieldCount);
      const mappedFields = destinations.reduce((n, d) => n + d.fieldCount, 0);
      out.push({
        rawObject: ro.object,
        totalFields: ro.fields.length,
        mappedFields,
        destinations,
      });
    }
    out.sort((a, b) => b.mappedFields - a.mappedFields);
    return out;
  }, [source, rawObjects]);

  return (
    <div
      className="rounded-lg border bg-background p-4"
      style={{ borderColor: color + "55" }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-md"
            style={{ background: color + "1a" }}
          >
            <BrandLogo brand={brand} size={22} />
          </span>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
              Source
            </div>
            <div className="text-sm font-semibold tracking-tight">
              {source}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse"
          className="shrink-0 rounded-md border border-border w-6 h-6 inline-flex items-center justify-center hover:border-foreground/40 text-xs"
        >
          ×
        </button>
      </div>
      <div className="space-y-2">
        {breakdown.map((b) => (
          <div
            key={b.rawObject}
            className="rounded-md border border-border bg-foreground/[0.02] px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs font-semibold">
                {source}.{b.rawObject}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
                {b.mappedFields}/{b.totalFields} mapped
              </span>
            </div>
            {b.destinations.length === 0 ? (
              <div className="text-[11px] text-muted italic mt-1">
                Unmapped — fields land in the raw catalog only.
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {b.destinations.map((d) => (
                  <span
                    key={d.canonicalObject}
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border border-brand/40 bg-brand/[0.06] text-brand"
                  >
                    → {d.canonicalObject}
                    <span className="text-muted">·</span>
                    <span>{d.fieldCount}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Canonical detail card ─────────────────────────────────────────

function CanonicalDetailCard({
  canonicalKey,
  onClose,
}: {
  canonicalKey: string;
  onClose: () => void;
}) {
  const obj = getCanonicalObject(canonicalKey);
  // Fields with their contributor lists. Sorted by join-point weight so
  // the high-attention fields (most sources) surface first.
  const fieldStats = useMemo(() => {
    if (!obj) return [];
    return obj.fields
      .map((f) => ({
        field: f,
        contributors: contributorsFor(obj.key, f.key),
      }))
      .sort((a, b) => b.contributors.length - a.contributors.length);
  }, [obj]);

  const [selectedField, setSelectedField] = useState<string | null>(null);
  if (!obj) return null;

  const selectedStat = fieldStats.find((s) => s.field.key === selectedField);

  return (
    <div className="rounded-lg border border-brand/40 bg-brand/[0.03] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
            Canonical object
          </div>
          <div className="text-sm font-semibold tracking-tight">
            {obj.label}
          </div>
          <p className="text-[11px] text-muted mt-0.5 leading-snug max-w-2xl">
            {obj.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse"
          className="shrink-0 rounded-md border border-border w-6 h-6 inline-flex items-center justify-center hover:border-foreground/40 text-xs"
        >
          ×
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-2">
        {fieldStats.map((s) => {
          const isJoin = s.contributors.length > 1;
          const isUnmapped = s.contributors.length === 0;
          const isSelected = selectedField === s.field.key;
          return (
            <button
              key={s.field.key}
              type="button"
              onClick={() =>
                setSelectedField(isSelected ? null : s.field.key)
              }
              className={
                "text-left rounded-md border px-2.5 py-1.5 transition-colors " +
                (isSelected
                  ? "border-brand bg-brand/10"
                  : isJoin
                    ? "border-brand/30 bg-brand/[0.04] hover:border-brand"
                    : isUnmapped
                      ? "border-border bg-foreground/[0.02] text-muted"
                      : "border-border bg-background hover:border-brand")
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold truncate">
                  {s.field.key}
                  {s.field.isArray ? "[]" : ""}
                </span>
                <span className="text-[9px] font-mono uppercase text-muted shrink-0">
                  {s.field.type}
                </span>
              </div>
              <div className="text-[10px] mt-0.5 flex items-center gap-2">
                {isUnmapped ? (
                  <span className="text-muted italic">unmapped</span>
                ) : isJoin ? (
                  <span className="text-brand">
                    ⚠ {s.contributors.length} sources
                  </span>
                ) : (
                  <span className="text-muted">
                    {s.contributors.length} source
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedStat && (
        <FieldDrillCard
          field={selectedStat.field}
          contributors={selectedStat.contributors}
          onClose={() => setSelectedField(null)}
        />
      )}
    </div>
  );
}

function FieldDrillCard({
  field,
  contributors,
  onClose,
}: {
  field: CanonicalField;
  contributors: CanonicalContribution[];
  onClose: () => void;
}) {
  // Group by source so multiple-rawfields-from-same-source share one
  // brand chip. Hover the chip to see the full RawObject.field paths.
  const bySource = new Map<string, CanonicalContribution[]>();
  for (const c of contributors) {
    const arr = bySource.get(c.source) ?? [];
    arr.push(c);
    bySource.set(c.source, arr);
  }
  return (
    <div className="mt-3 rounded-md border border-brand/50 bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold">
              {field.key}
              {field.isArray ? "[]" : ""}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
              {field.type}
              {field.unit ? ` · ${field.unit}` : ""}
            </span>
            {field.relationTo && (
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-brand">
                → {field.relationTo}
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/80 mt-1 leading-snug">
            {field.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-xs text-muted hover:text-foreground"
        >
          ×
        </button>
      </div>
      {contributors.length === 0 ? (
        <div className="mt-2 text-[11px] text-muted italic">
          Unmapped — no raw source contributes to this canonical field yet.
        </div>
      ) : (
        <div className="mt-2.5">
          <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted mb-1.5">
            {contributors.length} contributing source
            {contributors.length === 1 ? "" : "s"} · hover an icon
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {Array.from(bySource.entries()).map(([source, items]) => {
              const brand = sourceToBrandKey(source);
              const tooltipText = `${source}\n${items
                .map((i) => `${i.rawObject}.${i.rawField}`)
                .join("\n")}`;
              return (
                <div
                  key={source}
                  title={tooltipText}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-background hover:border-brand transition-colors cursor-default"
                >
                  <span
                    aria-hidden
                    className="w-5 h-5 inline-flex items-center justify-center rounded bg-foreground/[0.04]"
                  >
                    <BrandLogo brand={brand} size={16} />
                  </span>
                  <span className="text-[11px] font-semibold">{source}</span>
                  <span className="text-[10px] font-mono text-muted">
                    ×{items.length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {field.joinNote && (
        <div className="mt-2.5 rounded-md border border-border bg-foreground/[0.02] px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted mb-0.5">
            Join resolution
          </div>
          <p className="text-[11px] leading-snug">{field.joinNote}</p>
        </div>
      )}
    </div>
  );
}
