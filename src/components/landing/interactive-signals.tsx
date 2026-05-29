"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  comparatorsFor,
  comparatorLabel,
  getFieldSchema,
  groupLabel,
  ONTOLOGY_SCHEMA,
  type Comparator,
  type FieldGroup,
  type FieldSchema,
  type FieldType,
} from "@/data/ontology-schema";
import {
  ACTION_TEMPLATES,
  type Action,
  type AIExtractTrigger,
  type MeetingTrigger,
  type NewsTrigger,
  type OntologyTrigger,
  type RuleDraft,
  type Trigger,
  type TriggerKind,
} from "@/lib/rule-model";

// Interactive rules view.
//
// The composer is a call to the shadow ontology. Pick a trigger kind, then for
// "Ontology field" you search the column registry, pick a column, and the
// composer renders the value picker that matches the column's TYPE: enum
// columns get a multi-select of the distinct values present in the seeded
// accounts, numeric columns get comparator + threshold, text columns get
// contains / AI matches, and so on. Below the composer, active rules render
// their trigger chain and the action stream they kick off when they fire.

// ---------------------------------------------------------------------------
// Account data — what the rule engine evaluates over. Fields here are a
// subset of the shadow ontology; any field in ACCOUNT_DATA can be referenced
// by a rule, and the composer surfaces the distinct values it sees here for
// the multi-select picker.
// ---------------------------------------------------------------------------

type AccountData = Record<string, string | number | boolean>;

interface Account {
  name: string;
  owner_ae: string;
  data: AccountData;
}

const ACCOUNTS: Account[] = [
  {
    name: "SAP",
    owner_ae: "Sara Chen",
    data: {
      stage: "Contracting",
      forecast_category: "Commit",
      deal_amount: 380000,
      stage_age_days: 4,
      deal_type: "New Logo",
      contract_term_months: 36,
      meeting_count_30d: 6,
      email_count_14d: 12,
      days_since_last_touch: 1,
      champion_engagement_score: 0.91,
      champion_title: "Head of Legal Tech, EMEA",
      contact_count: 7,
      buying_committee_complete: true,
      vertical: "Tech",
      employee_count: 110000,
      annual_revenue: 35000000000,
      hq_country: "Germany",
      owner_ae: "Sara Chen",
    },
  },
  {
    name: "Hitachi Digital",
    owner_ae: "Marcus Webb",
    data: {
      stage: "Selected Vendor",
      forecast_category: "Commit",
      deal_amount: 360000,
      stage_age_days: 9,
      deal_type: "New Logo",
      contract_term_months: 24,
      meeting_count_30d: 4,
      email_count_14d: 8,
      days_since_last_touch: 3,
      champion_engagement_score: 0.78,
      champion_title: "Senior Manager, Global Legal Ops",
      contact_count: 5,
      buying_committee_complete: true,
      vertical: "Industrial",
      employee_count: 270000,
      annual_revenue: 80000000000,
      hq_country: "Japan",
      owner_ae: "Marcus Webb",
    },
  },
  {
    name: "Snowflake",
    owner_ae: "Sara Chen",
    data: {
      stage: "Selected Vendor",
      forecast_category: "Commit",
      deal_amount: 290000,
      stage_age_days: 7,
      deal_type: "New Logo",
      contract_term_months: 24,
      meeting_count_30d: 5,
      email_count_14d: 10,
      days_since_last_touch: 2,
      champion_engagement_score: 0.84,
      champion_title: "Senior Counsel, Commercial",
      contact_count: 6,
      buying_committee_complete: true,
      vertical: "Tech",
      employee_count: 7000,
      annual_revenue: 2800000000,
      hq_country: "United States",
      owner_ae: "Sara Chen",
    },
  },
  {
    name: "KKR & Co.",
    owner_ae: "Marcus Webb",
    data: {
      stage: "Evaluating",
      forecast_category: "Best Case",
      deal_amount: 180000,
      stage_age_days: 21,
      deal_type: "New Logo",
      contract_term_months: 12,
      meeting_count_30d: 2,
      email_count_14d: 4,
      days_since_last_touch: 11,
      champion_engagement_score: 0.41,
      champion_title: "Director, Legal Operations",
      contact_count: 3,
      buying_committee_complete: false,
      vertical: "Financial Services",
      employee_count: 4500,
      annual_revenue: 14000000000,
      hq_country: "United States",
      owner_ae: "Marcus Webb",
    },
  },
  {
    name: "CNA Financial",
    owner_ae: "Marcus Webb",
    data: {
      stage: "Selected Vendor",
      forecast_category: "Pipeline",
      deal_amount: 130000,
      stage_age_days: 18,
      deal_type: "New Logo",
      contract_term_months: 12,
      meeting_count_30d: 0,
      email_count_14d: 1,
      days_since_last_touch: 26,
      champion_engagement_score: 0.18,
      contact_count: 2,
      buying_committee_complete: false,
      vertical: "Insurance",
      employee_count: 5800,
      annual_revenue: 12000000000,
      hq_country: "United States",
      owner_ae: "Marcus Webb",
    },
  },
  {
    name: "Atlassian",
    owner_ae: "Sara Chen",
    data: {
      stage: "Selected Vendor",
      forecast_category: "Commit",
      deal_amount: 220000,
      stage_age_days: 11,
      deal_type: "Expansion",
      contract_term_months: 24,
      meeting_count_30d: 5,
      email_count_14d: 9,
      days_since_last_touch: 2,
      champion_engagement_score: 0.82,
      champion_title: "Head of Legal Operations",
      contact_count: 6,
      buying_committee_complete: true,
      vertical: "Tech",
      employee_count: 13000,
      annual_revenue: 4400000000,
      hq_country: "Australia",
      owner_ae: "Sara Chen",
    },
  },
  {
    name: "Stripe",
    owner_ae: "Sara Chen",
    data: {
      stage: "Qualified",
      forecast_category: "Pipeline",
      deal_amount: 95000,
      stage_age_days: 6,
      deal_type: "New Logo",
      contract_term_months: 12,
      meeting_count_30d: 1,
      email_count_14d: 3,
      days_since_last_touch: 5,
      champion_engagement_score: 0.52,
      champion_title: "Senior Counsel, Compliance",
      contact_count: 4,
      buying_committee_complete: false,
      vertical: "Tech",
      employee_count: 8000,
      annual_revenue: 14000000000,
      hq_country: "United States",
      owner_ae: "Sara Chen",
    },
  },
];

// The trigger/action/rule-draft model lives in @/lib/rule-model so the AI
// rule-builder route can validate LLM output into the exact shapes this
// composer renders and edits.

// ---------------------------------------------------------------------------
// Eval — does an ontology trigger fire on a given account?
// ---------------------------------------------------------------------------

function evalOntologyTrigger(acc: Account, t: OntologyTrigger): boolean {
  const raw = acc.data[t.field];
  if (raw === undefined || raw === null) return false;
  const lhsStr = String(raw);
  const lhsNum = typeof raw === "number" ? raw : parseFloat(lhsStr);
  switch (t.comparator) {
    case "==":
      if (typeof raw === "boolean") {
        return raw === (t.value.toLowerCase() === "true");
      }
      return lhsStr.toLowerCase() === t.value.toLowerCase();
    case "!=":
      return lhsStr.toLowerCase() !== t.value.toLowerCase();
    case ">":
      return !Number.isNaN(lhsNum) && lhsNum > parseFloat(t.value);
    case "<":
      return !Number.isNaN(lhsNum) && lhsNum < parseFloat(t.value);
    case ">=":
      return !Number.isNaN(lhsNum) && lhsNum >= parseFloat(t.value);
    case "<=":
      return !Number.isNaN(lhsNum) && lhsNum <= parseFloat(t.value);
    case "between": {
      if (Number.isNaN(lhsNum)) return false;
      const [lo, hi] = t.value.split(",").map((v) => parseFloat(v.trim()));
      if (Number.isNaN(lo!) || Number.isNaN(hi!)) return false;
      return lhsNum >= lo! && lhsNum <= hi!;
    }
    case "outside_of": {
      if (Number.isNaN(lhsNum)) return false;
      const [lo, hi] = t.value.split(",").map((v) => parseFloat(v.trim()));
      if (Number.isNaN(lo!) || Number.isNaN(hi!)) return false;
      return lhsNum < lo! || lhsNum > hi!;
    }
    case "in":
      return t.value.split(",").map((v) => v.trim().toLowerCase()).includes(lhsStr.toLowerCase());
    case "not_in":
      return !t.value.split(",").map((v) => v.trim().toLowerCase()).includes(lhsStr.toLowerCase());
    case "contains":
      return lhsStr.toLowerCase().includes(t.value.toLowerCase());
    case "not_contains":
      return !lhsStr.toLowerCase().includes(t.value.toLowerCase());
    case "ai_matches":
    case "not_ai_matches":
      // Demo: AI-driven matches are opaque to the synchronous evaluator.
      // The rule still saves; the live preview just can't preview AI hits.
      return false;
    case "before":
    case "after":
    case "within_days":
    case "more_than_days_ago":
      // Demo: date comparisons are not exercised on the seeded numeric fields.
      return false;
  }
}

function evalRule(acc: Account, triggers: Trigger[]): boolean {
  const ontology = triggers.filter(
    (t): t is OntologyTrigger => t.kind === "ontology",
  );
  if (ontology.length === 0) return false;
  return ontology.every((t) => evalOntologyTrigger(acc, t));
}

// Distinct values present in ACCOUNTS for a given field — used by the
// multi-select picker so the user picks rows that exist, not free-form text.
function distinctValuesFor(field: string): { value: string; accounts: string[] }[] {
  const map = new Map<string, string[]>();
  for (const a of ACCOUNTS) {
    const v = a.data[field];
    if (v === undefined || v === null) continue;
    const key = String(v);
    const list = map.get(key) ?? [];
    list.push(a.name);
    map.set(key, list);
  }
  return [...map.entries()].map(([value, accounts]) => ({ value, accounts }));
}

// ---------------------------------------------------------------------------
// Severity / active rules
// ---------------------------------------------------------------------------

type Severity = "blocking" | "action" | "awareness";

interface OntologyMatch {
  field: string;
  value: string;
  source?: string;
}

interface ActiveRule {
  id: string;
  severity: Severity;
  name: string;
  title: string;
  account: string;
  triggers: Trigger[];
  actions: Action[];
  matches: OntologyMatch[];
  evidence: string;
  evidenceFrom: string;
  age: string;
  custom?: boolean;
}

const SEEDED_RULES: ActiveRule[] = [
  {
    id: "rule_kkr_stale_high_value",
    severity: "action",
    name: "STALE_HIGH_VALUE_DEAL",
    title: "Mid-six-figure deal · low meeting velocity",
    account: "KKR & Co.",
    triggers: [
      { kind: "ontology", field: "deal_amount", comparator: "between", value: "150000,500000" },
      { kind: "ontology", field: "meeting_count_30d", comparator: "<", value: "3" },
    ],
    actions: [
      { kind: "slack_dm_owner" },
      { kind: "notify_csm" },
    ],
    matches: [
      { field: "deal_amount", value: "$180,000", source: "Salesforce" },
      { field: "meeting_count_30d", value: "2", source: "Gong" },
    ],
    evidence:
      "Deal crossed the $150K floor where Finance approval is mandatory, but only 2 meetings in 30 days. No CFO loop-in yet.",
    evidenceFrom: "Pipeline review · May 24",
    age: "8h ago",
  },
  {
    id: "rule_snowflake_competitor_mention",
    severity: "blocking",
    name: "COMPETITOR_MENTIONED",
    title: "Databricks named on last Snowflake call",
    account: "Snowflake",
    triggers: [
      { kind: "meeting", source: "Gong", mode: "word", pattern: "Databricks, Hightouch, Census" },
      { kind: "ontology", field: "forecast_category", comparator: "in", value: "Commit,Best Case" },
    ],
    actions: [
      { kind: "slack_dm_owner" },
      { kind: "send_asset", asset: "Snowflake vs Databricks one-pager" },
    ],
    matches: [
      { field: "meeting_signal", value: "Champion asked how we compare to Databricks", source: "Gong" },
      { field: "forecast_category", value: "Commit", source: "Salesforce" },
    ],
    evidence: "\"We're also evaluating Databricks. What's your story there?\"",
    evidenceFrom: "Jane Chen, May 23",
    age: "1d ago",
  },
  {
    id: "rule_sap_high_engagement_awareness",
    severity: "awareness",
    name: "HIGH_ENGAGEMENT_LATE_STAGE",
    title: "SAP · high-engagement late-stage deal",
    account: "SAP",
    triggers: [
      { kind: "ontology", field: "champion_engagement_score", comparator: ">=", value: "0.8" },
      { kind: "ontology", field: "stage", comparator: "in", value: "Selected Vendor,Contracting" },
    ],
    actions: [{ kind: "slack_channel", channel: "#deal-momentum" }],
    matches: [
      { field: "champion_engagement_score", value: "0.91", source: "Dugout AI" },
      { field: "stage", value: "Contracting", source: "Salesforce" },
    ],
    evidence:
      "Champion engagement at 0.91 and already in Contracting. Worth surfacing so the rep maintains pressure on the close.",
    evidenceFrom: "Engagement model · daily refresh",
    age: "12h ago",
  },
  {
    id: "rule_stripe_outside_band",
    severity: "action",
    name: "ACV_OUTSIDE_TARGET_BAND",
    title: "Stripe ACV outside $150K–$400K target band",
    account: "Stripe",
    triggers: [
      { kind: "ontology", field: "deal_amount", comparator: "outside_of", value: "150000,400000" },
      { kind: "ontology", field: "stage", comparator: "in", value: "Qualified,Demo Sat,Evaluating" },
    ],
    actions: [
      { kind: "slack_dm_owner" },
      { kind: "notify_csm" },
    ],
    matches: [
      { field: "deal_amount", value: "$95,000", source: "Salesforce" },
      { field: "stage", value: "Qualified", source: "Salesforce" },
    ],
    evidence:
      "Deal sized below our $150K minimum target band. Expand scope (add modules) or reclassify as SMB before progressing.",
    evidenceFrom: "Pricing playbook · target band $150K–$400K",
    age: "1d ago",
  },
  {
    id: "rule_kkr_freeze",
    severity: "blocking",
    name: "PROCUREMENT_FREEZE_CITED",
    title: "Procurement freeze cited twice → KKR",
    account: "KKR & Co.",
    triggers: [
      { kind: "ontology", field: "stage", comparator: "in", value: "Selected Vendor" },
      { kind: "meeting", source: "Gong", mode: "word", pattern: "procurement freeze, budget freeze" },
    ],
    actions: [
      { kind: "outreach_sequence", template: "Champion re-engagement" },
      { kind: "slack_dm_owner" },
    ],
    matches: [
      { field: "stage", value: "Selected Vendor", source: "Salesforce" },
      { field: "meeting_signal", value: "Procurement freeze cited twice in last 2 calls", source: "Gong" },
    ],
    evidence: "\"Our procurement team has frozen all new vendor evaluations until Q4 budget closes.\"",
    evidenceFrom: "Alex Mercer, last call (May 12)",
    age: "2h ago",
  },
  {
    id: "rule_cna_champion",
    severity: "blocking",
    name: "CHAMPION_ROLE_CHANGE",
    title: "Champion role change at CNA",
    account: "CNA Financial",
    triggers: [
      { kind: "meeting", source: "Granola", mode: "ai_extract", pattern: "champion mentions moving teams" },
    ],
    actions: [
      { kind: "slack_dm_owner" },
      { kind: "notify_csm" },
    ],
    matches: [
      { field: "contact_email", value: "null (was a.hart@cna.com)", source: "Salesforce" },
      { field: "meeting_signal", value: "Champion mentioned upcoming role change", source: "Granola" },
    ],
    evidence: "\"I'm moving to a different team in May. Will hand this off, but the timeline is unclear.\"",
    evidenceFrom: "Amelia Hart, last 1:1 (Apr 10)",
    age: "6h ago",
  },
  {
    id: "rule_unitedhealth_brief",
    severity: "action",
    name: "ASSET_GAP_FINANCE_BRIEF",
    title: "Finance brief unsent · 14d in Selected Vendor",
    account: "UnitedHealth Group",
    triggers: [
      { kind: "ontology", field: "stage", comparator: "in", value: "Selected Vendor" },
      { kind: "ontology", field: "stage_age_days", comparator: ">", value: "5" },
    ],
    actions: [
      { kind: "dock_workspace", template: "CFO Leave-Behind" },
      { kind: "send_asset", asset: "Finance brief + IT zero-lift one-pager" },
    ],
    matches: [
      { field: "stage", value: "Selected Vendor", source: "Salesforce" },
      { field: "stage_age_days", value: "14", source: "Salesforce OpportunityHistory" },
    ],
    evidence: "Selected Vendor stage for 14 days. CFO Leave-Behind playbook says assets ship by day 5.",
    evidenceFrom: "Playbook check",
    age: "3h ago",
  },
  {
    id: "rule_atlassian_soc2",
    severity: "action",
    name: "ASSET_REQUEST",
    title: "CFO requested SOC 2 update before TCO call",
    account: "Atlassian",
    triggers: [
      { kind: "ai_extract", source: "email", concept: "asset_request (SOC 2, DPA, ROI, security review)" },
    ],
    actions: [
      { kind: "dock_workspace", template: "Compliance bundle" },
      { kind: "send_asset", asset: "Latest SOC 2 Type II + pen-test summary" },
    ],
    matches: [
      { field: "meeting_signal", value: "CFO requested SOC 2 update before TCO approval", source: "Gong" },
      { field: "stage", value: "Selected Vendor", source: "Salesforce" },
    ],
    evidence: "\"We can't approve TCO until we see the latest SOC 2 report.\"",
    evidenceFrom: "Brendan Kelly, May 20",
    age: "4h ago",
  },
  {
    id: "rule_moderna_genai",
    severity: "awareness",
    name: "REGULATORY_DISCLOSURE_GENAI",
    title: "Moderna 10-K cites GenAI as risk factor",
    account: "Moderna",
    triggers: [
      { kind: "news", source: "SEC EDGAR", mode: "ai_semantic", pattern: "10-K cites GenAI or AI risk factor" },
    ],
    actions: [{ kind: "snooze", days: 2 }],
    matches: [
      { field: "regulatory_event", value: "Moderna 10-K cites GenAI risk factor", source: "SEC EDGAR" },
      { field: "vertical", value: "Biotech & pharma", source: "AI classified" },
    ],
    evidence: "10-K Item 1A: \"Our use of generative AI in clinical trial operations is subject to evolving regulatory scrutiny…\"",
    evidenceFrom: "Moderna, Inc. 10-K filed 2026-05-14",
    age: "2d ago",
  },
];

const TIERS: { key: Severity | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "blocking", label: "Blocking" },
  { key: "action", label: "Action" },
  { key: "awareness", label: "Awareness" },
];

// ===========================================================================
// Root
// ===========================================================================

export function InteractiveSignals() {
  const [tier, setTier] = useState<Severity | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // All rules — seeded + user-authored — live in one state slice so every
  // rule is editable through the composer.
  const [rules, setRules] = useState<ActiveRule[]>(SEEDED_RULES);
  const [editingId, setEditingId] = useState<string | null>(null);
  // AI-authored draft seeded into the composer. `draftNonce` re-mounts the
  // composer each time a fresh draft arrives so its useState initializers
  // pick up the new triggers/actions.
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [draftNonce, setDraftNonce] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);

  const editingRule = editingId ? rules.find((r) => r.id === editingId) ?? null : null;

  const handleAIDraft = (rule: RuleDraft) => {
    setEditingId(null);
    setDraft(rule);
    setDraftNonce((n) => n + 1);
  };

  const visible = rules.filter((r) => tier === "all" || r.severity === tier);
  const counts = {
    all: rules.length,
    blocking: rules.filter((r) => r.severity === "blocking").length,
    action: rules.filter((r) => r.severity === "action").length,
    awareness: rules.filter((r) => r.severity === "awareness").length,
  };

  const handleSave = (rule: ActiveRule) => {
    if (editingId) {
      setRules((rs) => rs.map((r) => (r.id === editingId ? { ...rule, id: editingId } : r)));
      setExpandedId(editingId);
      setEditingId(null);
    } else {
      setRules((rs) => [rule, ...rs]);
      setExpandedId(rule.id);
    }
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setExpandedId(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: window.scrollY - 50, behavior: "smooth" });
    }
  };

  const handleDelete = (id: string) => {
    setRules((rs) => rs.filter((r) => r.id !== id));
    if (expandedId === id) setExpandedId(null);
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="space-y-6">
      {!editingRule && (
        <div className="rounded-lg border border-brand/30 bg-brand/[0.03] p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h4 className="text-sm font-semibold tracking-tight flex items-center gap-2">
              Build a rule with AI
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand text-background">
                beta
              </span>
            </h4>
            <p className="text-[11px] text-muted leading-relaxed mt-0.5">
              Describe an automation in plain English and chat it into shape —
              it drops into the composer below to edit and save.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:bg-foreground/90 transition-colors shrink-0"
          >
            Build rule
          </button>
        </div>
      )}

      {chatOpen && (
        <RuleChatModal
          onClose={() => setChatOpen(false)}
          onAccept={handleAIDraft}
        />
      )}

      <RuleComposer
        // Re-mount the composer whenever the edit target changes (or when a
        // fresh AI draft arrives). Lets us seed state from editingRule/draft
        // via useState initializers — no effect-driven syncing.
        key={editingRule?.id ?? (draft ? `draft-${draftNonce}` : "new")}
        editingRule={editingRule}
        draft={editingRule ? null : draft}
        onSave={handleSave}
        onCancelEdit={() => setEditingId(null)}
      />

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold tracking-tight">Active rules</h4>
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
            {rules.length} firing
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {TIERS.map((t) => {
            const active = tier === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTier(t.key)}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] font-medium transition-colors " +
                  tierButtonClass(t.key, active)
                }
                aria-pressed={active}
              >
                <span>{t.label}</span>
                <span className="font-mono text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="space-y-2">
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-foreground/[0.015] p-6 text-center text-[12px] text-muted italic">
              No rules in this tier.
            </div>
          ) : (
            visible.map((r) => (
              <RuleCard
                key={r.id}
                rule={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
                onEdit={() => handleEdit(r.id)}
                onRemove={() => handleDelete(r.id)}
                isEditing={editingId === r.id}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Active rule card — expandable trigger + action chain
// ===========================================================================

function RuleCard({
  rule,
  expanded,
  onToggle,
  onEdit,
  onRemove,
  isEditing,
}: {
  rule: ActiveRule;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  isEditing: boolean;
}) {
  const cls = severityClasses(rule.severity);
  return (
    <div
      className={
        "rounded-lg border bg-background overflow-hidden transition-colors " +
        (isEditing ? "border-brand/60 ring-2 ring-brand/20" : "border-border")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-foreground/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        <span
          className={`text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 rounded border shrink-0 inline-flex items-center justify-center w-[72px] ${cls}`}
        >
          {rule.severity}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold tracking-tight leading-snug flex items-center gap-2">
            {rule.title}
            {rule.custom && (
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border border-brand/30 bg-brand/[0.06] text-brand">
                custom
              </span>
            )}
            {isEditing && (
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand text-background">
                editing
              </span>
            )}
          </div>
          <div className="text-xs text-muted leading-relaxed mt-0.5">
            {rule.account} · <code className="font-mono text-[10px]">{rule.name}</code>
          </div>
        </div>
        <span className="text-[10px] font-mono text-muted shrink-0 mt-1">{rule.age}</span>
        <span
          aria-hidden
          className={
            "text-muted text-[10px] mt-1 shrink-0 transition-transform " +
            (expanded ? "rotate-180" : "")
          }
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border bg-foreground/[0.015] p-3 space-y-3 text-[12px]">
          <Field label="Trigger chain">
            <TriggerChain triggers={rule.triggers} />
          </Field>
          <Field label="Action stream">
            <ActionChain actions={rule.actions} />
          </Field>
          {rule.matches.length > 0 && (
            <Field label="Ontology data">
              <div className="space-y-1">
                {rule.matches.map((m) => (
                  <div
                    key={m.field}
                    className="grid grid-cols-12 gap-2 items-baseline text-[11px]"
                  >
                    <code className="col-span-4 font-mono text-muted truncate">{m.field}</code>
                    <span className="col-span-6 text-foreground/85 truncate">{m.value}</span>
                    {m.source && (
                      <span className="col-span-2 text-[9px] font-mono text-brand text-right truncate">
                        {m.source}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Field>
          )}
          {rule.evidence && (
            <Field label="Evidence">
              <div className="italic text-foreground/80 leading-snug">{rule.evidence}</div>
              <div className="text-[10px] text-muted font-mono mt-1">{rule.evidenceFrom}</div>
            </Field>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-brand/40 bg-brand/[0.06] text-brand hover:bg-brand/[0.1] text-[11px] font-medium transition-colors"
            >
              Edit rule
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-foreground/30 text-[11px] font-medium transition-colors"
            >
              Delete rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Trigger chain / Action chain rendering (read-only)
// ===========================================================================

function TriggerChain({ triggers }: { triggers: Trigger[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {triggers.map((t, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted shrink-0 w-10 pt-1">
            {i === 0 ? "WHEN" : "AND"}
          </span>
          <TriggerChip trigger={t} />
        </div>
      ))}
    </div>
  );
}

function TriggerChip({ trigger }: { trigger: Trigger }) {
  if (trigger.kind === "ontology") {
    const schema = getFieldSchema(trigger.field);
    return (
      <div className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-foreground/[0.05] text-muted">
            ontology
          </span>
          <code className="font-mono text-foreground/85">{trigger.field}</code>
          {schema && <TypeChip type={schema.type} />}
          <code className="font-mono text-brand">{comparatorLabel(trigger.comparator)}</code>
          <code className="font-mono text-foreground/85">{trigger.value}</code>
        </div>
      </div>
    );
  }
  if (trigger.kind === "news") {
    return (
      <div className="flex-1 rounded-md border border-severity-awareness/30 bg-severity-awareness-bg/40 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-severity-awareness-bg text-severity-awareness">
            news · {trigger.source} · {trigger.mode === "word" ? "word" : "AI"}
          </span>
          <span className="text-foreground/85 leading-snug">{trigger.pattern}</span>
        </div>
      </div>
    );
  }
  if (trigger.kind === "meeting") {
    return (
      <div className="flex-1 rounded-md border border-brand/30 bg-brand/[0.04] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand/[0.1] text-brand">
            meeting · {trigger.source} · {trigger.mode === "word" ? "word" : "AI"}
          </span>
          <span className="text-foreground/85 leading-snug">{trigger.pattern}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 rounded-md border border-brand/30 bg-brand/[0.04] px-2.5 py-1.5">
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand/[0.1] text-brand">
          AI extract · {trigger.source}
        </span>
        <span className="text-foreground/85 leading-snug">{trigger.concept}</span>
      </div>
    </div>
  );
}

function ActionChain({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return <div className="text-[11px] text-muted italic">No actions configured.</div>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted shrink-0 w-10 pt-1">
            {i === 0 ? "THEN" : "↳"}
          </span>
          <div className="flex-1 rounded-md border border-severity-green/30 bg-severity-green-bg/40 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-severity-green-bg text-severity-green">
                {actionKindLabel(a)}
              </span>
              <span className="text-foreground/85 leading-snug">{actionDescription(a)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function actionKindLabel(a: Action): string {
  switch (a.kind) {
    case "slack_dm_owner":
      return "slack";
    case "slack_channel":
      return "slack";
    case "dock_workspace":
      return "dock";
    case "outreach_sequence":
      return "outreach";
    case "send_asset":
      return "asset";
    case "snooze":
      return "snooze";
    case "notify_csm":
      return "csm";
  }
}

function actionDescription(a: Action): string {
  switch (a.kind) {
    case "slack_dm_owner":
      return "DM the AE on each matching account";
    case "slack_channel":
      return `Post to ${a.channel}`;
    case "dock_workspace":
      return `Create workspace · ${a.template}`;
    case "outreach_sequence":
      return `Enroll in ${a.template}`;
    case "send_asset":
      return `Send ${a.asset}`;
    case "snooze":
      return `Suppress for ${a.days} day${a.days === 1 ? "" : "s"}`;
    case "notify_csm":
      return "Tag CSM with hand-off note";
  }
}

// ===========================================================================
// AI rule chat modal — a centered popup that chats with the user to come up
// with a rule. On accept it seeds the composer; the user edits + saves there.
// ===========================================================================

const CHAT_EXAMPLES = [
  "Flag deals over $150k that have had fewer than 3 meetings in 30 days, and DM the AE.",
  "When a Selected Vendor account goes 14+ days without a touch, notify the CSM.",
  "If a champion's engagement score drops below 0.3, enroll them in re-engagement.",
];

type ChatTurn = { id: number; role: "user" | "assistant"; content: string };

// Mounted only while open (the parent gates it), so useState initializers give
// a fresh conversation each time without any reset-in-effect.
function RuleChatModal({
  onClose,
  onAccept,
}: {
  onClose: () => void;
  onAccept: (rule: RuleDraft) => void;
}) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingRule, setPendingRule] = useState<RuleDraft | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnId = useRef(0);

  // Read the latest onClose without listing it as an effect dep — otherwise an
  // inline `onClose={() => …}` prop would tear down/re-add the listener on
  // every parent render. Synced in an effect (no ref writes during render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus the input on open and wire Escape-to-close. Registered once. On
  // unmount, also abort any in-flight request so we don't burn tokens on a
  // result no one will see.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
    };
  }, []);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading, pendingRule]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatTurn[] = [
      ...messages,
      { id: turnId.current++, role: "user", content: text },
    ];
    setMessages(next);
    setInput("");
    setPendingRule(null);
    setLoading(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/build-rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Strip client-only ids before sending the transcript to the API.
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
        signal: ac.signal,
      });
      const data = (await res.json()) as {
        reply?: string;
        rule?: RuleDraft | null;
        error?: string;
      };
      const reply =
        data.reply ?? data.error ?? "Something went wrong — try rephrasing.";
      setMessages((m) => [
        ...m,
        { id: turnId.current++, role: "assistant", content: reply },
      ]);
      if (data.rule) setPendingRule(data.rule);
    } catch (err) {
      // Aborted on close — the modal is unmounting, so don't touch state.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages((m) => [
        ...m,
        {
          id: turnId.current++,
          role: "assistant",
          content: "Network error reaching the builder — try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const accept = () => {
    if (!pendingRule) return;
    onAccept(pendingRule);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Build a rule with AI"
    >
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            Build a rule with AI
            <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand text-background">
              AI
            </span>
          </h4>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-foreground transition-colors text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {CHAT_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setInput(ex)}
                  className="text-left px-2 py-1 rounded border border-dashed border-border text-[10px] text-muted hover:text-foreground hover:border-foreground/30 transition-colors max-w-full truncate"
                  title={ex}
                >
                  {ex}
                </button>
              ))}
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  "max-w-[85%] rounded-lg px-3 py-2 text-[12px] leading-relaxed " +
                  (m.role === "user"
                    ? "bg-foreground text-background"
                    : "bg-foreground/[0.05] text-foreground")
                }
              >
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-foreground/[0.05] px-3 py-2 text-[12px] text-muted">
                Thinking…
              </div>
            </div>
          )}

          {pendingRule && !loading && (
            <div className="rounded-lg border border-brand/40 bg-brand/[0.06] px-3 py-2.5 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-brand">
                Proposed rule
              </div>
              <div className="font-mono text-[12px] text-foreground break-all">
                {pendingRule.name}
              </div>
              <div className="text-[11px] text-muted">
                {pendingRule.triggers.length} trigger
                {pendingRule.triggers.length === 1 ? "" : "s"} →{" "}
                {pendingRule.actions.length} action
                {pendingRule.actions.length === 1 ? "" : "s"}
              </div>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={accept}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:bg-foreground/90 transition-colors"
                >
                  Use this rule
                </button>
                <span className="text-[10px] text-muted">
                  or keep chatting to refine it
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border p-3 space-y-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Describe the automation…"
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-[12px] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-muted">
              Enter to send · Shift+Enter for a new line
            </span>
            <button
              type="button"
              onClick={send}
              disabled={loading || input.trim().length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ===========================================================================
// Composer
// ===========================================================================

function RuleComposer({
  editingRule,
  draft,
  onSave,
  onCancelEdit,
}: {
  editingRule: ActiveRule | null;
  draft: RuleDraft | null;
  onSave: (rule: ActiveRule) => void;
  onCancelEdit: () => void;
}) {
  // Seed state directly from editingRule (edit mode) or an AI draft via
  // useState initializers. The parent re-mounts this component (key changes
  // when the edit target or draft changes), so this initialization is always
  // fresh — no effect-driven syncing required.
  const [name, setName] = useState(
    editingRule?.name ?? draft?.name ?? "LOW_MEETING_VELOCITY",
  );
  const [triggers, setTriggers] = useState<Trigger[]>(
    editingRule?.triggers ??
      draft?.triggers ?? [
        {
          kind: "ontology",
          field: "meeting_count_30d",
          comparator: "<",
          value: "5",
        },
      ],
  );
  const [actions, setActions] = useState<Action[]>(
    editingRule?.actions ?? draft?.actions ?? [{ kind: "slack_dm_owner" }],
  );

  const isEditing = editingRule !== null;

  const matches = useMemo(
    () => ACCOUNTS.filter((a) => evalRule(a, triggers)),
    [triggers],
  );

  const canSave = name.trim().length > 0 && triggers.length > 0 && actions.length > 0;

  const draftTitle = useMemo(() => {
    const first = triggers[0];
    if (!first) return "New rule preview";
    if (first.kind === "ontology")
      return `${first.field} ${comparatorLabel(first.comparator)} ${first.value}`;
    if (first.kind === "news") return `News · ${first.pattern}`;
    if (first.kind === "meeting") return `Meeting · ${first.pattern}`;
    return `AI extracts · ${first.concept}`;
  }, [triggers]);

  const handleSave = () => {
    if (isEditing && editingRule) {
      // Preserve metadata the composer doesn't author (severity, evidence,
      // account label, age) so saved edits don't lose the surrounding context.
      onSave({
        ...editingRule,
        name: name.trim(),
        title: editingRule.title,
        triggers,
        actions,
      });
    } else {
      const rule: ActiveRule = {
        id: `custom_${Date.now()}`,
        severity: "action",
        name: name.trim(),
        title: draftTitle,
        account: matches[0]?.name ?? "(no matches yet)",
        triggers,
        actions,
        matches: triggers
          .filter((t): t is OntologyTrigger => t.kind === "ontology")
          .map((t) => ({
            field: t.field,
            value: `${comparatorLabel(t.comparator)} ${t.value}`,
          })),
        evidence: "",
        evidenceFrom: "",
        age: "just now",
        custom: true,
      };
      onSave(rule);
    }
  };

  return (
    <div
      className={
        "rounded-lg border p-4 space-y-4 " +
        (isEditing
          ? "border-brand/60 bg-brand/[0.06] ring-2 ring-brand/20"
          : "border-brand/30 bg-brand/[0.03]")
      }
    >
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            {isEditing ? `Edit rule · ${editingRule!.name}` : "Build a rule stream"}
            {isEditing && (
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-brand text-background">
                editing
              </span>
            )}
          </h4>
          <p className="text-[11px] text-muted leading-relaxed mt-0.5">
            {isEditing
              ? "Modify any trigger or action. Saving updates the rule in place; cancelling discards your changes."
              : "Chain triggers from any source: ontology fields, news, meetings, or AI extraction. Then string together actions that run on a hit."}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          WHEN → THEN
        </span>
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s+/g, "_"))}
        placeholder="RULE_NAME"
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background font-mono uppercase text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />

      <div className="space-y-2">
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          Triggers · joined with AND
        </span>
        <div className="space-y-2">
          {triggers.map((t, i) => (
            <TriggerEditor
              key={i}
              trigger={t}
              isFirst={i === 0}
              onChange={(next) =>
                setTriggers((arr) => arr.map((x, j) => (j === i ? next : x)))
              }
              onRemove={
                triggers.length > 1
                  ? () => setTriggers((arr) => arr.filter((_, j) => j !== i))
                  : undefined
              }
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setTriggers((arr) => [
              ...arr,
              { kind: "ontology", field: "deal_amount", comparator: ">", value: "100000" },
            ])
          }
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-dashed border-border text-[11px] font-mono text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          + AND trigger
        </button>
      </div>

      <div className="space-y-2">
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          Actions · run in order
        </span>
        <div className="space-y-2">
          {actions.map((a, i) => (
            <ActionEditor
              key={i}
              action={a}
              isFirst={i === 0}
              onChange={(next) =>
                setActions((arr) => arr.map((x, j) => (j === i ? next : x)))
              }
              onRemove={
                actions.length > 1
                  ? () => setActions((arr) => arr.filter((_, j) => j !== i))
                  : undefined
              }
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setActions((arr) => [...arr, { kind: "slack_dm_owner" }])}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-dashed border-border text-[11px] font-mono text-muted hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          + THEN action
        </button>
      </div>

      <div className="flex items-center justify-end gap-2">
        {isEditing && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-muted hover:text-foreground hover:border-foreground/30 text-[12px] font-medium transition-colors"
          >
            Cancel edit
          </button>
        )}
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isEditing ? "Update rule" : "Save rule to stream"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger editor (kind dropdown + per-kind body)
// ---------------------------------------------------------------------------

function TriggerEditor({
  trigger,
  isFirst,
  onChange,
  onRemove,
}: {
  trigger: Trigger;
  isFirst: boolean;
  onChange: (next: Trigger) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted shrink-0 w-10">
          {isFirst ? "WHEN" : "AND"}
        </span>
        <select
          value={trigger.kind}
          onChange={(e) => {
            const k = e.target.value as TriggerKind;
            if (k === "ontology")
              onChange({ kind: "ontology", field: "stage", comparator: "in", value: "Selected Vendor" });
            else if (k === "news")
              onChange({ kind: "news", source: "NewsAPI", mode: "word", pattern: "" });
            else if (k === "meeting")
              onChange({ kind: "meeting", source: "Gong", mode: "word", pattern: "" });
            else onChange({ kind: "ai_extract", source: "email", concept: "" });
          }}
          className="px-2 py-1 rounded-md border border-border bg-background text-[11px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="ontology">Ontology field</option>
          <option value="news">News event</option>
          <option value="meeting">Meeting mention</option>
          <option value="ai_extract">AI extraction</option>
        </select>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-muted hover:text-foreground text-xs"
            aria-label="Remove trigger"
            title="Remove trigger"
          >
            ✕
          </button>
        )}
      </div>

      {trigger.kind === "ontology" && (
        <OntologyTriggerBody trigger={trigger} onChange={onChange} />
      )}
      {trigger.kind === "news" && <NewsTriggerBody trigger={trigger} onChange={onChange} />}
      {trigger.kind === "meeting" && <MeetingTriggerBody trigger={trigger} onChange={onChange} />}
      {trigger.kind === "ai_extract" && (
        <AIExtractTriggerBody trigger={trigger} onChange={onChange} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ontology trigger body — column picker + type-aware value editor
// ---------------------------------------------------------------------------

function OntologyTriggerBody({
  trigger,
  onChange,
}: {
  trigger: OntologyTrigger;
  onChange: (next: OntologyTrigger) => void;
}) {
  const schema = getFieldSchema(trigger.field);
  return (
    <div className="space-y-2">
      <FieldPicker
        value={trigger.field}
        onChange={(f) => {
          // Pick a sensible default comparator + value for the new field's type
          const defaultComp = comparatorsFor(f.type)[0]!;
          let defaultValue = "";
          if (f.type === "enum" && f.enumValues && f.enumValues.length > 0)
            defaultValue = f.enumValues[0]!;
          else if (f.type === "int" || f.type === "float") defaultValue = "0";
          else if (f.type === "bool") defaultValue = "true";
          onChange({
            kind: "ontology",
            field: f.key,
            comparator: defaultComp,
            value: defaultValue,
          });
        }}
      />
      {schema && <OntologyValueEditor schema={schema} trigger={trigger} onChange={onChange} />}
    </div>
  );
}

function OntologyValueEditor({
  schema,
  trigger,
  onChange,
}: {
  schema: FieldSchema;
  trigger: OntologyTrigger;
  onChange: (next: OntologyTrigger) => void;
}) {
  const comparators = comparatorsFor(schema.type);

  // Multi-select for enum (in / not_in)
  if (schema.type === "enum") {
    const selected = trigger.value.split(",").map((v) => v.trim()).filter(Boolean);
    const distinct = distinctValuesFor(schema.key);
    const distinctMap = new Map(distinct.map((d) => [d.value, d.accounts]));
    const options = schema.enumValues ?? [];
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={trigger.comparator}
            onChange={(e) => onChange({ ...trigger, comparator: e.target.value as Comparator })}
            className="px-2 py-1 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          >
            {comparators.map((c) => (
              <option key={c} value={c}>
                {comparatorLabel(c)}
              </option>
            ))}
          </select>
          <span className="text-[10px] font-mono text-muted">
            {selected.length} of {options.length} value{options.length === 1 ? "" : "s"} selected
          </span>
        </div>
        <div className="rounded-md border border-border bg-background divide-y divide-border">
          {options.map((v) => {
            const checked = selected.includes(v);
            const accounts = distinctMap.get(v) ?? [];
            return (
              <label
                key={v}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-foreground/[0.02] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, v]
                      : selected.filter((x) => x !== v);
                    onChange({ ...trigger, value: next.join(",") });
                  }}
                  className="shrink-0"
                />
                <span className="font-mono text-foreground/85">{v}</span>
                <span className="ml-auto text-[10px] font-mono text-muted">
                  {accounts.length === 0
                    ? "no accounts"
                    : `${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  // Bool
  if (schema.type === "bool") {
    return (
      <div className="grid grid-cols-12 gap-2 text-[12px]">
        <select
          value={trigger.comparator}
          onChange={(e) => onChange({ ...trigger, comparator: e.target.value as Comparator })}
          className="col-span-6 px-2 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          {comparators.map((c) => (
            <option key={c} value={c}>
              {comparatorLabel(c)}
            </option>
          ))}
        </select>
        <select
          value={trigger.value}
          onChange={(e) => onChange({ ...trigger, value: e.target.value })}
          className="col-span-6 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </div>
    );
  }

  // Date
  if (schema.type === "date") {
    return (
      <div className="grid grid-cols-12 gap-2 text-[12px]">
        <select
          value={trigger.comparator}
          onChange={(e) => onChange({ ...trigger, comparator: e.target.value as Comparator })}
          className="col-span-5 px-2 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          {comparators.map((c) => (
            <option key={c} value={c}>
              {comparatorLabel(c)}
            </option>
          ))}
        </select>
        <input
          type={
            trigger.comparator === "within_days" || trigger.comparator === "more_than_days_ago"
              ? "number"
              : "date"
          }
          value={trigger.value}
          onChange={(e) => onChange({ ...trigger, value: e.target.value })}
          className="col-span-7 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
      </div>
    );
  }

  // Numeric (int/float)
  if (schema.type === "int" || schema.type === "float") {
    const distinct = distinctValuesFor(schema.key)
      .map((d) => parseFloat(d.value))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    const min = distinct[0];
    const max = distinct[distinct.length - 1];
    const step = schema.type === "float" ? "0.01" : "1";
    const isRange = trigger.comparator === "between" || trigger.comparator === "outside_of";

    // For range comparators we serialize the bounds as "lo,hi". When switching
    // INTO a range comparator from a single-value one, seed lo with the
    // existing value and hi with the dataset max so the user has a sensible
    // starting interval. When switching OUT, drop down to the low bound.
    const onComparatorChange = (next: Comparator) => {
      const prev = trigger.comparator;
      const wasRange = prev === "between" || prev === "outside_of";
      const willBeRange = next === "between" || next === "outside_of";
      let nextValue = trigger.value;
      if (!wasRange && willBeRange) {
        const lo = trigger.value || (min !== undefined ? String(min) : "0");
        const hi = max !== undefined ? String(max) : lo;
        nextValue = `${lo},${hi}`;
      } else if (wasRange && !willBeRange) {
        nextValue = trigger.value.split(",")[0]?.trim() || "0";
      }
      onChange({ ...trigger, comparator: next, value: nextValue });
    };

    const [loRaw, hiRaw] = isRange
      ? trigger.value.split(",").map((v) => v.trim())
      : [trigger.value, ""];

    return (
      <div className="space-y-1">
        {isRange ? (
          // [lo input] [comparator] [hi input] — the new blank opens to the
          // left of the comparator when between / outside_of is selected.
          <div className="grid grid-cols-12 gap-2 text-[12px] items-center">
            <input
              type="number"
              step={step}
              value={loRaw ?? ""}
              onChange={(e) =>
                onChange({ ...trigger, value: `${e.target.value},${hiRaw ?? ""}` })
              }
              placeholder="min"
              className="col-span-4 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <select
              value={trigger.comparator}
              onChange={(e) => onComparatorChange(e.target.value as Comparator)}
              className="col-span-4 px-2 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              {comparators.map((c) => (
                <option key={c} value={c}>
                  {comparatorLabel(c)}
                </option>
              ))}
            </select>
            <input
              type="number"
              step={step}
              value={hiRaw ?? ""}
              onChange={(e) =>
                onChange({ ...trigger, value: `${loRaw ?? ""},${e.target.value}` })
              }
              placeholder="max"
              className="col-span-4 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-2 text-[12px]">
            <select
              value={trigger.comparator}
              onChange={(e) => onComparatorChange(e.target.value as Comparator)}
              className="col-span-4 px-2 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            >
              {comparators.map((c) => (
                <option key={c} value={c}>
                  {comparatorLabel(c)}
                </option>
              ))}
            </select>
            <input
              type="number"
              step={step}
              value={trigger.value}
              onChange={(e) => onChange({ ...trigger, value: e.target.value })}
              className="col-span-8 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>
        )}
        {distinct.length > 0 && (
          <div className="text-[10px] font-mono text-muted">
            range across accounts: {formatNumber(min!, schema.unit)} → {formatNumber(max!, schema.unit)}
          </div>
        )}
      </div>
    );
  }

  // String / Text
  return (
    <div className="grid grid-cols-12 gap-2 text-[12px]">
      <select
        value={trigger.comparator}
        onChange={(e) => onChange({ ...trigger, comparator: e.target.value as Comparator })}
        className="col-span-4 px-2 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      >
        {comparators.map((c) => (
          <option key={c} value={c}>
            {comparatorLabel(c)}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={trigger.value}
        onChange={(e) => onChange({ ...trigger, value: e.target.value })}
        placeholder={
          trigger.comparator === "ai_matches" ? "Describe what AI should match" : "Value or pattern"
        }
        className="col-span-8 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable field picker — opens a popover with grouped, filterable columns
// ---------------------------------------------------------------------------

function FieldPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (f: FieldSchema) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = ONTOLOGY_SCHEMA.filter((f) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      f.key.toLowerCase().includes(q) ||
      f.label.toLowerCase().includes(q) ||
      f.source.toLowerCase().includes(q) ||
      f.description.toLowerCase().includes(q)
    );
  });

  const byGroup = new Map<FieldGroup, FieldSchema[]>();
  for (const f of filtered) {
    const list = byGroup.get(f.group) ?? [];
    list.push(f);
    byGroup.set(f.group, list);
  }

  const selected = getFieldSchema(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-1.5 rounded-md border border-border bg-background text-[12px] flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      >
        {selected ? (
          <>
            <code className="font-mono text-foreground">{selected.key}</code>
            <TypeChip type={selected.type} prominent />
            {selected.unit && (
              <span className="text-[10px] font-mono text-muted">· {selected.unit}</span>
            )}
            <span className="text-[10px] text-muted ml-auto">{selected.source}</span>
          </>
        ) : (
          <span className="text-muted italic">Pick a column from the ontology...</span>
        )}
        <span aria-hidden className="text-muted text-[10px]">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
          <input
            type="text"
            autoFocus
            placeholder={`Search ${ONTOLOGY_SCHEMA.length} ontology columns by name, source, or description...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 border-b border-border bg-background text-[12px] focus:outline-none"
          />
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-muted italic text-center">
                No columns match &ldquo;{query}&rdquo;
              </div>
            ) : (
              [...byGroup.entries()].map(([group, items]) => (
                <div key={group}>
                  <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-[0.15em] text-muted bg-foreground/[0.02]">
                    {groupLabel(group)}
                  </div>
                  {items.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        onChange(f);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-foreground/[0.04] text-[12px] block"
                    >
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-foreground">{f.key}</code>
                        <TypeChip type={f.type} prominent />
                        {f.enumValues && (
                          <span className="text-[9px] font-mono text-muted">
                            {f.enumValues.length} values
                          </span>
                        )}
                        {f.unit && (
                          <span className="text-[9px] font-mono text-muted">
                            · {f.unit}
                          </span>
                        )}
                        <span className="text-[9px] font-mono text-muted ml-auto">
                          {f.source}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted leading-snug mt-0.5">
                        {f.description}
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TypeChip({ type, prominent = false }: { type: FieldType; prominent?: boolean }) {
  const tone = typeChipTone(type);
  return (
    <span
      className={
        "font-mono uppercase tracking-[0.1em] rounded border " +
        (prominent
          ? "text-[10px] px-1.5 py-0.5 "
          : "text-[9px] px-1.5 py-0.5 ") +
        tone
      }
    >
      {type}
    </span>
  );
}

function typeChipTone(type: FieldType): string {
  switch (type) {
    case "int":
    case "float":
      return "bg-severity-action-bg text-severity-action border-severity-action/30";
    case "string":
    case "text":
      return "bg-brand/[0.08] text-brand border-brand/30";
    case "enum":
      return "bg-severity-green-bg text-severity-green border-severity-green/30";
    case "bool":
      return "bg-severity-awareness-bg text-severity-awareness border-severity-awareness/30";
    case "date":
      return "bg-foreground/[0.05] text-foreground border-foreground/20";
  }
}

// ---------------------------------------------------------------------------
// News / Meeting / AI extract trigger bodies
// ---------------------------------------------------------------------------

function NewsTriggerBody({
  trigger,
  onChange,
}: {
  trigger: NewsTrigger;
  onChange: (next: NewsTrigger) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[12px]">
        <select
          value={trigger.source}
          onChange={(e) => onChange({ ...trigger, source: e.target.value as NewsTrigger["source"] })}
          className="col-span-6 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="SEC EDGAR">SEC EDGAR</option>
          <option value="NewsAPI">NewsAPI</option>
          <option value="AgentMail digest">AgentMail digest</option>
        </select>
        <select
          value={trigger.mode}
          onChange={(e) => onChange({ ...trigger, mode: e.target.value as NewsTrigger["mode"] })}
          className="col-span-6 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="word">Word search · literal keyword</option>
          <option value="ai_semantic">AI semantic match · describe it</option>
        </select>
      </div>
      <input
        type="text"
        value={trigger.pattern}
        onChange={(e) => onChange({ ...trigger, pattern: e.target.value })}
        placeholder={
          trigger.mode === "word"
            ? "Keyword or phrase to find in news (e.g. Stripe, layoffs, acquisition)"
            : "Describe what AI should match (e.g. any regulatory action against the account)"
        }
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </div>
  );
}

function MeetingTriggerBody({
  trigger,
  onChange,
}: {
  trigger: MeetingTrigger;
  onChange: (next: MeetingTrigger) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2 text-[12px]">
        <select
          value={trigger.source}
          onChange={(e) =>
            onChange({ ...trigger, source: e.target.value as MeetingTrigger["source"] })
          }
          className="col-span-6 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="Gong">Gong</option>
          <option value="Granola">Granola</option>
        </select>
        <select
          value={trigger.mode}
          onChange={(e) => onChange({ ...trigger, mode: e.target.value as MeetingTrigger["mode"] })}
          className="col-span-6 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="word">Word search · literal phrase</option>
          <option value="ai_extract">AI extracts · describe concept</option>
        </select>
      </div>
      <input
        type="text"
        value={trigger.pattern}
        onChange={(e) => onChange({ ...trigger, pattern: e.target.value })}
        placeholder={
          trigger.mode === "word"
            ? "Phrases to find in transcripts (e.g. procurement freeze, budget freeze)"
            : "Describe what AI should extract (e.g. champion mentions moving teams)"
        }
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </div>
  );
}

function AIExtractTriggerBody({
  trigger,
  onChange,
}: {
  trigger: AIExtractTrigger;
  onChange: (next: AIExtractTrigger) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 text-[12px]">
      <select
        value={trigger.source}
        onChange={(e) =>
          onChange({ ...trigger, source: e.target.value as AIExtractTrigger["source"] })
        }
        className="col-span-12 sm:col-span-4 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      >
        <option value="email">Email</option>
        <option value="meeting">Meeting</option>
        <option value="account summary">Account summary</option>
      </select>
      <input
        type="text"
        value={trigger.concept}
        onChange={(e) => onChange({ ...trigger, concept: e.target.value })}
        placeholder="What should AI extract? (e.g. asset_request, role change)"
        className="col-span-12 sm:col-span-8 px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action editor — kind dropdown + per-kind body
// ---------------------------------------------------------------------------

function ActionEditor({
  action,
  isFirst,
  onChange,
  onRemove,
}: {
  action: Action;
  isFirst: boolean;
  onChange: (next: Action) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] font-mono uppercase tracking-[0.15em] text-muted shrink-0 w-10">
          {isFirst ? "THEN" : "↳"}
        </span>
        <select
          value={action.kind}
          onChange={(e) => {
            const k = e.target.value as Action["kind"];
            if (k === "slack_dm_owner") onChange({ kind: "slack_dm_owner" });
            else if (k === "slack_channel") onChange({ kind: "slack_channel", channel: "#deals" });
            else if (k === "dock_workspace")
              onChange({ kind: "dock_workspace", template: "CFO Leave-Behind" });
            else if (k === "outreach_sequence")
              onChange({ kind: "outreach_sequence", template: "Champion re-engagement" });
            else if (k === "send_asset")
              onChange({ kind: "send_asset", asset: "Latest SOC 2 packet" });
            else if (k === "snooze") onChange({ kind: "snooze", days: 7 });
            else onChange({ kind: "notify_csm" });
          }}
          className="px-2 py-1 rounded-md border border-border bg-background text-[11px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="slack_dm_owner">DM the AE on matching account</option>
          <option value="slack_channel">Post to Slack channel</option>
          <option value="dock_workspace">Create Dock workspace</option>
          <option value="outreach_sequence">Enroll Outreach sequence</option>
          <option value="send_asset">Send asset</option>
          <option value="notify_csm">Notify CSM</option>
          <option value="snooze">Snooze the rule</option>
        </select>
        <select
          value=""
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            const a = ACTION_TEMPLATES[idx];
            if (a) onChange(a.action);
          }}
          className="px-2 py-1 rounded-md border border-border bg-background text-[11px] text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">Pick an action template...</option>
          {ACTION_TEMPLATES.map((t, i) => (
            <option key={i} value={i}>
              {t.label}
            </option>
          ))}
        </select>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-muted hover:text-foreground text-xs"
            aria-label="Remove action"
            title="Remove action"
          >
            ✕
          </button>
        )}
      </div>
      <ActionBody action={action} onChange={onChange} />
    </div>
  );
}

function ActionBody({
  action,
  onChange,
}: {
  action: Action;
  onChange: (next: Action) => void;
}) {
  if (action.kind === "slack_dm_owner") {
    return (
      <div className="text-[11px] text-muted italic">
        DMs the <code className="font-mono">owner_ae</code> on each matching account directly from Dugout. Per-account recipient, no fixed channel needed.
      </div>
    );
  }
  if (action.kind === "slack_channel") {
    return (
      <input
        type="text"
        value={action.channel}
        onChange={(e) => onChange({ ...action, channel: e.target.value })}
        placeholder="#channel"
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background font-mono text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    );
  }
  if (action.kind === "dock_workspace") {
    return (
      <input
        type="text"
        value={action.template}
        onChange={(e) => onChange({ ...action, template: e.target.value })}
        placeholder="Workspace template"
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    );
  }
  if (action.kind === "outreach_sequence") {
    return (
      <input
        type="text"
        value={action.template}
        onChange={(e) => onChange({ ...action, template: e.target.value })}
        placeholder="Sequence name"
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    );
  }
  if (action.kind === "send_asset") {
    return (
      <input
        type="text"
        value={action.asset}
        onChange={(e) => onChange({ ...action, asset: e.target.value })}
        placeholder="Asset to send"
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    );
  }
  if (action.kind === "snooze") {
    return (
      <input
        type="number"
        min={1}
        value={action.days}
        onChange={(e) => onChange({ ...action, days: parseInt(e.target.value, 10) || 1 })}
        className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-[12px] focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
      />
    );
  }
  return (
    <div className="text-[11px] text-muted italic">
      Posts a hand-off note on the CSM channel with the rule context.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-3">
      <div className="sm:col-span-3 text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        {label}
      </div>
      <div className="sm:col-span-9">{children}</div>
    </div>
  );
}

function formatNumber(n: number, unit?: string): string {
  if (unit === "USD") {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  }
  if (unit === "days" || unit === "months") return `${n} ${unit}`;
  return String(n);
}

function severityClasses(severity: Severity): string {
  if (severity === "blocking")
    return "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20";
  if (severity === "action")
    return "bg-severity-action-bg text-severity-action border-severity-action/20";
  return "bg-severity-awareness-bg text-severity-awareness border-severity-awareness/20";
}

function tierButtonClass(key: Severity | "all", active: boolean): string {
  if (!active) {
    return "border-border bg-background text-muted hover:text-foreground hover:border-foreground/30";
  }
  if (key === "blocking")
    return "border-severity-blocking/40 bg-severity-blocking-bg text-severity-blocking";
  if (key === "action")
    return "border-severity-action/40 bg-severity-action-bg text-severity-action";
  if (key === "awareness")
    return "border-severity-awareness/40 bg-severity-awareness-bg text-severity-awareness";
  return "border-foreground/40 bg-foreground/[0.04] text-foreground";
}
