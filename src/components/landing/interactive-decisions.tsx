"use client";

import { useState } from "react";

// Interactive decisions view — mirrors the Signals UI but on the other side
// of the loop. Each row is an action the AE actually cast (sent an asset,
// enrolled a sequence, dismissed an awareness signal). Filter by status,
// expand any card to see the triggering signal, the channel used, the
// observed outcome, and how the decision feeds back into the engine.
//
// Read-only history. No mutating actions — once a decision is cast, this is
// the audit row. Reuse the visual language from InteractiveSignals so the
// reader sees them as a paired before/after view.

type DecisionStatus = "acted" | "skipped" | "snoozed";

interface Decision {
  id: string;
  status: DecisionStatus;
  title: string;
  account: string;
  triggeringRule: string;
  triggeringSignal: string;
  channel: string;
  detail: string;
  outcome: string;
  feedback: string;
  decidedBy: string;
  age: string;
}

const DECISIONS: Decision[] = [
  {
    id: "dec_sap_brief",
    status: "acted",
    title: "CFO Leave-Behind sent via Dock",
    account: "SAP",
    triggeringRule: "ASSET_GAP_FINANCE_BRIEF",
    triggeringSignal: "Finance brief unsent · 14d in Selected Vendor",
    channel: "Dock workspace · CFO Leave-Behind template",
    detail:
      "Workspace auto-created for SAP. Pre-loaded with CFO Leave-Behind, IT Zero Lift one-pager, and Finance Meeting Brief. Forwarded to Jens Becker.",
    outcome: "Asset opened 3x in 24h. Finance review now booked Thursday.",
    feedback:
      "asset_deliveries.finance_brief populated for acc_sap. ASSET_GAP rule will not re-fire on this opp for 14 days.",
    decidedBy: "Sara Chen (AE)",
    age: "2h ago",
  },
  {
    id: "dec_goldman_seq",
    status: "acted",
    title: "Champion re-engagement sequence enrolled",
    account: "Goldman Sachs",
    triggeringRule: "PROCUREMENT_FREEZE_CITED",
    triggeringSignal: "Procurement freeze cited twice → Goldman",
    channel: "Outreach · Champion Re-engagement template (3-step)",
    detail:
      "VP Tech Ops + Senior Counsel added as new prospects. Sequence auto-started at 9am ET; first touch confirmed delivered.",
    outcome: "2 prospects added. First reply received from VP Tech Ops within 4h.",
    feedback:
      "Engagement signal +0.4 on acc_goldman. CHAMPION_GHOST rule suppressed for 7 days; PROCUREMENT_FREEZE_CITED moves to monitor.",
    decidedBy: "Sara Chen (AE)",
    age: "1d ago",
  },
  {
    id: "dec_snowflake_roi",
    status: "acted",
    title: "ROI deck sent to champion",
    account: "Snowflake",
    triggeringRule: "NEXT_STEP_UNRESOLVED",
    triggeringSignal: "Champion needs ROI model before CFO call",
    channel: "Outreach · 1:1 sequence + Dock link",
    detail:
      "Customized ROI workbook generated against acc_snowflake's deal data ($290K ACV, 14-month payback). Sent to Jane Chen with calendar hold.",
    outcome: "Forwarded to CFO within 4h. Reply: \"Thursday works.\"",
    feedback:
      "next_step closed. Champion engagement confirmed. Snowflake forecast_category remains Commit.",
    decidedBy: "Sara Chen (AE)",
    age: "4h ago",
  },
  {
    id: "dec_atlassian_soc2",
    status: "acted",
    title: "SOC 2 packet sent via Dock",
    account: "Atlassian",
    triggeringRule: "ASSET_REQUEST",
    triggeringSignal: "CFO requested SOC 2 update before TCO call",
    channel: "Dock workspace · SOC 2 + Compliance bundle",
    detail:
      "Latest SOC 2 Type II report, pen-test summary, and DPA shared in a new Atlassian compliance workspace. Brendan Kelly notified via email.",
    outcome: "TCO call scheduled for Friday. Champion replied within 2h.",
    feedback:
      "asset_request resolved. ASSET_REQUEST rule re-armed; meeting_signal will be re-classified on the next call.",
    decidedBy: "Sara Chen (AE)",
    age: "6h ago",
  },
  {
    id: "dec_lockheed_skip",
    status: "skipped",
    title: "Awareness signal acknowledged · deferred",
    account: "Lockheed Martin",
    triggeringRule: "REGULATORY_DISCLOSURE",
    triggeringSignal: "Lockheed 8-K · DoD contract award disclosed",
    channel: "Manual note in agent_actions",
    detail:
      "AE acknowledged the regulatory event but decided to wait. Deal is in Contracting with champion departed; no leverage to act on this.",
    outcome: "Logged as deferred until DoD budget release clears the queue.",
    feedback:
      "Awareness signal noted. REGULATORY_DISCLOSURE rule will not re-fire on the same filing.",
    decidedBy: "Marcus Webb (AE)",
    age: "1d ago",
  },
  {
    id: "dec_pfizer_snooze",
    status: "snoozed",
    title: "GenAI risk briefing · snoozed until CLO meeting",
    account: "Pfizer",
    triggeringRule: "REGULATORY_DISCLOSURE_GENAI",
    triggeringSignal: "Pfizer 10-K cites GenAI as risk factor",
    channel: "System · snooze (auto-refire if not handled)",
    detail:
      "AE wants to lead the CLO discussion with this in person. Snoozed signal until Wed 14:00 EST so it surfaces in the morning digest the day of the meeting.",
    outcome: "Signal suppressed until snooze expires.",
    feedback:
      "Snooze logged. System will re-surface in Wed AM digest; if not acted on by Thu, the signal escalates back to the queue.",
    decidedBy: "Sara Chen (AE)",
    age: "2d ago",
  },
];

const STATUSES: { key: DecisionStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "acted", label: "Acted" },
  { key: "skipped", label: "Skipped" },
  { key: "snoozed", label: "Snoozed" },
];

export function InteractiveDecisions() {
  const [status, setStatus] = useState<DecisionStatus | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = DECISIONS.filter(
    (d) => status === "all" || d.status === status,
  );
  const counts = {
    all: DECISIONS.length,
    acted: DECISIONS.filter((d) => d.status === "acted").length,
    skipped: DECISIONS.filter((d) => d.status === "skipped").length,
    snoozed: DECISIONS.filter((d) => d.status === "snoozed").length,
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Status filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUSES.map((s) => {
          const active = status === s.key;
          const count = counts[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatus(s.key)}
              className={
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] font-medium transition-colors " +
                statusButtonClass(s.key, active)
              }
              aria-pressed={active}
            >
              <span>{s.label}</span>
              <span className="font-mono text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Decision cards */}
      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-foreground/[0.015] p-6 text-center text-[12px] text-muted italic">
            No decisions in this status.
          </div>
        ) : (
          visible.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              expanded={expandedId === d.id}
              onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DecisionCard({
  decision,
  expanded,
  onToggle,
}: {
  decision: Decision;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cls = statusBadgeClass(decision.status);
  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-foreground/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        <span
          className={`text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 rounded border shrink-0 inline-flex items-center justify-center w-[72px] ${cls}`}
        >
          {decision.status}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-tight leading-snug">
            {decision.title}
          </div>
          <div className="text-xs text-muted leading-relaxed mt-0.5">
            {decision.account} ·{" "}
            <code className="font-mono text-[10px]">
              {decision.triggeringRule}
            </code>
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted shrink-0 mt-1">
          {decision.age}
        </span>
        <span
          aria-hidden
          className={
            "text-muted text-[10px] mt-1 shrink-0 transition-transform " +
            (expanded ? "rotate-180" : "")
          }
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border bg-foreground/[0.015] p-3 space-y-3 text-[12px]">
          <Field label="Triggered by">
            <div className="text-foreground/85 leading-snug">
              {decision.triggeringSignal}
            </div>
            <code className="font-mono text-[10px] text-muted mt-0.5 block">
              {decision.triggeringRule}
            </code>
          </Field>
          <Field label="Channel">
            <code className="font-mono text-[11px] text-foreground/85">
              {decision.channel}
            </code>
          </Field>
          <Field label="Detail">
            <div className="text-foreground/80 leading-relaxed">
              {decision.detail}
            </div>
          </Field>
          <Field label="Outcome">
            <div className="text-foreground/85 leading-relaxed font-medium">
              {decision.outcome}
            </div>
          </Field>
          <Field label="Feedback loop">
            <div className="text-foreground/75 leading-relaxed">
              {decision.feedback}
            </div>
          </Field>
          <div className="pt-1 text-[10px] font-mono text-muted">
            Cast by {decision.decidedBy} · {decision.age}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3">
      <div className="sm:col-span-3 text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        {label}
      </div>
      <div className="sm:col-span-9">{children}</div>
    </div>
  );
}

function statusBadgeClass(status: DecisionStatus): string {
  if (status === "acted")
    return "bg-severity-green-bg text-severity-green border-severity-green/20";
  if (status === "snoozed")
    return "bg-severity-action-bg text-severity-action border-severity-action/20";
  // skipped
  return "border-border bg-foreground/[0.04] text-muted";
}

function statusButtonClass(
  key: DecisionStatus | "all",
  active: boolean,
): string {
  if (!active) {
    return "border-border bg-background text-muted hover:text-foreground hover:border-foreground/30";
  }
  if (key === "acted")
    return "border-severity-green/40 bg-severity-green-bg text-severity-green";
  if (key === "snoozed")
    return "border-severity-action/40 bg-severity-action-bg text-severity-action";
  if (key === "skipped")
    return "border-foreground/30 bg-foreground/[0.05] text-foreground";
  return "border-foreground/40 bg-foreground/[0.04] text-foreground";
}
