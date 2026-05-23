// Task layer — the orchestration substrate.
//
// Signals (from signal-engine) DETECT things. Tasks (from this module) make
// those signals STATEFUL: a task tracks whether the AE actually did the work,
// can be snoozed/muted, carries notes and coaching comments, and remembers
// who-did-what-when via a history log.
//
// Source of truth: the signal engine. Tasks reconcile against the current
// signal set on every read — if the underlying signal stops firing, the task
// auto-resolves (with a toast surfaced in the UI).
//
// Storage: localStorage. Production would back this with a database (one row
// per task, per workspace). This is the honest seam to flag in interview.

import type { Signal, SignalSeverity } from "./types";
import { TODAY } from "./utils";

export type TaskStatus = "open" | "done" | "snoozed" | "muted";

export type TaskResolutionReason =
  | "manual_done" // AE clicked "Mark done"
  | "auto_signal_resolved" // signal stopped firing; system closed it
  | "muted"; // AE muted with a reason — no further re-fires

export interface TaskEvent {
  at: string; // ISO timestamp
  by?: string; // rep id or "system"
  action: string; // short verb phrase, e.g. "marked done"
  detail?: string; // freeform context
}

export interface TaskNote {
  at: string;
  by?: string;
  kind: "work" | "coaching"; // AE work note vs manager coaching
  text: string;
}

export interface Task {
  id: string; // matches the signal.id that produced it (`${ruleId}:${oppId}`)
  signalRuleId: string;
  oppId: string;
  ownerId: string; // deal owner — AE responsible

  // Snapshot of the signal at the time the task was current. Refreshed on each
  // reconciliation while the task is still open. Frozen once the task closes.
  severity: SignalSeverity;
  title: string;
  body: string;
  suggestedAction: string;
  assetLink?: string;
  playbookId?: string;

  // Lifecycle
  createdAt: string;
  status: TaskStatus;
  resolvedAt?: string;
  resolutionReason?: TaskResolutionReason;
  snoozedUntil?: string; // ISO — when a snoozed task wakes up
  muteReason?: string;

  // Annotation
  notes: TaskNote[];
  history: TaskEvent[];
}

// ---------------------------------------------------------------------------
// Storage helpers — client-only (localStorage). Safe to call from server
// components; they'll return empty arrays since `window` is undefined.
//
// Storage is scoped per workspace: switching presets (Checkbox → Generic SaaS)
// uses a different key so tasks don't bleed across. Without scoping, every
// preset switch produces a wall of "auto-resolved" toasts as the old tasks'
// signal IDs no longer match the new ruleset's outputs.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "dugout-tasks";

function storageKey(workspaceKey: string): string {
  return `${STORAGE_PREFIX}:${workspaceKey}`;
}

export function loadTasks(workspaceKey: string): Task[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveTasks(workspaceKey: string, tasks: Task[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceKey), JSON.stringify(tasks));
  } catch {
    // localStorage quota or disabled — fail silently. Production would alert.
  }
}

export function clearTasks(workspaceKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(workspaceKey));
}

// ---------------------------------------------------------------------------
// Reconciliation — the core engine.
//
// Given the current set of signals (computed server-side from seed + workspace
// config) and the stored tasks (from localStorage), return:
//   1. The merged task list — preserves user state, creates new tasks for new
//      signals, auto-resolves tasks whose signal no longer fires.
//   2. A list of task IDs that JUST auto-resolved in this reconciliation pass.
//      The UI shows a toast for these.
//
// Pure function except for the localStorage write at the end.
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  tasks: Task[];
  autoResolved: Task[]; // tasks that just transitioned open/snoozed → done
}

export function reconcile(
  workspaceKey: string,
  signals: Signal[],
  reps: { id: string }[],
  oppOwnerLookup: Record<string, string>,
  now: Date = TODAY,
): ReconciliationResult {
  const stored = loadTasks(workspaceKey);
  const signalsById = new Map(signals.map((s) => [s.id, s]));
  const storedById = new Map(stored.map((t) => [t.id, t]));

  const merged: Task[] = [];
  const autoResolved: Task[] = [];
  const nowIso = now.toISOString();

  // Walk current signals first. For each, either update the existing task
  // (refresh snapshot if still open) or create a new one.
  for (const sig of signals) {
    const existing = storedById.get(sig.id);
    if (!existing) {
      // New signal → new task
      merged.push(signalToTask(sig, oppOwnerLookup[sig.oppId] ?? "", nowIso));
      continue;
    }

    // Snoozed task whose snooze has expired → reopen
    if (
      existing.status === "snoozed" &&
      existing.snoozedUntil &&
      existing.snoozedUntil <= nowIso
    ) {
      const reopened: Task = {
        ...existing,
        // Refresh snapshot from current signal
        severity: sig.severity,
        title: sig.title,
        body: sig.body,
        suggestedAction: sig.suggestedAction,
        assetLink: sig.assetLink,
        playbookId: sig.playbookId,
        status: "open",
        snoozedUntil: undefined,
        history: [
          ...existing.history,
          { at: nowIso, by: "system", action: "snooze expired, reopened" },
        ],
      };
      merged.push(reopened);
      continue;
    }

    // Open task → refresh snapshot from current signal (in case the body changed)
    if (existing.status === "open") {
      merged.push({
        ...existing,
        severity: sig.severity,
        title: sig.title,
        body: sig.body,
        suggestedAction: sig.suggestedAction,
        assetLink: sig.assetLink,
        playbookId: sig.playbookId,
      });
      continue;
    }

    // Done, muted, still-snoozed → keep as stored (snapshot frozen at close)
    merged.push(existing);
  }

  // Walk stored tasks whose signal is NO LONGER firing.
  // Open/snoozed → auto-resolve. Done/muted → keep as-is.
  for (const task of stored) {
    if (signalsById.has(task.id)) continue; // already handled above
    if (task.status === "open" || task.status === "snoozed") {
      const resolved: Task = {
        ...task,
        status: "done",
        resolvedAt: nowIso,
        resolutionReason: "auto_signal_resolved",
        history: [
          ...task.history,
          {
            at: nowIso,
            by: "system",
            action: "auto-resolved",
            detail: "Signal no longer firing.",
          },
        ],
      };
      merged.push(resolved);
      autoResolved.push(resolved);
      continue;
    }
    merged.push(task);
  }

  saveTasks(workspaceKey, merged);
  return { tasks: merged, autoResolved };
}

function signalToTask(sig: Signal, ownerId: string, nowIso: string): Task {
  return {
    id: sig.id,
    signalRuleId: sig.ruleId,
    oppId: sig.oppId,
    ownerId,
    severity: sig.severity,
    title: sig.title,
    body: sig.body,
    suggestedAction: sig.suggestedAction,
    assetLink: sig.assetLink,
    playbookId: sig.playbookId,
    createdAt: nowIso,
    status: "open",
    notes: [],
    history: [{ at: nowIso, by: "system", action: "task created" }],
  };
}

// ---------------------------------------------------------------------------
// Mutators — used by action buttons in the UI. Each returns the updated task
// list and persists to localStorage.
// ---------------------------------------------------------------------------

function findAndUpdate(
  tasks: Task[],
  taskId: string,
  patch: (t: Task) => Task,
): Task[] {
  return tasks.map((t) => (t.id === taskId ? patch(t) : t));
}

export function markDone(
  workspaceKey: string,
  tasks: Task[],
  taskId: string,
  by?: string,
): Task[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(tasks, taskId, (t) => ({
    ...t,
    status: "done",
    resolvedAt: nowIso,
    resolutionReason: "manual_done",
    history: [...t.history, { at: nowIso, by, action: "marked done" }],
  }));
  saveTasks(workspaceKey, next);
  return next;
}

export function snooze(
  workspaceKey: string,
  tasks: Task[],
  taskId: string,
  hours: number,
  by?: string,
): Task[] {
  const nowIso = new Date().toISOString();
  const wakeIso = new Date(Date.now() + hours * 3600_000).toISOString();
  const next = findAndUpdate(tasks, taskId, (t) => ({
    ...t,
    status: "snoozed",
    snoozedUntil: wakeIso,
    history: [
      ...t.history,
      { at: nowIso, by, action: `snoozed ${hours}h` },
    ],
  }));
  saveTasks(workspaceKey, next);
  return next;
}

export function mute(
  workspaceKey: string,
  tasks: Task[],
  taskId: string,
  reason: string,
  by?: string,
): Task[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(tasks, taskId, (t) => ({
    ...t,
    status: "muted",
    muteReason: reason,
    resolvedAt: nowIso,
    resolutionReason: "muted",
    history: [
      ...t.history,
      { at: nowIso, by, action: "muted", detail: reason },
    ],
  }));
  saveTasks(workspaceKey, next);
  return next;
}

export function reopen(
  workspaceKey: string,
  tasks: Task[],
  taskId: string,
  by?: string,
): Task[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(tasks, taskId, (t) => ({
    ...t,
    status: "open",
    resolvedAt: undefined,
    resolutionReason: undefined,
    snoozedUntil: undefined,
    muteReason: undefined,
    history: [...t.history, { at: nowIso, by, action: "reopened" }],
  }));
  saveTasks(workspaceKey, next);
  return next;
}

export function addNote(
  workspaceKey: string,
  tasks: Task[],
  taskId: string,
  text: string,
  kind: "work" | "coaching",
  by?: string,
): Task[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(tasks, taskId, (t) => ({
    ...t,
    notes: [...t.notes, { at: nowIso, by, kind, text }],
    history: [
      ...t.history,
      {
        at: nowIso,
        by,
        action: kind === "coaching" ? "added coaching note" : "added note",
      },
    ],
  }));
  saveTasks(workspaceKey, next);
  return next;
}
