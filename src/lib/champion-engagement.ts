// Champion Engagement Score — a continuous 0-1 read on how engaged a deal's
// champion is, converged from multiple weak signals so no single source can
// flip the verdict. When the score drops below the re-engagement threshold the
// champion is enrolled in the "Champion re-engagement" sequence.
//
// This is the multi-signal sibling of the CHAMPION_GHOST rule (which is pure
// recency) and the championEngagement component inside sv-health.ts (a thin
// "days since last touch" proxy). The product belief — same one BUDGET_APPROVAL
// _RISK encodes — is that A alone is weak, B alone is weak, A+B+C+D is decision
// grade. A champion who still replies but cancels meetings, goes terse, and
// stops pulling in stakeholders is disengaging even though recency looks fine.
//
// Design rules (orgs/_default/BUILD_ALIGNMENT.md, mirrored from sv-health.ts):
//   1. Pure function. No I/O, no Supabase, no fetch — testable closed-form.
//   2. Reads only canonical ontology already on EvaluationContext.
//   3. Driver strings are plain language: no exclamations, no emojis.
//   4. Every component that moved the score is explained in a driver.
//
// Scored on 0-1 (not 0-100 like SV Health) because the re-engagement threshold
// the product team specified is expressed as 0.3.

import type {
  Activity,
  CallTranscript,
  Contact,
  Opportunity,
} from "@/lib/types";
import { daysBetween } from "@/lib/utils";

// ─── Tunable constants ────────────────────────────────────────────────────

// Trailing window (days) for ratio metrics — responsiveness, initiative,
// meeting reliability all look back this far so a great relationship six weeks
// ago doesn't mask three dead weeks. Aligns with the 30d SV stage-age p75 used
// in sv-health.ts.
export const ENGAGEMENT_WINDOW_DAYS = 30;

// Recency decay floor. 0 days silent = 1.0, ENGAGEMENT_SILENCE_FLOOR_DAYS+ = 0.
// 14d matches sv-health's CHAMPION_SILENCE_FLOOR_DAYS ("14d is dead" per the
// persona research) so the two modules tell the same recency story.
export const ENGAGEMENT_SILENCE_FLOOR_DAYS = 14;

// Re-engagement enrollment uses hysteresis to stop a noisy score from flapping
// champions in and out of the sequence. Enroll when the score drops BELOW
// ENTER; only un-enroll once it climbs back ABOVE the higher EXIT band. A score
// in the [ENTER, EXIT] dead-band leaves the current enrollment state unchanged.
export const RE_ENGAGEMENT_ENTER_THRESHOLD = 0.3;
export const RE_ENGAGEMENT_EXIT_THRESHOLD = 0.4;

// Component weights — must sum to 1.0. Responsiveness and recency carry the
// most weight because a champion who stops replying or goes dark is the
// strongest disengagement tell; sentiment and initiative are corroborating.
const WEIGHTS = {
  responsiveness: 0.25,
  recency: 0.25,
  meetingReliability: 0.2,
  sentiment: 0.15,
  initiative: 0.15,
} as const;

// Neutral score used when a component has no data to judge (e.g. no emails sent
// yet). 0.5 keeps "no evidence" from reading as either healthy or alarming.
const NEUTRAL = 0.5;

// ─── Risk-flag matching for the sentiment component ─────────────────────────
//
// CallTranscript.riskFlags are short free-text markers an LLM populates from
// the Gong/Granola transcript (e.g. "budget pushback", "competitor mentioned",
// "no firm next step"). We don't enumerate them — any flag on a recent call is
// negative sentiment. The constant below is the per-flag penalty.
const SENTIMENT_PENALTY_PER_FLAG = 0.25;

// Cancelled / no-show / reschedule detection. The in-memory demo Activity model
// only carries `type: "meeting"` and a free-text `summary` — it has no
// status enum. We detect the negative cases by summary regex as a v1 proxy,
// the same pattern ASSET_GAP_IT uses for IT mentions. In production this reads
// the canonical `meetings.status` field (spec §4.5: scheduled | completed |
// canceled | no_show), at which point this regex is replaced by a status check.
export const MEETING_MISS_RE = /cancel|no[ -]?show|reschedul|bailed|skipped/i;

// ─── Types ──────────────────────────────────────────────────────────────────

export type EngagementComponents = {
  responsiveness: number; // 0-1: champion reply ratio vs our outreach
  recency: number; // 0-1: decayed days since last champion touch
  meetingReliability: number; // 0-1: kept meetings vs cancelled/no-show
  sentiment: number; // 0-1: inverse of risk flags on recent calls
  initiative: number; // 0-1: champion-initiated contact + multithreading
};

export type ReEngagementDecision = {
  // Whether the champion SHOULD be enrolled now, given the score, the
  // hysteresis band, and their current enrollment state.
  shouldEnroll: boolean;
  // True only on the transition into enrollment — the moment a signal/sequence
  // action should actually fire. Lets callers avoid re-enrolling every tick.
  justCrossed: boolean;
  reason: string;
};

export type ChampionEngagementScore = {
  score: number; // 0-1, rounded to 2dp
  championId: string | null;
  components: EngagementComponents;
  drivers: string[]; // 1-3 plain-language reasons, worst component first
  evidenceActivityIds: string[]; // activity/call ids that fed any component
  belowReEngagementThreshold: boolean; // score < RE_ENGAGEMENT_ENTER_THRESHOLD
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function inWindow(iso: string, windowDays: number): boolean {
  const d = daysBetween(iso);
  return Number.isFinite(d) && d >= 0 && d <= windowDays;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function findChampion(contacts: Contact[]): Contact | null {
  return contacts.find((c) => c.role === "Champion") ?? null;
}

// ─── Component computations ─────────────────────────────────────────────────

// Responsiveness — ratio of champion inbound replies to our outbound touches
// over the window. A champion we email five times who replies once (0.2) is
// disengaging; one who replies to most touches (→1.0) is healthy. No outbound
// in the window → no basis to judge → NEUTRAL.
function computeResponsiveness(
  championId: string,
  oppId: string,
  activities: Activity[],
): { score: number; evidence: string[] } {
  const outbound = activities.filter(
    (a) =>
      a.oppId === oppId &&
      a.type === "email_sent" &&
      inWindow(a.occurredAt, ENGAGEMENT_WINDOW_DAYS),
  );
  const inbound = activities.filter(
    (a) =>
      a.oppId === oppId &&
      a.contactId === championId &&
      a.type === "email_received" &&
      inWindow(a.occurredAt, ENGAGEMENT_WINDOW_DAYS),
  );
  if (outbound.length === 0) {
    return { score: NEUTRAL, evidence: [] };
  }
  const ratio = inbound.length / outbound.length;
  return {
    score: clamp01(ratio),
    evidence: [...outbound, ...inbound].map((a) => a.id),
  };
}

// Recency — linear decay on days since the champion last did anything that
// counts as a touch (replied, joined a call/meeting, visited the deal room).
// Never touched → 0. Mirrors sv-health's champion silence curve.
function computeRecency(
  championId: string,
  oppId: string,
  activities: Activity[],
): { score: number; daysSilent: number | null; evidence: string[] } {
  const touches = activities
    .filter(
      (a) =>
        a.oppId === oppId &&
        a.contactId === championId &&
        (a.type === "email_received" ||
          a.type === "call" ||
          a.type === "meeting" ||
          a.type === "dock_visit") &&
        // A cancelled / no-show meeting is the opposite of a touch — exclude it
        // so a champion who keeps bailing doesn't read as "recently engaged."
        !(a.type === "meeting" && MEETING_MISS_RE.test(a.summary)),
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  if (touches.length === 0) {
    return { score: 0, daysSilent: null, evidence: [] };
  }
  const last = touches[0];
  const days = daysBetween(last.occurredAt);
  const safeDays = Number.isFinite(days) && days >= 0 ? days : 0;
  const score = clamp01(1 - safeDays / ENGAGEMENT_SILENCE_FLOOR_DAYS);
  return { score, daysSilent: safeDays, evidence: [last.id] };
}

// Meeting reliability — kept meetings vs cancelled/no-show/rescheduled over the
// window. A champion who cancels or no-shows is pulling away even if they still
// answer email. No meetings in the window → NEUTRAL (nothing to judge).
function computeMeetingReliability(
  championId: string,
  oppId: string,
  activities: Activity[],
): { score: number; missed: number; total: number; evidence: string[] } {
  const meetings = activities.filter(
    (a) =>
      a.oppId === oppId &&
      a.type === "meeting" &&
      // Count a meeting toward the champion when it is tied to them, or
      // untied (the demo often logs the meeting against the opp, not a
      // specific contact). Tied-to-someone-else meetings are excluded.
      (a.contactId === championId || a.contactId === undefined) &&
      inWindow(a.occurredAt, ENGAGEMENT_WINDOW_DAYS),
  );
  if (meetings.length === 0) {
    return { score: NEUTRAL, missed: 0, total: 0, evidence: [] };
  }
  const missed = meetings.filter((a) => MEETING_MISS_RE.test(a.summary));
  const score = clamp01((meetings.length - missed.length) / meetings.length);
  return {
    score,
    missed: missed.length,
    total: meetings.length,
    evidence: missed.map((a) => a.id),
  };
}

// Sentiment — inverse of the risk markers on the champion's recent calls. Each
// risk flag (budget pushback, competitor mentioned, no next step, …) on a call
// inside the window knocks the score down. No recent calls → NEUTRAL.
function computeSentiment(
  oppId: string,
  calls: CallTranscript[],
): { score: number; flagCount: number; evidence: string[] } {
  const recent = calls.filter(
    (c) => c.oppId === oppId && inWindow(c.callDate, ENGAGEMENT_WINDOW_DAYS),
  );
  if (recent.length === 0) {
    return { score: NEUTRAL, flagCount: 0, evidence: [] };
  }
  const flagCount = recent.reduce((n, c) => n + c.riskFlags.length, 0);
  const score = clamp01(1 - flagCount * SENTIMENT_PENALTY_PER_FLAG);
  const evidence = recent.filter((c) => c.riskFlags.length > 0).map((c) => c.id);
  return { score, flagCount, evidence };
}

// Initiative — two halves, each worth 0.5:
//   (a) Does the champion ever reach out unprompted? Proxy: any inbound from
//       the champion in the window.
//   (b) Is the deal multi-threaded? Proxy: at least one buyer-side contact
//       beyond the champion on the opp. A solo champion is a single point of
//       failure — losing them loses the deal.
function computeInitiative(
  championId: string,
  oppId: string,
  activities: Activity[],
  contacts: Contact[],
): { score: number; evidence: string[] } {
  const championInbound = activities.filter(
    (a) =>
      a.oppId === oppId &&
      a.contactId === championId &&
      (a.type === "email_received" || a.type === "call") &&
      inWindow(a.occurredAt, ENGAGEMENT_WINDOW_DAYS),
  );
  const reachesOut = championInbound.length > 0 ? 0.5 : 0;
  const otherStakeholders = contacts.some((c) => c.id !== championId);
  const multithreaded = otherStakeholders ? 0.5 : 0;
  return {
    score: clamp01(reachesOut + multithreaded),
    evidence: championInbound.map((a) => a.id),
  };
}

// ─── Driver strings (plain language, worst component first) ─────────────────

function pickDrivers(args: {
  components: EngagementComponents;
  daysSilent: number | null;
  missedMeetings: number;
  totalMeetings: number;
  flagCount: number;
  multithreaded: boolean;
  hasOutbound: boolean;
}): string[] {
  const { components: c } = args;
  const candidates: { weight: number; text: string }[] = [];

  if (args.hasOutbound && c.responsiveness < 0.5) {
    candidates.push({
      weight: c.responsiveness,
      text: "Champion is replying to a minority of our outreach",
    });
  }
  if (args.daysSilent === null) {
    candidates.push({ weight: 0, text: "No champion activity on record" });
  } else if (args.daysSilent >= 7) {
    candidates.push({
      weight: c.recency,
      text: `Champion last engaged ${args.daysSilent} days ago`,
    });
  }
  if (args.missedMeetings > 0) {
    candidates.push({
      weight: c.meetingReliability,
      text: `${args.missedMeetings} of ${args.totalMeetings} recent meetings cancelled or missed`,
    });
  }
  if (args.flagCount > 0) {
    candidates.push({
      weight: c.sentiment,
      text: `${args.flagCount} risk marker${args.flagCount > 1 ? "s" : ""} on recent calls`,
    });
  }
  if (!args.multithreaded) {
    candidates.push({
      weight: c.initiative,
      text: "Deal is single-threaded on the champion",
    });
  }

  if (candidates.length === 0) return ["Champion engagement looks healthy"];
  return candidates
    .sort((a, b) => a.weight - b.weight)
    .slice(0, 3)
    .map((x) => x.text);
}

// ─── Public entry point ─────────────────────────────────────────────────────

export function computeChampionEngagement(args: {
  opportunity: Opportunity;
  contacts: Contact[]; // contacts on this opportunity
  activities: Activity[];
  calls: CallTranscript[];
}): ChampionEngagementScore {
  const { opportunity, contacts, activities, calls } = args;
  const champion = findChampion(contacts);

  // No champion mapped → engagement is 0 by definition. The committee-gap rules
  // already speak to the absence; here we just report it so the re-engagement
  // gate doesn't fire on a deal that has no champion to re-engage.
  if (!champion) {
    return {
      score: 0,
      championId: null,
      components: {
        responsiveness: 0,
        recency: 0,
        meetingReliability: 0,
        sentiment: 0,
        initiative: 0,
      },
      drivers: ["No champion identified on this deal"],
      evidenceActivityIds: [],
      belowReEngagementThreshold: true,
    };
  }

  // A departed champion is a category-different problem (CHAMPION_DEPARTED owns
  // it with its own playbook). Report engagement as 0 but let the caller decide
  // routing — we don't want to enroll a person who left the company in an email
  // sequence aimed at the buying account.
  const departed = champion.status === "departed";

  const oppId = opportunity.id;
  const resp = computeResponsiveness(champion.id, oppId, activities);
  const rec = computeRecency(champion.id, oppId, activities);
  const meet = computeMeetingReliability(champion.id, oppId, activities);
  const sent = computeSentiment(oppId, calls);
  const init = computeInitiative(champion.id, oppId, activities, contacts);

  const components: EngagementComponents = {
    responsiveness: resp.score,
    recency: departed ? 0 : rec.score,
    meetingReliability: meet.score,
    sentiment: sent.score,
    initiative: init.score,
  };

  const raw =
    WEIGHTS.responsiveness * components.responsiveness +
    WEIGHTS.recency * components.recency +
    WEIGHTS.meetingReliability * components.meetingReliability +
    WEIGHTS.sentiment * components.sentiment +
    WEIGHTS.initiative * components.initiative;

  const score = Math.round(clamp01(raw) * 100) / 100;

  const evidence = new Set<string>([
    ...resp.evidence,
    ...rec.evidence,
    ...meet.evidence,
    ...sent.evidence,
    ...init.evidence,
  ]);

  const drivers = departed
    ? ["Champion has left the company"]
    : pickDrivers({
        components,
        daysSilent: rec.daysSilent,
        missedMeetings: meet.missed,
        totalMeetings: meet.total,
        flagCount: sent.flagCount,
        multithreaded: contacts.some((c) => c.id !== champion.id),
        hasOutbound: resp.score !== NEUTRAL || resp.evidence.length > 0,
      });

  return {
    score,
    championId: champion.id,
    components,
    drivers,
    evidenceActivityIds: [...evidence],
    belowReEngagementThreshold: score < RE_ENGAGEMENT_ENTER_THRESHOLD,
  };
}

// ─── Re-engagement decision (hysteresis) ────────────────────────────────────
//
// Given the current score and whether the champion is ALREADY enrolled, decide
// whether they should be enrolled now. The dead-band between ENTER (0.3) and
// EXIT (0.4) prevents a score hovering around 0.3 from flapping the champion in
// and out of the re-engagement sequence on every evaluation tick.
export function reEngagementDecision(
  score: number,
  currentlyEnrolled: boolean,
): ReEngagementDecision {
  if (score < RE_ENGAGEMENT_ENTER_THRESHOLD) {
    return {
      shouldEnroll: true,
      justCrossed: !currentlyEnrolled,
      reason: `Engagement ${score.toFixed(2)} is below the ${RE_ENGAGEMENT_ENTER_THRESHOLD} enrollment threshold`,
    };
  }
  if (score >= RE_ENGAGEMENT_EXIT_THRESHOLD) {
    return {
      shouldEnroll: false,
      justCrossed: false,
      reason: `Engagement ${score.toFixed(2)} has recovered above the ${RE_ENGAGEMENT_EXIT_THRESHOLD} exit threshold`,
    };
  }
  // Dead-band: hold whatever state we were already in.
  return {
    shouldEnroll: currentlyEnrolled,
    justCrossed: false,
    reason: `Engagement ${score.toFixed(2)} is in the ${RE_ENGAGEMENT_ENTER_THRESHOLD}-${RE_ENGAGEMENT_EXIT_THRESHOLD} watch band; holding current enrollment state`,
  };
}
