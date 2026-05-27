"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Account,
  Activity,
  AssetDelivery,
  CallTranscript,
  Contact,
  DealHealth,
  Opportunity,
  Rep,
  Signal,
  Stage,
} from "@/lib/types";
import { STAGE_ORDER } from "@/lib/types";
import type { WorkspaceConfig } from "@/lib/workspace";
import {
  Sidebar,
  type ConsoleView,
  type FilterState,
} from "./sidebar";
import { Drawer } from "./drawer";
import { TaskCard } from "./task-card";
import { UpcomingMeetingsPanel } from "./upcoming-meetings-panel";
import { Card, HealthBadge, StageBadge, SeverityBadge, Button } from "./ui";
import { ToastStack, useToasts } from "./toast";
import {
  addNote,
  markDone,
  mute,
  reconcile,
  reopen,
  snooze,
  type Task,
} from "@/lib/tasks";
import { computeDealHealth } from "@/lib/signal-engine";
import { cn, daysBetween, formatCurrency, lookupBy } from "@/lib/utils";

export interface ConsoleData {
  signals: Signal[];
  opportunities: Opportunity[];
  accounts: Account[];
  contacts: Contact[];
  activities: Activity[];
  calls: CallTranscript[];
  deliveries: AssetDelivery[];
  reps: Rep[];
  workspace: WorkspaceConfig;
}

export function Console(
  props: ConsoleData & {
    basePath?: string;
    // /tool's Dashboard tab renders Console without the filter+view sidebar
    // and labels the table as "Dashboard" instead of "Pipeline". Default
    // (false / undefined) preserves the standalone /console and landing
    // embed look.
    hideSidebar?: boolean;
    pipelineTitle?: string;
  },
) {
  const router = useRouter();
  const params = useSearchParams();
  // basePath lets the Console live at any route - /console for the
  // standalone surface, / for the landing-page embed. URL state writes
  // respect this so internal filter changes don't bounce the user out
  // of the page they're on.
  const basePath = props.basePath ?? "/console";

  // ── URL-driven state ────────────────────────────────────────────
  const view = (params.get("view") as ConsoleView) || "pipeline";
  const filters: FilterState = useMemo(
    () => ({
      owners: params.get("owners")?.split(",").filter(Boolean) ?? [],
      stages: (params.get("stages")?.split(",").filter(Boolean) ?? []) as Stage[],
      healths: (params.get("healths")?.split(",").filter(Boolean) ?? []) as DealHealth[],
      severities: (params.get("severities")?.split(",").filter(Boolean) ?? []) as ("blocking" | "action" | "awareness")[],
    }),
    [params],
  );

  function updateUrl(next: { view?: ConsoleView; filters?: FilterState }) {
    const sp = new URLSearchParams();
    const v = next.view ?? view;
    if (v !== "pipeline") sp.set("view", v);
    const f = next.filters ?? filters;
    if (f.owners.length) sp.set("owners", f.owners.join(","));
    if (f.stages.length) sp.set("stages", f.stages.join(","));
    if (f.healths.length) sp.set("healths", f.healths.join(","));
    if (f.severities.length) sp.set("severities", f.severities.join(","));
    const qs = sp.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  }

  // ── Tasks: load, reconcile, manage ──────────────────────────────
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  // Scopes task localStorage per workspace. Switching presets stops the
  // current task set from being walked under the new ruleset (which would
  // produce a wall of "auto-resolved" toasts as old signal IDs no longer
  // match).
  const workspaceKey = useMemo(
    () =>
      `${props.workspace.presetName ?? "custom"}::${props.workspace.companyName}`,
    [props.workspace.presetName, props.workspace.companyName],
  );

  useEffect(() => {
    // On first mount (and whenever signals change), reconcile.
    const ownerLookup: Record<string, string> = {};
    for (const o of props.opportunities) ownerLookup[o.id] = o.ownerId;
    const result = reconcile(workspaceKey, props.signals, props.reps, ownerLookup);
    // Reconciliation reads localStorage (client-only) and must rehydrate
    // after mount - the React 19 "derive in render" alternative requires
    // splitting reconcile() into pure + side-effecting paths and tracking
    // user mutations separately. Deferred.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(result.tasks);
    setHydrated(true);
    if (result.autoResolved.length > 0) {
      const names = result.autoResolved
        .slice(0, 3)
        .map((t) => {
          const opp = props.opportunities.find((o) => o.id === t.oppId);
          const acc = props.accounts.find((a) => a.id === opp?.accountId);
          return acc?.name ?? "deal";
        })
        .join(", ");
      const extra = result.autoResolved.length - 3;
      push({
        tone: "success",
        message: `✓ ${result.autoResolved.length} task${result.autoResolved.length === 1 ? "" : "s"} auto-resolved`,
        detail:
          extra > 0
            ? `${names}, +${extra} more - signal no longer firing.`
            : `${names} - signal no longer firing.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.signals, workspaceKey]);

  // ── Drawer ──────────────────────────────────────────────────────
  const [drawerOppId, setDrawerOppId] = useState<string | null>(null);
  // Observer mode only. Was a rep-impersonation switcher; removed to simplify
  // the demo UX. The viewerId is still threaded through every task action +
  // drawer call so reintroducing rep-mode is one state change away.
  const viewerId: string | undefined = undefined;

  // ── Derived sets ────────────────────────────────────────────────
  const filteredOpps = useMemo(() => {
    return props.opportunities.filter((o) => {
      if (filters.owners.length && !filters.owners.includes(o.ownerId))
        return false;
      if (filters.stages.length && !filters.stages.includes(o.stage)) return false;
      const oppTasks = tasks.filter(
        (t) => t.oppId === o.id && (t.status === "open" || t.status === "snoozed"),
      );
      const oppSignals = oppTasks.map((t) => ({
        id: t.id,
        ruleId: t.signalRuleId,
        oppId: t.oppId,
        severity: t.severity,
        title: t.title,
        body: t.body,
        suggestedAction: t.suggestedAction,
        assetLink: t.assetLink,
        detectedAt: t.createdAt,
      }));
      const health = computeDealHealth(o, oppSignals);
      if (filters.healths.length && !filters.healths.includes(health))
        return false;
      if (filters.severities.length) {
        const oppSevs = new Set(oppTasks.map((t) => t.severity));
        if (!filters.severities.some((s) => oppSevs.has(s))) return false;
      }
      return true;
    });
  }, [filters, props.opportunities, tasks]);

  const openTasksAll = tasks.filter(
    (t) => t.status === "open" || t.status === "snoozed",
  );

  // ── Task action handlers ────────────────────────────────────────
  function handleMarkDone(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    setTasks(markDone(workspaceKey, tasks, taskId, viewerId));
    push({
      tone: "success",
      message: "Marked done",
      detail: task?.title,
      action: {
        label: "Undo",
        onClick: () =>
          setTasks((curr) => reopen(workspaceKey, curr, taskId, viewerId)),
      },
    });
  }
  function handleSnooze(taskId: string, hours: number) {
    setTasks(snooze(workspaceKey, tasks, taskId, hours, viewerId));
    push({
      tone: "info",
      message: `Snoozed ${hours}h`,
      action: {
        label: "Undo",
        onClick: () =>
          setTasks((curr) => reopen(workspaceKey, curr, taskId, viewerId)),
      },
    });
  }
  function handleMute(taskId: string, reason: string) {
    setTasks(mute(workspaceKey, tasks, taskId, reason, viewerId));
    push({
      tone: "info",
      message: "Muted",
      detail: reason,
      action: {
        label: "Undo",
        onClick: () =>
          setTasks((curr) => reopen(workspaceKey, curr, taskId, viewerId)),
      },
    });
  }
  function handleReopen(taskId: string) {
    setTasks(reopen(workspaceKey, tasks, taskId, viewerId));
  }
  function handleAddNote(taskId: string, text: string) {
    setTasks(addNote(workspaceKey, tasks, taskId, text, "work", viewerId));
  }
  function handleAddCoachingNote(taskId: string, text: string) {
    setTasks(addNote(workspaceKey, tasks, taskId, text, "coaching", viewerId));
    push({ tone: "success", message: "Coaching note saved" });
  }
  async function handlePageOnSlack(taskId: string) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    const opp = props.opportunities.find((o) => o.id === t.oppId);
    const acc = props.accounts.find((a) => a.id === opp?.accountId);
    const owner = props.reps.find((r) => r.id === opp?.ownerId);
    const digest = `*Coaching ping*: ${acc?.name} (${opp?.stage}, ${formatCurrency(opp?.amount ?? 0)})\n*Signal*: ${t.title}\n*Suggested*: ${t.suggestedAction}\n_${owner?.name ?? "AE"}, can you look at this today?_`;
    try {
      const res = await fetch("/api/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repName: owner?.name ?? "team",
          digest,
        }),
      });
      const data = await res.json();
      if (data.mode === "live" && data.ok) {
        push({
          tone: "success",
          message: `Posted to Slack`,
          detail: `${owner?.name} pinged about ${acc?.name}`,
        });
      } else if (data.mode === "preview") {
        push({
          tone: "info",
          message: "Slack preview (no webhook configured)",
          detail: "Configure SLACK_WEBHOOK_URL to post live.",
        });
      } else {
        push({
          tone: "warn",
          message: "Slack delivery failed",
          detail: data.error,
        });
      }
    } catch (e) {
      push({
        tone: "warn",
        message: "Slack delivery failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  if (!hydrated) {
    return (
      <div className="max-w-6xl mx-auto px-6 flex">
        {!props.hideSidebar && (
          <div className="w-56 shrink-0 border-r border-border bg-slate-50/50 h-[calc(100vh-3rem)]" />
        )}
        <div className="flex-1 p-6 text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 flex">
      {!props.hideSidebar && (
        <div className="shrink-0 flex flex-col">
          <Sidebar
            view={view}
            filters={filters}
            dealCount={filteredOpps.length}
            openTaskCount={openTasksAll.length}
            onViewChange={(v) => updateUrl({ view: v })}
            onFiltersChange={(f) => updateUrl({ filters: f })}
          />
          {/* Pre-meeting brief stacked below the filter sidebar on the
              Pipeline view - balances the left column visually so the
              right side is just the table. */}
          {view === "pipeline" && (
            <div className="w-56 border-r border-border bg-slate-50/50 px-3 pb-6">
              <UpcomingMeetingsPanel accounts={props.accounts} />
            </div>
          )}
        </div>
      )}

      <main className="flex-1 min-w-0 p-6">
        {view === "pipeline" && (
          <PipelineView
            opps={filteredOpps}
            data={props}
            tasks={tasks}
            onOpen={(id) => setDrawerOppId(id)}
            title={props.pipelineTitle}
          />
        )}
        {view === "today" && (
          <TodayView
            tasks={openTasksAll.filter((t) => {
              if (filters.owners.length && !filters.owners.includes(t.ownerId))
                return false;
              if (filters.severities.length && !filters.severities.includes(t.severity))
                return false;
              const o = props.opportunities.find((o) => o.id === t.oppId);
              if (filters.stages.length && o && !filters.stages.includes(o.stage))
                return false;
              return true;
            })}
            data={props}
            viewerId={viewerId}
            onOpen={(oppId) => setDrawerOppId(oppId)}
            onMarkDone={handleMarkDone}
            onSnooze={handleSnooze}
            onMute={handleMute}
            onReopen={handleReopen}
            onAddNote={handleAddNote}
            onAddCoachingNote={handleAddCoachingNote}
          />
        )}
      </main>

      {drawerOppId && (
        <Drawer
          oppId={drawerOppId}
          data={{ ...props, tasks }}
          workspace={props.workspace}
          viewerId={viewerId}
          onClose={() => setDrawerOppId(null)}
          onMarkDone={handleMarkDone}
          onSnooze={handleSnooze}
          onMute={handleMute}
          onReopen={handleReopen}
          onAddNote={handleAddNote}
          onAddCoachingNote={handleAddCoachingNote}
          onPageOnSlack={handlePageOnSlack}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// PIPELINE VIEW
// ─────────────────────────────────────────────────────────────────

type SortKey = "account" | "stage" | "health" | "amount" | "days" | "owner" | "tasks";
type SortDir = "asc" | "desc";

// Per-column intuitive default direction when first clicked.
// Numerics descend (biggest first), text ascends, ranks ascend (most-urgent first).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  account: "asc",
  stage: "asc",
  health: "asc",
  amount: "desc",
  days: "desc",
  owner: "asc",
  tasks: "desc",
};

function PipelineView({
  opps,
  data,
  tasks,
  onOpen,
  title,
}: {
  opps: Opportunity[];
  data: ConsoleData;
  tasks: Task[];
  onOpen: (oppId: string) => void;
  // Optional override for the column header. /tool's Dashboard tab passes
  // "Dashboard" so the surface reads as one thing instead of stacking a
  // tab label, a tab header, and a "Pipeline" view label all together.
  title?: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("health");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      // Toggle direction on same-column click
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  }

  const HEALTH_RANK: Record<DealHealth, number> = {
    Critical: 0,
    "At Risk": 1,
    Monitor: 2,
    Healthy: 3,
  };
  // Stage rank derived from STAGE_ORDER so adding/renaming a stage in
  // lib/types.ts can't drift from the sort here. Ascending sort places
  // earliest stages first (Intro at top, Contracting at bottom).
  const stageRank = (s: Stage) => STAGE_ORDER.indexOf(s);

  const enriched = opps.map((opp) => {
    const oppTasks = tasks.filter(
      (t) => t.oppId === opp.id && (t.status === "open" || t.status === "snoozed"),
    );
    const oppSignals = oppTasks.map((t) => ({
      id: t.id,
      ruleId: t.signalRuleId,
      oppId: t.oppId,
      severity: t.severity,
      title: t.title,
      body: t.body,
      suggestedAction: t.suggestedAction,
      assetLink: t.assetLink,
      detectedAt: t.createdAt,
    }));
    const health = computeDealHealth(opp, oppSignals);
    const blocking = oppTasks.filter((t) => t.severity === "blocking").length;
    const account = lookupBy(data.accounts, opp.accountId, "account");
    const owner = lookupBy(data.reps, opp.ownerId, "rep");
    return {
      opp,
      health,
      openTasks: oppTasks.length,
      blocking,
      account,
      owner,
      ageDays: daysBetween(opp.enteredStageAt),
    };
  });

  // Free-text search filter - matches against account name, owner name, and
  // opportunity name (case-insensitive substring). Applies before sort.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? enriched.filter(
        ({ account, owner, opp }) =>
          account.name.toLowerCase().includes(q) ||
          owner.name.toLowerCase().includes(q) ||
          opp.name.toLowerCase().includes(q) ||
          opp.stage.toLowerCase().includes(q),
      )
    : enriched;

  // Sort applies primary key; secondary tiebreaker is always
  // health-then-amount to keep the table feeling sensible even when sorted by
  // something like owner.
  filtered.sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let primary = 0;
    switch (sortKey) {
      case "account":
        primary = a.account.name.localeCompare(b.account.name);
        break;
      case "stage":
        primary = stageRank(a.opp.stage) - stageRank(b.opp.stage);
        break;
      case "health":
        primary = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
        break;
      case "amount":
        primary = a.opp.amount - b.opp.amount;
        break;
      case "days":
        primary = a.ageDays - b.ageDays;
        break;
      case "owner":
        primary = a.owner.name.localeCompare(b.owner.name);
        break;
      case "tasks":
        // Use blocking as a tiebreaker within open count so a deal with 2 tasks
        // and 2 blocking sorts above a deal with 2 tasks and 0 blocking.
        primary = a.openTasks - b.openTasks || a.blocking - b.blocking;
        break;
    }
    if (primary !== 0) return primary * dir;
    // Tiebreaker
    const h = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
    if (h !== 0) return h;
    return b.opp.amount - a.opp.amount;
  });

  const filteredPipeline = filtered.reduce((s, e) => s + e.opp.amount, 0);
  const criticalCount = filtered.filter((e) => e.health === "Critical").length;
  const atRiskCount = filtered.filter((e) => e.health === "At Risk").length;

  return (
    <div className="space-y-4">
      <Header
        title={title ?? "Pipeline"}
        sub={`${filtered.length} deal${filtered.length === 1 ? "" : "s"}${q ? ` (of ${opps.length})` : ""} · ${formatCurrency(filteredPipeline)} · ${criticalCount} Critical · ${atRiskCount} At Risk`}
      />

      {/* Search bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts, owners, stages…"
            className="w-full h-9 pl-9 pr-9 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          {/* Search icon */}
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-xs pointer-events-none">
            ⌕
          </span>
          {/* Clear button */}
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground text-xs px-1.5 py-0.5 rounded hover:bg-slate-100"
              title="Clear search"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {q && (
          <span className="text-xs text-muted">
            Filtered to {filtered.length} of {opps.length}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="min-w-0">
          {opps.length === 0 ? (
            <Empty msg="No deals match your filters." />
          ) : filtered.length === 0 ? (
            <Empty msg={`No deals match "${query}".`} />
          ) : (
            <div className="rounded-lg border border-border bg-background overflow-hidden">
              <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted font-semibold sticky top-0">
              <tr className="border-b border-border">
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="account" align="left" onSort={handleSort}>Account</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="stage" align="left" onSort={handleSort}>Stage</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="health" align="left" onSort={handleSort}>Health</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="amount" align="right" onSort={handleSort}>Amount</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="days" align="right" onSort={handleSort}>Days</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="owner" align="left" onSort={handleSort}>Owner</SortableTh>
                <SortableTh sortKey={sortKey} sortDir={sortDir} myKey="tasks" align="right" onSort={handleSort}>Tasks</SortableTh>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ opp, health, openTasks, blocking, account, owner, ageDays }) => (
                <tr
                  key={opp.id}
                  onClick={() => onOpen(opp.id)}
                  className="border-b border-border last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium">
                    <div>{account.name}</div>
                    <div className="text-[10px] font-mono text-muted mt-0.5">
                      pkey = {account.id}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge stage={opp.stage} />
                  </td>
                  <td className="px-3 py-2.5">
                    <HealthBadge health={health} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-foreground">
                    {formatCurrency(opp.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted">
                    {ageDays}d
                  </td>
                  <td className="px-3 py-2.5 text-muted">{owner.name}</td>
                  <td className="px-3 py-2.5 text-right">
                    {openTasks > 0 ? (
                      <span className="font-mono text-xs">
                        <span className="text-foreground">{openTasks}</span>
                        {blocking > 0 && (
                          <span className="text-severity-blocking font-medium ml-1">
                            · {blocking} blocking
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted text-xs italic">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TODAY VIEW
// ─────────────────────────────────────────────────────────────────

function TodayView({
  tasks,
  data,
  viewerId,
  onOpen,
  onMarkDone,
  onSnooze,
  onMute,
  onReopen,
  onAddNote,
  onAddCoachingNote,
}: {
  tasks: Task[];
  data: ConsoleData;
  viewerId?: string;
  onOpen: (oppId: string) => void;
  onMarkDone: (id: string) => void;
  onSnooze: (id: string, h: number) => void;
  onMute: (id: string, r: string) => void;
  onReopen: (id: string) => void;
  onAddNote: (id: string, text: string) => void;
  onAddCoachingNote: (id: string, text: string) => void;
}) {
  const SEV_RANK = { blocking: 0, action: 1, awareness: 2 };
  const sorted = [...tasks].sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity],
  );

  const openOnly = sorted.filter((t) => t.status === "open");
  const blocking = openOnly.filter((t) => t.severity === "blocking");
  const action = openOnly.filter((t) => t.severity === "action");
  const awareness = openOnly.filter((t) => t.severity === "awareness");
  const snoozed = sorted.filter((t) => t.status === "snoozed");

  return (
    <div className="space-y-6">
      <Header
        title="Actions queue"
        sub={`${openOnly.length} open · ${blocking.length} blocking · ${action.length} action${awareness.length > 0 ? ` · ${awareness.length} awareness` : ""}${snoozed.length > 0 ? ` · ${snoozed.length} snoozed` : ""}`}
      />

      {tasks.length === 0 ? (
        <Empty msg="All clear. Filtered queue is empty." />
      ) : (
        <>
          {blocking.length > 0 && (
            <SeverityGroup
              label="Blocking"
              tone="blocking"
              tasks={blocking}
              data={data}
              viewerId={viewerId}
              onOpen={onOpen}
              onMarkDone={onMarkDone}
              onSnooze={onSnooze}
              onMute={onMute}
              onReopen={onReopen}
              onAddNote={onAddNote}
              onAddCoachingNote={onAddCoachingNote}
            />
          )}

          {action.length > 0 && (
            <SeverityGroup
              label="Action"
              tone="action"
              tasks={action}
              data={data}
              viewerId={viewerId}
              onOpen={onOpen}
              onMarkDone={onMarkDone}
              onSnooze={onSnooze}
              onMute={onMute}
              onReopen={onReopen}
              onAddNote={onAddNote}
              onAddCoachingNote={onAddCoachingNote}
            />
          )}

          {awareness.length > 0 && (
            <SeverityGroup
              label="Awareness"
              tone="awareness"
              tasks={awareness}
              data={data}
              viewerId={viewerId}
              onOpen={onOpen}
              onMarkDone={onMarkDone}
              onSnooze={onSnooze}
              onMute={onMute}
              onReopen={onReopen}
              onAddNote={onAddNote}
              onAddCoachingNote={onAddCoachingNote}
            />
          )}
        </>
      )}
    </div>
  );
}

// Severity-grouped task list with progressive disclosure. Renders the first
// PAGE_SIZE items eagerly; subsequent items are revealed PAGE_SIZE at a time
// via the "Load more" footer button. Keeps the queue legible when a single
// severity bucket holds 20+ items.
const SEVERITY_GROUP_PAGE_SIZE = 3;

function SeverityGroup({
  label,
  tone,
  tasks,
  data,
  viewerId,
  onOpen,
  onMarkDone,
  onSnooze,
  onMute,
  onReopen,
  onAddNote,
  onAddCoachingNote,
}: {
  label: string;
  tone: "blocking" | "action" | "awareness";
  tasks: Task[];
  data: ConsoleData;
  viewerId?: string;
  onOpen: (oppId: string) => void;
  onMarkDone: (id: string) => void;
  onSnooze: (id: string, h: number) => void;
  onMute: (id: string, r: string) => void;
  onReopen: (id: string) => void;
  onAddNote: (id: string, text: string) => void;
  onAddCoachingNote: (id: string, text: string) => void;
}) {
  const [visible, setVisible] = useState(SEVERITY_GROUP_PAGE_SIZE);
  const shown = tasks.slice(0, visible);
  const remaining = tasks.length - shown.length;
  return (
    <section className="space-y-2">
      <SectionHead label={label} tone={tone} count={tasks.length} />
      <div className="space-y-2">
        {shown.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            data={data}
            viewerId={viewerId}
            onOpen={onOpen}
            onMarkDone={onMarkDone}
            onSnooze={onSnooze}
            onMute={onMute}
            onReopen={onReopen}
            onAddNote={onAddNote}
            onAddCoachingNote={onAddCoachingNote}
          />
        ))}
      </div>
      {remaining > 0 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11px] font-mono text-muted">
            Showing {shown.length} of {tasks.length}
          </span>
          <button
            type="button"
            onClick={() =>
              setVisible((v) => v + SEVERITY_GROUP_PAGE_SIZE)
            }
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-border text-[11px] font-medium text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            Load {Math.min(SEVERITY_GROUP_PAGE_SIZE, remaining)} more
          </button>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  task,
  data,
  viewerId,
  onOpen,
  onMarkDone,
  onSnooze,
  onMute,
  onReopen,
  onAddNote,
  onAddCoachingNote,
}: {
  task: Task;
  data: ConsoleData;
  viewerId?: string;
  onOpen: (oppId: string) => void;
  onMarkDone: (id: string) => void;
  onSnooze: (id: string, h: number) => void;
  onMute: (id: string, r: string) => void;
  onReopen: (id: string) => void;
  onAddNote: (id: string, text: string) => void;
  onAddCoachingNote: (id: string, text: string) => void;
}) {
  const opp = lookupBy(data.opportunities, task.oppId, "opportunity");
  const acc = lookupBy(data.accounts, opp.accountId, "account");
  const owner = lookupBy(data.reps, opp.ownerId, "rep");
  const isOwner = viewerId === task.ownerId;

  return (
    <TaskCard
      task={task}
      dealName={`${acc.name} · ${formatCurrency(opp.amount)} · ${owner.name.split(" ")[0]}`}
      isOwner={isOwner}
      onMarkDone={() => onMarkDone(task.id)}
      onSnooze={(h) => onSnooze(task.id, h)}
      onMute={(r) => onMute(task.id, r)}
      onReopen={() => onReopen(task.id)}
      onAddNote={(text) => onAddNote(task.id, text)}
      onAddCoachingNote={(text) => onAddCoachingNote(task.id, text)}
      onOpenDeal={() => onOpen(task.oppId)}
    />
  );
}

// Sortable table header. Renders an arrow indicator on the active column,
// a subtle muted arrow on the others as an affordance.
function SortableTh({
  myKey,
  sortKey,
  sortDir,
  align,
  onSort,
  children,
}: {
  myKey: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  align: "left" | "right";
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const isActive = sortKey === myKey;
  const arrow = isActive ? (sortDir === "asc" ? "↑" : "↓") : "·";
  return (
    <th
      onClick={() => onSort(myKey)}
      className={cn(
        "px-3 py-2 font-semibold cursor-pointer select-none hover:bg-slate-100 transition-colors",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "justify-end")}>
        {align === "right" && (
          <span className={cn("text-[10px]", isActive ? "text-foreground" : "text-muted/40")}>
            {arrow}
          </span>
        )}
        <span>{children}</span>
        {align === "left" && (
          <span className={cn("text-[10px]", isActive ? "text-foreground" : "text-muted/40")}>
            {arrow}
          </span>
        )}
      </span>
    </th>
  );
}


// ─────────────────────────────────────────────────────────────────
// SHARED BITS
// ─────────────────────────────────────────────────────────────────

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <Card className="p-8 text-center text-sm text-muted italic">{msg}</Card>
  );
}

function SectionHead({
  label,
  tone,
  count,
}: {
  label: string;
  tone: "blocking" | "action" | "awareness";
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <SeverityBadge severity={tone} />
      <span className="text-xs uppercase tracking-wider text-muted font-semibold">
        {label}
      </span>
      <span className="text-xs text-muted">· {count}</span>
    </div>
  );
}

