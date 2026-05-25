// Trial Orchestrator — SLA math, status transitions, signal linkage.
// Pure-function tests; no localStorage, no window. The mutators are exercised
// only through the in-memory return path (saveIntakes is a no-op server-side).

import { describe, expect, test } from "vitest";
import {
  assignSe,
  computeSla,
  createIntake,
  deriveStatus,
  markDemoSeeded,
  markKpiDelivered,
  resolveLinkedTrialBriefTask,
  TRIAL_BRIEF_RULE_ID,
} from "./trial-intake";
import type { Task } from "./tasks";
import { TRIAL_INTAKE_SLA_MS } from "./types";

const WORKSPACE = "test-ws";

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `${TRIAL_BRIEF_RULE_ID}:opp_x`,
    signalRuleId: TRIAL_BRIEF_RULE_ID,
    oppId: "opp_x",
    ownerId: "rep_sc",
    severity: "action",
    title: "No outcome-first trial brief delivered",
    body: "",
    suggestedAction: "",
    createdAt: "2026-05-21T09:00:00Z",
    status: "open",
    notes: [],
    history: [],
    ...overrides,
  };
}

describe("createIntake", () => {
  test("sets slaDeadline to submittedAt + 48h", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_meridian",
      accountId: "acc_meridian",
      submittedBy: "rep_sc",
      kpiHypotheses: ["matter throughput", "review SLA", ""],
      buyerSuccessCriteria: "30% reduction in review time",
      datasetRequirements: "Last 90 days of NDA matters",
      seNotes: "",
      now,
    });
    expect(intake.submittedAt).toBe("2026-05-20T10:00:00.000Z");
    expect(new Date(intake.slaDeadline).getTime()).toBe(
      now.getTime() + TRIAL_INTAKE_SLA_MS,
    );
    expect(intake.status).toBe("pending_se_assignment");
    // Empty hypothesis lines dropped.
    expect(intake.kpiHypotheses).toEqual(["matter throughput", "review SLA"]);
  });
});

describe("computeSla", () => {
  test("healthy bucket when > 24h remaining", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    const sla = computeSla(intake, new Date("2026-05-20T11:00:00Z"));
    expect(sla.bucket).toBe("healthy");
    expect(sla.overdue).toBe(false);
  });

  test("warning bucket between 24h and 4h remaining", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    // 30h after submission → 18h remaining → warning.
    const sla = computeSla(intake, new Date("2026-05-21T16:00:00Z"));
    expect(sla.bucket).toBe("warning");
  });

  test("urgent bucket under 4h remaining", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    // 46h after submission → 2h remaining → urgent.
    const sla = computeSla(intake, new Date("2026-05-22T08:00:00Z"));
    expect(sla.bucket).toBe("urgent");
    expect(sla.overdue).toBe(false);
  });

  test("overdue bucket past the deadline", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    const sla = computeSla(intake, new Date("2026-05-23T10:00:01Z"));
    expect(sla.bucket).toBe("overdue");
    expect(sla.overdue).toBe(true);
    expect(sla.remainingMs).toBeLessThan(0);
  });
});

describe("deriveStatus", () => {
  test("delivered status persists even past the deadline", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    const delivered = markKpiDelivered(WORKSPACE, [intake], intake.id)[0];
    // Way past the 48h window — still reads as delivered.
    expect(deriveStatus(delivered, new Date("2026-06-01T00:00:00Z"))).toBe(
      "delivered",
    );
  });

  test("pending intake reads as overdue once past the deadline", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    expect(deriveStatus(intake, new Date("2026-05-23T00:00:00Z"))).toBe(
      "overdue",
    );
  });
});

describe("status transitions", () => {
  test("assignSe moves pending → in_progress and records history", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    const next = assignSe(WORKSPACE, [intake], intake.id, "rep_se1", "rep_dr");
    expect(next[0].status).toBe("in_progress");
    expect(next[0].assignedSeId).toBe("rep_se1");
    expect(next[0].history.at(-1)?.action).toBe("assigned SE");
  });

  test("markDemoSeeded records the timestamp without changing status", () => {
    const now = new Date("2026-05-20T10:00:00Z");
    const intake = createIntake({
      oppId: "opp_x",
      accountId: "acc_x",
      submittedBy: "rep_sc",
      kpiHypotheses: ["k"],
      buyerSuccessCriteria: "",
      datasetRequirements: "",
      seNotes: "",
      now,
    });
    const assigned = assignSe(WORKSPACE, [intake], intake.id, "rep_se1")[0];
    const seeded = markDemoSeeded(WORKSPACE, [assigned], intake.id)[0];
    expect(seeded.status).toBe("in_progress");
    expect(seeded.demoSeededAt).toBeTruthy();
  });
});

describe("resolveLinkedTrialBriefTask", () => {
  test("auto-resolves the open trial-brief task for the same opp", () => {
    const tasks: Task[] = [
      baseTask({ id: `${TRIAL_BRIEF_RULE_ID}:opp_x`, oppId: "opp_x" }),
      baseTask({
        id: "SINGLE_THREAD_RISK:opp_x",
        signalRuleId: "SINGLE_THREAD_RISK",
        oppId: "opp_x",
      }),
    ];
    const { tasks: next, resolved } = resolveLinkedTrialBriefTask(
      WORKSPACE,
      tasks,
      "opp_x",
    );
    expect(resolved?.status).toBe("done");
    expect(resolved?.resolutionReason).toBe("manual_done");
    // Unrelated task untouched.
    expect(
      next.find((t) => t.signalRuleId === "SINGLE_THREAD_RISK")?.status,
    ).toBe("open");
  });

  test("no-op when no matching task exists", () => {
    const tasks: Task[] = [
      baseTask({
        id: "SINGLE_THREAD_RISK:opp_z",
        signalRuleId: "SINGLE_THREAD_RISK",
        oppId: "opp_z",
      }),
    ];
    const result = resolveLinkedTrialBriefTask(WORKSPACE, tasks, "opp_z");
    expect(result.resolved).toBeNull();
    expect(result.tasks).toEqual(tasks);
  });
});
