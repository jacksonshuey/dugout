"use client";

import { useState } from "react";
import {
  accountsById,
  calls,
  demoSignals,
  opportunities,
} from "@/data/seed";

// Interactive body of the "Live workspace" dashboard. Four KPI cards — click
// one to expand a breakdown — over a compact activity feed. Two layout
// variants are shipped behind a toggle for A/B comparison:
//   - accordion: KPI cards stacked left, breakdown drops in under the clicked
//     card at the column width; activity feed on the right.
//   - popover:   KPI cards in a row, a box-width breakdown drops under the
//     clicked card; activity feed on the right.
// The Meetings breakdown renders a Mon–Sun week calendar. Everything is
// derived from the seeded pipeline/signals so figures stay consistent with the
// rest of the page; ages/weeks are anchored to the most recent seeded data.

type PanelKey = "pipeline" | "signals" | "atrisk" | "meetings";
type Variant = "accordion" | "popover";

const oppById = new Map(opportunities.map((o) => [o.id, o]));

function accountName(oppId: string): string {
  const opp = oppById.get(oppId);
  const acc = opp ? accountsById.get(opp.accountId) : undefined;
  return acc?.name ?? "Workspace";
}

function fmtCompactUSD(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${n}`;
}

function fmtUSD(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function relAgo(ms: number): string {
  const h = ms / 3.6e6;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function severityDot(sev: string): string {
  if (sev === "blocking") return "bg-rose-500";
  if (sev === "action") return "bg-amber-500";
  return "bg-sky-500";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const offset = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

// ── Derived datasets (static seed → compute once) ──────────────────────────

const pipelineValue = opportunities.reduce((sum, o) => sum + o.amount, 0);
const signalsFiring = demoSignals.length;
const atRiskOppIds = [
  ...new Set(
    demoSignals.filter((s) => s.severity === "blocking").map((s) => s.oppId),
  ),
];
const newestSignal = Math.max(...demoSignals.map((s) => +new Date(s.detectedAt)));
const latestCall = Math.max(...calls.map((c) => +new Date(c.callDate)));
const meetingsThisWeek = calls.filter(
  (c) => latestCall - +new Date(c.callDate) <= 7 * 8.64e7,
);

const pipelineRows = [...opportunities]
  .sort((a, b) => b.amount - a.amount)
  .map((o) => ({
    id: o.id,
    account: accountsById.get(o.accountId)?.name ?? "Workspace",
    stage: o.stage,
    amount: o.amount,
  }));

const signalRows = [...demoSignals]
  .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt))
  .map((s) => ({
    id: s.id,
    account: accountName(s.oppId),
    title: s.title,
    severity: s.severity,
    ago: relAgo(newestSignal - +new Date(s.detectedAt)),
  }));

const atRiskRows = atRiskOppIds.map((oppId) => {
  const sig = demoSignals.find(
    (s) => s.oppId === oppId && s.severity === "blocking",
  );
  return {
    id: oppId,
    account: accountName(oppId),
    title: sig?.title ?? "Blocking signal",
    action: sig?.suggestedAction ?? "",
  };
});

const feed = signalRows.slice(0, 6);

// Week-calendar buckets for the Meetings breakdown.
const weekStart = startOfWeek(new Date(latestCall));
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + i);
  return d;
});
const callsByDay = new Map<
  string,
  { id: string; account: string; durationMin: number }[]
>();
for (const c of calls) {
  const d = new Date(c.callDate);
  d.setHours(0, 0, 0, 0);
  const key = d.toDateString();
  const list = callsByDay.get(key) ?? [];
  list.push({ id: c.id, account: accountName(c.oppId), durationMin: c.durationMin });
  callsByDay.set(key, list);
}

const CARDS: { key: PanelKey; value: string; label: string }[] = [
  { key: "pipeline", value: fmtCompactUSD(pipelineValue), label: "pipeline" },
  { key: "signals", value: String(signalsFiring), label: "signals firing" },
  { key: "atrisk", value: String(atRiskOppIds.length), label: "at risk" },
  { key: "meetings", value: String(meetingsThisWeek.length), label: "meetings · 7d" },
];

const PANEL_TITLE: Record<PanelKey, string> = {
  pipeline: "Open pipeline by account",
  signals: "Signals firing",
  atrisk: "At-risk deals",
  meetings: "This week",
};

// ── Top-level body with the A/B variant toggle ─────────────────────────────

export function OverviewDashboardBody() {
  const [variant, setVariant] = useState<Variant>("accordion");
  const [open, setOpen] = useState<PanelKey | null>(null);

  return (
    <>
      <div className="mt-6 flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted mr-1">
          Layout
        </span>
        {(["accordion", "popover"] as Variant[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVariant(v)}
            className={
              "px-2.5 py-1 rounded-md border text-[11px] font-medium capitalize transition-colors " +
              (variant === v
                ? "border-brand bg-brand/[0.08] text-brand"
                : "border-border text-muted hover:text-foreground hover:border-foreground/30")
            }
          >
            {v}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div>
          {variant === "accordion" ? (
            <AccordionKpis open={open} setOpen={setOpen} />
          ) : (
            <PopoverKpis open={open} setOpen={setOpen} />
          )}
        </div>
        <ActivityFeed />
      </div>
    </>
  );
}

// ── Variant: accordion (stacked cards, breakdown under the clicked one) ────

function AccordionKpis({
  open,
  setOpen,
}: {
  open: PanelKey | null;
  setOpen: (k: PanelKey | null) => void;
}) {
  return (
    <div className="space-y-3">
      {CARDS.map((c) => {
        const active = open === c.key;
        return (
          <div key={c.key} className="space-y-3">
            <KpiCard card={c} active={active} onClick={() => setOpen(active ? null : c.key)} />
            {active && <BreakdownPanel panel={c.key} onClose={() => setOpen(null)} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Variant: popover (row of cards, box-width breakdown under clicked card) ─

function PopoverKpis({
  open,
  setOpen,
}: {
  open: PanelKey | null;
  setOpen: (k: PanelKey | null) => void;
}) {
  const activeIndex = CARDS.findIndex((c) => c.key === open);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {CARDS.map((c) => {
        const active = open === c.key;
        return (
          <KpiCard
            key={c.key}
            card={c}
            active={active}
            onClick={() => setOpen(active ? null : c.key)}
          />
        );
      })}
      {open && activeIndex >= 0 && (
        <div
          className="col-span-2 sm:col-span-1"
          style={{ gridColumnStart: activeIndex + 1 }}
        >
          <BreakdownPanel panel={open} onClose={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}

// ── Shared pieces ──────────────────────────────────────────────────────────

function KpiCard({
  card,
  active,
  onClick,
}: {
  card: { key: PanelKey; value: string; label: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={
        "w-full text-left rounded-xl border bg-background p-5 transition-colors " +
        (active
          ? "border-brand ring-2 ring-brand/20"
          : "border-border hover:border-foreground/30")
      }
    >
      <div className="flex items-start justify-between">
        <div className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">
          {card.value}
        </div>
        <span
          aria-hidden
          className={"text-muted text-[10px] mt-1 transition-transform " + (active ? "rotate-180" : "")}
        >
          ▾
        </span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.18em] font-mono text-muted">
        {card.label}
      </div>
    </button>
  );
}

function BreakdownPanel({
  panel,
  onClose,
}: {
  panel: PanelKey;
  onClose: () => void;
}) {
  return (
    <div className="rounded-xl border border-brand/40 bg-background overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-brand truncate">
          {PANEL_TITLE[panel]}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close breakdown"
          className="text-muted hover:text-foreground text-sm leading-none shrink-0 ml-2"
        >
          ✕
        </button>
      </div>
      <div className="max-h-80 overflow-auto">
        <Breakdown panel={panel} />
      </div>
    </div>
  );
}

function ActivityFeed() {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted">
          Activity
        </span>
        <span className="text-[10px] font-mono text-muted">{signalsFiring} signals</span>
      </div>
      <ul className="divide-y divide-border">
        {feed.map((f) => (
          <li key={f.id} className="px-5 py-3 flex items-center gap-3">
            <span
              aria-hidden
              className={"h-1.5 w-1.5 rounded-full shrink-0 " + severityDot(f.severity)}
            />
            <span className="text-[12px] font-semibold tracking-tight shrink-0">{f.account}</span>
            <span className="text-[12px] text-foreground/70 truncate">{f.title}</span>
            <span className="ml-auto text-[10px] font-mono text-muted shrink-0">{f.ago}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Breakdown({ panel }: { panel: PanelKey }) {
  if (panel === "pipeline") {
    return (
      <table className="w-full text-[12px]">
        <tbody className="divide-y divide-border">
          {pipelineRows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2.5 font-semibold tracking-tight">{r.account}</td>
              <td className="px-2 py-2.5 text-muted">{r.stage}</td>
              <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtUSD(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <td className="px-4 py-2.5 text-[10px] uppercase tracking-[0.15em] font-mono text-muted" colSpan={2}>
              Total
            </td>
            <td className="px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">
              {fmtUSD(pipelineValue)}
            </td>
          </tr>
        </tfoot>
      </table>
    );
  }

  if (panel === "signals") {
    return (
      <ul className="divide-y divide-border">
        {signalRows.map((s) => (
          <li key={s.id} className="px-4 py-2.5 flex items-center gap-3 text-[12px]">
            <span aria-hidden className={"h-1.5 w-1.5 rounded-full shrink-0 " + severityDot(s.severity)} />
            <span className="font-semibold tracking-tight shrink-0">{s.account}</span>
            <span className="text-foreground/70 truncate">{s.title}</span>
            <span className="ml-auto text-[10px] font-mono text-muted shrink-0">{s.ago}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (panel === "atrisk") {
    if (atRiskRows.length === 0) {
      return (
        <div className="px-4 py-6 text-[12px] text-muted italic text-center">
          No deals are blocked right now.
        </div>
      );
    }
    return (
      <ul className="divide-y divide-border">
        {atRiskRows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-[12px]">
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full shrink-0 bg-rose-500" />
              <span className="font-semibold tracking-tight">{r.account}</span>
              <span className="text-foreground/70">· {r.title}</span>
            </div>
            {r.action && (
              <div className="mt-1 pl-3.5 text-[11px] text-muted leading-snug">→ {r.action}</div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  // meetings → week calendar
  return <WeekCalendar />;
}

function WeekCalendar() {
  return (
    <div className="p-3">
      <div className="grid grid-cols-7 gap-px rounded-lg overflow-hidden bg-border min-w-[480px]">
        {weekDays.map((d) => {
          const items = callsByDay.get(d.toDateString()) ?? [];
          return (
            <div key={d.toDateString()} className="bg-background min-h-[96px] p-2">
              <div className="text-[9px] font-mono uppercase tracking-[0.1em] text-muted">
                {WEEKDAYS[d.getDay()]} {d.getDate()}
              </div>
              <div className="mt-1.5 space-y-1">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="rounded border border-brand/20 bg-brand/[0.08] px-1.5 py-1 text-[10px] leading-tight"
                    title={`${it.account} · ${it.durationMin}m`}
                  >
                    <div className="font-semibold tracking-tight truncate">{it.account}</div>
                    <div className="text-muted">{it.durationMin}m</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
