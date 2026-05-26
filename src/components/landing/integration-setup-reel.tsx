"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandLogo, getBrandName, type BrandKey } from "./logos";
import type { IntegrationHealth } from "@/lib/integration-health";

// Autoplay reel for the integration constellation right column. Cycles
// through a simulated Granola setup (key paste → field fill → verify →
// success) and then reveals the integration constellation, lighting up
// chips with Granola flagged as just-connected.
//
// Pure visual demo: no real action calls, no network. Pre-recorded values
// keep the timing predictable and the bundle small.

export interface IntegrationSlot {
  brand: BrandKey;
  role: string;
  status: "live" | "beta" | "config";
}

const FAKE_API_KEY = "grn_pk_4f9e2a8c1b7d3e0f5a";

type Phase =
  | "empty"
  | "typing-key"
  | "filling-fields"
  | "verifying"
  | "success"
  | "constellation";

const PHASE_DURATIONS: Record<Phase, number> = {
  empty: 600,
  "typing-key": 1500,
  "filling-fields": 1100,
  verifying: 950,
  success: 1100,
  constellation: 3400,
};

// The constellation reveal phase is intentionally excluded — the reel just
// cycles through the setup-card phases (key paste → verify → success →
// loop). The icon grid is rendered in IntegrationConstellation elsewhere.
const ORDER: Phase[] = [
  "empty",
  "typing-key",
  "filling-fields",
  "verifying",
  "success",
];

// matchMedia subscription via useSyncExternalStore - avoids a setState-in-
// effect cascade and gives correct SSR behavior (treat as "no preference"
// on the server, then re-render after hydration if reduce is on).
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

export function IntegrationSetupReel({
  integrations,
  health,
}: {
  integrations: IntegrationSlot[];
  // Per-brand configuration health from `checkAllHealth()`. Optional -
  // when omitted, chips fall back to the static status color and skip the
  // missing-credential treatment.
  health?: Record<string, IntegrationHealth>;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [tick, setTick] = useState(0);

  // Each tick advances one phase. Cycle counter (tick / ORDER.length) keys the
  // typing child so it remounts at the start of each loop without an effect-
  // driven state reset.
  const phase = reducedMotion ? "success" : ORDER[tick % ORDER.length];
  const cycle = Math.floor(tick / ORDER.length);

  useEffect(() => {
    if (reducedMotion) return;
    const t = setTimeout(
      () => setTick((n) => n + 1),
      PHASE_DURATIONS[phase],
    );
    return () => clearTimeout(t);
  }, [tick, phase, reducedMotion]);

  const showConstellation = phase === "constellation";

  return (
    <div className="relative w-full" style={{ minHeight: 360 }}>
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          showConstellation ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        aria-hidden={showConstellation}
      >
        <SetupCard key={`form-${cycle}`} phase={phase} />
      </div>
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          showConstellation ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!showConstellation}
      >
        <ConstellationGrid
          key={`grid-${cycle}`}
          integrations={integrations}
          health={health}
          animateIn={showConstellation && !reducedMotion}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup card - simulated Granola connector form.
// ---------------------------------------------------------------------------

function SetupCard({ phase }: { phase: Phase }) {
  const fieldsFilled =
    phase === "filling-fields" ||
    phase === "verifying" ||
    phase === "success";
  // The key is visually "complete" once we leave typing-key - every later
  // phase keeps the full string visible while the user moves on to other
  // fields.
  const keyComplete = phase !== "empty" && phase !== "typing-key";
  const verifyEnabled = keyComplete && fieldsFilled;

  return (
    <div className="rounded-2xl border border-border bg-background shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-3">
        <BrandLogo brand="granola" size={36} />
        <div>
          <div className="text-sm font-semibold tracking-tight">
            Connect Granola
          </div>
          <div className="text-[11px] text-muted">
            Meeting signal extraction
          </div>
        </div>
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted">
          Step 1 of 1
        </span>
      </div>

      <FieldRow label="API key">
        <TypedKey
          fullKey={FAKE_API_KEY}
          phase={phase}
        />
        <div className="text-[10px] text-muted mt-1">
          Granola → Settings → API keys
        </div>
      </FieldRow>

      <FieldRow label="Workspace">
        <FillingValue
          value="Checkbox · Production"
          filled={fieldsFilled}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Sync frequency">
          <FillingValue value="Every 15 min" filled={fieldsFilled} />
        </FieldRow>
        <FieldRow label="Lookback">
          <FillingValue value="30 days" filled={fieldsFilled} />
        </FieldRow>
      </div>

      <div className="pt-1 flex items-center gap-3">
        <ConfirmButton phase={phase} enabled={verifyEnabled} />
        <span className="text-[10px] text-muted">
          Encrypted in Supabase Vault · never returned to the browser
        </span>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono mb-1">
        {label}
      </div>
      <div className="rounded-lg border border-border bg-foreground/[0.02] px-3 py-2 min-h-[40px]">
        {children}
      </div>
    </div>
  );
}

function FillingValue({ value, filled }: { value: string; filled: boolean }) {
  return (
    <div
      className={`text-sm transition-opacity duration-500 ${
        filled ? "opacity-100 text-foreground" : "opacity-0"
      }`}
    >
      {value}
    </div>
  );
}

// Owns its own typing counter so it can reset cleanly when the parent
// remounts it (via key) at the start of each loop cycle - no need for the
// parent to fight react-hooks/set-state-in-effect.
function TypedKey({ fullKey, phase }: { fullKey: string; phase: Phase }) {
  const [len, setLen] = useState(0);
  const active = phase === "typing-key";
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setLen((n) => (n >= fullKey.length ? n : n + 1));
    }, 60);
    return () => clearInterval(id);
  }, [active, fullKey.length]);
  // Past the typing phase: pin to the full key so subsequent phases show
  // the completed value.
  const visible =
    phase === "empty"
      ? ""
      : phase === "typing-key"
        ? fullKey.slice(0, len)
        : fullKey;
  return (
    <div className="font-mono text-xs text-foreground break-all min-h-[18px]">
      {visible}
      {active && (
        <span className="inline-block w-[1ch] -ml-0.5 align-baseline animate-pulse text-foreground">
          |
        </span>
      )}
    </div>
  );
}

function ConfirmButton({
  phase,
  enabled,
}: {
  phase: Phase;
  enabled: boolean;
}) {
  if (phase === "verifying") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-medium bg-brand text-white opacity-90"
      >
        <Spinner />
        Verifying…
      </button>
    );
  }
  if (phase === "success") {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-medium bg-severity-green text-white"
      >
        <CheckIcon />
        Connected · 247 notes
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled
      className={`inline-flex items-center px-4 h-9 rounded-lg text-sm font-medium transition-colors ${
        enabled
          ? "bg-brand text-white"
          : "bg-foreground/10 text-muted cursor-not-allowed"
      }`}
    >
      Verify &amp; connect
    </button>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M12 3a9 9 0 1 1-6.36 2.64" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l4 4L19 7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Constellation grid - the "after" view. Chips fade in staggered; Granola
// gets a green pulse halo to read as just-connected.
// ---------------------------------------------------------------------------

function ConstellationGrid({
  integrations,
  health,
  animateIn,
}: {
  integrations: IntegrationSlot[];
  health?: Record<string, IntegrationHealth>;
  animateIn: boolean;
}) {
  // Granola first so its pulse reads as the new addition, then the rest in
  // the order the caller passed them.
  const ordered = [
    ...integrations.filter((i) => i.brand === "granola"),
    ...integrations.filter((i) => i.brand !== "granola"),
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {ordered.map((i, idx) => (
        <IntegrationChip
          key={i.brand}
          integration={i}
          health={health?.[i.brand]}
          delayMs={animateIn ? idx * 70 : 0}
          animateIn={animateIn}
          highlight={i.brand === "granola"}
        />
      ))}
    </div>
  );
}

function IntegrationChip({
  integration,
  health,
  delayMs,
  animateIn,
  highlight,
}: {
  integration: IntegrationSlot;
  health?: IntegrationHealth;
  delayMs: number;
  animateIn: boolean;
  highlight: boolean;
}) {
  const missing = health?.mode === "missing";
  // Dot color = static status (live/beta/config). Missing-credential state
  // is surfaced through the border tint + tooltip below, not the dot -
  // overloading one indicator with two axes (status + health) reads as
  // confusion in practice.
  const dot =
    integration.status === "live"
      ? "bg-severity-green"
      : integration.status === "beta"
        ? "bg-severity-action"
        : "bg-slate-400";
  // Border priority: missing-credential warning beats highlight beats default.
  const border = missing
    ? "border-severity-blocking/40"
    : highlight
      ? "border-severity-green/40"
      : "border-border";
  // Tooltip text. Health note when available; otherwise the static role.
  const titleText = health
    ? `${getBrandName(integration.brand)} · ${health.note}`
    : `${getBrandName(integration.brand)} · ${integration.role}`;
  return (
    <div
      className={`relative rounded-xl border bg-background p-3 flex items-center gap-3 transition-all duration-500 ${
        animateIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
      } ${border}`}
      style={{ transitionDelay: `${delayMs}ms` }}
      title={titleText}
    >
      {highlight && animateIn && !missing && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-severity-green animate-ping"
        />
      )}
      {missing && (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-severity-blocking"
        />
      )}
      <BrandLogo brand={integration.brand} size={40} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold tracking-tight text-sm truncate">
            {getBrandName(integration.brand)}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        </div>
        <div className="text-[11px] text-muted truncate">{integration.role}</div>
      </div>
    </div>
  );
}
