"use client";

import { useEffect, useState } from "react";
import type {
  Account,
  Activity,
  AssetDelivery,
  CallTranscript,
  Contact,
  ContactRole,
  Opportunity,
  Rep,
} from "@/lib/types";
import type { Task } from "@/lib/tasks";
import type { ExternalSignal } from "@/lib/external-signals";
import { HealthBadge, StageBadge } from "./ui";
import { computeDealHealth } from "@/lib/signal-engine";
import { TaskCard } from "./task-card";
import {
  daysBetween,
  formatCurrency,
  formatDate,
  TODAY,
} from "@/lib/utils";
import type { WorkspaceConfig } from "@/lib/workspace";
import { cn } from "@/lib/utils";

const ROLE_ORDER: ContactRole[] = [
  "Champion",
  "GC",
  "Legal Ops",
  "Finance/CFO",
  "IT/Security",
  "Procurement",
];

const ACTIVITY_DOT: Record<Activity["type"], string> = {
  email_sent: "bg-slate-300",
  email_received: "bg-slate-500",
  call: "bg-brand",
  meeting: "bg-brand-dark",
  dock_visit: "bg-severity-green",
  sequence_enrolled: "bg-slate-200",
  external_signal: "bg-severity-blocking",
};

export function Drawer({
  oppId,
  data,
  workspace,
  viewerId,
  onClose,
  onMarkDone,
  onSnooze,
  onMute,
  onReopen,
  onAddNote,
  onAddCoachingNote,
  onPageOnSlack,
}: {
  oppId: string;
  data: {
    opportunities: Opportunity[];
    accounts: Account[];
    contacts: Contact[];
    activities: Activity[];
    calls: CallTranscript[];
    deliveries: AssetDelivery[];
    reps: Rep[];
    tasks: Task[];
  };
  workspace: WorkspaceConfig;
  viewerId?: string; // if matches deal.ownerId → "owner mode"
  onClose: () => void;
  onMarkDone: (taskId: string) => void;
  onSnooze: (taskId: string, hours: number) => void;
  onMute: (taskId: string, reason: string) => void;
  onReopen: (taskId: string) => void;
  onAddNote: (taskId: string, text: string) => void;
  onAddCoachingNote: (taskId: string, text: string) => void;
  onPageOnSlack: (taskId: string) => void;
}) {
  // Esc closes the drawer.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // External signals (Supabase-backed) for this deal's account.
  // Lazy-loaded when the drawer opens; not part of the seed data.
  const [externalSignals, setExternalSignals] = useState<ExternalSignal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const opp = data.opportunities.find((o) => o.id === oppId);
  useEffect(() => {
    if (!opp) return;
    let cancelled = false;
    setSignalsLoading(true);
    fetch(`/api/external-signals?account=${opp.accountId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setExternalSignals(d.signals ?? []);
        setSignalsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setExternalSignals([]);
        setSignalsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opp]);

  if (!opp) return null;
  const account = data.accounts.find((a) => a.id === opp.accountId)!;
  const owner = data.reps.find((r) => r.id === opp.ownerId)!;
  const isOwnerMode = viewerId === opp.ownerId;

  const dealContacts = opp.contactRoleIds
    .map((cid) => data.contacts.find((c) => c.id === cid))
    .filter((c): c is Contact => !!c);
  const presentRoles = new Set(dealContacts.map((c) => c.role));

  const dealTasks = data.tasks.filter((t) => t.oppId === oppId);
  const openTasks = dealTasks.filter(
    (t) => t.status === "open" || t.status === "snoozed",
  );
  const closedTasks = dealTasks.filter(
    (t) => t.status === "done" || t.status === "muted",
  );

  const dealActivities = data.activities
    .filter((a) => a.oppId === oppId)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const dealCalls = data.calls
    .filter((c) => c.oppId === oppId)
    .sort((a, b) => (a.callDate < b.callDate ? 1 : -1));
  const dealDeliveries = data.deliveries.filter((d) => d.oppId === oppId);

  // Match the Pipeline row's health selector: only open/snoozed tasks count
  // against deal health. Done/muted tasks have been actively resolved and
  // should no longer escalate. Without this filter, drawer header stays
  // CRITICAL after the user marks the blocking task done, disagreeing with
  // the row in the background.
  const health = computeDealHealth(
    opp,
    dealTasks
      .filter((t) => t.status === "open" || t.status === "snoozed")
      .map((t) => ({
        id: t.id,
        ruleId: t.signalRuleId,
        oppId: t.oppId,
        severity: t.severity,
        title: t.title,
        body: t.body,
        suggestedAction: t.suggestedAction,
        assetLink: t.assetLink,
        detectedAt: t.createdAt,
      })),
  );

  return (
    <>
      {/* Backdrop — pointer-events-none so users can click Pipeline rows
          behind the dimmer to switch deals without closing the drawer.
          Esc + the X button still dismiss. */}
      <div
        className="fixed inset-0 bg-black/20 z-40 pointer-events-none"
        aria-hidden
      />
      {/* Panel */}
      <aside
        className="fixed top-0 right-0 h-full w-full max-w-[640px] bg-background border-l border-border z-50 flex flex-col shadow-2xl"
        aria-label={`Deal: ${account.name}`}
      >
        {/* Sticky header */}
        <div className="border-b border-border px-5 py-3 flex items-start justify-between gap-3 shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold tracking-tight">{account.name}</span>
              <StageBadge stage={opp.stage} />
              <HealthBadge health={health} />
            </div>
            <div className="text-xs text-muted">
              {opp.name} · {formatCurrency(opp.amount)} · close {formatDate(opp.closeDate)} · owner {owner.name} {isOwnerMode && "(you)"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-xl leading-none shrink-0"
            title="Close (Esc)"
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Stakeholders */}
          <Section title="Stakeholders" sub={`${dealContacts.length} on the OCR`}>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_ORDER.map((role) => {
                const c = dealContacts.find((c) => c.role === role);
                const present = !!c;
                const expectedAtStage =
                  opp.stage === "Evaluating" ||
                  opp.stage === "Selected Vendor" ||
                  opp.stage === "Contracting";
                const isCritical =
                  role === "Finance/CFO" ||
                  role === "IT/Security" ||
                  role === "Procurement";
                const missing = !present && expectedAtStage && isCritical;
                return (
                  <span
                    key={role}
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-md border",
                      present
                        ? c?.status === "departed"
                          ? "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/30"
                          : "bg-severity-green-bg text-severity-green border-severity-green/20"
                        : missing
                          ? "bg-severity-action-bg text-severity-action border-severity-action/20"
                          : "bg-slate-50 text-muted border-border",
                    )}
                    title={present ? `${c?.name} · ${c?.title}` : `No ${role} contact`}
                  >
                    {role}
                    {present && c?.status === "departed" && " ⚠"}
                  </span>
                );
              })}
            </div>
            {dealContacts.length > 0 && (
              <div className="mt-3 space-y-1">
                {dealContacts.map((c) => (
                  <div
                    key={c.id}
                    className="text-xs text-muted flex items-baseline gap-2"
                  >
                    <span className="text-foreground font-medium">{c.name}</span>
                    <span>{c.title}</span>
                    <span>· {c.role}</span>
                    {c.status === "departed" && (
                      <span className="text-severity-blocking font-medium">
                        · departed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Tasks — open */}
          <Section
            title="Open tasks"
            sub={`${openTasks.length} active · ${closedTasks.length} resolved`}
          >
            {openTasks.length === 0 ? (
              <div className="text-sm text-muted italic">
                No open tasks. The signal engine has nothing to flag here right now.
              </div>
            ) : (
              <div className="space-y-2">
                {openTasks.map((t) => (
                  <div key={t.id} className="space-y-1">
                    <TaskCard
                      task={t}
                      isOwner={isOwnerMode}
                      onMarkDone={() => onMarkDone(t.id)}
                      onSnooze={(h) => onSnooze(t.id, h)}
                      onMute={(r) => onMute(t.id, r)}
                      onReopen={() => onReopen(t.id)}
                      onAddNote={(text) => onAddNote(t.id, text)}
                      onAddCoachingNote={(text) =>
                        onAddCoachingNote(t.id, text)
                      }
                    />
                    {!isOwnerMode && (
                      <button
                        onClick={() => onPageOnSlack(t.id)}
                        className="text-[11px] text-muted hover:text-brand inline-flex items-center gap-1"
                      >
                        Page {owner.name.split(" ")[0]} on Slack about this →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Tasks — resolved */}
          {closedTasks.length > 0 && (
            <Section title="Resolved" sub={`${closedTasks.length} closed`}>
              <div className="space-y-2">
                {closedTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    isOwner={isOwnerMode}
                    compact
                    onMarkDone={() => onMarkDone(t.id)}
                    onSnooze={(h) => onSnooze(t.id, h)}
                    onMute={(r) => onMute(t.id, r)}
                    onReopen={() => onReopen(t.id)}
                    onAddNote={(text) => onAddNote(t.id, text)}
                    onAddCoachingNote={(text) =>
                      onAddCoachingNote(t.id, text)
                    }
                  />
                ))}
              </div>
            </Section>
          )}

          {/* External signals — what the outside world is saying about this account */}
          <ExternalSignalsSection
            signals={externalSignals}
            loading={signalsLoading}
            isTrackable={!!account.trackable}
          />

          {/* Call transcripts */}
          {dealCalls.length > 0 && (
            <Section
              title={`${workspace.stack.conversationIntelligence} call excerpts`}
              sub={`${dealCalls.length} call${dealCalls.length > 1 ? "s" : ""} on record`}
            >
              <div className="space-y-3">
                {dealCalls.map((call) => (
                  <CallCard
                    key={call.id}
                    call={call}
                    defaultExpanded={dealCalls.length === 1}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Activity timeline */}
          {dealActivities.length > 0 && (
            <Section
              title="Activity"
              sub={`${dealActivities.length} touches · last ${daysBetween(dealActivities[0].occurredAt)}d ago`}
            >
              <div className="space-y-1.5">
                {dealActivities.slice(0, 15).map((a) => (
                  <div key={a.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full mt-1.5 shrink-0",
                        ACTIVITY_DOT[a.type],
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="text-foreground">{a.summary}</span>
                      </div>
                      <div className="text-muted">
                        {formatDate(a.occurredAt)} · {a.type.replace(/_/g, " ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Assets */}
          <Section
            title="Standard assets"
            sub={`${dealDeliveries.length}/${workspace.assets.length} delivered`}
          >
            <div className="space-y-1">
              {workspace.assets.map((asset) => {
                const delivery = dealDeliveries.find(
                  (d) => d.asset === asset.id,
                );
                return (
                  <div
                    key={asset.id}
                    className="flex items-baseline justify-between text-xs py-1 border-b border-border last:border-0"
                  >
                    <span
                      className={cn(
                        delivery ? "text-foreground" : "text-muted",
                      )}
                    >
                      {asset.name}
                    </span>
                    {delivery ? (
                      <span className="text-severity-green text-[11px]">
                        ✓ {formatDate(delivery.deliveredAt!)}
                      </span>
                    ) : (
                      <span className="text-muted text-[11px]">not sent</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </aside>
    </>
  );
}

// External signals section — pulled from Supabase, sourced from Claude's
// web_search (real news) for trackable accounts, or seed/demo data for
// fictional accounts. Each signal is tagged with its source so the UI is
// transparent about what's real.

const SIGNAL_TYPE_LABEL: Record<string, string> = {
  leadership_change: "Leadership",
  champion_job_change: "Job change",
  ma_acquisition: "M&A",
  funding_round: "Funding",
  layoff: "Layoff",
  earnings: "Earnings",
  product_launch: "Product",
  press_release: "Press",
  competitor_mention: "Competitor",
  regulatory_action: "Regulatory",
  partnership: "Partnership",
  other: "News",
};

function CallCard({
  call,
  defaultExpanded,
}: {
  call: CallTranscript;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasDetail = call.riskFlags.length > 0 || call.excerpts.length > 0;

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={
          "w-full flex items-baseline justify-between gap-3 text-left " +
          (hasDetail ? "cursor-pointer" : "cursor-default")
        }
      >
        <div className="text-xs text-muted flex items-center gap-1.5">
          {hasDetail && (
            <span
              className="text-muted/60 font-mono text-[10px] w-3 inline-block"
              aria-hidden
            >
              {expanded ? "▾" : "▸"}
            </span>
          )}
          <span className="text-foreground font-medium">
            {formatDate(call.callDate)}
          </span>{" "}
          · {call.durationMin}min · {call.attendees.length} attendees
        </div>
        {call.riskFlags.length > 0 && (
          <span className="text-[10px] font-semibold tracking-wider text-severity-action shrink-0">
            {call.riskFlags.length} RISK
            {call.riskFlags.length > 1 ? "S" : ""}
          </span>
        )}
      </button>
      <p className="text-sm leading-relaxed">{call.summary}</p>
      {expanded && call.riskFlags.length > 0 && (
        <ul className="text-xs space-y-0.5">
          {call.riskFlags.map((f, i) => (
            <li key={i} className="text-severity-action">
              ⚠ {f}
            </li>
          ))}
        </ul>
      )}
      {expanded && call.excerpts.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          {call.excerpts.map((e, i) => (
            <div key={i} className="text-xs">
              <div className="text-muted font-mono">
                [{e.timestamp}] {e.speaker}
              </div>
              <div className="text-foreground italic pl-3 border-l-2 border-border ml-1">
                &ldquo;{e.text}&rdquo;
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExternalSignalsSection({
  signals,
  loading,
  isTrackable,
}: {
  signals: ExternalSignal[];
  loading: boolean;
  isTrackable: boolean;
}) {
  const sub = loading
    ? "Loading…"
    : signals.length === 0
      ? isTrackable
        ? "No signals yet — daily cron runs at 8am UTC"
        : "Fictional account · no live signals"
      : `${signals.length} event${signals.length === 1 ? "" : "s"} on record`;
  return (
    <Section title="External signals" sub={sub}>
      {loading ? (
        <div className="text-xs text-muted italic">Loading signals…</div>
      ) : signals.length === 0 ? (
        <div className="text-xs text-muted italic">
          {isTrackable
            ? "Claude web search hasn't surfaced material events for this account yet. Run the cron manually from Settings to refresh."
            : "This is a fictional account, so the live web search doesn't return useful results. Real accounts (Stripe, Snowflake, Atlassian in this demo) are populated by the daily cron."}
        </div>
      ) : (
        <div className="space-y-2">
          {signals.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-border p-3 space-y-1.5"
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold tracking-wider uppercase text-muted px-1.5 py-0.5 rounded bg-slate-100">
                    {SIGNAL_TYPE_LABEL[s.type] ?? "News"}
                  </span>
                  <SourceBadge source={s.source} isDemo={s.is_demo} />
                </div>
                <span className="text-[11px] text-muted font-mono">
                  {formatDate(s.occurred_at)}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{s.summary}</p>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-brand hover:underline inline-block truncate max-w-full"
                >
                  source ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SourceBadge({
  source,
  isDemo,
}: {
  source: string;
  isDemo: boolean;
}) {
  if (isDemo || source === "demo") {
    return (
      <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border">
        Demo
      </span>
    );
  }
  const label =
    source === "newsapi"
      ? "Live · NewsAPI"
      : source === "sec_edgar"
        ? "Live · SEC EDGAR"
        : source === "claude_web_search"
          ? "Live · web search"
          : source === "manual"
            ? "Manual"
            : "Live";
  return (
    <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-severity-green-bg text-severity-green border border-severity-green/20">
      {label}
    </span>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted">
          {title}
        </h3>
        {sub && <span className="text-[11px] text-muted">{sub}</span>}
      </div>
      <div>{children}</div>
    </section>
  );
}

void TODAY; // silence unused warning if drawer doesn't use it directly
