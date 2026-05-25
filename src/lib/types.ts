// Salesforce-aligned types. Naming mirrors SF object/field names where reasonable
// so the demo reads as "this is what would live in your CRM today."

export type Stage =
  | "Intro"
  | "Qualified"
  | "Demo Sat"
  | "Evaluating"
  | "Selected Vendor"
  | "Contracting";

export const STAGE_ORDER: Stage[] = [
  "Intro",
  "Qualified",
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
];

// Stage-age benchmarks (days). Sourced from case context conversion-rate hints
// and typical SaaS sales-cycle norms (4-month avg cycle). Used by signal engine.
export const STAGE_AGE_BENCHMARK_DAYS: Record<Stage, number> = {
  Intro: 7,
  Qualified: 14,
  "Demo Sat": 10,
  Evaluating: 21,
  "Selected Vendor": 21,
  Contracting: 14,
};

export type RepRole = "AE" | "SDR" | "SE" | "Manager" | "SVP";

export interface Rep {
  id: string;
  name: string;
  role: RepRole;
  email: string;
  managerId?: string;
}

export type AccountSegment = "Enterprise" | "Mid-Market";

export type Industry =
  | "Pharma"
  | "Financial Services"
  | "Energy"
  | "SaaS"
  | "Insurance"
  | "Aerospace"
  | "Manufacturing"
  | "Healthcare"
  | "Logistics"
  | "Retail";

export interface Account {
  id: string;
  name: string;
  industry: Industry;
  segment: AccountSegment;
  hqLocation: string;
  legalTeamSize: number; // proxy for buyer complexity
  // Whether the daily ingestion cron should run live news + EDGAR for this
  // account. Every seeded account today is a real company, so this is true
  // across the board — the flag is retained for the future case of a private
  // / pre-launch account where live sources would return nothing useful.
  trackable?: boolean;
  // LinkedIn company slug (e.g. "stripe" → linkedin.com/company/stripe/).
  // Undefined → UI falls back to a LinkedIn company search.
  linkedinSlug?: string;
  // Buyer website — fallback link target and scope for future enrichment.
  website?: string;
  // Bare apex domain (e.g. "stripe.com"). Used by the Granola adapter to
  // match meetings → accounts via attendee email domain. Distinct from
  // `website` so the matching key stays a clean apex even if `website` ever
  // becomes a full URL.
  domain?: string;
  // Stock ticker for public-co accounts. Drives SEC EDGAR adapter coverage.
  ticker?: string;
  // True when the account is a real company but the layered CRM scenario
  // (opportunity, contacts, transcripts, activity) is fictional for demo
  // purposes. The drawer surfaces a chip + tooltip so the audience sees
  // clearly which parts are real signal and which are illustrative.
  isDemoScenario?: boolean;
  // Firecrawl scrape-path override. When set, the firecrawl adapter scrapes
  // EXACTLY these paths (relative to `website`) and skips the /map sitemap
  // lookup entirely. Useful for sites whose /map output is unreliable
  // (JS-only landing pages, missing sitemap.xml) or for ops to force scope
  // on a specific account. Leave undefined → adapter uses dynamic discovery
  // (Firecrawl /map → preferred-pattern filter → fallback to ACCOUNT_PAGES).
  paths?: string[];
  // ABM research-cluster trigger snapshot — populated in demo mode from a
  // hand-curated seed value, in real mode by aggregating the external_signals
  // table (news + EDGAR + newsletter mentions) over the last 7 days. Drives
  // the ABM_SHADOW_RESEARCH rule (P6) and the Top Accounts manager card.
  // Optional so existing fixtures don't need updates.
  abmTrigger?: {
    highRelevanceSignalsLast7d: number; // 0-8
    sources: string[]; // e.g. ["news", "sec_edgar", "newsletter"]
    lastSignalAt: string; // ISO timestamp
  };
}

// Contact roles map to Salesforce OpportunityContactRole. The presence/absence
// of these roles on an opportunity is THE primary signal source — e.g., no
// "Finance/CFO" contact on an Evaluating+ deal triggers the wedge signal.
export type ContactRole =
  | "Champion"
  | "GC" // General Counsel
  | "Legal Ops"
  | "Finance/CFO"
  | "IT/Security"
  | "Procurement"
  | "Executive Sponsor"
  | "End User";

// Contact status — defaults to 'active'. 'departed' lets us model the
// LinkedIn-detected job-change case that Jackson's CS framework identified
// as a top churn/deal-loss predictor.
export type ContactStatus = "active" | "departed";

export interface Contact {
  id: string;
  accountId: string;
  name: string;
  title: string;
  role: ContactRole;
  status?: ContactStatus; // undefined = active
  departureNote?: string; // surfaced in CHAMPION_DEPARTED signal
  // Full LinkedIn profile URL. Personal slugs aren't predictable, so we store
  // the URL rather than a slug fragment. Undefined → UI falls back to a
  // LinkedIn people search scoped to "{name} {accountName}".
  linkedinUrl?: string;
}

// Per-asset deployment + view state used by the SV Health Score
// (metrics.md §"Enablement-asset deployment score"). "Shared" means the asset
// exists in the deal room; "Viewed" means a non-Checkbox email opened it at
// least once. Both flags are needed because Helios's worked example fails
// specifically on `cfoLeaveBehindViewed: false` — sent but never opened.
//
// Optional throughout so existing fixtures don't need updates. When absent the
// SV Health calculator treats every asset as unshared (worst-case), which is
// the safe default for accounts that haven't been engineered as demo scenarios.
export interface OpportunityAssetsShared {
  cfoLeaveBehind?: boolean;
  cfoLeaveBehindViewed?: boolean;
  itZeroLift?: boolean;
  itZeroLiftViewed?: boolean;
  financeBrief?: boolean;
  financeBriefViewed?: boolean;
}

export interface Opportunity {
  id: string;
  accountId: string;
  name: string;
  ownerId: string; // Rep.id
  stage: Stage;
  amount: number; // ACV USD
  enteredStageAt: string; // ISO date — drives stage-age signals
  createdAt: string;
  closeDate: string; // forecasted close
  contactRoleIds: string[]; // Contact.id list — OpportunityContactRole join
  // SV Health Score field (metrics.md §"Enablement-asset deployment score").
  // Distinct from `assetDeliveries` which is the AE-action log; this is the
  // buyer-side view-state telemetry the score actually reads. Optional so the
  // existing 11 fixtures don't need backfill — only the three labeled demo
  // scenarios in DEMO_SCENARIO_ACCOUNTS populate it today.
  assetsShared?: OpportunityAssetsShared;
}

export type ActivityType =
  | "email_sent"
  | "email_received"
  | "call"
  | "meeting"
  | "dock_visit"
  | "sequence_enrolled"
  | "external_signal"; // LinkedIn job changes, M&A news, layoff reports — see architecture for sources

export interface Activity {
  id: string;
  oppId: string;
  contactId?: string;
  type: ActivityType;
  occurredAt: string;
  summary: string;
}

// Gong-shaped call transcript. We store excerpts (not full transcripts) — the
// signal engine reasons over excerpts + summary, not the raw audio.
export interface CallTranscript {
  id: string;
  oppId: string;
  callDate: string;
  durationMin: number;
  attendees: string[]; // contact ids + rep names
  summary: string;
  riskFlags: string[]; // e.g., "competitor mentioned", "budget pushback"
  excerpts: { speaker: string; text: string; timestamp: string }[];
}

// Track which standard assets have been delivered per opportunity.
// This is how we detect "AE has the Finance brief but hasn't sent it" — the
// adoption-not-content problem called out in the case context.
export type StandardAsset =
  | "outcome_first_trial_brief"
  | "kpi_assessment"
  | "pre_seeded_demo"
  | "cfo_leave_behind"
  | "finance_meeting_brief"
  | "it_zero_lift_one_pager"
  | "dock_room";

export interface AssetDelivery {
  oppId: string;
  asset: StandardAsset;
  deliveredAt?: string; // undefined = not delivered yet
}

// A signal is an instance of a rule firing on a specific opportunity.
// Severity determines routing: blocking -> page now, action -> morning digest,
// awareness -> weekly summary. This tiering is the core "noise vs signal" answer.
export type SignalSeverity = "blocking" | "action" | "awareness";

// Canonical signal taxonomy — the 12 types every source-signal across every
// integration collapses into. Definitions live in
// `orgs/_default/synthesis.md §1`. The signal_type is the join key that makes
// cross-source correlation possible: different tools observing the same
// underlying phenomenon get the same `signalType`, even though their raw
// payloads differ.
//
// Polarity (good vs bad news) is carried on a separate `direction` column on
// the persistent `signal_instances` table — NOT on this in-memory Signal
// today. When a rule's polarity matters, document it in a comment near the
// rule rather than adding a field here.
//
// `data_hygiene_gap` is future-state — no current rule emits it. It's defined
// for when Swyft (MEDDPICC field staleness) is wired.
export type SignalType =
  | "champion_loss"
  | "champion_disengagement"
  | "committee_gap"
  | "committee_expansion"
  | "momentum_change"
  | "competitive_threat"
  | "shadow_research"
  | "account_health_decline"
  | "lifecycle_milestone"
  | "account_context"
  | "vertical_context"
  | "data_hygiene_gap";

export interface Signal {
  id: string; // unique per firing — `${ruleId}:${oppId}`
  ruleId: string;
  oppId: string;
  severity: SignalSeverity;
  // Canonical signal taxonomy — required. One of the 12 values in synthesis.md §1.
  // Source-specific subtypes (e.g., 'finance_mentioned_not_engaged') belong in
  // a `derived` JSONB column on the persistent row, not in `signalType`.
  signalType: SignalType;
  title: string; // short, scannable
  body: string; // 1-2 sentences of context
  suggestedAction: string; // imperative — what the AE should do next
  assetLink?: string; // asset name + URL (mocked) for one-click access
  detectedAt: string;
  playbookId?: string; // when set, the UI shows a "View playbook" expander
  // Evidence-chain fields (BUILD_ALIGNMENT principle #6). The deterministic
  // rule engine emits signals from in-process state and leaves these blank;
  // the demo-scenario signals in seed.ts populate them with realistic-looking
  // tool/event IDs so the citation UI has something to drill into.
  //
  // BUILD_ALIGNMENT.md principle #6 (evidence chain mandatory) requires these
  // to be present on every signal that reaches the unified payload. The route
  // layer satisfies this by stamping `sourceTool: "signal_engine"` and
  // `sourceEventId: <ruleId>` on engine-emitted signals during unification.
  //
  // TODO: make these required on the Signal type itself once F1 rules cite
  // real source events (e.g. a SFDC stage-rank rule citing
  // `sfdc:OpportunityHistory:<id>`). Until then, optional + unify-time
  // backfill is the principled compromise.
  sourceTool?: string; // e.g. "gong", "dock", "outreach", "salesforce"
  sourceEventId?: string; // idempotency key from the source system
}

// Deal Health — compound state derived from all signals on a deal, weighted
// by close-date proximity. The single-glance answer to "how is this deal."
// Per the design philosophy: no single signal determines this; the read comes
// from the compound pattern.
export type DealHealth = "Healthy" | "Monitor" | "At Risk" | "Critical";

export interface SignalRule {
  id: string;
  name: string;
  description: string;
  severity: SignalSeverity;
  // Workspace strategic priority ID (e.g. "P1", "P4"). Looked up against the
  // current workspace config for display.
  strategicPriority: string;
  evaluate: (ctx: EvaluationContext) => Signal[];
}

// ---------------------------------------------------------------------------
// Trial Orchestrator (companion system, see /spec#companion).
//
// The signal engine emits NO_TRIAL_BRIEF_AT_DEMO_SAT when a Demo Sat+ opp
// is missing an outcome-first trial brief. The orchestrator is the workflow
// that takes that signal from "we should run a trial" to "the brief is in
// flight" — captured as a TrialIntake submitted by the AE and worked by an SE
// against a 48-hour SLA.
//
// Persistence is localStorage, mirroring the task layer in tasks.ts. The
// honest production seam: this would be a Postgres table with one row per
// intake and a real SLA-overdue cron. The state machine on this type is the
// part that survives that migration unchanged.
// ---------------------------------------------------------------------------

// 48 hours, expressed in ms. The single SLA window for every intake — kept
// generic on purpose so the test suite + the timer component read the same
// number and can't drift.
export const TRIAL_INTAKE_SLA_MS = 48 * 60 * 60 * 1000;

export type TrialIntakeStatus =
  | "pending_se_assignment" // AE submitted; round-robin hasn't picked an SE yet
  | "in_progress" // SE assigned; KPI assessment in flight
  | "delivered" // KPI assessment + pre-seeded demo dropped in the deal room
  | "overdue"; // derived, not stored — surfaced when now > slaDeadline and !delivered

export interface TrialIntakeEvent {
  at: string; // ISO timestamp
  by?: string; // rep id or "system"
  action: string; // short verb phrase, e.g. "assigned SE"
  detail?: string;
}

export interface TrialIntake {
  id: string; // `intake_<oppId>_<submittedAt epoch>` — stable per-submission
  oppId: string;
  accountId: string;
  submittedBy: string; // Rep.id of the AE
  submittedAt: string; // ISO
  slaDeadline: string; // ISO — submittedAt + TRIAL_INTAKE_SLA_MS

  // Intake fields — captured at submission, immutable thereafter.
  kpiHypotheses: string[]; // up to 3
  buyerSuccessCriteria: string;
  datasetRequirements: string;
  seNotes: string;

  // Assignment + delivery state.
  status: Exclude<TrialIntakeStatus, "overdue">; // overdue is derived
  assignedSeId?: string; // Rep.id (role: SE) — set when status moves off pending
  kpiAssessmentDeliveredAt?: string; // ISO — set when status moves to delivered
  demoSeededAt?: string; // ISO

  history: TrialIntakeEvent[];
}

// Forward-declared on purpose to avoid a circular import. The concrete shape
// lives in lib/workspace.ts. Optional here so older call sites continue to
// compile; rules guard with `?.` and fall back to hardcoded names.
export interface EvaluationContext {
  opportunities: Opportunity[];
  accounts: Account[];
  contacts: Contact[];
  activities: Activity[];
  calls: CallTranscript[];
  deliveries: AssetDelivery[];
  reps: Rep[];
  config?: {
    companyName: string;
    assets: { id: string; name: string }[];
    stack: { dealRooms: string; conversationIntelligence: string };
    // Optional ACV floor read by the CONTRACT_IDLE rule — see
    // workspace.ts §CONTRACT_IDLE_AMOUNT_FLOOR_DEFAULT.
    contractIdleAmountFloor?: number;
  };
}
