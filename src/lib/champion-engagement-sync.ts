// Champion engagement sync — the orchestration layer between the pure scoring
// module (champion-engagement.ts), the store (champion-engagement-store.ts),
// and the re-engagement executor.
//
// `evaluateEngagementForPipeline` is itself pure: given the pipeline objects
// and the prior enrollment state, it returns the rows to persist, the history
// to append, and the enrollment intents to execute. The cron route does the
// I/O (load prior state → call this → persist → run intents). Keeping the
// decision logic pure is what makes the cross-run hysteresis testable without
// a database.

import {
  computeChampionEngagement,
  reEngagementDecision,
} from "./champion-engagement";
import type {
  EngagementRow,
  HistoryRow,
  PriorEnrollmentState,
} from "./champion-engagement-store";
import type { Activity, CallTranscript, Contact, Opportunity } from "./types";
import { TODAY } from "./utils";

// The Outreach sequence template the enrollment action targets. Matches the
// existing ACTION_TEMPLATES entry in rule-model.ts so the score-driven path and
// the rule-builder path enroll into the same sequence.
export const RE_ENGAGEMENT_SEQUENCE = "Champion re-engagement";

// An intent to enroll a champion in the re-engagement sequence. Produced only
// on the transition into enrollment (hysteresis `justCrossed`), so re-running
// the sync daily on a still-low champion does not re-enroll them every day.
export interface EnrollmentIntent {
  workspaceKey: string;
  oppId: string;
  accountId: string;
  championContactId: string;
  score: number;
  sequence: string;
  reason: string;
}

export interface PipelineEvaluation {
  rows: EngagementRow[];
  history: HistoryRow[];
  intents: EnrollmentIntent[];
}

function contactsOnOpp(opp: Opportunity, allContacts: Contact[]): Contact[] {
  const ids = new Set(opp.contactRoleIds);
  return allContacts.filter((c) => ids.has(c.id));
}

export function evaluateEngagementForPipeline(args: {
  workspaceKey: string;
  opportunities: Opportunity[];
  contacts: Contact[];
  activities: Activity[];
  calls: CallTranscript[];
  priorStates: Map<string, PriorEnrollmentState>;
  now?: Date;
}): PipelineEvaluation {
  const { workspaceKey, opportunities, contacts, activities, calls, priorStates } = args;
  const nowIso = (args.now ?? TODAY).toISOString();

  const rows: EngagementRow[] = [];
  const history: HistoryRow[] = [];
  const intents: EnrollmentIntent[] = [];

  for (const opp of opportunities) {
    const oppContacts = contactsOnOpp(opp, contacts);
    const engagement = computeChampionEngagement({
      opportunity: opp,
      contacts: oppContacts,
      activities,
      calls,
    });

    const prior = priorStates.get(opp.id) ?? { enrolled: false, enrolledAt: null };
    const decision = reEngagementDecision(engagement.score, prior.enrolled);

    // Resolve the persisted enrolled_at:
    //   - entering enrollment now (justCrossed) → stamp now
    //   - still enrolled from a prior run → keep the original timestamp
    //   - not enrolled → null
    let enrolledAt: string | null;
    if (decision.shouldEnroll && decision.justCrossed) {
      enrolledAt = nowIso;
    } else if (decision.shouldEnroll) {
      enrolledAt = prior.enrolledAt ?? nowIso;
    } else {
      enrolledAt = null;
    }

    rows.push({
      workspace_key: workspaceKey,
      opp_id: opp.id,
      account_id: opp.accountId,
      champion_contact_id: engagement.championId,
      score: engagement.score,
      components: engagement.components,
      drivers: engagement.drivers,
      below_threshold: engagement.belowReEngagementThreshold,
      enrolled: decision.shouldEnroll,
      enrolled_at: enrolledAt,
      last_evaluated_at: nowIso,
    });

    history.push({
      workspace_key: workspaceKey,
      opp_id: opp.id,
      score: engagement.score,
      evaluated_at: nowIso,
    });

    // Only fire an enrollment intent on the transition into enrollment, and
    // only when there is an actual champion to enroll (a departed/absent
    // champion scores low but has no one to put in an email sequence —
    // CHAMPION_DEPARTED owns that case with a different playbook).
    if (decision.justCrossed && engagement.championId) {
      intents.push({
        workspaceKey,
        oppId: opp.id,
        accountId: opp.accountId,
        championContactId: engagement.championId,
        score: engagement.score,
        sequence: RE_ENGAGEMENT_SEQUENCE,
        reason: decision.reason,
      });
    }
  }

  return { rows, history, intents };
}

// ---------------------------------------------------------------------------
// Enrollment executor — SEAM, not a live integration.
//
// This is deliberately a stub. Enrolling a champion in an Outreach sequence is
// an external, buyer-visible side effect (it sends real email) — exactly the
// kind of action that should not be wired to fire automatically from a cron
// without an explicit decision to do so. Today this records the intent and
// returns a result; the real Outreach API call goes where the TODO marks.
//
// When wiring the real call: read the workspace's Outreach key the same way
// the granola cron reads its key (getIntegrationKey(workspaceKey, "outreach")),
// resolve the champion's Outreach prospect id, and POST the sequence-state.
// Keep this function the single call site so the cron stays unaware of Outreach
// specifics.
export interface EnrollmentResult {
  intent: EnrollmentIntent;
  status: "recorded" | "enrolled" | "skipped" | "error";
  detail: string;
}

export async function enrollInReEngagement(
  intent: EnrollmentIntent,
): Promise<EnrollmentResult> {
  // TODO(outreach): replace this block with the real Outreach sequence-state
  // POST. Until then we record the intent so the run is observable and the
  // persisted `enrolled` flag reflects that we *intended* to enroll.
  return {
    intent,
    status: "recorded",
    detail: `Recorded intent to enroll champion ${intent.championContactId} on opp ${intent.oppId} into "${intent.sequence}" (score ${intent.score.toFixed(2)}). Live Outreach enrollment not yet wired.`,
  };
}
