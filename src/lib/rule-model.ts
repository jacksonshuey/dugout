import type { Comparator } from "@/data/ontology-schema";

// Rule model shared by the interactive composer (client) and the AI
// rule-builder route (server). Kept provider- and React-free so both sides
// import one source of truth — the composer renders/edits these shapes and the
// builder validates LLM output into them.

// ---------------------------------------------------------------------------
// Triggers — kind-discriminated. Only the ontology kind evaluates against the
// seeded accounts; the others describe upstream sources the engine watches.
// ---------------------------------------------------------------------------

export type TriggerKind = "ontology" | "news" | "meeting" | "ai_extract";

export interface OntologyTrigger {
  kind: "ontology";
  field: string;
  comparator: Comparator;
  // Value semantics depend on comparator:
  // - numeric (>, <, ==, >=, <=, !=): number string
  // - in / not_in: comma-joined list of selected enum values
  // - contains / ai_matches: pattern string
  // - within_days / more_than_days_ago: integer string
  // - before / after: ISO date string
  value: string;
}

export interface NewsTrigger {
  kind: "news";
  source: "SEC EDGAR" | "NewsAPI" | "AgentMail digest";
  mode: "word" | "ai_semantic";
  pattern: string;
}

export interface MeetingTrigger {
  kind: "meeting";
  source: "Gong" | "Granola";
  mode: "word" | "ai_extract";
  pattern: string;
}

export interface AIExtractTrigger {
  kind: "ai_extract";
  source: "email" | "meeting" | "account summary";
  concept: string;
}

export type Trigger =
  | OntologyTrigger
  | NewsTrigger
  | MeetingTrigger
  | AIExtractTrigger;

// ---------------------------------------------------------------------------
// Actions — the "stream" chained after the triggers
// ---------------------------------------------------------------------------

export type Action =
  | { kind: "slack_dm_owner" }
  | { kind: "slack_channel"; channel: string }
  | { kind: "dock_workspace"; template: string }
  | { kind: "outreach_sequence"; template: string }
  | { kind: "send_asset"; asset: string }
  | { kind: "snooze"; days: number }
  | { kind: "notify_csm" };

export type ActionKind = Action["kind"];

export const ACTION_TEMPLATES: { label: string; action: Action }[] = [
  { label: "DM the AE on the matching account", action: { kind: "slack_dm_owner" } },
  { label: "Post to channel", action: { kind: "slack_channel", channel: "#deals" } },
  { label: "Create Dock workspace", action: { kind: "dock_workspace", template: "CFO Leave-Behind" } },
  { label: "Enroll Outreach sequence", action: { kind: "outreach_sequence", template: "Champion re-engagement" } },
  { label: "Send asset", action: { kind: "send_asset", asset: "Latest SOC 2 packet" } },
  { label: "Notify CSM", action: { kind: "notify_csm" } },
  { label: "Snooze 7 days", action: { kind: "snooze", days: 7 } },
];

// The fields the composer authors for a new rule. Severity/title/account and
// other metadata are derived on save, so the AI builder only produces these.
export interface RuleDraft {
  name: string;
  triggers: Trigger[];
  actions: Action[];
}
