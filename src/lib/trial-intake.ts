// Trial Orchestrator persistence + state machine.
//
// Companion system to the signal engine. The engine detects "Demo Sat without
// outcome-first trial brief" via NO_TRIAL_BRIEF_AT_DEMO_SAT; this module is
// the workflow that takes the next 6 steps — AE submits an intake, SE returns
// a KPI Assessment + pre-seeded demo within 48 hours, deal room is populated.
//
// Storage: localStorage, matching the task layer in tasks.ts. Pure functions
// for computations (SLA + status transitions) so the tests can hit them
// without a window object. Production would back this with a database row
// per intake; the state machine on TrialIntake survives that migration
// unchanged.

import type { Task } from "./tasks";
import { markDone } from "./tasks";
import type {
  TrialIntake,
  TrialIntakeEvent,
  TrialIntakeStatus,
} from "./types";
import { TRIAL_INTAKE_SLA_MS } from "./types";

// ---------------------------------------------------------------------------
// Storage — client-only. Safe to call from server components; will return [].
// Workspace-scoped exactly like tasks so preset switches don't bleed intakes
// across.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "dugout-trial-intakes";

function storageKey(workspaceKey: string): string {
  return `${STORAGE_PREFIX}:${workspaceKey}`;
}

export function loadIntakes(workspaceKey: string): TrialIntake[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrialIntake[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveIntakes(
  workspaceKey: string,
  intakes: TrialIntake[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(workspaceKey),
      JSON.stringify(intakes),
    );
  } catch {
    // Quota / disabled — fail silently. Production would alert.
  }
}

export function clearIntakes(workspaceKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(workspaceKey));
}

// ---------------------------------------------------------------------------
// Pure helpers — SLA + status derivation. These are the tested seams.
// ---------------------------------------------------------------------------

export interface SlaState {
  remainingMs: number; // negative when overdue
  totalMs: number;
  overdue: boolean;
  // Bucket: drives the timer color. Boundaries chosen so a glance at the
  // table tells the AE which intakes need attention before lunch vs which
  // are fine until tomorrow.
  bucket: "healthy" | "warning" | "urgent" | "overdue";
}

// > 24h remaining → green. 24h–4h → amber. < 4h → red. < 0 → red strike.
const WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const URGENT_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export function computeSla(
  intake: TrialIntake,
  now: Date = new Date(),
): SlaState {
  const deadline = new Date(intake.slaDeadline).getTime();
  const remainingMs = deadline - now.getTime();
  const overdue = remainingMs < 0;
  let bucket: SlaState["bucket"];
  if (overdue) bucket = "overdue";
  else if (remainingMs < URGENT_THRESHOLD_MS) bucket = "urgent";
  else if (remainingMs < WARNING_THRESHOLD_MS) bucket = "warning";
  else bucket = "healthy";
  return { remainingMs, totalMs: TRIAL_INTAKE_SLA_MS, overdue, bucket };
}

// Surfaced status — "overdue" is computed at read time, never stored. Once an
// intake is delivered the stored status sticks (a delivered intake can't go
// overdue retroactively).
export function deriveStatus(
  intake: TrialIntake,
  now: Date = new Date(),
): TrialIntakeStatus {
  if (intake.status === "delivered") return "delivered";
  const sla = computeSla(intake, now);
  if (sla.overdue) return "overdue";
  return intake.status;
}

// Pretty-print a remainingMs value as "Xh Ym" or "-Xh Ym overdue".
export function formatRemaining(remainingMs: number): string {
  const abs = Math.abs(remainingMs);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  const minutes = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  const sign = remainingMs < 0 ? "-" : "";
  const stem = `${sign}${hours}h ${minutes}m`;
  return remainingMs < 0 ? `${stem} overdue` : `${stem} left`;
}

// ---------------------------------------------------------------------------
// Mutators — used by action buttons in the UI. Each returns the updated list
// and persists to localStorage. Mirrors the tasks.ts shape.
// ---------------------------------------------------------------------------

function findAndUpdate(
  intakes: TrialIntake[],
  intakeId: string,
  patch: (i: TrialIntake) => TrialIntake,
): TrialIntake[] {
  return intakes.map((i) => (i.id === intakeId ? patch(i) : i));
}

export interface CreateIntakeInput {
  oppId: string;
  accountId: string;
  submittedBy: string;
  kpiHypotheses: string[];
  buyerSuccessCriteria: string;
  datasetRequirements: string;
  seNotes: string;
  // Override for tests; defaults to new Date().
  now?: Date;
}

export function createIntake(input: CreateIntakeInput): TrialIntake {
  const now = input.now ?? new Date();
  const submittedAt = now.toISOString();
  const slaDeadline = new Date(now.getTime() + TRIAL_INTAKE_SLA_MS).toISOString();
  return {
    id: `intake_${input.oppId}_${now.getTime()}`,
    oppId: input.oppId,
    accountId: input.accountId,
    submittedBy: input.submittedBy,
    submittedAt,
    slaDeadline,
    kpiHypotheses: input.kpiHypotheses.filter((k) => k.trim().length > 0),
    buyerSuccessCriteria: input.buyerSuccessCriteria,
    datasetRequirements: input.datasetRequirements,
    seNotes: input.seNotes,
    status: "pending_se_assignment",
    history: [
      {
        at: submittedAt,
        by: input.submittedBy,
        action: "intake submitted",
      },
    ],
  };
}

export function appendIntake(
  workspaceKey: string,
  intakes: TrialIntake[],
  intake: TrialIntake,
): TrialIntake[] {
  const next = [intake, ...intakes];
  saveIntakes(workspaceKey, next);
  return next;
}

export function assignSe(
  workspaceKey: string,
  intakes: TrialIntake[],
  intakeId: string,
  seId: string,
  by?: string,
): TrialIntake[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(intakes, intakeId, (i) => ({
    ...i,
    status: "in_progress",
    assignedSeId: seId,
    history: appendEvent(i.history, {
      at: nowIso,
      by,
      action: "assigned SE",
      detail: seId,
    }),
  }));
  saveIntakes(workspaceKey, next);
  return next;
}

export function markKpiDelivered(
  workspaceKey: string,
  intakes: TrialIntake[],
  intakeId: string,
  by?: string,
): TrialIntake[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(intakes, intakeId, (i) => ({
    ...i,
    status: "delivered",
    kpiAssessmentDeliveredAt: nowIso,
    history: appendEvent(i.history, {
      at: nowIso,
      by,
      action: "KPI assessment delivered",
    }),
  }));
  saveIntakes(workspaceKey, next);
  return next;
}

export function markDemoSeeded(
  workspaceKey: string,
  intakes: TrialIntake[],
  intakeId: string,
  by?: string,
): TrialIntake[] {
  const nowIso = new Date().toISOString();
  const next = findAndUpdate(intakes, intakeId, (i) => ({
    ...i,
    demoSeededAt: nowIso,
    history: appendEvent(i.history, {
      at: nowIso,
      by,
      action: "pre-seeded demo dropped in deal room",
    }),
  }));
  saveIntakes(workspaceKey, next);
  return next;
}

function appendEvent(
  history: TrialIntakeEvent[],
  event: TrialIntakeEvent,
): TrialIntakeEvent[] {
  return [...history, event];
}

// ---------------------------------------------------------------------------
// Signal/task reconciliation — when an intake is created for an opportunity,
// the corresponding NO_TRIAL_BRIEF_AT_DEMO_SAT task should auto-resolve. The
// brief is in flight, the signal's behavioral premise no longer holds.
//
// This is a manual-resolve rather than waiting for the next signal-engine
// pass: the engine's input (assetDeliveries) doesn't get mutated by an intake
// submission, so the engine would keep emitting the signal until an SE
// actually marks the brief delivered. Resolving the task here closes that gap.
// ---------------------------------------------------------------------------

export const TRIAL_BRIEF_RULE_ID = "NO_TRIAL_BRIEF_AT_DEMO_SAT";

export function resolveLinkedTrialBriefTask(
  workspaceKey: string,
  tasks: Task[],
  oppId: string,
  by?: string,
): { tasks: Task[]; resolved: Task | null } {
  const target = tasks.find(
    (t) =>
      t.signalRuleId === TRIAL_BRIEF_RULE_ID &&
      t.oppId === oppId &&
      (t.status === "open" || t.status === "snoozed"),
  );
  if (!target) return { tasks, resolved: null };
  const nextTasks = markDone(workspaceKey, tasks, target.id, by ?? "system");
  const resolved = nextTasks.find((t) => t.id === target.id) ?? null;
  return { tasks: nextTasks, resolved };
}
