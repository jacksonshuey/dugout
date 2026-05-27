"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandLogo, getBrandName, type BrandKey } from "./logos";
import {
  STEP_GRID_CLASS,
  STEP_LEFT_COL_CLASS,
  STEP_RIGHT_COL_CLASS,
} from "./step-layout";

// Dynamic zippering demo. Cycles through a simulated ingest where three
// integrations land rows on the same account (acc_snowflake / Snowflake), and
// Haiku routes each column into a canonical wide row. Visual goal: make the
// "joining" verb literal — the user watches columns from three schemas
// collapse onto one row, with brand-chip provenance per canonical cell.
//
// Pre-recorded values keep the timing predictable and the bundle small.
// No network, no model calls. The point is to communicate the mechanism.
//
// Field paths reflect actual API shapes (Salesforce CamelCase + dot
// notation, HubSpot snake_case properties, Outreach JSON:API attributes).
// If a path looks unfamiliar, that's the point — the divergence is what
// the zipperer absorbs. Final names will be confirmed during real adapter
// buildout; for the demo they're representative.

interface DemoColumn {
  path: string; // source-side field path, e.g. "Opportunity.CloseDate"
  value: string; // displayed value
  routesTo: string; // canonical column name
  canonicalType: string; // "timestamp" | "text" | "number" | ...
  similarity: number; // 0..1, Haiku-reported
}

interface DemoSource {
  brand: BrandKey;
  columns: DemoColumn[];
}

// Demo dataset — one fictional Snowflake deal observed by three integrations.
// Columns are ordered so that Salesforce always introduces new canonicals
// (all `append`); Gong and HubSpot mostly `join` into the existing canonical,
// with one fresh `append` per source to keep the wide row growing.
const SOURCES: DemoSource[] = [
  {
    brand: "salesforce",
    columns: [
      {
        path: "Opportunity.CloseDate",
        value: "2026-06-15",
        routesTo: "occurred_at",
        canonicalType: "timestamp",
        similarity: 0.94,
      },
      {
        path: "Contact.Email",
        value: "jane.chen@snowflake.com",
        routesTo: "contact_email",
        canonicalType: "text",
        similarity: 0.99,
      },
      {
        path: "Opportunity.Amount",
        value: "$420,000",
        routesTo: "deal_amount",
        canonicalType: "number",
        similarity: 0.97,
      },
    ],
  },
  {
    brand: "gong",
    columns: [
      {
        path: "call.metaData.scheduled",
        value: "2026-06-15T14:00Z",
        routesTo: "occurred_at",
        canonicalType: "timestamp",
        similarity: 0.96,
      },
      {
        path: "call.parties[0].emailAddress",
        value: "jane.chen@snowflake.com",
        routesTo: "contact_email",
        canonicalType: "text",
        similarity: 0.98,
      },
      {
        path: "call.content.brief",
        value: "Q3 budget review, Finance looped in",
        routesTo: "summary",
        canonicalType: "text",
        similarity: 0.91,
      },
    ],
  },
  {
    brand: "hubspot",
    columns: [
      {
        path: "deal.properties.closedate",
        value: "2026-06-15",
        routesTo: "occurred_at",
        canonicalType: "timestamp",
        similarity: 0.95,
      },
      {
        path: "contact.properties.email",
        value: "jane.chen@snowflake.com",
        routesTo: "contact_email",
        canonicalType: "text",
        similarity: 0.99,
      },
      {
        path: "deal.properties.dealstage",
        value: "Selected Vendor",
        routesTo: "stage",
        canonicalType: "text",
        similarity: 0.89,
      },
    ],
  },
];

// Flatten every source × column into a single ordered step list. The demo
// walks through these in order; each step lights up the source cell, shows
// Haiku's verdict, and updates the canonical row.
interface DemoStep {
  sourceIdx: number;
  columnIdx: number;
  column: DemoColumn;
  brand: BrandKey;
  isAppend: boolean; // true the first time this canonical name appears
}

const STEPS: DemoStep[] = (() => {
  const seen = new Set<string>();
  const steps: DemoStep[] = [];
  SOURCES.forEach((src, sourceIdx) => {
    src.columns.forEach((col, columnIdx) => {
      steps.push({
        sourceIdx,
        columnIdx,
        column: col,
        brand: src.brand,
        isAppend: !seen.has(col.routesTo),
      });
      seen.add(col.routesTo);
    });
  });
  return steps;
})();

const STEP_MS = 1100;
const RESET_HOLD_MS = 2800;

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
function getReducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function getReducedMotionServerSnapshot() {
  return false;
}

export function LiveZipperingDemo() {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  // stepIdx ranges from -1 (intro) through STEPS.length (held final state).
  // When reducedMotion is true we don't run the timer; the displayed index
  // is derived (jumps straight to the held-final state) rather than written
  // through setState inside an effect.
  const [stepIdx, setStepIdx] = useState(-1);
  const displayStepIdx = reducedMotion ? STEPS.length : stepIdx;

  useEffect(() => {
    if (reducedMotion) return;
    const isHold = stepIdx >= STEPS.length;
    const delay = isHold ? RESET_HOLD_MS : STEP_MS;
    const t = setTimeout(() => {
      setStepIdx((prev) => {
        if (prev >= STEPS.length) return -1; // reset to intro
        return prev + 1;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [stepIdx, reducedMotion]);

  // Active = the column the spotlight is on right now.
  const activeStep =
    displayStepIdx >= 0 && displayStepIdx < STEPS.length ? STEPS[displayStepIdx] : null;

  // Canonical state: list of {name, type, contributors[]} accumulated through
  // step displayStepIdx. Rebuilt from STEPS on every render — cheap, deterministic.
  const canonical = buildCanonicalState(displayStepIdx);

  return (
    <div className="mt-10 rounded-xl border border-border bg-foreground/[0.02] overflow-hidden">
      <DemoHeader stepIdx={displayStepIdx} activeStep={activeStep} />
      {/* Canonical step split: 5 left / 7 right. See step-layout.ts.
          The right-column boundary aligns vertically with Step 01's
          Connect Granola popup. */}
      <div className={`${STEP_GRID_CLASS} gap-6 px-5 sm:px-6 py-6`}>
        <div className={`${STEP_LEFT_COL_CLASS} space-y-3`}>
          {SOURCES.map((src, sourceIdx) => (
            <SourceTable
              key={src.brand}
              source={src}
              sourceIdx={sourceIdx}
              activeStep={activeStep}
              stepIdx={displayStepIdx}
            />
          ))}
        </div>
        <div className={STEP_RIGHT_COL_CLASS}>
          <CanonicalWideRow canonical={canonical} activeStep={activeStep} />
        </div>
      </div>
      <div className="px-5 sm:px-6 py-3 border-t border-border bg-foreground/[0.03] flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
          decision cached per (account, source, column)
        </div>
        <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          {canonical.length} canonical {canonical.length === 1 ? "column" : "columns"}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — running commentary on what Haiku is doing right now.
// ---------------------------------------------------------------------------

function DemoHeader({
  stepIdx,
  activeStep,
}: {
  stepIdx: number;
  activeStep: DemoStep | null;
}) {
  let line: React.ReactNode;
  if (stepIdx < 0) {
    line = "Three integrations land on acc_snowflake (Snowflake).";
  } else if (activeStep) {
    const verb = activeStep.isAppend ? "append" : "join";
    line = (
      <>
        <span className="text-foreground/85">
          {getBrandName(activeStep.brand)}
        </span>
        <span className="text-muted">{" · "}</span>
        <code className="font-mono text-[12px] text-foreground/85">
          {activeStep.column.path}
        </code>
        <span className="text-muted">{" → "}</span>
        <span
          className={
            verb === "append"
              ? "uppercase tracking-[0.15em] font-mono text-[10px] text-brand"
              : "uppercase tracking-[0.15em] font-mono text-[10px] text-severity-green"
          }
        >
          {verb}
        </span>
        <span className="text-muted">{" → "}</span>
        <code className="font-mono text-[12px] text-foreground/85">
          {activeStep.column.routesTo}
        </code>
        <span className="text-muted ml-2 text-[11px]">
          ({activeStep.column.similarity.toFixed(2)})
        </span>
      </>
    );
  } else {
    line = "Wide row complete. Three sources, one shape.";
  }
  return (
    <div className="px-5 sm:px-6 py-3 border-b border-border flex items-baseline justify-between gap-3 flex-wrap">
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
        Live zippering · AI
      </div>
      <div className="text-[12px] text-foreground/70 font-mono">{line}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceTable — one row per integration. Cells light up as the spotlight
// passes; visited cells stay subtly highlighted with their brand color.
// ---------------------------------------------------------------------------

function SourceTable({
  source,
  sourceIdx,
  activeStep,
  stepIdx,
}: {
  source: DemoSource;
  sourceIdx: number;
  activeStep: DemoStep | null;
  stepIdx: number;
}) {
  const isCurrentLane = activeStep?.sourceIdx === sourceIdx;
  const laneActive = stepIdx < 0 ? false : isCurrentLane;
  const laneVisited = stepIdx >= 0 && stepIdx >= STEPS.findIndex(
    (s) => s.sourceIdx === sourceIdx,
  );
  return (
    <div
      className={
        "rounded-lg border bg-background overflow-hidden transition-opacity duration-300 " +
        (laneActive
          ? "border-brand/40 opacity-100"
          : laneVisited
            ? "border-border opacity-80"
            : "border-border opacity-50")
      }
    >
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-border bg-foreground/[0.02]">
        <BrandLogo brand={source.brand} size={20} />
        <span className="text-[12px] font-semibold tracking-tight">
          {getBrandName(source.brand)}
        </span>
        <span className="text-[10px] text-muted font-mono ml-auto">
          incoming row
        </span>
      </div>
      <ul className="divide-y divide-border">
        {source.columns.map((col, columnIdx) => {
          const isActive =
            activeStep?.sourceIdx === sourceIdx &&
            activeStep?.columnIdx === columnIdx;
          const cellStepIdx = STEPS.findIndex(
            (s) => s.sourceIdx === sourceIdx && s.columnIdx === columnIdx,
          );
          const isVisited = stepIdx >= cellStepIdx && cellStepIdx >= 0;
          return (
            <li
              key={col.path}
              className={
                "grid grid-cols-12 gap-3 px-3 py-2 items-center transition-colors duration-300 " +
                (isActive
                  ? "bg-brand/[0.08]"
                  : isVisited
                    ? "bg-foreground/[0.02]"
                    : "")
              }
            >
              <code
                className={
                  "col-span-6 font-mono text-[12px] truncate transition-colors " +
                  (isActive
                    ? "text-foreground font-semibold"
                    : "text-foreground/70")
                }
              >
                {col.path}
              </code>
              <span
                className={
                  "col-span-6 text-[12px] truncate text-right transition-colors " +
                  (isActive ? "text-foreground" : "text-foreground/55")
                }
              >
                {col.value}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CanonicalWideRow — the merged result. Grows as the demo progresses. Each
// canonical cell shows its name, type, value, and a stack of brand chips
// indicating which sources contributed to it.
// ---------------------------------------------------------------------------

interface CanonicalCell {
  name: string;
  type: string;
  value: string;
  contributors: BrandKey[];
}

function buildCanonicalState(stepIdx: number): CanonicalCell[] {
  if (stepIdx < 0) return [];
  const lastStep = Math.min(stepIdx, STEPS.length - 1);
  const map = new Map<string, CanonicalCell>();
  for (let i = 0; i <= lastStep; i++) {
    const s = STEPS[i];
    const existing = map.get(s.column.routesTo);
    if (existing) {
      if (!existing.contributors.includes(s.brand)) {
        existing.contributors.push(s.brand);
      }
    } else {
      map.set(s.column.routesTo, {
        name: s.column.routesTo,
        type: s.column.canonicalType,
        value: s.column.value,
        contributors: [s.brand],
      });
    }
  }
  return Array.from(map.values());
}

function CanonicalWideRow({
  canonical,
  activeStep,
}: {
  canonical: CanonicalCell[];
  activeStep: DemoStep | null;
}) {
  return (
    <div className="rounded-lg border-2 border-brand/40 bg-background overflow-hidden h-full">
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-brand/30 bg-brand/[0.06]">
        <span
          aria-hidden
          className="w-5 h-5 rounded bg-brand text-background flex items-center justify-center text-[11px] font-bold"
        >
          ⇶
        </span>
        <span className="text-[12px] font-semibold tracking-tight">
          Canonical wide row
        </span>
        <code className="text-[10px] text-muted font-mono ml-auto">
          pkey: acc_snowflake
        </code>
      </div>
      <ul className="divide-y divide-border min-h-[240px]">
        {canonical.length === 0 ? (
          <li className="px-4 py-8 text-[12px] text-muted text-center italic">
            Waiting for first ingest…
          </li>
        ) : (
          canonical.map((cell) => {
            const isJustUpdated =
              activeStep?.column.routesTo === cell.name;
            return (
              <li
                key={cell.name}
                className={
                  "px-3 py-2.5 transition-colors duration-300 " +
                  (isJustUpdated ? "bg-brand/[0.08]" : "")
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <code
                    className={
                      "font-mono text-[13px] font-semibold transition-colors " +
                      (isJustUpdated ? "text-brand" : "text-foreground")
                    }
                  >
                    {cell.name}
                  </code>
                  <span className="text-[10px] font-mono text-muted">
                    {cell.type}
                  </span>
                </div>
                <div className="mt-1 text-[12px] text-foreground/75 truncate">
                  {cell.value}
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  {cell.contributors.map((b) => (
                    <span
                      key={b}
                      className="inline-flex items-center"
                      title={`From ${getBrandName(b)}`}
                    >
                      <BrandLogo brand={b} size={14} />
                    </span>
                  ))}
                  {cell.contributors.length > 1 && (
                    <span className="ml-1 text-[9px] uppercase tracking-[0.15em] font-mono text-severity-green">
                      joined
                    </span>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
