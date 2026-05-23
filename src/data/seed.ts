import type {
  Account,
  Activity,
  AssetDelivery,
  CallTranscript,
  Contact,
  Opportunity,
  Rep,
  Signal,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// DEMO_SCENARIO_ACCOUNTS — the three accounts engineered to render predictable
// SV Health Score tiers when run through the metrics.md formula.
//
// Per BUILD_ALIGNMENT principle #10 ("synthetic signal scenarios should be
// labeled so they're filterable in production") and to give Hero #0 (the SV
// Health surface, U2) a stable handle to render the canonical three-card
// rollup without hard-coding account IDs.
//
// Targets when scored by the metrics.md SV Health formula:
//   - healthy  → Snowflake (acc_atlas)         expected score ~85 (Healthy)
//   - watch    → KKR (acc_meridian)            expected score ~55 (At Risk)
//   - critical → CNA Financial (acc_sentinel)  expected score <20 (Critical,
//                matches the Helios worked example in metrics.md verbatim)
//
// These IDs are stable; if the underlying scenario is rewritten, update the
// scoring assertions but keep the keys.
//
// NOTE on the `watch` key: its computed SV Health Score is currently ~53,
// which falls into the `at_risk` tier (40-59) per tierForScore. The key
// labels the demo *scenario role* (middling deal that needs attention),
// not the computed tier badge — the UI renders "AT RISK" orange for this
// account, which is semantically correct. If a true 60-79 watch-tier
// scenario is wanted for visual variety in the dashboard, rebalance the
// KKR seed signals to push the score up; otherwise leave as-is.
// ---------------------------------------------------------------------------
export const DEMO_SCENARIO_ACCOUNTS = {
  healthy: "acc_atlas",
  watch: "acc_meridian",
  critical: "acc_sentinel",
} as const;

export type DemoScenarioTier = keyof typeof DEMO_SCENARIO_ACCOUNTS;

// Sales org scaled down from case context (9 AEs total) to 3 AEs + 1 manager
// for demo focus. Sara is the primary demo persona.
export const reps: Rep[] = [
  {
    id: "rep_dr",
    name: "David Reyes",
    role: "Manager",
    email: "david.reyes@checkbox.ai",
  },
  {
    id: "rep_sc",
    name: "Sara Chen",
    role: "AE",
    email: "sara.chen@checkbox.ai",
    managerId: "rep_dr",
  },
  {
    id: "rep_mw",
    name: "Marcus Webb",
    role: "AE",
    email: "marcus.webb@checkbox.ai",
    managerId: "rep_dr",
  },
  {
    id: "rep_jp",
    name: "Jenna Park",
    role: "AE",
    email: "jenna.park@checkbox.ai",
    managerId: "rep_dr",
  },
];

// All seeded accounts are real, public companies. The layered CRM scenario
// (deal stage, contact roster, transcripts, activity log) is fictional and
// engineered to exercise the signal engine — but every external integration
// (NewsAPI, SEC EDGAR, LinkedIn deep-link) runs against the real underlying
// company. Demo audience sees the isDemoScenario chip in the drawer.
export const accounts: Account[] = [
  {
    id: "acc_apex",
    name: "Moderna",
    industry: "Pharma",
    segment: "Enterprise",
    hqLocation: "Cambridge, MA",
    legalTeamSize: 80,
    trackable: true,
    linkedinSlug: "modernatx",
    website: "modernatx.com",
    domain: "modernatx.com",
    ticker: "MRNA",
    isDemoScenario: true,
  },
  {
    id: "acc_meridian",
    name: "KKR & Co.",
    industry: "Financial Services",
    segment: "Enterprise",
    hqLocation: "New York, NY",
    legalTeamSize: 75,
    trackable: true,
    linkedinSlug: "kkr",
    website: "kkr.com",
    domain: "kkr.com",
    ticker: "KKR",
    isDemoScenario: true,
  },
  {
    id: "acc_cobalt",
    name: "Stripe",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "South San Francisco, CA",
    legalTeamSize: 120,
    trackable: true,
    linkedinSlug: "stripe",
    website: "stripe.com",
    domain: "stripe.com",
    isDemoScenario: true,
  },
  {
    id: "acc_northwind",
    name: "ConocoPhillips",
    industry: "Energy",
    segment: "Enterprise",
    hqLocation: "Houston, TX",
    legalTeamSize: 90,
    trackable: true,
    linkedinSlug: "conocophillips",
    website: "conocophillips.com",
    domain: "conocophillips.com",
    ticker: "COP",
    isDemoScenario: true,
  },
  {
    id: "acc_helios",
    name: "UnitedHealth Group",
    industry: "Healthcare",
    segment: "Enterprise",
    hqLocation: "Minneapolis, MN",
    legalTeamSize: 150,
    trackable: true,
    linkedinSlug: "unitedhealth-group",
    website: "unitedhealthgroup.com",
    domain: "unitedhealthgroup.com",
    ticker: "UNH",
    isDemoScenario: true,
  },
  {
    id: "acc_sentinel",
    name: "CNA Financial",
    industry: "Insurance",
    segment: "Enterprise",
    hqLocation: "Chicago, IL",
    legalTeamSize: 60,
    trackable: true,
    linkedinSlug: "cna-financial",
    website: "cna.com",
    domain: "cna.com",
    ticker: "CNA",
    isDemoScenario: true,
  },
  {
    id: "acc_vector",
    name: "Boeing",
    industry: "Aerospace",
    segment: "Enterprise",
    hqLocation: "Arlington, VA",
    legalTeamSize: 200,
    trackable: true,
    linkedinSlug: "boeing",
    website: "boeing.com",
    domain: "boeing.com",
    ticker: "BA",
    isDemoScenario: true,
  },
  {
    id: "acc_atlas",
    name: "Snowflake",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "Bozeman, MT",
    legalTeamSize: 85,
    trackable: true,
    linkedinSlug: "snowflake-computing",
    website: "snowflake.com",
    domain: "snowflake.com",
    ticker: "SNOW",
    isDemoScenario: true,
  },
  {
    id: "acc_quantum",
    name: "UPS",
    industry: "Logistics",
    segment: "Enterprise",
    hqLocation: "Atlanta, GA",
    legalTeamSize: 50,
    trackable: true,
    linkedinSlug: "ups",
    website: "ups.com",
    domain: "ups.com",
    ticker: "UPS",
    isDemoScenario: true,
  },
  {
    id: "acc_horizon",
    name: "Atlassian",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "Sydney, AU / San Francisco, CA",
    legalTeamSize: 95,
    trackable: true,
    linkedinSlug: "atlassian",
    website: "atlassian.com",
    domain: "atlassian.com",
    ticker: "TEAM",
    isDemoScenario: true,
  },
  {
    id: "acc_stratos",
    name: "Civitas Resources",
    industry: "Energy",
    segment: "Mid-Market",
    hqLocation: "Denver, CO",
    legalTeamSize: 12,
    trackable: true,
    linkedinSlug: "civitas-resources",
    website: "civitasresources.com",
    domain: "civitasresources.com",
    ticker: "CIVI",
    isDemoScenario: true,
  },
];

// Contacts are the key data source for the signal engine. The PRESENCE or
// ABSENCE of contacts with specific roles drives the wedge signals (no Finance
// contact on an Evaluating+ deal = priority #4 violation). Names are
// fictional — real names would be PII and would scrape from the underlying
// company, which violates LinkedIn's TOS and breaks the rigged scenarios.
export const contacts: Contact[] = [
  // Moderna (Sara) — WEDGE: champion only, no Finance, no IT
  { id: "c_apex_1", accountId: "acc_apex", name: "Priya Raman", title: "Senior Counsel, Contracts", role: "Champion" },

  // KKR (Sara) — DEMO_SCENARIO_ACCOUNTS.watch. Selected Vendor: Champion +
  // GC (Legal role for SV Health) + Finance + Procurement. Missing the EB
  // and IT/Security roles → 3/5 committee coverage. Procurement is on the
  // OCR (suppresses SELECTED_VENDOR_NO_PROCUREMENT BLOCKING signal) but
  // doesn't count toward the 5-role SV Health coverage check.
  { id: "c_mer_1", accountId: "acc_meridian", name: "Daniel Cohen", title: "Director, Legal Operations", role: "Champion" },
  { id: "c_mer_2", accountId: "acc_meridian", name: "Janet Liu", title: "General Counsel", role: "GC" },
  { id: "c_mer_3", accountId: "acc_meridian", name: "Robert Park", title: "VP Finance", role: "Finance/CFO" },
  { id: "c_mer_4", accountId: "acc_meridian", name: "Anika Shah", title: "Procurement Manager", role: "Procurement" },

  // Stripe (Sara) — Qualified: champion identified, but no demo activity
  { id: "c_cob_1", accountId: "acc_cobalt", name: "Maya Patel", title: "Head of Legal", role: "Champion" },

  // ConocoPhillips (Sara) — Demo Sat: strong champion + Legal Ops + Procurement
  { id: "c_nw_1", accountId: "acc_northwind", name: "Charles Whitfield", title: "Deputy GC", role: "Champion" },
  { id: "c_nw_2", accountId: "acc_northwind", name: "Linda Park", title: "Legal Operations Manager", role: "Legal Ops" },
  { id: "c_nw_3", accountId: "acc_northwind", name: "Tom Ostrov", title: "Director of Procurement", role: "Procurement" },

  // UnitedHealth (Sara) — Evaluating + HEALTHY: champion, GC, Finance, IT all engaged
  { id: "c_hel_1", accountId: "acc_helios", name: "Rachel Nguyen", title: "Senior Counsel", role: "Champion" },
  { id: "c_hel_2", accountId: "acc_helios", name: "James Okafor", title: "General Counsel", role: "GC" },
  { id: "c_hel_3", accountId: "acc_helios", name: "Maria Santos", title: "CFO", role: "Finance/CFO" },
  { id: "c_hel_4", accountId: "acc_helios", name: "Kevin Wu", title: "Director of IT Security", role: "IT/Security" },

  // CNA (Sara) — DEMO_SCENARIO_ACCOUNTS.critical. The Helios worked example
  // from metrics.md, instantiated. Champion + Executive Sponsor only on the
  // opp's OCR (Finance c_sen_2 and Procurement c_sen_3 exist as account
  // contacts but are intentionally NOT attached to the opportunity — see
  // opp_sentinel.contactRoleIds below). Champion last touched 9 days ago,
  // Stage age 35 days, asset views fail (cfoLeaveBehind sent but unviewed),
  // → ~10/100 Critical when scored.
  { id: "c_sen_1", accountId: "acc_sentinel", name: "Amelia Hart", title: "Associate GC", role: "Champion" },
  { id: "c_sen_2", accountId: "acc_sentinel", name: "Greg Foster", title: "VP Finance", role: "Finance/CFO" },
  { id: "c_sen_3", accountId: "acc_sentinel", name: "Brian Tu", title: "Procurement Lead", role: "Procurement" },
  { id: "c_sen_4", accountId: "acc_sentinel", name: "Patricia Wells", title: "SVP Risk & Compliance", role: "Executive Sponsor" },

  // Boeing (Sara) — Evaluating: champion DEPARTED to a competitor (the worst-
  // case version of going dark). Detected via LinkedIn Sales Navigator alert.
  {
    id: "c_vec_1",
    accountId: "acc_vector",
    name: "Samuel Brooks",
    title: "Senior Legal Counsel",
    role: "Champion",
    status: "departed",
    departureNote: "LinkedIn updated 5/20: moved to Ironclad as Head of Legal. Ironclad was the competitor mentioned in the 5/9 call.",
  },
  { id: "c_vec_2", accountId: "acc_vector", name: "Helen Zhao", title: "Director, Legal Ops", role: "Legal Ops" },

  // Snowflake (Marcus) — DEMO_SCENARIO_ACCOUNTS.healthy. Selected Vendor with
  // all 5 SV Health committee roles engaged: Champion, Executive Sponsor (EB),
  // Finance, IT/Security, GC (Legal). Procurement also present but doesn't
  // count toward the 5-role coverage check. Targets score ~85 (Healthy).
  { id: "c_atl_1", accountId: "acc_atlas", name: "Roberto Diaz", title: "GC", role: "Champion" },
  { id: "c_atl_2", accountId: "acc_atlas", name: "Kim Andersson", title: "CFO", role: "Finance/CFO" },
  { id: "c_atl_3", accountId: "acc_atlas", name: "Marcus Lee", title: "Procurement Director", role: "Procurement" },
  { id: "c_atl_4", accountId: "acc_atlas", name: "Eleanor Bishop", title: "Chief Legal Officer", role: "GC" },
  { id: "c_atl_5", accountId: "acc_atlas", name: "Devon Pierce", title: "VP Information Security", role: "IT/Security" },
  { id: "c_atl_6", accountId: "acc_atlas", name: "Hiroshi Tanaka", title: "President, Data Cloud BU", role: "Executive Sponsor" },

  // UPS (Marcus) — Evaluating, SINGLE THREAD: only champion
  { id: "c_qua_1", accountId: "acc_quantum", name: "Yusuf Abadi", title: "Senior Counsel", role: "Champion" },

  // Atlassian (Jenna) — Contracting, healthy
  { id: "c_hor_1", accountId: "acc_horizon", name: "Diane Mercer", title: "Deputy GC", role: "Champion" },
  { id: "c_hor_2", accountId: "acc_horizon", name: "Frank Olson", title: "VP Legal", role: "GC" },
  { id: "c_hor_3", accountId: "acc_horizon", name: "Anita Krishnan", title: "Director Finance", role: "Finance/CFO" },
  { id: "c_hor_4", accountId: "acc_horizon", name: "Carlos Vega", title: "IT Security Manager", role: "IT/Security" },

  // Civitas (Jenna) — Qualified, stalled
  { id: "c_str_1", accountId: "acc_stratos", name: "Tracy Bell", title: "Legal Manager", role: "Champion" },
];

// Opportunities — engineered with deliberate stage-ages and contact attachments
// to exercise the signal engine. Each one is a "demo moment."
export const opportunities: Opportunity[] = [
  {
    id: "opp_apex",
    accountId: "acc_apex",
    name: "Moderna — Legal Service Hub",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 180000,
    enteredStageAt: "2026-04-26", // 25 days = past Evaluating benchmark of 21
    createdAt: "2026-02-18",
    closeDate: "2026-07-15",
    contactRoleIds: ["c_apex_1"],
  },
  {
    // DEMO_SCENARIO_ACCOUNTS.watch — target SV Health ~55 (At Risk).
    // 18d in Selected Vendor (just past visible-drift threshold but under
    // p75=30), Champion + GC + Finance + Procurement on OCR (3/5 SV Health
    // coverage; missing EB + IT/Security), 1/3 enablement assets shared,
    // Champion last touched 6d ago (drifting), no BLOCKING-tier signals
    // active.
    id: "opp_meridian",
    accountId: "acc_meridian",
    name: "KKR — Matter Management",
    ownerId: "rep_sc",
    stage: "Selected Vendor",
    amount: 240000,
    enteredStageAt: "2026-05-03",
    createdAt: "2026-01-12",
    closeDate: "2026-06-30",
    contactRoleIds: ["c_mer_1", "c_mer_2", "c_mer_3", "c_mer_4"],
    assetsShared: {
      cfoLeaveBehind: true,
      cfoLeaveBehindViewed: true,
      itZeroLift: false,
      financeBrief: false,
    },
  },
  {
    id: "opp_cobalt",
    accountId: "acc_cobalt",
    name: "Stripe — NDA Automation",
    ownerId: "rep_sc",
    stage: "Qualified",
    amount: 95000,
    enteredStageAt: "2026-05-09",
    createdAt: "2026-04-22",
    closeDate: "2026-08-10",
    contactRoleIds: ["c_cob_1"],
  },
  {
    id: "opp_northwind",
    accountId: "acc_northwind",
    name: "ConocoPhillips — Legal Service Hub",
    ownerId: "rep_sc",
    stage: "Demo Sat",
    amount: 310000,
    enteredStageAt: "2026-05-14",
    createdAt: "2026-03-08",
    closeDate: "2026-08-30",
    contactRoleIds: ["c_nw_1", "c_nw_2", "c_nw_3"],
  },
  {
    id: "opp_helios",
    accountId: "acc_helios",
    name: "UnitedHealth Group — Full Platform",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 145000,
    enteredStageAt: "2026-05-07",
    createdAt: "2026-03-21",
    closeDate: "2026-07-22",
    contactRoleIds: ["c_hel_1", "c_hel_2", "c_hel_3", "c_hel_4"],
  },
  {
    // DEMO_SCENARIO_ACCOUNTS.critical — the Helios worked example from
    // metrics.md, instantiated on CNA. Target SV Health ~10 (Critical).
    // - Stage age 35d (past p75=30) → time-in-stage component near 0
    // - OCR has Champion + Executive Sponsor (EB) + Procurement; Finance
    //   contact c_sen_2 deliberately dropped from contactRoleIds so the
    //   SELECTED_VENDOR_NO_FINANCE BLOCKING rule fires (the contact record
    //   itself remains on the account for the U4 "Why is X stalling?"
    //   citation chain to show "Finance exists at CNA but isn't on the deal")
    // - 1/3 enablement assets shared and cfoLeaveBehind was sent but never
    //   viewed (cfoLeaveBehindViewed: false) — the Helios failure mode
    // - Champion-disengagement correlation: 3 corroborating signals from
    //   Dock + Outreach + Gong (see demoSignals below)
    id: "opp_sentinel",
    accountId: "acc_sentinel",
    name: "CNA Financial — Workflow Automation",
    ownerId: "rep_sc",
    stage: "Selected Vendor",
    amount: 90000,
    enteredStageAt: "2026-04-16", // 35 days, way past benchmark
    createdAt: "2025-12-04",
    closeDate: "2026-06-05",
    contactRoleIds: ["c_sen_1", "c_sen_3", "c_sen_4"],
    assetsShared: {
      cfoLeaveBehind: true,
      cfoLeaveBehindViewed: false, // sent but never opened — the Helios kill
      itZeroLift: false,
      financeBrief: false,
    },
  },
  {
    id: "opp_vector",
    accountId: "acc_vector",
    name: "Boeing — Enterprise Deployment",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 400000,
    enteredStageAt: "2026-05-13",
    createdAt: "2026-02-02",
    closeDate: "2026-09-15",
    contactRoleIds: ["c_vec_1", "c_vec_2"],
  },
  {
    // DEMO_SCENARIO_ACCOUNTS.healthy — target SV Health ~85 (Healthy).
    // - 11d in Selected Vendor (well under p75=30) → time-in-stage ~63
    // - All 5 SV Health committee roles on OCR: Champion, EB, Finance,
    //   IT/Security, GC (Legal). Procurement is also present but doesn't
    //   count toward the 5-role check.
    // - All 3 enablement assets shared AND viewed by buyer-domain emails
    // - Champion last touched 2d ago (see Atlas activities below)
    // - No BLOCKING signals fire on this opp.
    id: "opp_atlas",
    accountId: "acc_atlas",
    name: "Snowflake — Contract Lifecycle",
    ownerId: "rep_mw",
    stage: "Selected Vendor",
    amount: 75000,
    enteredStageAt: "2026-05-10",
    createdAt: "2026-02-10",
    closeDate: "2026-06-22",
    contactRoleIds: ["c_atl_1", "c_atl_2", "c_atl_3", "c_atl_4", "c_atl_5", "c_atl_6"],
    assetsShared: {
      cfoLeaveBehind: true,
      cfoLeaveBehindViewed: true,
      itZeroLift: true,
      itZeroLiftViewed: true,
      financeBrief: true,
      financeBriefViewed: true,
    },
  },
  {
    id: "opp_quantum",
    accountId: "acc_quantum",
    name: "UPS — Matter Management",
    ownerId: "rep_mw",
    stage: "Evaluating",
    amount: 120000,
    enteredStageAt: "2026-05-06",
    createdAt: "2026-03-15",
    closeDate: "2026-08-01",
    contactRoleIds: ["c_qua_1"],
  },
  {
    id: "opp_horizon",
    accountId: "acc_horizon",
    name: "Atlassian — Full Platform",
    ownerId: "rep_jp",
    stage: "Contracting",
    amount: 200000,
    enteredStageAt: "2026-05-16",
    createdAt: "2026-01-28",
    closeDate: "2026-06-12",
    contactRoleIds: ["c_hor_1", "c_hor_2", "c_hor_3", "c_hor_4"],
  },
  {
    id: "opp_stratos",
    accountId: "acc_stratos",
    name: "Civitas Resources — NDA Automation",
    ownerId: "rep_jp",
    stage: "Qualified",
    amount: 60000,
    enteredStageAt: "2026-04-30", // 21 days, way past Qualified benchmark of 14
    createdAt: "2026-04-08",
    closeDate: "2026-07-31",
    contactRoleIds: ["c_str_1"],
  },
];

// Activities — recent enough to drive ghost/engagement signals. We focus on
// the last 14 days where signals decide what's "happening now."
export const activities: Activity[] = [
  // Moderna — quiet for 11 days (champion not ghosting but no momentum)
  { id: "a_apex_1", oppId: "opp_apex", contactId: "c_apex_1", type: "email_sent", occurredAt: "2026-05-10", summary: "Sent follow-up on POC scope" },
  { id: "a_apex_2", oppId: "opp_apex", contactId: "c_apex_1", type: "email_received", occurredAt: "2026-05-12", summary: "Priya confirmed POC continuing, asked about pricing model" },
  { id: "a_apex_3", oppId: "opp_apex", contactId: "c_apex_1", type: "dock_visit", occurredAt: "2026-05-15", summary: "Priya viewed pricing page (3 min)" },

  // KKR (DEMO_SCENARIO_ACCOUNTS.watch) — Finance conversation active but
  // champion drifting (last touch 6d ago = 2026-05-15). This puts champion
  // engagement just under the "ACTION-tier momentum_change" threshold without
  // tripping CHAMPION_GHOST (≥7d) BLOCKING.
  { id: "a_mer_1", oppId: "opp_meridian", contactId: "c_mer_3", type: "meeting", occurredAt: "2026-05-15", summary: "Finance review call with Robert Park (VP Finance) — 45 min" },
  { id: "a_mer_2", oppId: "opp_meridian", contactId: "c_mer_3", type: "email_received", occurredAt: "2026-05-17", summary: "Robert asked for revised TCO model" },
  { id: "a_mer_3", oppId: "opp_meridian", contactId: "c_mer_1", type: "dock_visit", occurredAt: "2026-05-15", summary: "Daniel reviewed security questionnaire (6d ago — last champion touch)" },

  // Stripe — booked, then quiet
  { id: "a_cob_1", oppId: "opp_cobalt", contactId: "c_cob_1", type: "call", occurredAt: "2026-05-09", summary: "Discovery call with Maya Patel" },
  { id: "a_cob_2", oppId: "opp_cobalt", contactId: "c_cob_1", type: "email_sent", occurredAt: "2026-05-11", summary: "Sent Chili Piper link for demo booking" },
  { id: "a_cob_3", oppId: "opp_cobalt", contactId: "c_cob_1", type: "email_sent", occurredAt: "2026-05-18", summary: "Follow-up nudge — demo still unbooked" },

  // ConocoPhillips — strong post-demo momentum, trial conversation starting
  { id: "a_nw_1", oppId: "opp_northwind", contactId: "c_nw_1", type: "meeting", occurredAt: "2026-05-14", summary: "Demo delivered — strong reception, asked about trial structure" },
  { id: "a_nw_2", oppId: "opp_northwind", contactId: "c_nw_2", type: "dock_visit", occurredAt: "2026-05-17", summary: "Linda spent 22 min in deal room, watched 2 customer story videos" },
  { id: "a_nw_3", oppId: "opp_northwind", contactId: "c_nw_1", type: "email_received", occurredAt: "2026-05-19", summary: "Charles asked: 'What does a POC look like for us?'" },

  // UnitedHealth — healthy, multithreaded, active
  { id: "a_hel_1", oppId: "opp_helios", contactId: "c_hel_3", type: "meeting", occurredAt: "2026-05-13", summary: "Finance brief delivered to CFO Maria Santos" },
  { id: "a_hel_2", oppId: "opp_helios", contactId: "c_hel_4", type: "meeting", occurredAt: "2026-05-15", summary: "IT/Security review with Kevin Wu — SSO + SOC2 walkthrough" },
  { id: "a_hel_3", oppId: "opp_helios", contactId: "c_hel_1", type: "dock_visit", occurredAt: "2026-05-19", summary: "Rachel logged in, downloaded ROI calculator" },
  { id: "a_hel_4", oppId: "opp_helios", contactId: "c_hel_2", type: "dock_visit", occurredAt: "2026-05-20", summary: "GC James Okafor reviewed contract terms section" },

  // CNA (DEMO_SCENARIO_ACCOUNTS.critical) — the Helios pattern. Finance
  // contact engaged early (a_sen_1 on 4/22) but never made it onto the opp's
  // OCR (see opp_sentinel.contactRoleIds). Champion last touched 9d ago
  // (a_sen_2 on 2026-05-12) — matches metrics.md worked example exactly.
  // The 5/14 outbound email doesn't count toward champion-touch math because
  // engagement is buyer-initiated.
  { id: "a_sen_1", oppId: "opp_sentinel", contactId: "c_sen_2", type: "meeting", occurredAt: "2026-04-22", summary: "Finance brief delivered to Greg Foster — strong response (but Finance never added to OCR)" },
  { id: "a_sen_2", oppId: "opp_sentinel", contactId: "c_sen_1", type: "email_received", occurredAt: "2026-05-12", summary: "Amelia: 'security team has questions about SSO setup' (last champion-initiated touch, 9d ago)" },
  { id: "a_sen_3", oppId: "opp_sentinel", contactId: "c_sen_1", type: "email_sent", occurredAt: "2026-05-14", summary: "Sent follow-up checking on security review status — no reply" },

  // Boeing — champion DEPARTED to competitor. The 12 days of silence is now
  // explained by the LinkedIn signal that landed yesterday.
  { id: "a_vec_1", oppId: "opp_vector", contactId: "c_vec_1", type: "meeting", occurredAt: "2026-05-09", summary: "Discovery + product walkthrough with Samuel Brooks" },
  { id: "a_vec_2", oppId: "opp_vector", contactId: "c_vec_1", type: "email_sent", occurredAt: "2026-05-13", summary: "Sent recap + next steps" },
  { id: "a_vec_3", oppId: "opp_vector", contactId: "c_vec_1", type: "email_sent", occurredAt: "2026-05-18", summary: "Follow-up — no response" },
  { id: "a_vec_4", oppId: "opp_vector", contactId: "c_vec_1", type: "external_signal", occurredAt: "2026-05-20", summary: "LinkedIn Sales Navigator alert: Samuel Brooks updated profile to 'Head of Legal @ Ironclad' — left Boeing. Ironclad is the competitor he mentioned on the 5/9 call." },

  // Snowflake (DEMO_SCENARIO_ACCOUNTS.healthy) — all 5 buying-committee
  // roles touched in the last 14d, Champion touched in last 2d. The
  // ChampionEngagement and CommitteeCoverage SV Health components both
  // score ~100 from this activity log.
  { id: "a_atl_1", oppId: "opp_atlas", contactId: "c_atl_2", type: "meeting", occurredAt: "2026-05-16", summary: "CFO Kim Andersson finance review — TCO approved" },
  { id: "a_atl_2", oppId: "opp_atlas", contactId: "c_atl_3", type: "email_received", occurredAt: "2026-05-18", summary: "Procurement: 'sending paperwork to legal'" },
  { id: "a_atl_3", oppId: "opp_atlas", contactId: "c_atl_5", type: "meeting", occurredAt: "2026-05-17", summary: "IT/Sec walkthrough with Devon Pierce — SOC2 + SSO signed off" },
  { id: "a_atl_4", oppId: "opp_atlas", contactId: "c_atl_4", type: "dock_visit", occurredAt: "2026-05-19", summary: "CLO Eleanor Bishop reviewed MSA + DPA in deal room (28 min)" },
  { id: "a_atl_5", oppId: "opp_atlas", contactId: "c_atl_6", type: "email_received", occurredAt: "2026-05-20", summary: "EB Hiroshi Tanaka: 'Approved. Ready to move on terms this week.'" },
  { id: "a_atl_6", oppId: "opp_atlas", contactId: "c_atl_1", type: "email_received", occurredAt: "2026-05-20", summary: "Champion Roberto Diaz: 'Forwarding to Anika in Procurement — let's hit signature by Friday.'" },

  // UPS — single-thread, champion responsive but alone
  { id: "a_qua_1", oppId: "opp_quantum", contactId: "c_qua_1", type: "call", occurredAt: "2026-05-15", summary: "Trial check-in with Yusuf — using daily" },
  { id: "a_qua_2", oppId: "opp_quantum", contactId: "c_qua_1", type: "dock_visit", occurredAt: "2026-05-19", summary: "Yusuf reviewed pricing" },

  // Atlassian — Contracting, legal review active
  { id: "a_hor_1", oppId: "opp_horizon", contactId: "c_hor_2", type: "email_received", occurredAt: "2026-05-18", summary: "GC Frank Olson: redlines on MSA section 7.3" },
  { id: "a_hor_2", oppId: "opp_horizon", contactId: "c_hor_4", type: "meeting", occurredAt: "2026-05-19", summary: "IT security: SSO setup confirmed, ready for signature" },

  // Civitas — stalled, single contact, no movement
  { id: "a_str_1", oppId: "opp_stratos", contactId: "c_str_1", type: "call", occurredAt: "2026-05-02", summary: "Discovery — Tracy is interested but unsure of budget process" },
  { id: "a_str_2", oppId: "opp_stratos", contactId: "c_str_1", type: "email_sent", occurredAt: "2026-05-11", summary: "Sent recap + pricing tiers" },
  // 19 days since last meaningful activity
];

// Gong-shaped call transcripts. The signal engine reasons over summary +
// riskFlags + a few representative excerpts (not full audio). This is how the
// LLM-based sentiment signal works in practice.
export const calls: CallTranscript[] = [
  {
    id: "call_vec_1",
    oppId: "opp_vector",
    callDate: "2026-05-09",
    durationMin: 47,
    attendees: ["Sara Chen", "c_vec_1", "c_vec_2"],
    summary:
      "Discovery + product walkthrough. Champion engaged on workflow automation but raised concerns about deployment timeline and pricing relative to incumbent (Onit). Mentioned that 'we're also looking at Ironclad' near the end. No clear next step locked in beyond 'we'll regroup internally.'",
    riskFlags: [
      "Competitor mentioned (Ironclad)",
      "Pricing concern unaddressed",
      "No firm next step",
    ],
    excerpts: [
      {
        speaker: "Samuel Brooks (Champion)",
        timestamp: "32:14",
        text: "Look — what you're showing is impressive, but I have to be straight: the price is higher than Onit and I haven't seen anything yet that would justify that to my CFO.",
      },
      {
        speaker: "Sara Chen",
        timestamp: "32:42",
        text: "Totally fair. Let me circle back with our team on the commercial side and put together a comparison for you.",
      },
      {
        speaker: "Samuel Brooks (Champion)",
        timestamp: "44:21",
        text: "Honestly, we're also taking a closer look at Ironclad. So let me regroup with my team and we'll figure out next steps.",
      },
    ],
  },
  {
    id: "call_nw_1",
    oppId: "opp_northwind",
    callDate: "2026-05-14",
    durationMin: 52,
    attendees: ["Sara Chen", "c_nw_1", "c_nw_2"],
    summary:
      "Demo delivered. Strong reception from both Charles (Deputy GC) and Linda (Legal Ops). Multiple buying signals: asked about trial structure, asked about implementation timeline, asked about other Energy references. Linda offered to introduce IT 'when we're ready.'",
    riskFlags: [],
    excerpts: [
      {
        speaker: "Charles Whitfield (Deputy GC)",
        timestamp: "41:08",
        text: "OK this is genuinely interesting. What would a proper trial look like for our team? I want to test this with real matters, not a sandbox.",
      },
      {
        speaker: "Linda Park (Legal Ops)",
        timestamp: "48:55",
        text: "I can loop in Tom from IT once we have the trial scoped — he's the one who needs to bless any new tool.",
      },
    ],
  },
  {
    id: "call_apex_1",
    oppId: "opp_apex",
    callDate: "2026-05-08",
    durationMin: 38,
    attendees: ["Sara Chen", "c_apex_1"],
    summary:
      "POC mid-check. Champion happy with workflow but flagged: 'we need to bring Finance in eventually and I'm not sure how to start that conversation.' Sara offered to send materials but didn't follow up with the Finance Meeting Brief.",
    riskFlags: ["Buyer explicitly flagged Finance engagement gap"],
    excerpts: [
      {
        speaker: "Priya Raman (Champion)",
        timestamp: "26:33",
        text: "I love what we're doing, but at some point I need to bring this to our CFO and I genuinely don't know how to frame it. Last vendor I tried this with, it died at that step.",
      },
      {
        speaker: "Sara Chen",
        timestamp: "27:04",
        text: "Yeah totally — let me send you something that helps with that conversation.",
      },
    ],
  },
  {
    id: "call_hel_1",
    oppId: "opp_helios",
    callDate: "2026-05-15",
    durationMin: 55,
    attendees: ["Sara Chen", "c_hel_4"],
    summary:
      "IT/Security review with Kevin Wu. Discussed SSO (Okta), SOC2 Type II, data residency, encryption at rest. Kevin was thorough but supportive. Committed to giving green-light by end of week pending the SOC2 report.",
    riskFlags: [],
    excerpts: [
      {
        speaker: "Kevin Wu (IT Security)",
        timestamp: "49:30",
        text: "This is one of the cleaner security reviews I've done this quarter. Send me the SOC2 and assuming nothing weird, I'll sign off Friday.",
      },
    ],
  },
];

// Asset deliveries — which standard plays have been deployed per deal.
// This is HOW we detect adoption gaps in priority #2 (Finance/IT package exists
// but AEs aren't using it consistently).
export const assetDeliveries: AssetDelivery[] = [
  // Moderna — no Finance brief delivered despite Priya explicitly asking
  { oppId: "opp_apex", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-30" },
  { oppId: "opp_apex", asset: "kpi_assessment", deliveredAt: "2026-05-01" },
  { oppId: "opp_apex", asset: "dock_room", deliveredAt: "2026-04-30" },
  // MISSING: finance_meeting_brief, cfo_leave_behind, it_zero_lift_one_pager

  // KKR — Finance engaged with brief, but Procurement assets not sent
  { oppId: "opp_meridian", asset: "outcome_first_trial_brief", deliveredAt: "2026-03-22" },
  { oppId: "opp_meridian", asset: "kpi_assessment", deliveredAt: "2026-03-25" },
  { oppId: "opp_meridian", asset: "pre_seeded_demo", deliveredAt: "2026-03-30" },
  { oppId: "opp_meridian", asset: "finance_meeting_brief", deliveredAt: "2026-05-15" },
  { oppId: "opp_meridian", asset: "cfo_leave_behind", deliveredAt: "2026-05-15" },
  { oppId: "opp_meridian", asset: "dock_room", deliveredAt: "2026-03-22" },

  // Stripe — only initial discovery sent, no trial brief or demo prep
  { oppId: "opp_cobalt", asset: "dock_room", deliveredAt: "2026-05-09" },

  // ConocoPhillips — Demo Sat, NO outcome-first trial brief yet — priority #1 violation
  { oppId: "opp_northwind", asset: "dock_room", deliveredAt: "2026-03-12" },

  // UnitedHealth — full play executed; gold standard
  { oppId: "opp_helios", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-10" },
  { oppId: "opp_helios", asset: "kpi_assessment", deliveredAt: "2026-04-12" },
  { oppId: "opp_helios", asset: "pre_seeded_demo", deliveredAt: "2026-04-18" },
  { oppId: "opp_helios", asset: "finance_meeting_brief", deliveredAt: "2026-05-13" },
  { oppId: "opp_helios", asset: "cfo_leave_behind", deliveredAt: "2026-05-13" },
  { oppId: "opp_helios", asset: "it_zero_lift_one_pager", deliveredAt: "2026-05-15" },
  { oppId: "opp_helios", asset: "dock_room", deliveredAt: "2026-04-10" },

  // CNA — Finance brief sent but IT brief never followed
  { oppId: "opp_sentinel", asset: "outcome_first_trial_brief", deliveredAt: "2026-01-20" },
  { oppId: "opp_sentinel", asset: "kpi_assessment", deliveredAt: "2026-01-25" },
  { oppId: "opp_sentinel", asset: "finance_meeting_brief", deliveredAt: "2026-04-22" },
  { oppId: "opp_sentinel", asset: "cfo_leave_behind", deliveredAt: "2026-04-22" },
  { oppId: "opp_sentinel", asset: "dock_room", deliveredAt: "2026-01-20" },
  // MISSING: it_zero_lift_one_pager — the asset that would unblock this deal

  // Boeing — outcome-first trial brief sent, but champion went dark before Finance touch
  { oppId: "opp_vector", asset: "outcome_first_trial_brief", deliveredAt: "2026-05-05" },
  { oppId: "opp_vector", asset: "kpi_assessment", deliveredAt: "2026-05-07" },
  { oppId: "opp_vector", asset: "dock_room", deliveredAt: "2026-05-05" },

  // Snowflake — full play executed
  { oppId: "opp_atlas", asset: "outcome_first_trial_brief", deliveredAt: "2026-03-01" },
  { oppId: "opp_atlas", asset: "kpi_assessment", deliveredAt: "2026-03-05" },
  { oppId: "opp_atlas", asset: "finance_meeting_brief", deliveredAt: "2026-05-05" },
  { oppId: "opp_atlas", asset: "cfo_leave_behind", deliveredAt: "2026-05-05" },
  { oppId: "opp_atlas", asset: "it_zero_lift_one_pager", deliveredAt: "2026-05-08" },
  { oppId: "opp_atlas", asset: "dock_room", deliveredAt: "2026-03-01" },

  // UPS — only trial brief sent
  { oppId: "opp_quantum", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-15" },
  { oppId: "opp_quantum", asset: "kpi_assessment", deliveredAt: "2026-04-20" },
  { oppId: "opp_quantum", asset: "dock_room", deliveredAt: "2026-04-15" },

  // Atlassian — full execution all the way to Contracting
  { oppId: "opp_horizon", asset: "outcome_first_trial_brief", deliveredAt: "2026-02-15" },
  { oppId: "opp_horizon", asset: "kpi_assessment", deliveredAt: "2026-02-20" },
  { oppId: "opp_horizon", asset: "pre_seeded_demo", deliveredAt: "2026-02-25" },
  { oppId: "opp_horizon", asset: "finance_meeting_brief", deliveredAt: "2026-04-12" },
  { oppId: "opp_horizon", asset: "cfo_leave_behind", deliveredAt: "2026-04-12" },
  { oppId: "opp_horizon", asset: "it_zero_lift_one_pager", deliveredAt: "2026-04-25" },
  { oppId: "opp_horizon", asset: "dock_room", deliveredAt: "2026-02-15" },

  // Civitas — early stage, just initial materials
  { oppId: "opp_stratos", asset: "dock_room", deliveredAt: "2026-04-30" },
];

// ---------------------------------------------------------------------------
// demoSignals — pre-computed signals representing cross-source observations
// that the deterministic in-memory rule engine doesn't (yet) detect on its
// own. The rule engine in signal-engine.ts reads structured CRM state
// (contacts, activities, deliveries) and emits the rule-driven signals; these
// represent the OTHER half of the synthesis-md taxonomy — buyer-side
// engagement telemetry that would arrive from Dock / Outreach / Gong / Granola
// adapters in production, carrying source_tool + source_event_id per
// BUILD_ALIGNMENT principle #6 (evidence chain mandatory).
//
// In production these would land in `signal_instances` from real webhooks;
// here they're hand-authored so the three DEMO_SCENARIO_ACCOUNTS scenarios
// render the expected SV Health tiers without depending on adapter live-ness.
//
// Every signal here is labeled with one of the canonical 12 signalType
// values, severity from the 3-tier set, and source attribution for citation.
// ---------------------------------------------------------------------------
export const demoSignals: Signal[] = [
  // ── Healthy (Snowflake / opp_atlas) ──────────────────────────────────────
  // Two positive-direction signals showing committee filling out + momentum
  // committing. Per the existing convention (types.ts §SignalType comment),
  // polarity is in the title/body wording rather than a field on Signal.
  {
    id: "demo_atl_1",
    ruleId: "DEMO_COMMITTEE_EXPANSION",
    oppId: "opp_atlas",
    severity: "awareness",
    signalType: "committee_expansion",
    title: "EB Hiroshi Tanaka engaged on the deal",
    body: "Executive Sponsor (BU President) replied 'approved, let's move on terms' — fifth distinct committee role now active on this opportunity.",
    suggestedAction: "Loop EB into the contracts kickoff call this week so signature isn't gated on a re-intro.",
    detectedAt: "2026-05-20T16:12:00Z",
    sourceTool: "outreach",
    sourceEventId: "outreach_mailing_reply_atl_eb_5212",
  },
  {
    id: "demo_atl_2",
    ruleId: "DEMO_NEXT_STEP_COMMITTED",
    oppId: "opp_atlas",
    severity: "awareness",
    // Positive next-step commitment is momentum_change with positive
    // direction per synthesis.md §1 — direction lives in the persistent
    // schema, not on in-memory Signal.
    signalType: "momentum_change",
    title: "Champion committed signature by Friday",
    body: "Roberto Diaz (Champion) forwarded MSA to Procurement and named Friday as the signature target. Granola call summary corroborates verbal commitment.",
    suggestedAction: "Confirm Friday slot on calendar with Procurement + Legal today.",
    detectedAt: "2026-05-20T18:04:00Z",
    sourceTool: "granola",
    sourceEventId: "granola_meeting_atl_20260520",
  },

  // ── Watch (KKR / opp_meridian) ───────────────────────────────────────────
  // One ACTION-tier momentum_change showing visible drift without crossing
  // into BLOCKING territory. No champion-disengagement correlation yet.
  {
    id: "demo_mer_1",
    ruleId: "DEMO_DECISION_CRITERIA_STALE",
    oppId: "opp_meridian",
    severity: "action",
    signalType: "momentum_change",
    title: "Decision Criteria field stale 8 days",
    body: "Salesforce Decision Criteria custom field hasn't been updated in 8 days despite Robert Park (Finance) asking for a revised TCO model on 5/17. Deal is 18d in Selected Vendor — drift is visible.",
    suggestedAction: "Update Decision Criteria with TCO model status today; schedule 15-min sync with Daniel to confirm IT and EB intros.",
    detectedAt: "2026-05-21T08:30:00Z",
    sourceTool: "salesforce",
    sourceEventId: "sfdc_field_history_opp_meridian_dc_20260513",
  },

  // ── Critical (CNA Financial / opp_sentinel) ──────────────────────────────
  // Three corroborating signals from Dock + Outreach + Gong, all observing
  // champion-disengagement on the same opportunity within the 14-day
  // correlation window. Per synthesis.md §6, a correlation with ≥3 source
  // tools agreeing produces a strong-confidence cross-source signal — this
  // is what makes the U4 "Why is CNA stalling?" answer load-bearing.
  // Plus one BLOCKING-tier signal so the risk-correlation penalty fires
  // (-20pts on the SV Health Score per metrics.md §"Risk-correlation
  // penalty"). The deterministic engine separately emits
  // SELECTED_VENDOR_NO_FINANCE (BLOCKING) and CHAMPION_GHOST (BLOCKING) on
  // this opp — those drive the rule-based portion; demoSignals cover the
  // cross-source corroboration the engine doesn't compute today.
  {
    id: "demo_sen_1",
    ruleId: "DEMO_CHAMPION_DISENGAGEMENT_DOCK",
    oppId: "opp_sentinel",
    severity: "action",
    signalType: "champion_disengagement",
    title: "Amelia Hart (Champion) — last Dock visit 11 days ago",
    body: "Champion's deal-room visit cadence dropped from 2x/week to zero. CFO Leave-Behind asset was sent but never opened by anyone at cna.com.",
    suggestedAction: "Send low-pressure check-in: 'should I pause outreach or keep pushing?'",
    detectedAt: "2026-05-21T07:10:00Z",
    sourceTool: "dock",
    sourceEventId: "dock_room_visit_history_sen_20260510",
  },
  {
    id: "demo_sen_2",
    ruleId: "DEMO_CHAMPION_DISENGAGEMENT_OUTREACH",
    oppId: "opp_sentinel",
    severity: "action",
    signalType: "champion_disengagement",
    title: "Outreach reply latency on Amelia Hart climbed past 7d",
    body: "Reply-latency baseline of 36h has decayed to 7d+ over the last three sequences. The 5/14 follow-up is unanswered.",
    suggestedAction: "Pause sequence and try a different channel (LinkedIn DM or text intro from Patricia Wells, the EB).",
    detectedAt: "2026-05-21T07:11:00Z",
    sourceTool: "outreach",
    sourceEventId: "outreach_reply_decay_amelia_sen_20260521",
  },
  {
    id: "demo_sen_3",
    ruleId: "DEMO_CHAMPION_DISENGAGEMENT_GONG",
    oppId: "opp_sentinel",
    severity: "action",
    signalType: "champion_disengagement",
    title: "No champion-attended call in 14d",
    body: "Last Gong call with Amelia was 5/07. Two subsequent invitations were declined without reschedule.",
    suggestedAction: "Have Marcus (the manager) make a peer-level check-in call to validate champion status.",
    detectedAt: "2026-05-21T07:12:00Z",
    sourceTool: "gong",
    sourceEventId: "gong_call_attendance_sen_20260507_to_20260521",
  },
  {
    id: "demo_sen_4",
    ruleId: "DEMO_BUDGET_RISK_CONFIRMED",
    oppId: "opp_sentinel",
    severity: "blocking",
    // Champion-disengagement + missing Finance role + asset never viewed
    // is the textbook "deal dying at the budget gate" pattern — synthesis
    // maps this composite to champion_loss (one rung above disengagement)
    // once the correlation is strong enough. The 3 demo_sen_1..3 signals
    // above are the corroborating evidence; this is the rolled-up
    // BLOCKING-tier signal that triggers the risk-correlation penalty
    // (metrics.md §"Risk-correlation penalty").
    signalType: "champion_loss",
    title: "Budget gate stall: 3 sources agree champion has disengaged",
    body: "Dock (visit drop-off), Outreach (reply decay), and Gong (no-attendance) corroborate champion disengagement over the last 14d. CFO Leave-Behind sent but unopened. Finance not on OCR. This deal will close-lose without intervention.",
    suggestedAction: "Open Champion-Departure / Save-Play playbook today. Manager (David Reyes) should make peer call by EOW.",
    detectedAt: "2026-05-21T07:15:00Z",
    sourceTool: "intel",
    sourceEventId: "correlation_champion_disengagement_opp_sentinel_20260521",
    playbookId: "champion-departure",
  },
];
