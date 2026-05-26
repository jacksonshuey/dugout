// Shadow ontology — the type/source metadata that lives alongside the data
// ontology. Never rendered in the wide-row table. Read by the rule composer
// to know which comparators are legal for a field and what value input to
// draw, and by the rule engine at runtime to compare values correctly.

export type FieldType =
  | "int"
  | "float"
  | "string"
  | "text"
  | "bool"
  | "date"
  | "enum";

export type FieldGroup =
  | "deal"
  | "engagement"
  | "people"
  | "company"
  | "ai_signal";

export type Comparator =
  | "=="
  | "!="
  | ">"
  | "<"
  | ">="
  | "<="
  | "between"
  | "outside_of"
  | "in"
  | "not_in"
  | "contains"
  | "not_contains"
  | "ai_matches"
  | "not_ai_matches"
  | "before"
  | "after"
  | "within_days"
  | "more_than_days_ago";

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup;
  source: string;
  derivation: "raw" | "ai_classified" | "computed";
  enumValues?: readonly string[];
  unit?: string;
  description: string;
}

export const ONTOLOGY_SCHEMA: readonly FieldSchema[] = [
  // ===== Deal =====
  {
    key: "stage",
    label: "stage",
    type: "enum",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    enumValues: [
      "Qualified",
      "Demo Sat",
      "Evaluating",
      "Selected Vendor",
      "Contracting",
    ],
    description: "Current pipeline stage",
  },
  {
    key: "forecast_category",
    label: "forecast_category",
    type: "enum",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    enumValues: ["Pipeline", "Best Case", "Commit", "Closed"],
    description: "Forecast bucket",
  },
  {
    key: "deal_amount",
    label: "deal_amount",
    type: "int",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    unit: "USD",
    description: "Annual contract value",
  },
  {
    key: "stage_age_days",
    label: "stage_age_days",
    type: "int",
    group: "deal",
    source: "OpportunityHistory",
    derivation: "computed",
    unit: "days",
    description: "Days in current stage",
  },
  {
    key: "close_date",
    label: "close_date",
    type: "date",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    description: "Expected close date",
  },
  {
    key: "deal_type",
    label: "deal_type",
    type: "enum",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    enumValues: ["New Logo", "Expansion", "Renewal"],
    description: "Deal motion",
  },
  {
    key: "contract_term_months",
    label: "contract_term_months",
    type: "int",
    group: "deal",
    source: "Salesforce",
    derivation: "raw",
    unit: "months",
    description: "Contract length",
  },

  // ===== Engagement =====
  {
    key: "meeting_count_30d",
    label: "meeting_count_30d",
    type: "int",
    group: "engagement",
    source: "Gong",
    derivation: "computed",
    description: "Customer meetings in last 30 days",
  },
  {
    key: "email_count_14d",
    label: "email_count_14d",
    type: "int",
    group: "engagement",
    source: "Outreach",
    derivation: "computed",
    description: "Outbound emails in last 14 days",
  },
  {
    key: "last_meeting_date",
    label: "last_meeting_date",
    type: "date",
    group: "engagement",
    source: "Gong",
    derivation: "raw",
    description: "Most recent customer meeting",
  },
  {
    key: "days_since_last_touch",
    label: "days_since_last_touch",
    type: "int",
    group: "engagement",
    source: "Outreach + Gong",
    derivation: "computed",
    unit: "days",
    description: "Days since last customer interaction",
  },
  {
    key: "champion_engagement_score",
    label: "champion_engagement_score",
    type: "float",
    group: "engagement",
    source: "Dugout AI",
    derivation: "ai_classified",
    description: "0.0 to 1.0 engagement score",
  },

  // ===== People =====
  {
    key: "champion_title",
    label: "champion_title",
    type: "string",
    group: "people",
    source: "Salesforce",
    derivation: "raw",
    description: "Title of primary champion",
  },
  {
    key: "contact_count",
    label: "contact_count",
    type: "int",
    group: "people",
    source: "Salesforce",
    derivation: "computed",
    description: "Total contacts on the opportunity",
  },
  {
    key: "buying_committee_complete",
    label: "buying_committee_complete",
    type: "bool",
    group: "people",
    source: "Dugout AI",
    derivation: "ai_classified",
    description: "All required roles identified (Champion, Finance, Legal, IT)",
  },
  {
    key: "owner_ae",
    label: "owner_ae",
    type: "string",
    group: "people",
    source: "Salesforce",
    derivation: "raw",
    description: "Account executive assigned",
  },

  // ===== Company =====
  {
    key: "vertical",
    label: "vertical",
    type: "enum",
    group: "company",
    source: "Dugout AI",
    derivation: "ai_classified",
    enumValues: [
      "Financial Services",
      "Tech",
      "Biotech & pharma",
      "Insurance",
      "Industrial",
    ],
    description: "Industry classification",
  },
  {
    key: "employee_count",
    label: "employee_count",
    type: "int",
    group: "company",
    source: "Apollo",
    derivation: "raw",
    description: "Total employees",
  },
  {
    key: "annual_revenue",
    label: "annual_revenue",
    type: "int",
    group: "company",
    source: "Apollo",
    derivation: "raw",
    unit: "USD",
    description: "Reported annual revenue",
  },
  {
    key: "hq_country",
    label: "hq_country",
    type: "string",
    group: "company",
    source: "Apollo",
    derivation: "raw",
    description: "Headquarters country",
  },

  // ===== AI signal / text =====
  {
    key: "last_meeting_summary",
    label: "last_meeting_summary",
    type: "text",
    group: "ai_signal",
    source: "Gong AI",
    derivation: "ai_classified",
    description: "AI summary of most recent meeting",
  },
  {
    key: "objection_themes",
    label: "objection_themes",
    type: "text",
    group: "ai_signal",
    source: "Dugout AI",
    derivation: "ai_classified",
    description: "Recurring objections extracted from calls",
  },
  {
    key: "regulatory_event",
    label: "regulatory_event",
    type: "text",
    group: "ai_signal",
    source: "SEC EDGAR",
    derivation: "ai_classified",
    description: "Recent regulatory filing summary",
  },
  {
    key: "news_last_30d",
    label: "news_last_30d",
    type: "text",
    group: "ai_signal",
    source: "NewsAPI",
    derivation: "ai_classified",
    description: "News mentions in last 30 days",
  },
];

// Which comparators are legal for a given field type. The composer uses this
// to render only the operators that make sense (no `>=` on a string).
export const COMPARATORS_BY_TYPE: Record<FieldType, readonly Comparator[]> = {
  int: ["==", "!=", ">", "<", ">=", "<=", "between", "outside_of"],
  float: ["==", "!=", ">", "<", ">=", "<=", "between", "outside_of"],
  string: ["==", "!=", "contains", "not_contains"],
  text: ["contains", "not_contains", "ai_matches", "not_ai_matches"],
  bool: ["==", "!="],
  date: ["before", "after", "within_days", "more_than_days_ago", "between", "outside_of"],
  enum: ["in", "not_in"],
};

export function comparatorsFor(type: FieldType): readonly Comparator[] {
  return COMPARATORS_BY_TYPE[type];
}

export function getFieldSchema(key: string): FieldSchema | undefined {
  return ONTOLOGY_SCHEMA.find((f) => f.key === key);
}

export function groupLabel(g: FieldGroup): string {
  switch (g) {
    case "deal":
      return "Deal";
    case "engagement":
      return "Engagement";
    case "people":
      return "People";
    case "company":
      return "Company";
    case "ai_signal":
      return "AI signal";
  }
}

export function comparatorLabel(c: Comparator): string {
  switch (c) {
    case "==":
      return "is";
    case "!=":
      return "is not";
    case ">":
      return ">";
    case "<":
      return "<";
    case ">=":
      return ">=";
    case "<=":
      return "<=";
    case "between":
      return "between";
    case "outside_of":
      return "outside of";
    case "in":
      return "is any of";
    case "not_in":
      return "is none of";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
    case "ai_matches":
      return "AI matches";
    case "not_ai_matches":
      return "AI does not match";
    case "before":
      return "before";
    case "after":
      return "after";
    case "within_days":
      return "within N days";
    case "more_than_days_ago":
      return "more than N days ago";
  }
}
