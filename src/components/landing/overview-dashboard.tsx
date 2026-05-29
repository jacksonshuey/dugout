"use client";

import {
  accountsById,
  demoSignals,
  opportunities,
  reps,
} from "@/data/seed";

// "Live workspace" analytics dashboard — KPI stat cards, a weekday signals bar
// chart, a pipeline-by-stage donut, and two list panels (recent deals + a
// needs-attention signal queue). Layout follows a property-CRM reference but
// uses Dugout's tokens. All figures derive from the seeded pipeline/signals so
// they stay consistent with the rest of the page. Month-over-month deltas are
// illustrative (no time series in the seed).

const oppById = new Map(opportunities.map((o) => [o.id, o]));
const repById = new Map(reps.map((r) => [r.id, r]));

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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? "—"
    : d.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ── Derived data ────────────────────────────────────────────────────────────

const pipelineValue = opportunities.reduce((s, o) => s + o.amount, 0);
const dealCount = opportunities.length;
const signalsFiring = demoSignals.length;

const KPIS = [
  {
    label: "Open pipeline",
    value: fmtCompactUSD(pipelineValue),
    delta: 18,
    last: fmtCompactUSD(pipelineValue / 1.18),
    icon: <MoneyIcon />,
  },
  {
    label: "Active deals",
    value: String(dealCount),
    delta: 14,
    last: String(Math.round(dealCount / 1.14)),
    icon: <DealIcon />,
  },
  {
    label: "Signals firing",
    value: String(signalsFiring),
    delta: 27,
    last: String(Math.round(signalsFiring / 1.27)),
    icon: <BoltIcon />,
  },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdaySignals = WEEKDAYS.map((_, i) => {
  const target = (i + 1) % 7; // Mon=1 … Sun=0
  return demoSignals.filter((s) => new Date(s.detectedAt).getDay() === target).length;
});
const peakIdx = weekdaySignals.indexOf(Math.max(...weekdaySignals));

const STAGE_ORDER = [
  "Intro",
  "Qualified",
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
];
const STAGE_COLOR = [
  "text-brand",
  "text-severity-green",
  "text-severity-action",
  "text-severity-awareness",
  "text-foreground/40",
  "text-muted",
];
const stageAgg = STAGE_ORDER.map((stage, idx) => ({
  stage,
  amount: opportunities
    .filter((o) => o.stage === stage)
    .reduce((s, o) => s + o.amount, 0),
  colorClass: STAGE_COLOR[idx % STAGE_COLOR.length],
})).filter((s) => s.amount > 0);

// Precompute donut arc dash/offset at module scope so the component render
// stays pure (no cumulative mutation during render).
const DONUT_C = 2 * Math.PI * 64;
const donutSegments = (() => {
  let cum = 0;
  return stageAgg.map((seg) => {
    const len = (seg.amount / pipelineValue) * DONUT_C;
    const dash = `${len.toFixed(2)} ${(DONUT_C - len).toFixed(2)}`;
    const offset = (-cum).toFixed(2);
    cum += len;
    return { stage: seg.stage, colorClass: seg.colorClass, dash, offset };
  });
})();

const recentDeals = [...opportunities]
  .sort((a, b) => b.amount - a.amount)
  .slice(0, 5)
  .map((o) => ({
    id: o.id,
    account: accountsById.get(o.accountId)?.name ?? "Account",
    name: o.name,
    date: fmtDate(o.closeDate),
    amount: o.amount,
  }));

const SEV_RANK: Record<string, number> = { blocking: 0, action: 1, awareness: 2 };
const attention = [...demoSignals]
  .sort(
    (a, b) =>
      (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
      +new Date(b.detectedAt) - +new Date(a.detectedAt),
  )
  .slice(0, 5)
  .map((s) => {
    const o = oppById.get(s.oppId);
    const owner = o ? repById.get(o.ownerId) : undefined;
    return {
      id: s.id,
      severity: s.severity,
      title: s.title,
      account: accountName(s.oppId),
      ruleId: s.ruleId,
      owner: owner?.name ?? "Unassigned",
    };
  });

function severityDot(sev: string): string {
  if (sev === "blocking") return "bg-rose-500";
  if (sev === "action") return "bg-amber-500";
  return "bg-sky-500";
}

// ── Layout ───────────────────────────────────────────────────────────────────

export function OverviewDashboardBody() {
  return (
    <div className="mt-8 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {KPIS.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <SignalsBarCard />
        <PipelineDonutCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentDealsCard />
        <AttentionCard />
      </div>
    </div>
  );
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  last,
  icon,
}: {
  label: string;
  value: string;
  delta: number;
  last: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand/[0.08] text-brand">
          {icon}
        </span>
        <span className="text-sm text-muted">{label}</span>
      </div>
      <div className="mt-4 flex items-end gap-2.5 flex-wrap">
        <div className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums leading-none">
          {value}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-severity-green-bg px-2 py-0.5 text-[11px] font-medium text-severity-green">
          <span aria-hidden>↗</span>
          {delta}%
        </span>
      </div>
      <div className="mt-1.5 text-[11px] text-muted">Last month {last}</div>
    </div>
  );
}

// ── Signals bar chart ─────────────────────────────────────────────────────────

function SignalsBarCard() {
  const max = Math.max(1, ...weekdaySignals);
  const W = 520;
  const H = 220;
  const padL = 28;
  const padB = 28;
  const padT = 28;
  const slot = (W - padL) / WEEKDAYS.length;
  const barW = slot * 0.46;
  const chartH = H - padB - padT;
  const yTicks = [0, max / 2, max];

  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight">Signals this week</h3>
        <span className="text-[11px] font-mono text-muted rounded-md border border-border px-2 py-1">
          Weekday
        </span>
      </div>

      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
          {yTicks.map((t, i) => {
            const y = padT + chartH * (1 - t / max);
            return (
              <g key={i}>
                <line
                  x1={padL}
                  x2={W}
                  y1={y.toFixed(2)}
                  y2={y.toFixed(2)}
                  className="stroke-border"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                />
                <text
                  x={padL - 6}
                  y={(y + 3).toFixed(2)}
                  textAnchor="end"
                  className="fill-muted"
                  fontSize="9"
                  fontFamily="ui-monospace, monospace"
                >
                  {Math.round(t)}
                </text>
              </g>
            );
          })}
          {weekdaySignals.map((c, i) => {
            const h = (c / max) * chartH;
            const x = padL + i * slot + (slot - barW) / 2;
            const y = padT + chartH - h;
            const peak = i === peakIdx;
            return (
              <g key={i}>
                <rect
                  x={x.toFixed(2)}
                  y={y.toFixed(2)}
                  width={barW.toFixed(2)}
                  height={Math.max(h, 2).toFixed(2)}
                  rx="4"
                  className={peak ? "fill-brand" : "fill-foreground/[0.10]"}
                />
                <text
                  x={(x + barW / 2).toFixed(2)}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {WEEKDAYS[i]}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Peak tooltip bubble */}
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-background px-2.5 py-1.5 shadow-lg"
          style={{
            left: `${((peakIdx + 0.5) / WEEKDAYS.length) * 100}%`,
            top: `${(padT / H) * 100}%`,
          }}
        >
          <div className="text-[12px] font-semibold tracking-tight tabular-nums">
            {weekdaySignals[peakIdx]} signals
          </div>
          <div className="text-[10px] font-mono text-muted">{WEEKDAYS[peakIdx]} · peak</div>
        </div>
      </div>
    </div>
  );
}

// ── Pipeline donut ──────────────────────────────────────────────────────────

function PipelineDonutCard() {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <h3 className="text-base font-semibold tracking-tight">Pipeline by stage</h3>

      <div className="mt-4 flex items-center gap-5">
        <div className="relative shrink-0">
          <svg viewBox="0 0 160 160" className="h-[136px] w-[136px]" aria-hidden>
            <g transform="rotate(-90 80 80)">
              <circle
                cx="80"
                cy="80"
                r="64"
                fill="none"
                strokeWidth="20"
                className="stroke-border"
              />
              {donutSegments.map((seg) => (
                <circle
                  key={seg.stage}
                  cx="80"
                  cy="80"
                  r="64"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="20"
                  strokeDasharray={seg.dash}
                  strokeDashoffset={seg.offset}
                  className={seg.colorClass}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-lg font-semibold tracking-tight tabular-nums">
              {fmtCompactUSD(pipelineValue)}
            </div>
            <div className="text-[10px] text-muted">open</div>
          </div>
        </div>

        <ul className="flex-1 min-w-0 space-y-1.5">
          {stageAgg.map((seg) => (
            <li key={seg.stage} className="flex items-center gap-2 text-[12px]">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full shrink-0 bg-current ${seg.colorClass}`}
              />
              <span className="truncate text-foreground/80">{seg.stage}</span>
              <span className="ml-auto font-mono text-[11px] text-muted tabular-nums shrink-0">
                {fmtCompactUSD(seg.amount)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Recent deals ──────────────────────────────────────────────────────────────

function RecentDealsCard() {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <h3 className="text-base font-semibold tracking-tight">Recent deals</h3>
        <span className="text-[11px] font-mono text-muted">{dealCount} total</span>
      </div>
      <ul className="divide-y divide-border">
        {recentDeals.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-5 py-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/[0.06] text-[11px] font-semibold text-foreground/70 shrink-0">
              {initials(d.account)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-tight truncate">
                {d.account}
              </div>
              <div className="text-[11px] text-muted truncate">{d.name}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[13px] font-semibold tabular-nums text-severity-green">
                {fmtCompactUSD(d.amount)}
              </div>
              <div className="text-[10px] font-mono text-muted">{d.date}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Needs attention (signal queue) ─────────────────────────────────────────────

function AttentionCard() {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <h3 className="text-base font-semibold tracking-tight">Needs attention</h3>
        <span className="text-[11px] font-mono text-muted">{signalsFiring} signals</span>
      </div>
      <ul className="divide-y divide-border">
        {attention.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-3">
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full shrink-0 ${severityDot(a.severity)}`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold tracking-tight truncate">
                {a.title}
              </div>
              <div className="text-[11px] text-muted truncate">
                {a.account} · <span className="font-mono">{a.ruleId}</span>
              </div>
            </div>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground/[0.06] text-[9px] font-semibold text-foreground/70 shrink-0" title={a.owner}>
              {initials(a.owner)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function MoneyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function DealIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
    </svg>
  );
}
