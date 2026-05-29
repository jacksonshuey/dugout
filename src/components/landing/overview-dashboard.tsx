"use client";

import { useState } from "react";
import {
  accountsById,
  calls,
  demoSignals,
  opportunities,
} from "@/data/seed";

// Interactive body of the "Live workspace" dashboard. Four KPI cards — click
// one to expand a breakdown of the rows behind the number — over a compact
// activity feed. Everything is derived from the seeded pipeline/signals so the
// figures stay consistent with the rest of the page. Feed/breakdown ages are
// anchored to the most recent seeded signal so it reads fresh in the demo.

type PanelKey = "pipeline" | "signals" | "atrisk" | "meetings";

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

const meetingRows = [...meetingsThisWeek]
  .sort((a, b) => +new Date(b.callDate) - +new Date(a.callDate))
  .map((c) => ({
    id: c.id,
    account: accountName(c.oppId),
    durationMin: c.durationMin,
    ago: relAgo(latestCall - +new Date(c.callDate)),
    summary: c.summary,
  }));

const feed = signalRows.slice(0, 6);

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
  meetings: "Meetings · last 7 days",
};

export function OverviewDashboardBody() {
  const [open, setOpen] = useState<PanelKey | null>(null);

  return (
    <>
      <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {CARDS.map((c) => {
          const active = open === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setOpen(active ? null : c.key)}
              aria-expanded={active}
              className={
                "text-left rounded-xl border bg-background p-5 transition-colors " +
                (active
                  ? "border-brand ring-2 ring-brand/20"
                  : "border-border hover:border-foreground/30")
              }
            >
              <div className="flex items-start justify-between">
                <div className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">
                  {c.value}
                </div>
                <span
                  aria-hidden
                  className={
                    "text-muted text-[10px] mt-1 transition-transform " +
                    (active ? "rotate-180" : "")
                  }
                >
                  ▾
                </span>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.18em] font-mono text-muted">
                {c.label}
              </div>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="mt-4 rounded-xl border border-brand/40 bg-background overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-brand">
              {PANEL_TITLE[open]}
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close breakdown"
              className="text-muted hover:text-foreground text-sm leading-none"
            >
              ✕
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <Breakdown panel={open} />
          </div>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border bg-background overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted">
            Activity
          </span>
          <span className="text-[10px] font-mono text-muted">
            {signalsFiring} signals
          </span>
        </div>
        <ul className="divide-y divide-border">
          {feed.map((f) => (
            <li key={f.id} className="px-5 py-3 flex items-center gap-3">
              <span
                aria-hidden
                className={"h-1.5 w-1.5 rounded-full shrink-0 " + severityDot(f.severity)}
              />
              <span className="text-[12px] font-semibold tracking-tight shrink-0">
                {f.account}
              </span>
              <span className="text-[12px] text-foreground/70 truncate">
                {f.title}
              </span>
              <span className="ml-auto text-[10px] font-mono text-muted shrink-0">
                {f.ago}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Breakdown({ panel }: { panel: PanelKey }) {
  if (panel === "pipeline") {
    return (
      <table className="w-full text-[12px]">
        <tbody className="divide-y divide-border">
          {pipelineRows.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-2.5 font-semibold tracking-tight">{r.account}</td>
              <td className="px-2 py-2.5 text-muted">{r.stage}</td>
              <td className="px-5 py-2.5 text-right tabular-nums">{fmtUSD(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <td className="px-5 py-2.5 text-[10px] uppercase tracking-[0.15em] font-mono text-muted" colSpan={2}>
              Total
            </td>
            <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
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
          <li key={s.id} className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
            <span
              aria-hidden
              className={"h-1.5 w-1.5 rounded-full shrink-0 " + severityDot(s.severity)}
            />
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
        <div className="px-5 py-6 text-[12px] text-muted italic text-center">
          No deals are blocked right now.
        </div>
      );
    }
    return (
      <ul className="divide-y divide-border">
        {atRiskRows.map((r) => (
          <li key={r.id} className="px-5 py-3 text-[12px]">
            <div className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full shrink-0 bg-rose-500" />
              <span className="font-semibold tracking-tight">{r.account}</span>
              <span className="text-foreground/70">· {r.title}</span>
            </div>
            {r.action && (
              <div className="mt-1 pl-3.5 text-[11px] text-muted leading-snug">
                → {r.action}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  // meetings
  return (
    <ul className="divide-y divide-border">
      {meetingRows.map((m) => (
        <li key={m.id} className="px-5 py-3 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{m.account}</span>
            <span className="text-[10px] font-mono text-muted">{m.durationMin}m</span>
            <span className="ml-auto text-[10px] font-mono text-muted">{m.ago}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted leading-snug line-clamp-2">
            {m.summary}
          </div>
        </li>
      ))}
    </ul>
  );
}
