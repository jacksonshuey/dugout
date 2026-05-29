"use client";

import { useEffect, useState } from "react";
import {
  accountsById,
  demoSignals,
  opportunities,
  reps,
} from "@/data/seed";
import type { Stage } from "@/lib/types";

// "Live workspace" dashboard, styled after the BizLink CRM reference but in
// Dugout's tokens: a hero band (weekday signal bars + a radial gauge + two
// stat callouts) over a stage-based deal board. All figures derive from the
// seeded pipeline/signals so they stay consistent with the rest of the page.

const repById = new Map(reps.map((r) => [r.id, r]));

function fmtCompactUSD(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? "—"
    : d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

// ── Derived data ────────────────────────────────────────────────────────────

const pipelineValue = opportunities.reduce((s, o) => s + o.amount, 0);
const signalsFiring = demoSignals.length;
const blockedOppIds = new Set(
  demoSignals.filter((s) => s.severity === "blocking").map((s) => s.oppId),
);
const healthyPct = Math.round(
  ((opportunities.length - blockedOppIds.size) / opportunities.length) * 100,
);

// Weekday signal counts (Mon–Fri) for the hero bar chart.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const weekdayCounts = WEEKDAY_LABELS.map((_, i) => {
  const target = i + 1; // JS getDay: Mon=1 … Fri=5
  return demoSignals.filter((s) => new Date(s.detectedAt).getDay() === target).length;
});

const signalCountByOpp = new Map<string, number>();
for (const s of demoSignals) {
  signalCountByOpp.set(s.oppId, (signalCountByOpp.get(s.oppId) ?? 0) + 1);
}

// Funnel order; only stages with at least one opp render as a column.
const STAGE_ORDER: Stage[] = [
  "Intro",
  "Qualified",
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
];

// What each pipeline stage means — surfaced as a hover tooltip on the column.
const STAGE_BLURBS: Record<Stage, string> = {
  Intro: "First contact made — exploring whether there's a fit.",
  Qualified: "Fit confirmed: budget, authority, need, and timeline all check out.",
  "Demo Sat": "Product demo delivered — the buying team has seen Dugout in action.",
  Evaluating: "Buyer is actively comparing options or running an internal review / pilot.",
  "Selected Vendor": "Chosen as the preferred vendor; aligning on scope and terms.",
  Contracting: "In legal & procurement — redlines, MSA, and signature.",
};

interface DealCardData {
  id: string;
  account: string;
  subtitle: string;
  closeDate: string;
  signals: number;
  contacts: number;
  blocked: boolean;
  hqLocation: string;
  domain?: string;
  ownerName: string;
  ownerRole: string;
  amount: number;
}

function toCard(oppId: string): DealCardData | null {
  const o = opportunities.find((x) => x.id === oppId);
  if (!o) return null;
  const acc = accountsById.get(o.accountId);
  const owner = repById.get(o.ownerId);
  return {
    id: o.id,
    account: acc?.name ?? "Account",
    subtitle: o.name,
    closeDate: o.closeDate,
    signals: signalCountByOpp.get(o.id) ?? 0,
    contacts: o.contactRoleIds.length,
    blocked: blockedOppIds.has(o.id),
    hqLocation: acc?.hqLocation ?? "",
    domain: acc?.domain,
    ownerName: owner?.name ?? "Unassigned",
    ownerRole: owner?.role ?? "",
    amount: o.amount,
  };
}

const columns = STAGE_ORDER.map((stage) => ({
  stage,
  cards: opportunities
    .filter((o) => o.stage === stage)
    .map((o) => toCard(o.id))
    .filter((c): c is DealCardData => c !== null),
})).filter((col) => col.cards.length > 0);

// Headlines for the rotating news filler card.
const headlines = [...demoSignals]
  .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt))
  .slice(0, 8)
  .map((s) => {
    const o = opportunities.find((x) => x.id === s.oppId);
    const acc = o ? accountsById.get(o.accountId) : undefined;
    return { account: acc?.name ?? "Workspace", title: s.title };
  });

// Product widgets in their own "Tools" section, distinct from the pipeline
// columns: automation = brand (orange) CTA into the composer; news = black
// live rotator.

// Shared collapsed-card height so every column's rows align (symmetric board).
const CARD_MIN_H = "min-h-[150px]";

function scrollToComposer() {
  document
    .getElementById("automation-composer")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Top-level ────────────────────────────────────────────────────────────────

export function OverviewDashboardBody() {
  return (
    <div className="mt-8 space-y-6">
      <KpiHero />
      <DealBoard />
    </div>
  );
}

// ── Hero band ────────────────────────────────────────────────────────────────

function KpiHero() {
  return (
    <div className="rounded-2xl border border-border bg-brand/[0.06] p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr_0.8fr_0.8fr] lg:items-center">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] font-mono text-muted">
            Signals this week
          </div>
          <WeekdayBars counts={weekdayCounts} />
        </div>

        <div className="flex justify-center">
          <Gauge pct={healthyPct} label="Healthy deals" />
        </div>

        <StatCallout value={String(signalsFiring)} label="Signals firing" />
        <StatCallout value={fmtCompactUSD(pipelineValue)} label="Open pipeline" />
      </div>
    </div>
  );
}

function WeekdayBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const W = 240;
  const H = 120;
  const pad = 18;
  const slot = (W - pad) / counts.length;
  const barW = slot * 0.42;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full max-w-[260px]" aria-hidden>
      {[0, 0.5, 1].map((t) => (
        <line
          key={t}
          x1={pad}
          x2={W}
          y1={pad + (H - pad * 2) * (1 - t)}
          y2={pad + (H - pad * 2) * (1 - t)}
          stroke="currentColor"
          className="text-border"
          strokeWidth="1"
        />
      ))}
      {counts.map((c, i) => {
        // Round to fixed precision so SSR/client SVG strings match exactly.
        const h = Number(((c / max) * (H - pad * 2)).toFixed(3));
        const x = Number((pad + i * slot + (slot - barW) / 2).toFixed(3));
        const y = Number((H - pad - h).toFixed(3));
        const w = Number(barW.toFixed(3));
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(h, 2)} rx="3" className="fill-foreground" />
            <text
              x={Number((x + w / 2).toFixed(3))}
              y={H - 4}
              textAnchor="middle"
              className="fill-muted"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
            >
              {WEEKDAY_LABELS[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Gauge({ pct, label }: { pct: number; label: string }) {
  const ticks = 40;
  const filled = Math.round((pct / 100) * ticks);
  const cx = 90;
  const cy = 90;
  const rOuter = 78;
  const rInner = 62;
  return (
    <div className="relative w-[180px] h-[104px]">
      <svg viewBox="0 0 180 100" className="w-full h-full" aria-hidden>
        {Array.from({ length: ticks }, (_, i) => {
          // 180° sweep, left (180°) → right (0°). Round coordinates to a fixed
          // precision so the SVG strings match exactly between server render
          // and client hydration (raw floats differ in their last digit).
          const angle = Math.PI - (i / (ticks - 1)) * Math.PI;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x1 = (cx + rInner * cos).toFixed(3);
          const y1 = (cy - rInner * sin).toFixed(3);
          const x2 = (cx + rOuter * cos).toFixed(3);
          const y2 = (cy - rOuter * sin).toFixed(3);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth="2"
              strokeLinecap="round"
              className={i < filled ? "stroke-foreground" : "stroke-border"}
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <div className="text-3xl font-semibold tracking-tight tabular-nums">{pct}%</div>
        <div className="text-[11px] text-muted">{label}</div>
      </div>
    </div>
  );
}

function StatCallout({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <div className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        <div className="mt-0.5 text-[11px] text-muted leading-snug">{label}</div>
      </div>
      <span aria-hidden className="text-muted text-lg shrink-0">
        →
      </span>
    </div>
  );
}

// ── Deal board (kanban by stage) ─────────────────────────────────────────────

function DealBoard() {
  return (
    <div className="space-y-8">
      {/* Section: pipeline — stage columns of deals only */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-mono text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          Pipeline
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {columns.map((col) => (
            <DealColumn key={col.stage} stage={col.stage} cards={col.cards} />
          ))}
        </div>
      </section>

      {/* Section: tools — product widgets, distinct from the pipeline */}
      <section className="space-y-4 border-t border-border pt-8">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-mono text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          Tools
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AutomationFiller />
          <NewsFiller offset={0} />
          <NewsFiller offset={4} />
        </div>
      </section>
    </div>
  );
}

function DealColumn({ stage, cards }: { stage: Stage; cards: DealCardData[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="group relative">
          <h3
            tabIndex={0}
            title={STAGE_BLURBS[stage]}
            className="text-lg font-semibold tracking-tight cursor-help underline decoration-dotted decoration-border underline-offset-4 outline-none"
          >
            {stage}
          </h3>
          <div
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-60 rounded-lg border border-border bg-background p-3 text-[11px] leading-snug text-muted shadow-lg opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0"
          >
            {STAGE_BLURBS[stage]}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] font-mono text-muted">
          {cards.length}
          <span aria-hidden>↕</span>
        </span>
      </div>
      <div className="space-y-3">
        {cards.map((c) => (
          <DealCard key={c.id} card={c} />
        ))}
      </div>
    </div>
  );
}

// ── Filler product cards (fill the column gaps) ──────────────────────────────

function AutomationFiller() {
  return (
    <button
      type="button"
      onClick={scrollToComposer}
      className={`w-full text-left rounded-xl border border-brand bg-brand text-background p-4 flex flex-col ${CARD_MIN_H} transition-transform hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between">
        <BoltIcon />
        <span aria-hidden className="text-background/70 text-sm">
          →
        </span>
      </div>
      <div className="mt-auto pt-3 text-sm font-semibold tracking-tight leading-snug">
        Build an automation
      </div>
      <div className="mt-1 text-[11px] text-background/75 leading-snug">
        Describe it in plain English — it drafts the rule for you.
      </div>
    </button>
  );
}

function NewsFiller({ offset = 0 }: { offset?: number }) {
  const [i, setI] = useState(offset % headlines.length);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % headlines.length), 3500);
    return () => clearInterval(id);
  }, []);
  const h = headlines[i];
  return (
    <div className={`rounded-xl border border-foreground bg-foreground text-background p-4 flex flex-col ${CARD_MIN_H}`}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-mono text-background/70">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live news
        </span>
        <span className="text-[10px] font-mono text-background/50 tabular-nums">
          {i + 1}/{headlines.length}
        </span>
      </div>
      <div key={i} className="mt-auto pt-3">
        <div className="text-[11px] font-semibold tracking-tight text-background/90">
          {h?.account}
        </div>
        <div className="mt-1 text-[12px] leading-snug text-background/75 line-clamp-2">
          {h?.title}
        </div>
      </div>
    </div>
  );
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"
        fill="currentColor"
        className="text-background"
      />
    </svg>
  );
}

function DealCard({ card }: { card: DealCardData }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={
        `w-full text-left rounded-xl border p-4 flex flex-col ${CARD_MIN_H} transition-colors ` +
        (open
          ? "border-foreground/40 bg-foreground text-background"
          : "border-border bg-background hover:border-foreground/30")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold tracking-tight text-sm">{card.account}</div>
        <span aria-hidden className={open ? "text-background/60" : "text-muted"}>
          ⋮
        </span>
      </div>
      <p
        className={
          "mt-1.5 text-[12px] leading-snug line-clamp-2 " +
          (open ? "text-background/75" : "text-muted")
        }
      >
        {card.subtitle}
      </p>

      {open && (
        <div className="mt-3 space-y-1.5 text-[11px] text-background/80">
          {card.hqLocation && <div>◍ {card.hqLocation}</div>}
          {card.domain && <div>✉ contact@{card.domain}</div>}
          <div className="flex items-center gap-2 pt-1">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/20 text-[9px] font-semibold">
              {card.ownerName
                .split(" ")
                .map((p) => p[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span className="text-background/70">
              {card.ownerRole} · {card.ownerName}
            </span>
          </div>
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between">
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono " +
            (open ? "border-background/20 text-background/70" : "border-border text-muted")
          }
        >
          <CalendarIcon />
          {fmtDate(card.closeDate)}
        </span>
        <span
          className={
            "flex items-center gap-3 text-[11px] " +
            (open ? "text-background/70" : "text-muted")
          }
        >
          <span className="inline-flex items-center gap-1">
            <ChatIcon />
            {card.signals}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClipIcon />
            {card.contacts}
          </span>
        </span>
      </div>
    </button>
  );
}

// ── Tiny inline icons (currentColor) ─────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4.5A2 2 0 0 1 4.5 2.5h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6l-3 2.5v-2.5H4.5a2 2 0 0 1-2-2v-4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.5 6.5 7 11a2.5 2.5 0 0 1-3.5-3.5l5-5a1.5 1.5 0 0 1 2 2l-4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
