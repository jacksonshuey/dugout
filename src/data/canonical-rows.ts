// Sample rows per canonical object. Drives the workspace tables in the
// Ontology tab. Sourced from seed where possible (Account, Contact,
// Deal, User, Activity), synthesized otherwise (Meeting, Email, Call,
// Sequence, Filing, NewsArticle, SupportTicket, Invoice).
//
// __sources tracks which integrations contributed to a given row, so
// the table can render provenance brand chips per row (same pattern as
// InteractiveZipperedTable on the landing page).

import { accounts, opportunities, contacts, reps } from "@/data/seed";

export type CanonicalRow = Record<string, unknown> & {
  __id: string;
  __sources: readonly string[];
};

// Synthetic enrichment - the canonical objects want fields the seed
// doesn't carry (employee count, revenue, etc.). We map account industry
// to a sensible employee/revenue band so the demo numbers feel real.
const INDUSTRY_BANDS: Record<string, { employees: number; revenue: number }> = {
  "Data infrastructure": { employees: 7500, revenue: 2_800_000_000 },
  "Enterprise software": { employees: 12000, revenue: 4_200_000_000 },
  "Private equity · financial services": { employees: 4000, revenue: 12_500_000_000 },
  "Insurance": { employees: 6000, revenue: 11_300_000_000 },
  "Healthcare & insurance": { employees: 8800, revenue: 13_900_000_000 },
  "Aerospace & defense": { employees: 150000, revenue: 78_000_000_000 },
  "Industrial · technology": { employees: 25000, revenue: 9_400_000_000 },
  "Biotech & pharma": { employees: 3800, revenue: 6_200_000_000 },
  "Consumer goods · beverage": { employees: 11000, revenue: 4_800_000_000 },
  "Payments · financial tech": { employees: 8200, revenue: 14_200_000_000 },
  "Energy · oil & gas": { employees: 9500, revenue: 56_000_000_000 },
};

function bandFor(industry: string): { employees: number; revenue: number } {
  return INDUSTRY_BANDS[industry] ?? { employees: 5000, revenue: 1_000_000_000 };
}

// ── Account ──────────────────────────────────────────────────────
const accountRows: CanonicalRow[] = accounts.slice(0, 10).map((a) => {
  const band = bandFor(a.industry);
  return {
    __id: a.id,
    __sources: ["Salesforce", "Apollo", "ZoomInfo", "Outreach"],
    name: a.name,
    domain: a.name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com",
    industry: a.industry,
    employee_count: band.employees,
    annual_revenue: band.revenue,
    hq_country: "US",
    account_type: "Customer - Direct",
    intent_strength: "medium",
  };
});

// ── Contact ──────────────────────────────────────────────────────
const contactRows: CanonicalRow[] = contacts.slice(0, 10).map((c) => ({
  __id: c.id,
  __sources: ["Salesforce", "Apollo", "Outreach"],
  full_name: c.name,
  email: `${c.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
  title: c.title,
  account_id: c.accountId,
  seniority: c.title?.toLowerCase().includes("vp")
    ? "vp"
    : c.title?.toLowerCase().includes("chief")
      ? "c_suite"
      : "director",
  email_status: "verified",
  opted_out: false,
  intent_strength: "high",
  last_engaged_at: "2026-05-24",
}));

// ── Deal ─────────────────────────────────────────────────────────
const dealRows: CanonicalRow[] = opportunities.slice(0, 10).map((o) => {
  const isLate = o.stage === "Selected Vendor" || o.stage === "Contracting";
  return {
    __id: o.id,
    __sources: ["Salesforce", "HubSpot"],
    name: o.name,
    amount: o.amount,
    stage: o.stage,
    forecast_category: isLate ? "Commit" : "Pipeline",
    close_date: o.closeDate,
    probability: o.stage === "Contracting" ? 0.9 : isLate ? 0.7 : 0.4,
    is_closed: false,
    is_won: false,
    account_id: o.accountId,
    owner_user_id: o.ownerId,
    days_in_stage: 12,
  };
});

// ── User ─────────────────────────────────────────────────────────
const userRows: CanonicalRow[] = reps.map((r) => ({
  __id: r.id,
  __sources: ["Salesforce", "Gong", "Outreach"],
  email: `${r.name.toLowerCase().replace(/\s+/g, ".")}@checkbox.ai`,
  full_name: r.name,
  title: r.role,
  is_active: true,
  forecast_enabled: true,
  time_zone: "America/Los_Angeles",
}));

// ── Meeting (synthesized from realistic Gong + SF Event joins) ────
const meetingRows: CanonicalRow[] = [
  { __id: "mtg_001", __sources: ["Gong", "Salesforce", "Chili Piper"], title: "Snowflake / Discovery", scheduled_start_at: "2026-05-22T14:00:00Z", duration_seconds: 2700, organizer_user_id: "rep_1", summary: "Champion confirmed buying committee. Legal stakeholder TBD.", talk_ratio_customer: 0.58, sentiment_score: 0.72, outcome: "Demo Booked" },
  { __id: "mtg_002", __sources: ["Gong", "Salesforce"], title: "Hitachi / Pricing Walkthrough", scheduled_start_at: "2026-05-21T10:30:00Z", duration_seconds: 1800, organizer_user_id: "rep_2", summary: "Pushed back on per-matter pricing. Need pooled-seat option.", talk_ratio_customer: 0.41, sentiment_score: -0.12, outcome: "Follow Up" },
  { __id: "mtg_003", __sources: ["Gong", "Swyft AI"], title: "SAP / Demo", scheduled_start_at: "2026-05-23T09:00:00Z", duration_seconds: 3300, organizer_user_id: "rep_1", summary: "EMEA Head of Legal Tech engaged. Asked for SOC2 docs.", talk_ratio_customer: 0.49, sentiment_score: 0.55, outcome: "Demo Booked" },
  { __id: "mtg_004", __sources: ["Salesforce", "Chili Piper"], title: "KKR / Intro Call", scheduled_start_at: "2026-05-15T15:00:00Z", duration_seconds: 1500, organizer_user_id: "rep_3", summary: "Initial intro. Director of Legal Ops set up follow-up with VP.", talk_ratio_customer: 0.62, sentiment_score: 0.38, outcome: "Qualified" },
  { __id: "mtg_005", __sources: ["Gong", "Salesforce"], title: "CNA Financial / Renewal Risk", scheduled_start_at: "2026-04-03T11:00:00Z", duration_seconds: 2100, organizer_user_id: "rep_2", summary: "Customer raised dissatisfaction with onboarding. Escalated to CSM.", talk_ratio_customer: 0.71, sentiment_score: -0.48, outcome: "At Risk" },
  { __id: "mtg_006", __sources: ["Gong", "Swyft AI", "Salesforce"], title: "Atlassian / Contracting", scheduled_start_at: "2026-05-20T13:00:00Z", duration_seconds: 2400, organizer_user_id: "rep_1", summary: "Legal redlines on MSA. Confirmed close date 2026-06-15.", talk_ratio_customer: 0.44, sentiment_score: 0.62, outcome: "Closing" },
  { __id: "mtg_007", __sources: ["Gong"], title: "Stripe / Compliance Deep-Dive", scheduled_start_at: "2026-05-18T16:00:00Z", duration_seconds: 3600, organizer_user_id: "rep_4", summary: "Senior Counsel asked about FedRAMP roadmap.", talk_ratio_customer: 0.55, sentiment_score: 0.21, outcome: "Discovery" },
];

// ── Email ────────────────────────────────────────────────────────
const emailRows: CanonicalRow[] = [
  { __id: "em_001", __sources: ["Outreach"], subject: "Following up on yesterday's demo", state: "opened", opened_at: "2026-05-24T09:14:00Z", open_count: 3, click_count: 1, to_contact_id: "c_sap_1", from_user_id: "rep_1" },
  { __id: "em_002", __sources: ["Outreach"], subject: "Re: Pricing question", state: "replied", replied_at: "2026-05-23T15:42:00Z", open_count: 5, click_count: 2, to_contact_id: "c_hit_1", from_user_id: "rep_2" },
  { __id: "em_003", __sources: ["Outreach", "Salesforce"], subject: "SOC2 documentation request", state: "delivered", delivered_at: "2026-05-24T08:00:00Z", open_count: 0, to_contact_id: "c_sap_1", from_user_id: "rep_1" },
  { __id: "em_004", __sources: ["Outreach"], subject: "Quick intro - Checkbox for KKR", state: "clicked", clicked_at: "2026-05-15T11:22:00Z", open_count: 2, click_count: 1, to_contact_id: "c_kkr_1", from_user_id: "rep_3" },
  { __id: "em_005", __sources: ["Outreach"], subject: "Re: Onboarding timeline", state: "bounced", bounced_at: "2026-04-03T10:18:00Z", open_count: 0, to_contact_id: "c_cna_1", from_user_id: "rep_2" },
  { __id: "em_006", __sources: ["Outreach"], subject: "Contract redlines attached", state: "replied", replied_at: "2026-05-21T14:30:00Z", open_count: 8, click_count: 3, to_contact_id: "c_atl_1", from_user_id: "rep_1" },
];

// ── Call ─────────────────────────────────────────────────────────
const callRows: CanonicalRow[] = [
  { __id: "cl_001", __sources: ["Nooks", "Outreach", "Salesforce"], dialed_at: "2026-05-24T10:15:00Z", duration_seconds: 412, direction: "outbound", state: "complete", outcome: "Meeting Booked", contact_id: "c_sap_1", user_id: "rep_1" },
  { __id: "cl_002", __sources: ["Outreach", "Salesforce"], dialed_at: "2026-05-23T14:20:00Z", duration_seconds: 0, direction: "outbound", state: "voicemail", outcome: "Left VM", contact_id: "c_hit_1", user_id: "rep_2" },
  { __id: "cl_003", __sources: ["Nooks"], dialed_at: "2026-05-22T11:05:00Z", duration_seconds: 893, direction: "outbound", state: "complete", outcome: "Qualified", contact_id: "c_kkr_1", user_id: "rep_3" },
  { __id: "cl_004", __sources: ["Nooks", "Outreach"], dialed_at: "2026-05-21T16:30:00Z", duration_seconds: 124, direction: "outbound", state: "no_answer", outcome: "No Answer", contact_id: "c_str_1", user_id: "rep_4" },
  { __id: "cl_005", __sources: ["Outreach", "Salesforce"], dialed_at: "2026-05-20T09:45:00Z", duration_seconds: 1820, direction: "inbound", state: "complete", outcome: "Renewal Discussion", contact_id: "c_cna_1", user_id: "rep_2" },
];

// ── Sequence ─────────────────────────────────────────────────────
const sequenceRows: CanonicalRow[] = [
  { __id: "seq_001", __sources: ["Outreach"], name: "Enterprise Legal Outbound Q2", num_steps: 7, num_contacts: 142, delivered_count: 138, open_count: 89, reply_count: 14, demoed_count: 4, owner_user_id: "rep_1" },
  { __id: "seq_002", __sources: ["Outreach", "Apollo"], name: "GC Discovery (MEDDPICC)", num_steps: 5, num_contacts: 96, delivered_count: 96, open_count: 72, reply_count: 22, demoed_count: 7, owner_user_id: "rep_2" },
  { __id: "seq_003", __sources: ["Outreach"], name: "POC Re-Engagement", num_steps: 4, num_contacts: 38, delivered_count: 38, open_count: 19, reply_count: 5, demoed_count: 2, owner_user_id: "rep_3" },
  { __id: "seq_004", __sources: ["Apollo"], name: "ABM Tier 1 - Insurance", num_steps: 8, num_contacts: 24, delivered_count: 23, open_count: 18, reply_count: 6, demoed_count: 3, owner_user_id: "rep_1" },
];

// ── Filing (SEC EDGAR 8-K events) ────────────────────────────────
const filingRows: CanonicalRow[] = [
  { __id: "fil_001", __sources: ["SEC EDGAR"], accession_number: "0000320193-26-000012", registrant_name: "Snowflake Inc.", form: "8-K", filing_date: "2026-05-15", items: "5.02, 9.01", summary: "Chief Legal Officer departure; successor named.", linked_account_id: "acc_snowflake" },
  { __id: "fil_002", __sources: ["SEC EDGAR"], accession_number: "0001682852-26-000088", registrant_name: "Moderna, Inc.", form: "8-K", filing_date: "2026-05-12", items: "2.02", summary: "Q1 2026 earnings released. Revenue $1.8B, beat consensus.", linked_account_id: "acc_moderna" },
  { __id: "fil_003", __sources: ["SEC EDGAR"], accession_number: "0001318605-26-000044", registrant_name: "Boeing Co", form: "8-K", filing_date: "2026-05-08", items: "1.01", summary: "Material agreement entered with DoD for $2.3B contract.", linked_account_id: "acc_boeing" },
  { __id: "fil_004", __sources: ["SEC EDGAR"], accession_number: "0000731766-26-000067", registrant_name: "UnitedHealth Group", form: "10-Q", filing_date: "2026-05-01", items: "", summary: "Q1 2026 quarterly report. Stable margins.", linked_account_id: "acc_unitedhealth" },
];

// ── NewsArticle ──────────────────────────────────────────────────
const newsRows: CanonicalRow[] = [
  { __id: "news_001", __sources: ["NewsAPI"], title: "SAP names new EMEA General Counsel in 6-K filing", source_name: "Reuters", published_at: "2026-05-23", author: "Sarah Lee", linked_account_id: "acc_sap" },
  { __id: "news_002", __sources: ["NewsAPI"], title: "Moderna Q3 trial results expand mRNA pipeline", source_name: "FierceBiotech", published_at: "2026-05-22", author: "James Park", linked_account_id: "acc_moderna" },
  { __id: "news_003", __sources: ["NewsAPI"], title: "Snowflake Q1 cloud revenue beats; legal team expansion announced", source_name: "TechCrunch", published_at: "2026-05-20", author: "Maria Chen", linked_account_id: "acc_snowflake" },
  { __id: "news_004", __sources: ["NewsAPI"], title: "KKR closes $400M deal with regional tech holding", source_name: "Bloomberg", published_at: "2026-05-18", author: "Tom Briggs", linked_account_id: "acc_kkr" },
  { __id: "news_005", __sources: ["NewsAPI"], title: "Atlassian acquires legal-AI startup; integration roadmap detailed", source_name: "The Information", published_at: "2026-05-17", author: "Priya Singh", linked_account_id: "acc_atlassian" },
];

// ── SupportTicket (Zendesk) ──────────────────────────────────────
const supportRows: CanonicalRow[] = [
  { __id: "tkt_001", __sources: ["Zendesk"], ticket_number: "#10247", subject: "SSO integration intermittent", type: "incident", priority: "high", status: "open", created_at: "2026-05-22", csat_score: "unrated", channel: "email", linked_account_id: "acc_snowflake" },
  { __id: "tkt_002", __sources: ["Zendesk"], ticket_number: "#10239", subject: "Onboarding sequence broken for new users", type: "problem", priority: "urgent", status: "open", created_at: "2026-05-20", csat_score: "unrated", channel: "web", linked_account_id: "acc_cna" },
  { __id: "tkt_003", __sources: ["Zendesk"], ticket_number: "#10221", subject: "Question about renewal pricing", type: "question", priority: "normal", status: "solved", created_at: "2026-05-15", solved_at: "2026-05-16", csat_score: "good", channel: "email", linked_account_id: "acc_atlassian" },
  { __id: "tkt_004", __sources: ["Zendesk"], ticket_number: "#10212", subject: "Export report not delivering", type: "incident", priority: "normal", status: "pending", created_at: "2026-05-12", csat_score: "unrated", channel: "email", linked_account_id: "acc_kkr" },
];

// ── Invoice (Xero) ───────────────────────────────────────────────
const invoiceRows: CanonicalRow[] = [
  { __id: "inv_001", __sources: ["Xero"], invoice_number: "INV-002145", type: "receivable", status: "paid", issue_date: "2026-04-01", due_date: "2026-05-01", paid_date: "2026-04-28", currency_code: "USD", total: 120000, amount_paid: 120000, amount_due: 0, is_overdue: false, linked_account_id: "acc_snowflake" },
  { __id: "inv_002", __sources: ["Xero"], invoice_number: "INV-002146", type: "receivable", status: "authorised", issue_date: "2026-05-01", due_date: "2026-06-01", currency_code: "USD", total: 90000, amount_paid: 0, amount_due: 90000, is_overdue: false, linked_account_id: "acc_atlassian" },
  { __id: "inv_003", __sources: ["Xero"], invoice_number: "INV-002112", type: "receivable", status: "authorised", issue_date: "2026-03-15", due_date: "2026-04-15", currency_code: "USD", total: 180000, amount_paid: 0, amount_due: 180000, is_overdue: true, linked_account_id: "acc_unitedhealth" },
  { __id: "inv_004", __sources: ["Xero"], invoice_number: "INV-002098", type: "receivable", status: "paid", issue_date: "2026-02-01", due_date: "2026-03-01", paid_date: "2026-02-28", currency_code: "USD", total: 60000, amount_paid: 60000, amount_due: 0, is_overdue: false, linked_account_id: "acc_moderna" },
];

// ── Activity (catch-all) ─────────────────────────────────────────
const activityRows: CanonicalRow[] = [
  { __id: "act_001", __sources: ["Dock"], type: "workspace_visit", subject: "Snowflake dealroom opened", activity_date: "2026-05-24T08:14:00Z", linked_account_id: "acc_snowflake", linked_deal_id: "opp_001" },
  { __id: "act_002", __sources: ["Webflow"], type: "form_submit", subject: "Demo request - Hitachi Digital", activity_date: "2026-05-22T11:32:00Z", linked_account_id: "acc_hitachi" },
  { __id: "act_003", __sources: ["Salesforce"], type: "note", subject: "Champion confirmed budget allocation", activity_date: "2026-05-22T15:00:00Z", linked_account_id: "acc_sap" },
  { __id: "act_004", __sources: ["Dock"], type: "asset_view", subject: "ROI calculator viewed 4x by Atlassian team", activity_date: "2026-05-20T13:00:00Z", linked_account_id: "acc_atlassian" },
  { __id: "act_005", __sources: ["Salesforce", "Outreach"], type: "task", subject: "Send CFO leave-behind to KKR", activity_date: "2026-05-15T16:00:00Z", linked_account_id: "acc_kkr" },
];

// Aggregated registry. Workspace tables look up rows by canonical key.
export const CANONICAL_ROWS: Record<string, readonly CanonicalRow[]> = {
  Account: accountRows,
  Contact: contactRows,
  Deal: dealRows,
  Meeting: meetingRows,
  Email: emailRows,
  Call: callRows,
  Sequence: sequenceRows,
  Filing: filingRows,
  NewsArticle: newsRows,
  SupportTicket: supportRows,
  Invoice: invoiceRows,
  User: userRows,
  Activity: activityRows,
};
