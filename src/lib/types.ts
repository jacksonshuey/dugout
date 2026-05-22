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
  // Stock ticker for public-co accounts. Drives SEC EDGAR adapter coverage.
  ticker?: string;
  // True when the account is a real company but the layered CRM scenario
  // (opportunity, contacts, transcripts, activity) is fictional for demo
  // purposes. The drawer surfaces a chip + tooltip so the audience sees
  // clearly which parts are real signal and which are illustrative.
  isDemoScenario?: boolean;
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

export interface Signal {
  id: string; // unique per firing — `${ruleId}:${oppId}`
  ruleId: string;
  oppId: string;
  severity: SignalSeverity;
  title: string; // short, scannable
  body: string; // 1-2 sentences of context
  suggestedAction: string; // imperative — what the AE should do next
  assetLink?: string; // asset name + URL (mocked) for one-click access
  detectedAt: string;
  playbookId?: string; // when set, the UI shows a "View playbook" expander
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
  };
}
