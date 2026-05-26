import type { MeetingSignalRow } from "@/lib/meeting-signals";

// Seed of Granola meeting signals for the 7 demo accounts. Used by the
// account drawer as a fallback when the live Supabase read returns nothing
// — so the demo surface always has something to show even when the
// Granola adapter hasn't been wired against a real Granola tenant.
//
// Three meetings per account, one extracted signal each, going back ~3
// weeks. Healthy accounts have recent meetings and forward-moving signals;
// CNA's meetings stop in early April because the champion departed (the
// scenario the manager dashboard pivots on).
//
// Signal types are the unions from src/lib/granola-classifier.ts. Severity
// mapping mirrors SEVERITY_FOR_TYPE in that file so the demo data lines up
// with how real classified rows would render.

const WORKSPACE_KEY = "dugout-default";

function row(
  i: number,
  account_id: string,
  meeting_title: string,
  meeting_date: string,
  signal_type: MeetingSignalRow["signal_type"],
  severity: MeetingSignalRow["severity"],
  summary: string,
  raw_excerpt: string,
): MeetingSignalRow {
  return {
    id: `seed_ms_${i}`,
    workspace_key: WORKSPACE_KEY,
    account_id,
    note_id: `seed_note_${i}`,
    meeting_title,
    meeting_date,
    granola_url: `https://app.granola.ai/notes/seed_note_${i}`,
    signal_type,
    severity,
    summary,
    raw_excerpt,
    classifier: "haiku",
    meta: {},
    created_at: meeting_date + "T00:00:00Z",
  };
}

const SEED: MeetingSignalRow[] = [
  // --- SAP (acc_sap, Contracting, healthy) ---
  row(1, "acc_sap", "Contracting kickoff · European procurement", "2026-05-22",
    "legal_review_requested", "action",
    "External counsel returning redlines Thursday",
    "Procurement wants final signoff before COB Friday."),
  row(2, "acc_sap", "CFO walkthrough", "2026-05-15",
    "timeline_signal", "awareness",
    "CFO confirmed $400K cap fits FY budget",
    "We're comfortable at that ceiling for FY26."),
  row(3, "acc_sap", "Champion sync", "2026-05-08",
    "new_stakeholder_introduced", "action",
    "Deputy GC joining next meeting",
    "I'll bring our Deputy GC to validate the SSO posture."),

  // --- Hitachi Digital (acc_hitachi, Selected Vendor, healthy) ---
  row(4, "acc_hitachi", "APAC GC briefing", "2026-05-21",
    "new_stakeholder_introduced", "action",
    "Tokyo GC joining to validate data residency",
    "Yumi will join next call to validate the Japan residency story."),
  row(5, "acc_hitachi", "Multi-region IT discovery", "2026-05-14",
    "legal_review_requested", "action",
    "Legal needs SSO + data residency scoped per region",
    "We'll need per-region legal review for the EU and JP entities."),
  row(6, "acc_hitachi", "Champion sync", "2026-05-07",
    "timeline_signal", "awareness",
    "Champion targeting EOQ for global rollout",
    "If we can sign by end of quarter, rollout starts FY27 Q1."),

  // --- Snowflake (acc_snowflake, Selected Vendor, healthy) ---
  row(7, "acc_snowflake", "CFO + IT joint review", "2026-05-22",
    "timeline_signal", "awareness",
    "CFO confirmed Thursday review; IT signed off on SSO",
    "We're aligned on Thursday for the final budget walkthrough."),
  row(8, "acc_snowflake", "Procurement intro", "2026-05-15",
    "new_stakeholder_introduced", "action",
    "Procurement lead introduced; standard vendor cycle expected",
    "I'll loop in our procurement lead next week."),
  row(9, "acc_snowflake", "Champion deep-dive", "2026-05-08",
    "competitor_mentioned", "awareness",
    "Champion evaluating us alongside Ironclad; ours preferred",
    "We're looking at you and Ironclad. You're ahead on the workflow side."),

  // --- KKR & Co. (acc_kkr, Evaluating, watch) ---
  row(10, "acc_kkr", "Champion sync", "2026-05-15",
    "finance_mentioned_not_engaged", "blocking",
    "CFO needs to weigh in but isn't yet looped in",
    "Our CFO will need to sign off, but I haven't engaged her yet."),
  row(11, "acc_kkr", "POC review", "2026-05-08",
    "timeline_signal", "awareness",
    "Champion wants 2 more weeks before Finance loop-in",
    "Give me two more weeks to mature the POC before I pull in Finance."),
  row(12, "acc_kkr", "Initial demo", "2026-04-30",
    "budget_concern", "action",
    "Champion flagged $200K cap as ceiling",
    "We probably can't get past $200K without exec approval."),

  // --- CNA Financial (acc_cna, Selected Vendor, critical) ---
  row(13, "acc_cna", "Champion check-in", "2026-04-10",
    "champion_role_change", "blocking",
    "Champion mentioned upcoming role change at CNA",
    "I'm moving to a different team in May. Will hand this off, but the timeline is unclear."),
  row(14, "acc_cna", "Routine sync", "2026-04-02",
    "timeline_signal", "awareness",
    "No urgency expressed; deal feels stalled",
    "We have no fixed timeline on our end. Let's circle back next month."),
  row(15, "acc_cna", "Contracting walkthrough", "2026-03-24",
    "legal_review_requested", "action",
    "Legal review requested; outside counsel involvement uncertain",
    "We'll want our outside counsel to look this over before we sign anything."),

  // --- Atlassian (acc_atlassian, Selected Vendor, healthy) ---
  row(16, "acc_atlassian", "CFO TCO walkthrough", "2026-05-20",
    "budget_concern", "action",
    "CFO requested SOC 2 update before TCO approval",
    "We can't approve TCO until we see the latest SOC 2 report."),
  row(17, "acc_atlassian", "POC review", "2026-05-13",
    "timeline_signal", "awareness",
    "Champion wants CFO sign-off by EOM",
    "I'm pushing for CFO sign-off by end of month if we can hit the SOC 2 bar."),
  row(18, "acc_atlassian", "Champion sync", "2026-05-06",
    "new_stakeholder_introduced", "action",
    "Champion adding IT lead to security scoping",
    "I'll bring Frank from IT into next week's call to walk through SSO."),

  // --- Stripe (acc_stripe, Qualified, neutral) ---
  row(19, "acc_stripe", "Discovery call", "2026-05-18",
    "timeline_signal", "awareness",
    "Champion exploring legal-tech consolidation as 2026 initiative",
    "We're trying to consolidate our legal tooling this year. You'd be part of that."),
  row(20, "acc_stripe", "Intro meeting", "2026-05-11",
    "new_stakeholder_introduced", "action",
    "Champion introducing compliance counsel to next call",
    "I want our compliance counsel in next time to validate the workflow story."),
  row(21, "acc_stripe", "Initial qualification", "2026-05-04",
    "competitor_mentioned", "awareness",
    "Evaluating Dugout alongside Ironclad and Spotdraft",
    "We're talking to you, Ironclad, and Spotdraft. Still mapping the landscape."),
];

const BY_ACCOUNT: Map<string, MeetingSignalRow[]> = (() => {
  const m = new Map<string, MeetingSignalRow[]>();
  for (const r of SEED) {
    if (!m.has(r.account_id)) m.set(r.account_id, []);
    m.get(r.account_id)!.push(r);
  }
  return m;
})();

export function getSeedMeetingsForAccount(
  accountId: string,
): MeetingSignalRow[] {
  return BY_ACCOUNT.get(accountId) ?? [];
}
