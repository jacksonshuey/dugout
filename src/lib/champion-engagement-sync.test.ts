// Cross-run hysteresis tests for the engagement sync orchestrator. The point
// of persistence is that the enrollment decision depends on the PRIOR run's
// state — these tests simulate consecutive runs by threading the prior-state
// map forward, the same way the cron does via getEnrollmentStates().

import { describe, expect, test } from "vitest";
import { evaluateEngagementForPipeline } from "./champion-engagement-sync";
import type { PriorEnrollmentState } from "./champion-engagement-store";
import { TODAY } from "./utils";
import type { Activity, CallTranscript, Contact, Opportunity } from "./types";

const ago = (n: number) => new Date(TODAY.getTime() - n * 864e5).toISOString();

const champion: Contact = {
  id: "c1",
  accountId: "a1",
  name: "Casey",
  title: "VP",
  role: "Champion",
};

function opp(): Opportunity {
  return {
    id: "o1",
    accountId: "a1",
    name: "Deal",
    ownerId: "r1",
    stage: "Evaluating",
    amount: 1e5,
    enteredStageAt: ago(10),
    createdAt: ago(60),
    closeDate: ago(-30),
    contactRoleIds: ["c1"],
  };
}

// A champion failing on every dimension → score below 0.3.
const deadChampionActivities: Activity[] = [
  { id: "1", oppId: "o1", type: "email_sent", occurredAt: ago(20), summary: "" },
  { id: "2", oppId: "o1", type: "email_sent", occurredAt: ago(16), summary: "" },
  { id: "3", oppId: "o1", type: "email_sent", occurredAt: ago(13), summary: "" },
  { id: "4", oppId: "o1", type: "email_sent", occurredAt: ago(8), summary: "" },
  { id: "5", oppId: "o1", type: "email_sent", occurredAt: ago(4), summary: "" },
  { id: "6", oppId: "o1", contactId: "c1", type: "email_received", occurredAt: ago(11), summary: "" },
  { id: "7", oppId: "o1", contactId: "c1", type: "meeting", occurredAt: ago(9), summary: "Champion cancelled" },
  { id: "8", oppId: "o1", contactId: "c1", type: "meeting", occurredAt: ago(5), summary: "No-show" },
];
const negativeCall: CallTranscript[] = [
  {
    id: "call1",
    oppId: "o1",
    callDate: ago(7),
    durationMin: 30,
    attendees: ["c1"],
    summary: "x",
    riskFlags: ["budget pushback", "competitor mentioned", "no firm next step"],
    excerpts: [],
  },
];

// A healthy champion → score well above the exit threshold.
const healthyActivities: Activity[] = [
  { id: "1", oppId: "o1", type: "email_sent", occurredAt: ago(5), summary: "" },
  { id: "2", oppId: "o1", contactId: "c1", type: "email_received", occurredAt: ago(4), summary: "" },
  { id: "3", oppId: "o1", type: "email_sent", occurredAt: ago(3), summary: "" },
  { id: "4", oppId: "o1", contactId: "c1", type: "email_received", occurredAt: ago(2), summary: "" },
  { id: "5", oppId: "o1", contactId: "c1", type: "meeting", occurredAt: ago(2), summary: "Demo went well" },
];

function run(
  activities: Activity[],
  calls: CallTranscript[],
  priorStates: Map<string, PriorEnrollmentState>,
) {
  return evaluateEngagementForPipeline({
    workspaceKey: "ws",
    opportunities: [opp()],
    contacts: [champion],
    activities,
    calls,
    priorStates,
  });
}

describe("evaluateEngagementForPipeline hysteresis across runs", () => {
  test("first run below threshold enrolls and fires exactly one intent", () => {
    const result = run(deadChampionActivities, negativeCall, new Map());
    expect(result.rows[0].below_threshold).toBe(true);
    expect(result.rows[0].enrolled).toBe(true);
    expect(result.rows[0].enrolled_at).not.toBeNull();
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].oppId).toBe("o1");
    expect(result.history).toHaveLength(1);
  });

  test("second run still-low does NOT re-fire the intent but stays enrolled", () => {
    // Thread the prior state forward as if a previous run had enrolled them.
    const prior = new Map<string, PriorEnrollmentState>([
      ["o1", { enrolled: true, enrolledAt: ago(1) }],
    ]);
    const result = run(deadChampionActivities, negativeCall, prior);
    expect(result.rows[0].enrolled).toBe(true);
    // enrolled_at carried forward from the prior run, not re-stamped.
    expect(result.rows[0].enrolled_at).toBe(ago(1));
    expect(result.intents).toHaveLength(0);
  });

  test("recovery above the exit threshold un-enrolls and clears enrolled_at", () => {
    const prior = new Map<string, PriorEnrollmentState>([
      ["o1", { enrolled: true, enrolledAt: ago(5) }],
    ]);
    const result = run(healthyActivities, [], prior);
    expect(result.rows[0].score).toBeGreaterThanOrEqual(0.4);
    expect(result.rows[0].enrolled).toBe(false);
    expect(result.rows[0].enrolled_at).toBeNull();
    expect(result.intents).toHaveLength(0);
  });
});
