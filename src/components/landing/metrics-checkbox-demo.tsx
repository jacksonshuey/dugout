"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandLogo, getBrandName, type BrandKey } from "./logos";

// Two-column "checkbox + metrics" demo for Step 01 of the onboarding
// walkthrough. Left column lets you check off the integrations you actually
// have; the right column shows which metrics are reachable given that set.
// Auto-plays a fixed selection sequence on mount, then pauses the moment the
// user clicks anything.

// IntegrationId reflects the six stack categories from the spec's Data layer
// (CRM, Conversation Intel, Sales Engagement, Deal Rooms, Meeting Scheduling,
// Prospecting/Enrichment) plus comms, contracts, and external signal sources.
// Multiple options per category so a metric tagged ["salesforce", "hubspot"]
// lights up if you have either CRM.
type IntegrationId =
  | "salesforce"
  | "hubspot"
  | "gong"
  | "granola"
  | "outreach"
  | "salesloft"
  | "dock"
  | "aligned"
  | "calendly"
  | "linkedin"
  | "apollo"
  | "slack"
  | "docusign"
  | "newsapi";

interface Metric {
  id: string;
  name: string;
  sources: IntegrationId[];
}

const INTEGRATIONS: IntegrationId[] = [
  "salesforce",
  "hubspot",
  "gong",
  "granola",
  "outreach",
  "salesloft",
  "dock",
  "aligned",
  "calendly",
  "linkedin",
  "apollo",
  "slack",
  "docusign",
  "newsapi",
];

// Metrics map 1:1 onto the RULES library in src/lib/signal-engine.ts where
// possible; the rest are derived measurements that flow from the same
// integration categories. Source lists are inclusive — any one source unlocks
// the row.
const CRM: IntegrationId[] = ["salesforce", "hubspot"];
const CONV_INTEL: IntegrationId[] = ["gong", "granola"];
const SALES_ENGAGEMENT: IntegrationId[] = ["outreach", "salesloft"];
const DEAL_ROOMS: IntegrationId[] = ["dock", "aligned"];
const ENRICHMENT: IntegrationId[] = ["linkedin", "apollo"];

const METRICS: Metric[] = [
  // CRM-rooted (Signal engine: SELECTED_VENDOR_NO_FINANCE, NO_FINANCE_AT_EVALUATING, …)
  { id: "finance-gate", name: "Finance gate unmanned (Selected Vendor)", sources: CRM },
  { id: "procurement-late", name: "Procurement not engaged", sources: CRM },
  { id: "no-finance-eval", name: "No Finance contact on Evaluating", sources: CRM },
  { id: "no-it-eval", name: "No IT/Security contact on Evaluating", sources: CRM },
  { id: "single-thread", name: "Single-thread risk", sources: CRM },
  { id: "stage-age", name: "Stage age vs. benchmark", sources: CRM },
  { id: "committee-cov", name: "Buying-committee coverage", sources: [...CRM, ...ENRICHMENT] },

  // Conversation intelligence (CALL_NEGATIVE_SENTIMENT + derived)
  { id: "neg-sentiment", name: "Negative call sentiment", sources: CONV_INTEL },
  { id: "talk-ratio", name: "Talk-time ratio", sources: CONV_INTEL },
  { id: "next-step", name: "Next-step commitment extraction", sources: CONV_INTEL },
  { id: "champion-silent", name: "Champion silent (7+ days)", sources: [...CONV_INTEL, ...SALES_ENGAGEMENT] },
  { id: "it-pager", name: "IT one-pager owed after IT signal", sources: [...CONV_INTEL, ...DEAL_ROOMS] },

  // Sales engagement
  { id: "reply-velocity", name: "Sequence reply velocity", sources: SALES_ENGAGEMENT },

  // Deal rooms (ASSET_GAP_*, NO_TRIAL_BRIEF_AT_DEMO_SAT)
  { id: "trial-brief", name: "Outcome-first trial brief delivered", sources: DEAL_ROOMS },
  { id: "finance-brief", name: "Finance brief delivered", sources: DEAL_ROOMS },
  { id: "asset-engmt", name: "Buyer asset engagement", sources: DEAL_ROOMS },

  // Meeting scheduling (DEMO_NOT_BOOKED)
  { id: "demo-booked", name: "Champion → demo booked", sources: ["calendly"] },

  // Stakeholder / enrichment (CHAMPION_DEPARTED + derived)
  { id: "champ-departed", name: "Champion has left the company", sources: ENRICHMENT },
  { id: "role-changes", name: "Stakeholder role changes", sources: ENRICHMENT },
  { id: "multi-thread", name: "Multi-thread depth", sources: [...CRM, "linkedin"] },

  // Comms / contracts / external
  { id: "urgency", name: "Internal urgency signal", sources: ["slack"] },
  { id: "redlines", name: "Contract redline activity", sources: ["docusign"] },
  { id: "news-velocity", name: "Account news velocity", sources: ["newsapi"] },
];

// Autoplay reveals one new integration per tick. Stops after primary picks
// (10 of 14) so the alternate-vendor rows stay visible for the user to click.
const AUTOPLAY_ORDER: IntegrationId[] = [
  "salesforce",
  "gong",
  "outreach",
  "dock",
  "calendly",
  "linkedin",
  "apollo",
  "slack",
  "docusign",
  "newsapi",
];

const AUTOPLAY_SEQUENCE: ReadonlyArray<ReadonlyArray<IntegrationId>> = [
  [],
  ...AUTOPLAY_ORDER.map((_, i) => AUTOPLAY_ORDER.slice(0, i + 1)),
];

const STEP_DURATION_MS = 1100;
const HOLD_AT_END_MS = 3000;

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

export function MetricsCheckboxDemo() {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState<ReadonlyArray<IntegrationId> | null>(
    null,
  );

  useEffect(() => {
    if (reducedMotion || manual) return;
    const isLast = step === AUTOPLAY_SEQUENCE.length - 1;
    const t = setTimeout(
      () => setStep((n) => (n + 1) % AUTOPLAY_SEQUENCE.length),
      isLast ? HOLD_AT_END_MS : STEP_DURATION_MS,
    );
    return () => clearTimeout(t);
  }, [step, manual, reducedMotion]);

  const selected: ReadonlyArray<IntegrationId> =
    manual ??
    (reducedMotion
      ? AUTOPLAY_SEQUENCE[AUTOPLAY_SEQUENCE.length - 1]
      : AUTOPLAY_SEQUENCE[step]);
  const selectedSet = new Set(selected);

  const toggle = (id: IntegrationId) => {
    const current = manual ?? Array.from(selectedSet);
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setManual(next);
  };

  const isAvailable = (m: Metric) =>
    m.sources.some((s) => selectedSet.has(s));
  const availableCount = METRICS.filter(isAvailable).length;

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-background">
      {/* Header row */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.15fr] bg-foreground/[0.03] border-b border-border">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Integration
          </span>
          <span className="text-[10px] font-mono text-muted tabular-nums">
            {selected.length} / {INTEGRATIONS.length}
          </span>
        </div>
        <div className="px-4 py-2.5 flex items-center justify-between sm:border-l border-border border-t sm:border-t-0">
          <span className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Available metric
          </span>
          <span className="text-[10px] font-mono text-muted tabular-nums">
            {availableCount} / {METRICS.length}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.15fr]">
        {/* Integrations column */}
        <ul className="divide-y divide-border">
          {INTEGRATIONS.map((id) => {
            const checked = selectedSet.has(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-foreground/[0.03] transition-colors text-left"
                  aria-pressed={checked}
                >
                  <Checkbox checked={checked} />
                  <BrandLogo brand={id as BrandKey} size={20} />
                  <span className="text-sm">
                    {getBrandName(id as BrandKey)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Metrics column */}
        <ul className="divide-y divide-border sm:border-l border-t sm:border-t-0 border-border">
          {METRICS.map((m) => {
            const available = isAvailable(m);
            return (
              <li
                key={m.id}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-opacity duration-300 ${
                  available ? "opacity-100" : "opacity-30"
                }`}
              >
                <span className="text-sm leading-snug">{m.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {m.sources.map((s) => (
                    <BrandLogo
                      key={s}
                      brand={s as BrandKey}
                      size={14}
                      className={
                        selectedSet.has(s) ? "opacity-100" : "opacity-40"
                      }
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-[4px] border transition-colors ${
        checked
          ? "bg-brand border-brand"
          : "bg-background border-border"
      }`}
      aria-hidden
    >
      {checked && (
        <svg
          viewBox="0 0 12 12"
          className="w-3 h-3 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2.5 6.5 5 9 9.5 3.5" />
        </svg>
      )}
    </span>
  );
}
