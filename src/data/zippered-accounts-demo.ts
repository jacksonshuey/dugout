import type { BrandKey } from "@/components/landing/logos";

// Demo dataset for the /plan interactive wide-row table. Shows what
// zippering produces at Day 90: one row per account, every integration's
// data on it, brand-chip provenance per cell. Designed for the table's
// filter/sort controls — wider than strictly necessary (10 canonical
// columns × 7 accounts) so column and account toggles feel meaningful.
//
// Account pkeys MATCH the seed file (src/data/seed.ts). The 3 pinned demo
// scenarios (acc_snowflake Snowflake, acc_kkr KKR, acc_cna CNA) are
// included so /plan and the manager Console show the same companies. SAP
// and Hitachi Digital are real Checkbox customers per the public case;
// Atlassian and Stripe round out the table with seed accounts that fit
// Checkbox's enterprise-legal profile.
//
// Values are illustrative — the CRM integrations aren't live yet, so
// these are NOT real Salesforce/Gong/HubSpot reads. The contributor mix
// per cell is intentional: healthy accounts have rich multi-source
// coverage; struggling accounts have sparse coverage that itself is a
// signal.

export type CanonicalKey =
  | "occurred_at"
  | "contact_email"
  | "champion_title"
  | "vertical"
  | "stage"
  | "forecast_category"
  | "deal_amount"
  | "next_step"
  | "meeting_count_30d"
  | "meeting_signal"
  | "last_news_event"
  | "regulatory_event"
  | "summary";

export type CanonicalType = "timestamp" | "text" | "currency" | "integer";

export interface CanonicalColumn {
  key: CanonicalKey;
  label: string;
  type: CanonicalType;
}

export const CANONICAL_COLUMNS: CanonicalColumn[] = [
  { key: "occurred_at", label: "Last touch", type: "timestamp" },
  { key: "contact_email", label: "Champion email", type: "text" },
  { key: "champion_title", label: "Champion title", type: "text" },
  { key: "vertical", label: "Vertical (AI)", type: "text" },
  { key: "stage", label: "Stage", type: "text" },
  { key: "forecast_category", label: "Forecast", type: "text" },
  { key: "deal_amount", label: "Amount", type: "currency" },
  { key: "next_step", label: "Next step", type: "text" },
  { key: "meeting_count_30d", label: "Mtgs (30d)", type: "integer" },
  { key: "meeting_signal", label: "Meeting signal", type: "text" },
  { key: "last_news_event", label: "Last news", type: "text" },
  { key: "regulatory_event", label: "Regulatory event", type: "text" },
  { key: "summary", label: "Latest summary", type: "text" },
];

export interface ZipperedCell {
  value: string | null;
  contributors: BrandKey[];
}

export interface ZipperedAccountRow {
  pkey: string;
  name: string;
  industry: string;
  health: "healthy" | "watch" | "critical" | "neutral";
  cells: Record<CanonicalKey, ZipperedCell>;
}

export const ACTIVE_BRANDS: BrandKey[] = [
  "salesforce",
  "gong",
  "hubspot",
  "outreach",
  "chilipiper",
  "zoominfo",
  "dock",
  "nooks",
  "swyftai",
  "newsapi",
  "sec",
  "firecrawl",
  "granola",
];

export const ZIPPERED_ACCOUNTS: ZipperedAccountRow[] = [
  // --- Real Checkbox customers (also in seed) ---
  {
    pkey: "acc_sap",
    name: "SAP",
    industry: "Enterprise software",
    health: "healthy",
    cells: {
      occurred_at: { value: "2026-05-23", contributors: ["salesforce", "gong", "hubspot", "chilipiper", "nooks"] },
      contact_email: { value: "j.becker@sap.com", contributors: ["salesforce", "gong", "hubspot", "outreach"] },
      champion_title: { value: "Head of Legal Tech, EMEA", contributors: ["salesforce", "hubspot", "zoominfo"] },
      vertical: { value: "Enterprise software", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Contracting", contributors: ["salesforce", "hubspot"] },
      forecast_category: { value: "Commit", contributors: ["salesforce"] },
      deal_amount: { value: "$380,000", contributors: ["salesforce", "hubspot", "swyftai"] },
      next_step: { value: "Confirm signature timeline with procurement", contributors: ["salesforce", "swyftai", "dock"] },
      meeting_count_30d: { value: "6", contributors: ["gong", "chilipiper", "nooks"] },
      meeting_signal: { value: "Champion confirmed CFO buy-in; timeline acceptable", contributors: ["gong", "granola", "swyftai"] },
      last_news_event: { value: "SAP Q1 cloud revenue beats; legal team expansion announced", contributors: ["newsapi"] },
      regulatory_event: { value: "SAP 6-K filing: EMEA legal reorganization", contributors: ["sec", "firecrawl"] },
      summary: { value: "Final redlines back from European procurement; SE on standby", contributors: ["gong", "dock", "swyftai"] },
    },
  },
  {
    pkey: "acc_hitachi",
    name: "Hitachi Digital",
    industry: "Industrial · technology",
    health: "healthy",
    cells: {
      occurred_at: { value: "2026-05-21", contributors: ["salesforce", "gong", "chilipiper"] },
      contact_email: { value: "k.tanaka@hitachi.com", contributors: ["salesforce", "hubspot", "outreach"] },
      champion_title: { value: "Senior Manager, Global Legal Ops", contributors: ["salesforce", "zoominfo"] },
      vertical: { value: "Industrial · technology", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Selected Vendor", contributors: ["salesforce", "hubspot"] },
      forecast_category: { value: "Commit", contributors: ["salesforce"] },
      deal_amount: { value: "$360,000", contributors: ["salesforce", "hubspot", "swyftai"] },
      next_step: { value: "Multi-region IT discovery for SSO and data residency", contributors: ["salesforce", "outreach", "dock"] },
      meeting_count_30d: { value: "4", contributors: ["gong", "chilipiper"] },
      meeting_signal: { value: "APAC GC raised data-residency requirement for Tokyo", contributors: ["granola", "gong"] },
      last_news_event: { value: "Hitachi divests transportation unit, $5B", contributors: ["newsapi"] },
      regulatory_event: { value: "Hitachi 8-K: transportation unit divestiture closed", contributors: ["sec", "firecrawl"] },
      summary: { value: "Global rollout scoping; APAC + EMEA leads identified", contributors: ["gong", "dock", "swyftai"] },
    },
  },
  // --- Pinned demo scenarios (also drive verify-demo-scores.ts) ---
  {
    pkey: "acc_snowflake",
    name: "Snowflake",
    industry: "Data infrastructure",
    health: "healthy",
    cells: {
      occurred_at: { value: "2026-05-22", contributors: ["salesforce", "gong", "hubspot", "chilipiper"] },
      contact_email: { value: "jane.chen@snowflake.com", contributors: ["salesforce", "gong", "hubspot", "outreach"] },
      champion_title: { value: "Senior Counsel, Commercial", contributors: ["salesforce", "zoominfo"] },
      vertical: { value: "Data infrastructure", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Selected Vendor", contributors: ["salesforce", "hubspot"] },
      forecast_category: { value: "Commit", contributors: ["salesforce"] },
      deal_amount: { value: "$290,000", contributors: ["salesforce", "hubspot"] },
      next_step: { value: "Finance review with CFO Thursday", contributors: ["salesforce", "outreach"] },
      meeting_count_30d: { value: "5", contributors: ["gong", "chilipiper"] },
      meeting_signal: { value: "Champion confirmed Finance and IT both engaged", contributors: ["gong", "granola", "swyftai"] },
      last_news_event: { value: "Snowflake announces Series F at $40B valuation", contributors: ["newsapi"] },
      regulatory_event: { value: "Snowflake 10-K updates AI vendor disclosure", contributors: ["sec"] },
      summary: { value: "SV Health 83; finance and IT both engaged on Selected Vendor", contributors: ["gong", "dock"] },
    },
  },
  {
    pkey: "acc_kkr",
    name: "KKR & Co.",
    industry: "Private equity · financial services",
    health: "watch",
    cells: {
      occurred_at: { value: "2026-05-15", contributors: ["salesforce", "gong"] },
      contact_email: { value: "d.cohen@kkr.com", contributors: ["salesforce", "outreach"] },
      champion_title: { value: "Director, Legal Operations", contributors: ["salesforce", "zoominfo"] },
      vertical: { value: "Financial services", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Evaluating", contributors: ["salesforce"] },
      forecast_category: { value: "Best Case", contributors: ["salesforce"] },
      deal_amount: { value: "$180,000", contributors: ["salesforce"] },
      next_step: { value: "Re-engage Finance; loop in procurement", contributors: ["salesforce", "outreach"] },
      meeting_count_30d: { value: "2", contributors: ["gong"] },
      meeting_signal: { value: "Champion flagged Finance has not yet been looped in", contributors: ["gong", "granola"] },
      last_news_event: { value: "KKR closes $19B private equity fund", contributors: ["newsapi"] },
      regulatory_event: { value: "KKR 10-Q filing: legal spend up 12% YoY", contributors: ["sec"] },
      summary: { value: "SV Health 65; Evaluating with Finance still missing from BC", contributors: ["gong", "dock"] },
    },
  },
  {
    pkey: "acc_cna",
    name: "CNA Financial",
    industry: "Insurance",
    health: "critical",
    cells: {
      occurred_at: { value: "2026-04-03", contributors: ["salesforce"] },
      contact_email: { value: null, contributors: [] },
      champion_title: { value: null, contributors: [] },
      vertical: { value: "Insurance", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Selected Vendor", contributors: ["salesforce"] },
      forecast_category: { value: "Pipeline", contributors: ["salesforce"] },
      deal_amount: { value: "$130,000", contributors: ["salesforce"] },
      next_step: { value: null, contributors: [] },
      meeting_count_30d: { value: "0", contributors: ["gong"] },
      meeting_signal: { value: null, contributors: [] },
      last_news_event: { value: "CNA names new CTO; champion departed", contributors: ["newsapi"] },
      regulatory_event: { value: "CNA 8-K: leadership transition disclosed", contributors: ["sec", "firecrawl"] },
      summary: { value: null, contributors: [] },
    },
  },
  // --- Additional seed accounts that round out the table ---
  {
    pkey: "acc_atlassian",
    name: "Atlassian",
    industry: "Enterprise software",
    health: "healthy",
    cells: {
      occurred_at: { value: "2026-05-20", contributors: ["salesforce", "gong", "hubspot", "nooks"] },
      contact_email: { value: "b.kelly@atlassian.com", contributors: ["salesforce", "gong", "hubspot", "outreach"] },
      champion_title: { value: "Head of Legal Operations", contributors: ["salesforce", "zoominfo"] },
      vertical: { value: "Enterprise software", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Selected Vendor", contributors: ["salesforce", "hubspot"] },
      forecast_category: { value: "Commit", contributors: ["salesforce"] },
      deal_amount: { value: "$220,000", contributors: ["salesforce", "hubspot"] },
      next_step: { value: "Schedule CFO TCO walkthrough", contributors: ["salesforce", "outreach", "dock"] },
      meeting_count_30d: { value: "5", contributors: ["gong", "chilipiper"] },
      meeting_signal: { value: "CFO requested SOC 2 update before TCO call", contributors: ["gong", "granola", "swyftai"] },
      last_news_event: { value: "Atlassian acquires AI startup for $300M", contributors: ["newsapi"] },
      regulatory_event: { value: "Atlassian 10-K expands AI risk disclosure", contributors: ["sec", "firecrawl"] },
      summary: { value: "POC successful; ROI model approved; CFO review queued", contributors: ["gong", "dock"] },
    },
  },
  {
    pkey: "acc_stripe",
    name: "Stripe",
    industry: "Payments · financial tech",
    health: "neutral",
    cells: {
      occurred_at: { value: "2026-05-18", contributors: ["outreach", "nooks", "chilipiper"] },
      contact_email: { value: "m.patel@stripe.com", contributors: ["outreach", "zoominfo"] },
      champion_title: { value: "Senior Counsel, Compliance", contributors: ["zoominfo"] },
      vertical: { value: "Payments · fintech", contributors: ["zoominfo", "firecrawl"] },
      stage: { value: "Qualified", contributors: ["salesforce"] },
      forecast_category: { value: "Pipeline", contributors: ["salesforce"] },
      deal_amount: { value: "$95,000", contributors: ["salesforce"] },
      next_step: { value: "Send IT Zero Lift one-pager to CIO", contributors: ["outreach"] },
      meeting_count_30d: { value: "1", contributors: ["chilipiper", "nooks"] },
      meeting_signal: { value: "Champion warm on legal-tech consolidation theme", contributors: ["granola", "chilipiper"] },
      last_news_event: { value: "Stripe expands Asia-Pacific corridors", contributors: ["newsapi", "firecrawl"] },
      regulatory_event: { value: "Stripe 10-Q discloses compliance reserve increase", contributors: ["sec"] },
      summary: { value: "Discovery call set; champion warm on category", contributors: ["chilipiper", "granola"] },
    },
  },
];
