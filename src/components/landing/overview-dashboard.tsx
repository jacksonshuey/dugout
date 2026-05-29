"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  accountsById,
  contacts,
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

// Week calendar of signals — the Mon–Sun grid we built, placing each signal on
// its detected day (anchored to the week of the most recent signal).
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const offset = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

const newestSignalMs = Math.max(...demoSignals.map((s) => +new Date(s.detectedAt)));
const calWeekStart = startOfWeek(new Date(newestSignalMs));
const calWeekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(calWeekStart);
  d.setDate(d.getDate() + i);
  return d;
});
// Meetings on the calendar, formatted "Jackson <> {name}". Built from the key
// account people (champions, exec sponsors, GCs) and spread round-robin across
// the work week (Mon–Fri) so the week reads busy.
const MEETING_ROLES = new Set(["Champion", "Executive Sponsor", "GC"]);
const meetingPeople = contacts.filter((c) => MEETING_ROLES.has(c.role));

interface CalMeeting {
  id: string;
  name: string;
  title: string;
  role: string;
  account: string;
  industry: string;
  hq: string;
  dateLabel: string;
  startMin: number; // minutes from midnight
  durationMin: number;
  timeLabel: string;
}

// Calendar day window (08:00–18:00) used to lay meetings out on a time axis.
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 18 * 60;
// Per-weekday base start (Mon–Fri) so columns don't line up in rigid rows.
const DAY_BASE_START = [9 * 60, 8 * 60 + 30, 9 * 60 + 30, 8 * 60, 10 * 60];
// Varied meeting lengths and gaps, walked round-robin so each day reads organic.
const DURATIONS = [30, 60, 45, 90, 30, 45];
const GAPS = [30, 15, 45, 30, 15];

function fmtTime(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const meetingsByDay = new Map<string, CalMeeting[]>();
const dayCursor = new Map<string, number>(); // next free minute per day
meetingPeople.forEach((c, i) => {
  const dayIdx = i % 5; // Mon–Fri
  const day = calWeekDays[dayIdx];
  if (!day) return;
  const key = day.toDateString();
  const acc = accountsById.get(c.accountId);
  const list = meetingsByDay.get(key) ?? [];

  const startMin = dayCursor.get(key) ?? DAY_BASE_START[dayIdx] ?? DAY_START_MIN;
  const durationMin = DURATIONS[(list.length + dayIdx) % DURATIONS.length] ?? 45;
  const gap = GAPS[(list.length + dayIdx) % GAPS.length] ?? 30;
  dayCursor.set(key, startMin + durationMin + gap);

  list.push({
    id: c.id,
    name: c.name,
    title: c.title,
    role: c.role,
    account: acc?.name ?? "Account",
    industry: acc?.industry ?? "",
    hq: acc?.hqLocation ?? "",
    dateLabel: `${WD_SHORT[day.getDay()]} ${day.getDate()}`,
    startMin,
    durationMin,
    timeLabel: fmtTime(startMin),
  });
  meetingsByDay.set(key, list);
});

// Hour gridlines/labels down the time axis.
const HOUR_MARKS = Array.from(
  { length: Math.floor((DAY_END_MIN - DAY_START_MIN) / 60) + 1 },
  (_, i) => DAY_START_MIN + i * 60,
);

// Vertical scale for the time axis.
const PX_PER_MIN = 0.7;
const TRACK_HEIGHT = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;

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

// Stage close probabilities → weighted forecast (sum of amount × probability),
// then broken out by close month for the bar chart under the donut.
const STAGE_PROB: Record<string, number> = {
  Intro: 0.1,
  Qualified: 0.25,
  "Demo Sat": 0.4,
  Evaluating: 0.6,
  "Selected Vendor": 0.8,
  Contracting: 0.95,
};
const weightedForecast = opportunities.reduce(
  (s, o) => s + o.amount * (STAGE_PROB[o.stage] ?? 0),
  0,
);
const forecastByMonth = (() => {
  const m = new Map<number, { label: string; amount: number }>();
  opportunities.forEach((o) => {
    const d = new Date(o.closeDate);
    const k = d.getFullYear() * 12 + d.getMonth();
    const label = d.toLocaleDateString("en-US", { month: "short" });
    const cur = m.get(k) ?? { label, amount: 0 };
    cur.amount += o.amount * (STAGE_PROB[o.stage] ?? 0);
    m.set(k, cur);
  });
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
})();
const forecastMax = Math.max(...forecastByMonth.map((f) => f.amount), 1);

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

// Account-relevant news for the cycling ticker — every account-tagged signal,
// newest first, with a relative age anchored to the most recent one.
function relAgo(ms: number): string {
  const h = ms / 3.6e6;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
const accountNews = [...demoSignals]
  .sort((a, b) => +new Date(b.detectedAt) - +new Date(a.detectedAt))
  .map((s) => ({
    id: s.id,
    account: accountName(s.oppId),
    title: s.title,
    ago: relAgo(newestSignalMs - +new Date(s.detectedAt)),
  }));

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
        <MeetingsCalendarCard />
        <PipelineDonutCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentDealsCard />
        <AttentionCard />
      </div>

      <AccountNewsTicker />
    </div>
  );
}

// ── Cycling account-news ticker ───────────────────────────────────────────────

function AccountNewsTicker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (accountNews.length <= 1) return;
    const id = setInterval(() => setI((n) => (n + 1) % accountNews.length), 3500);
    return () => clearInterval(id);
  }, []);
  const n = accountNews[i];
  if (!n) return null;
  return (
    <div className="rounded-xl border border-foreground bg-foreground text-background overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-mono text-background/70 shrink-0">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Account news
        </span>
        <div key={n.id} className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-tight shrink-0">
            {n.account}
          </span>
          <span className="text-[13px] text-background/75 truncate">{n.title}</span>
        </div>
        <span className="shrink-0 text-[11px] font-mono text-background/50 tabular-nums">
          {n.ago} · {i + 1}/{accountNews.length}
        </span>
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

// ── Meetings week calendar ────────────────────────────────────────────────────

function MeetingsCalendarCard() {
  const [selected, setSelected] = useState<CalMeeting | null>(null);
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight">Meetings this week</h3>
        <span className="text-[11px] font-mono text-muted rounded-md border border-border px-2 py-1">
          This week
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        {/* Day header row, aligned to the time-gutter + 7 columns below */}
        <div className="flex min-w-[640px]">
          <div className="w-12 shrink-0" />
          <div className="grid flex-1 grid-cols-7">
            {calWeekDays.map((d) => (
              <div
                key={d.toDateString()}
                className="px-2 pb-1.5 text-[9px] font-mono uppercase tracking-[0.1em] text-muted"
              >
                {WD_SHORT[d.getDay()]} {d.getDate()}
              </div>
            ))}
          </div>
        </div>

        {/* Time axis + day columns */}
        <div
          className="relative flex min-w-[640px]"
          style={{ height: TRACK_HEIGHT }}
        >
          {/* Hour labels (y-axis) */}
          <div className="relative w-12 shrink-0">
            {HOUR_MARKS.map((min) => (
              <div
                key={min}
                className="absolute right-1.5 -translate-y-1/2 text-[9px] font-mono tabular-nums text-muted"
                style={{ top: (min - DAY_START_MIN) * PX_PER_MIN }}
              >
                {fmtTime(min)}
              </div>
            ))}
          </div>

          <div className="relative grid flex-1 grid-cols-7 gap-px rounded-lg overflow-hidden bg-border">
            {/* Hour gridlines spanning all columns */}
            <div className="pointer-events-none absolute inset-0 z-0">
              {HOUR_MARKS.map((min) => (
                <div
                  key={min}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (min - DAY_START_MIN) * PX_PER_MIN }}
                />
              ))}
            </div>

            {calWeekDays.map((d) => {
              const items = meetingsByDay.get(d.toDateString()) ?? [];
              return (
                <div key={d.toDateString()} className="relative bg-background">
                  {items.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelected(m)}
                      title={`${m.timeLabel} · Jackson <> ${m.name} · ${m.account}`}
                      className="absolute inset-x-0.5 z-10 overflow-hidden rounded border border-brand/20 bg-brand/[0.06] px-1.5 py-1 text-left leading-tight transition-colors hover:border-brand/50 hover:bg-brand/[0.12]"
                      style={{
                        top: (m.startMin - DAY_START_MIN) * PX_PER_MIN,
                        height: Math.max(m.durationMin * PX_PER_MIN, 30),
                      }}
                    >
                      <div className="flex items-center gap-1 text-[8px] uppercase tracking-[0.08em] text-brand/80">
                        <span aria-hidden className="h-1 w-1 rounded-full shrink-0 bg-brand" />
                        {m.timeLabel}
                      </div>
                      <div className="text-[10px] font-medium text-foreground/90 leading-snug line-clamp-1">
                        {m.name}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (
        <MeetingDetailModal meeting={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function MeetingDetailModal({
  meeting,
  onClose,
}: {
  meeting: CalMeeting;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const rows: [string, string][] = [
    ["Account", meeting.industry ? `${meeting.account} · ${meeting.industry}` : meeting.account],
    ["Attendee", `${meeting.name} — ${meeting.title}`],
    ["Role", meeting.role],
    ["Location", meeting.hq || "—"],
    ["When", `${meeting.dateLabel} · this week`],
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Meeting details"
    >
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-brand">
              Meeting
            </div>
            <h4 className="mt-1 text-base font-semibold tracking-tight">
              Jackson &lt;&gt; {meeting.name}
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-foreground text-lg leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <dl className="divide-y divide-border">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-3 px-5 py-2.5">
              <dt className="w-20 shrink-0 text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
                {k}
              </dt>
              <dd className="text-[13px] text-foreground/85 leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
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

      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[13px] font-medium text-foreground/80">
            Weighted forecast
          </h4>
          <span className="text-sm font-semibold tabular-nums">
            {fmtCompactUSD(weightedForecast)}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted leading-snug">
          probability-adjusted, by close month
        </div>
        <div className="mt-3 space-y-2">
          {forecastByMonth.map((f) => (
            <div key={f.label} className="flex items-center gap-2.5">
              <span className="w-8 shrink-0 text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
                {f.label}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-brand"
                  style={{ width: `${(f.amount / forecastMax) * 100}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                {fmtCompactUSD(f.amount)}
              </span>
            </div>
          ))}
        </div>
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
