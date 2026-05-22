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
import type { WorkspaceConfig } from "@/lib/workspace";
import {
  Sidebar,
  type ConsoleView,
  type FilterState,
  EMPTY_FILTERS,
} from "./sidebar";
import { Drawer } from "./drawer";
import { TaskCard } from "./task-card";
import { Card, HealthBadge, StageBadge, SeverityBadge, Button } from "./ui";
import { ToastStack, useToasts } from "./toast";
import {
  addNote,
  loadTasks,
  markDone,
  mute,
  reconcile,
  reopen,
  snooze,
  type Task,
} from "@/lib/tasks";
import { computeDealHealth } from "@/lib/signal-engine";
import { daysBetween, formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

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

export function Console(props: ConsoleData) {
  const router = useRouter();
  const params = useSearchParams();

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
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  // ── Tasks: load, reconcile, manage ──────────────────────────────
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    // On first mount (and whenever signals change), reconcile.
    const ownerLookup: Record<string, string> = {};
    for (const o of props.opportunities) ownerLookup[o.id] = o.ownerId;
    const result = reconcile(props.signals, props.reps, ownerLookup);
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
            ? `${names}, +${extra} more — signal no longer firing.`
            : `${names} — signal no longer firing.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.signals]);

  // ── Drawer ──────────────────────────────────────────────────────
  const [drawerOppId, setDrawerOppId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | undefined>(undefined);

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
    setTasks(markDone(tasks, taskId, viewerId));
    push({
      tone: "success",
      message: "Marked done",
      detail: task?.title,
      action: {
        label: "Undo",
        onClick: () => setTasks((curr) => reopen(curr, taskId, viewerId)),
      },
    });
  }
  function handleSnooze(taskId: string, hours: number) {
    setTasks(snooze(tasks, taskId, hours, viewerId));
    push({
      tone: "info",
      message: `Snoozed ${hours}h`,
      action: {
        label: "Undo",
        onClick: () => setTasks((curr) => reopen(curr, taskId, viewerId)),
      },
    });
  }
  function handleMute(taskId: string, reason: string) {
    setTasks(mute(tasks, taskId, reason, viewerId));
    push({
      tone: "info",
      message: "Muted",
      detail: reason,
      action: {
        label: "Undo",
        onClick: () => setTasks((curr) => reopen(curr, taskId, viewerId)),
      },
    });
  }
  function handleReopen(taskId: string) {
    setTasks(reopen(tasks, taskId, viewerId));
  }
  function handleAddNote(taskId: string, text: string) {
    setTasks(addNote(tasks, taskId, text, "work", viewerId));
  }
  function handleAddCoachingNote(taskId: string, text: string) {
    setTasks(addNote(tasks, taskId, text, "coaching", viewerId));
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
      <div className="flex">
        <div className="w-56 shrink-0 border-r border-border bg-slate-50/50 h-[calc(100vh-3rem)]" />
        <div className="flex-1 p-8 text-sm text-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex">
      <Sidebar
        view={view}
        filters={filters}
        reps={props.reps}
        dealCount={filteredOpps.length}
        openTaskCount={openTasksAll.length}
        onViewChange={(v) => updateUrl({ view: v })}
        onFiltersChange={(f) => updateUrl({ filters: f })}
      />

      <main className="flex-1 min-w-0 p-6 max-w-5xl">
        {view === "pipeline" && (
          <PipelineView
            opps={filteredOpps}
            data={props}
            tasks={tasks}
            onOpen={(id) => setDrawerOppId(id)}
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
        {view === "digest" && (
          <DigestView reps={props.reps} workspace={props.workspace} />
        )}

        {/* Viewer identity switcher — small footer affordance, not the main UX */}
        <ViewerIdentityRow
          reps={props.reps}
          viewerId={viewerId}
          onChange={setViewerId}
        />
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
}: {
  opps: Opportunity[];
  data: ConsoleData;
  tasks: Task[];
  onOpen: (oppId: string) => void;
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
  // Stage order matches the funnel — Intro at top, Contracting at bottom.
  // Ascending sort places earliest stages first.
  const STAGE_RANK: Record<string, number> = {
    Intro: 0,
    Qualified: 1,
    "Demo Sat": 2,
    Evaluating: 3,
    "Selected Vendor": 4,
    Contracting: 5,
  };

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
    const account = data.accounts.find((a) => a.id === opp.accountId)!;
    const owner = data.reps.find((r) => r.id === opp.ownerId)!;
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

  // Free-text search filter — matches against account name, owner name, and
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
        primary = STAGE_RANK[a.opp.stage] - STAGE_RANK[b.opp.stage];
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
        title="Pipeline"
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
                  <td className="px-3 py-2.5 font-medium">{account.name}</td>
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
                      <span className="text-muted text-xs italic">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

  const blocking = sorted.filter((t) => t.severity === "blocking");
  const action = sorted.filter((t) => t.severity === "action");
  const awareness = sorted.filter((t) => t.severity === "awareness");

  return (
    <div className="space-y-6">
      <Header
        title="Today's queue"
        sub={`${tasks.length} open task${tasks.length === 1 ? "" : "s"} · ${blocking.length} blocking · ${action.length} action${awareness.length > 0 ? ` · ${awareness.length} awareness` : ""}`}
      />

      {tasks.length === 0 ? (
        <Empty msg="All clear. Filtered queue is empty." />
      ) : (
        <>
          {blocking.length > 0 && (
            <section className="space-y-2">
              <SectionHead label="Blocking" tone="blocking" count={blocking.length} />
              <div className="space-y-2">
                {blocking.map((t) => (
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
            </section>
          )}

          {action.length > 0 && (
            <section className="space-y-2">
              <SectionHead label="Action" tone="action" count={action.length} />
              <div className="space-y-2">
                {action.map((t) => (
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
            </section>
          )}

          {awareness.length > 0 && (
            <section className="space-y-2">
              <SectionHead label="Awareness" tone="awareness" count={awareness.length} />
              <div className="space-y-2">
                {awareness.map((t) => (
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
            </section>
          )}
        </>
      )}
    </div>
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
  const opp = data.opportunities.find((o) => o.id === task.oppId)!;
  const acc = data.accounts.find((a) => a.id === opp.accountId)!;
  const owner = data.reps.find((r) => r.id === opp.ownerId)!;
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
// DIGEST VIEW
// ─────────────────────────────────────────────────────────────────

function DigestView({
  reps,
  workspace,
}: {
  reps: Rep[];
  workspace: WorkspaceConfig;
}) {
  const aes = reps.filter((r) => r.role === "AE");
  const [recipientId, setRecipientId] = useState(aes[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts();
  const recipient = reps.find((r) => r.id === recipientId);

  async function generate() {
    setLoading(true);
    setError(null);
    setDigest(null);
    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repId: recipientId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDigest(data.digest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function sendToSlack() {
    if (!digest || !recipient) return;
    try {
      const res = await fetch("/api/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repName: recipient.name.split(" ")[0],
          digest,
        }),
      });
      const data = await res.json();
      if (data.mode === "live" && data.ok)
        push({ tone: "success", message: "Posted to Slack" });
      else if (data.mode === "preview")
        push({
          tone: "info",
          message: "Preview (no SLACK_WEBHOOK_URL set)",
        });
      else
        push({
          tone: "warn",
          message: "Slack failed",
          detail: data.error,
        });
    } catch (e) {
      push({
        tone: "warn",
        message: "Slack failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="space-y-6">
      <Header
        title="Morning digest"
        sub={`Synthesized live by Claude from the current signal state for ${workspace.companyName}.`}
      />

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted">Generate for:</span>
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="text-sm rounded border border-border bg-background px-2 h-8 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            {aes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Button onClick={generate} disabled={loading}>
            {loading ? "Synthesizing…" : digest ? "Regenerate" : "Generate"}
          </Button>
          {digest && (
            <Button variant="secondary" onClick={sendToSlack}>
              Send to Slack
            </Button>
          )}
        </div>

        {error && (
          <div className="text-xs text-severity-blocking">
            <div className="font-medium">Generation failed</div>
            <div className="font-mono opacity-80 mt-0.5">{error}</div>
          </div>
        )}

        {digest && (
          <div className="border-t border-border pt-3">
            <DigestText markdown={digest} />
          </div>
        )}

        {!digest && !loading && !error && (
          <div className="border-t border-border pt-3 text-sm text-muted italic">
            Click <span className="font-medium not-italic text-foreground">Generate</span> to run the signal engine and synthesize {recipient?.name?.split(" ")[0]}&apos;s morning briefing.
          </div>
        )}
      </Card>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function DigestText({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  let key = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push(<div key={key++} className="h-2" />);
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(
        <h3
          key={key++}
          className="text-xs uppercase tracking-wider font-semibold text-muted mt-3 mb-1"
        >
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      out.push(
        <h2 key={key++} className="text-sm font-semibold mt-3 mb-1">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      out.push(
        <div key={key++} className="flex gap-2 text-sm leading-relaxed">
          <span className="text-muted">•</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(line.slice(2)) }} />
        </div>,
      );
    } else {
      out.push(
        <p
          key={key++}
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: inlineMd(line) }}
        />,
      );
    }
  }
  return <div className="space-y-1">{out}</div>;
}

function inlineMd(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /`(.+?)`/g,
      '<code class="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">$1</code>',
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

function ViewerIdentityRow({
  reps,
  viewerId,
  onChange,
}: {
  reps: Rep[];
  viewerId?: string;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <div className="mt-12 pt-4 border-t border-border flex items-center gap-2 text-xs text-muted">
      <span>You are:</span>
      <button
        onClick={() => onChange(undefined)}
        className={cn(
          "px-2 py-0.5 rounded border",
          !viewerId
            ? "border-brand bg-brand text-white"
            : "border-border hover:text-foreground",
        )}
      >
        observer
      </button>
      {reps.map((r) => (
        <button
          key={r.id}
          onClick={() => onChange(r.id)}
          className={cn(
            "px-2 py-0.5 rounded border",
            viewerId === r.id
              ? "border-brand bg-brand text-white"
              : "border-border hover:text-foreground",
          )}
        >
          {r.name.split(" ")[0]} <span className="opacity-70">· {r.role}</span>
        </button>
      ))}
      <span className="ml-2">— controls whose coaching-note vs work-note fields show.</span>
    </div>
  );
}
