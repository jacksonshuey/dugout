// Champion Engagement Score tests. TODAY is pinned at 2026-05-21 in
// lib/utils.ts; all ISO dates here are anchored to that so the math is
// deterministic. Dates are written as "N days before TODAY" via daysAgo().

import { describe, expect, test } from "vitest";
import {
  computeChampionEngagement,
  reEngagementDecision,
  RE_ENGAGEMENT_ENTER_THRESHOLD,
  RE_ENGAGEMENT_EXIT_THRESHOLD,
  ENGAGEMENT_SILENCE_FLOOR_DAYS,
} from "./champion-engagement";
import { TODAY } from "./utils";
import type { Activity, CallTranscript, Contact, Opportunity } from "./types";

// ─── Fixtures ───────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_1",
    accountId: "acc_1",
    name: "Test Deal",
    ownerId: "rep_1",
    stage: "Evaluating",
    amount: 100_000,
    enteredStageAt: daysAgo(10),
    createdAt: daysAgo(60),
    closeDate: daysAgo(-30),
    contactRoleIds: ["c_champ"],
    ...overrides,
  };
}

function champion(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c_champ",
    accountId: "acc_1",
    name: "Casey Champion",
    title: "VP Eng",
    role: "Champion",
    ...overrides,
  };
}

function act(overrides: Partial<Activity> & Pick<Activity, "type">): Activity {
  return {
    id: Math.random().toString(36).slice(2),
    oppId: "opp_1",
    occurredAt: daysAgo(1),
    summary: "",
    ...overrides,
  };
}

function call(overrides: Partial<CallTranscript> = {}): CallTranscript {
  return {
    id: "call_1",
    oppId: "opp_1",
    callDate: daysAgo(3),
    durationMin: 30,
    attendees: ["c_champ", "rep_1"],
    summary: "Discovery call",
    riskFlags: [],
    excerpts: [],
    ...overrides,
  };
}

// ─── Healthy champion ───────────────────────────────────────────────────

test("engaged champion scores high and is not flagged for re-engagement", () => {
  const contacts = [champion(), { ...champion(), id: "c_legal", role: "Legal Ops" as const }];
  const activities = [
    act({ type: "email_sent", occurredAt: daysAgo(5) }),
    act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(4) }),
    act({ type: "email_sent", occurredAt: daysAgo(3) }),
    act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(2) }),
    act({ type: "meeting", contactId: "c_champ", occurredAt: daysAgo(2), summary: "Demo, went well" }),
  ];
  const result = computeChampionEngagement({
    opportunity: makeOpp({ contactRoleIds: ["c_champ", "c_legal"] }),
    contacts,
    activities,
    calls: [call()],
  });
  expect(result.score).toBeGreaterThanOrEqual(0.8);
  expect(result.belowReEngagementThreshold).toBe(false);
});

// ─── Clearly disengaged champion ──────────────────────────────────────────

test("champion failing across responsiveness, recency, meetings, and sentiment scores below threshold", () => {
  // Replied once to five touches, last reply 11 days ago, both meetings
  // cancelled, three risk flags, single-threaded. Every dimension is failing —
  // this is the near-dead champion the 0.3 floor is meant to catch.
  const activities = [
    act({ type: "email_sent", occurredAt: daysAgo(20) }),
    act({ type: "email_sent", occurredAt: daysAgo(16) }),
    act({ type: "email_sent", occurredAt: daysAgo(13) }),
    act({ type: "email_sent", occurredAt: daysAgo(8) }),
    act({ type: "email_sent", occurredAt: daysAgo(4) }),
    act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(11) }),
    act({ type: "meeting", contactId: "c_champ", occurredAt: daysAgo(9), summary: "Champion cancelled" }),
    act({ type: "meeting", contactId: "c_champ", occurredAt: daysAgo(5), summary: "No-show" }),
  ];
  const result = computeChampionEngagement({
    opportunity: makeOpp(),
    contacts: [champion()],
    activities,
    calls: [call({ riskFlags: ["budget pushback", "competitor mentioned", "no firm next step"] })],
  });
  expect(result.score).toBeLessThan(RE_ENGAGEMENT_ENTER_THRESHOLD);
  expect(result.belowReEngagementThreshold).toBe(true);
  expect(result.drivers.length).toBeGreaterThan(0);
});

// ─── Fading champion CHAMPION_GHOST would miss ────────────────────────────

test("multi-dimensional fade lands in the watch band even when last touch is under 7 days", () => {
  // Last reply 6 days ago — under CHAMPION_GHOST's 7-day trigger, so recency
  // alone says "fine." But 1/5 reply ratio, a cancelled meeting, and two risk
  // flags pull the converged score into the 0.3-0.4 watch band. This is the
  // case the recency-only rule misses.
  const activities = [
    act({ type: "email_sent", occurredAt: daysAgo(18) }),
    act({ type: "email_sent", occurredAt: daysAgo(14) }),
    act({ type: "email_sent", occurredAt: daysAgo(10) }),
    act({ type: "email_sent", occurredAt: daysAgo(8) }),
    act({ type: "email_sent", occurredAt: daysAgo(7) }),
    act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(6) }),
    act({ type: "meeting", contactId: "c_champ", occurredAt: daysAgo(6), summary: "Rescheduled by champion" }),
  ];
  const result = computeChampionEngagement({
    opportunity: makeOpp(),
    contacts: [champion()],
    activities,
    calls: [call({ riskFlags: ["budget pushback", "competitor mentioned"] })],
  });
  expect(result.score).toBeGreaterThanOrEqual(RE_ENGAGEMENT_ENTER_THRESHOLD);
  expect(result.score).toBeLessThan(RE_ENGAGEMENT_EXIT_THRESHOLD);
  // In the watch band, hysteresis holds an un-enrolled champion out of the
  // sequence rather than flapping them in.
  expect(reEngagementDecision(result.score, false).shouldEnroll).toBe(false);
});

// ─── Component edge cases ─────────────────────────────────────────────────

test("no champion on the deal scores 0 and is below threshold", () => {
  const result = computeChampionEngagement({
    opportunity: makeOpp({ contactRoleIds: ["c_legal"] }),
    contacts: [{ ...champion(), id: "c_legal", role: "Legal Ops" }],
    activities: [],
    calls: [],
  });
  expect(result.score).toBe(0);
  expect(result.championId).toBeNull();
  expect(result.belowReEngagementThreshold).toBe(true);
});

test("departed champion scores 0 with a departure driver", () => {
  const result = computeChampionEngagement({
    opportunity: makeOpp(),
    contacts: [champion({ status: "departed" })],
    activities: [act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(1) })],
    calls: [],
  });
  expect(result.components.recency).toBe(0);
  expect(result.drivers).toContain("Champion has left the company");
});

test("recency hits 0 at the silence floor", () => {
  const result = computeChampionEngagement({
    opportunity: makeOpp(),
    contacts: [champion()],
    activities: [
      act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(ENGAGEMENT_SILENCE_FLOOR_DAYS) }),
    ],
    calls: [],
  });
  expect(result.components.recency).toBe(0);
});

test("activity outside the 30-day window does not count toward responsiveness", () => {
  // One outbound inside the window, the matching reply is 40 days old → the
  // reply is ignored, so responsiveness is 0 (replied to none of recent touches).
  const result = computeChampionEngagement({
    opportunity: makeOpp(),
    contacts: [champion()],
    activities: [
      act({ type: "email_sent", occurredAt: daysAgo(5) }),
      act({ type: "email_received", contactId: "c_champ", occurredAt: daysAgo(40) }),
    ],
    calls: [],
  });
  expect(result.components.responsiveness).toBe(0);
});

// ─── Re-engagement hysteresis ─────────────────────────────────────────────

describe("reEngagementDecision hysteresis", () => {
  test("enrolls when below the enter threshold", () => {
    const d = reEngagementDecision(0.2, false);
    expect(d.shouldEnroll).toBe(true);
    expect(d.justCrossed).toBe(true);
  });

  test("does not re-fire when already enrolled and still low", () => {
    const d = reEngagementDecision(0.2, true);
    expect(d.shouldEnroll).toBe(true);
    expect(d.justCrossed).toBe(false);
  });

  test("dead-band holds the current state to prevent flapping", () => {
    const mid = (RE_ENGAGEMENT_ENTER_THRESHOLD + RE_ENGAGEMENT_EXIT_THRESHOLD) / 2;
    expect(reEngagementDecision(mid, true).shouldEnroll).toBe(true);
    expect(reEngagementDecision(mid, false).shouldEnroll).toBe(false);
  });

  test("un-enrolls only once recovered above the exit threshold", () => {
    const d = reEngagementDecision(RE_ENGAGEMENT_EXIT_THRESHOLD, true);
    expect(d.shouldEnroll).toBe(false);
  });
});
