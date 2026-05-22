import type {
  Account,
  Activity,
  AssetDelivery,
  CallTranscript,
  Contact,
  Opportunity,
  Rep,
} from "@/lib/types";

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

export const accounts: Account[] = [
  {
    id: "acc_apex",
    name: "Apex Pharmaceuticals",
    industry: "Pharma",
    segment: "Enterprise",
    hqLocation: "Boston, MA",
    legalTeamSize: 42,
  },
  {
    id: "acc_meridian",
    name: "Meridian Capital Partners",
    industry: "Financial Services",
    segment: "Enterprise",
    hqLocation: "New York, NY",
    legalTeamSize: 28,
  },
  {
    id: "acc_cobalt",
    name: "Stripe",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "South San Francisco, CA",
    legalTeamSize: 120,
    trackable: true,
  },
  {
    id: "acc_northwind",
    name: "Northwind Energy",
    industry: "Energy",
    segment: "Enterprise",
    hqLocation: "Houston, TX",
    legalTeamSize: 35,
  },
  {
    id: "acc_helios",
    name: "Helios Healthcare",
    industry: "Healthcare",
    segment: "Enterprise",
    hqLocation: "Minneapolis, MN",
    legalTeamSize: 51,
  },
  {
    id: "acc_sentinel",
    name: "Sentinel Insurance Group",
    industry: "Insurance",
    segment: "Enterprise",
    hqLocation: "Chicago, IL",
    legalTeamSize: 22,
  },
  {
    id: "acc_vector",
    name: "Vector Aerospace",
    industry: "Aerospace",
    segment: "Enterprise",
    hqLocation: "Seattle, WA",
    legalTeamSize: 67,
  },
  {
    id: "acc_atlas",
    name: "Snowflake",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "Bozeman, MT",
    legalTeamSize: 85,
    trackable: true,
  },
  {
    id: "acc_quantum",
    name: "Quantum Logistics",
    industry: "Logistics",
    segment: "Enterprise",
    hqLocation: "Atlanta, GA",
    legalTeamSize: 16,
  },
  {
    id: "acc_horizon",
    name: "Atlassian",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "Sydney, AU / San Francisco, CA",
    legalTeamSize: 95,
    trackable: true,
  },
  {
    id: "acc_stratos",
    name: "Stratos Energy Solutions",
    industry: "Energy",
    segment: "Mid-Market",
    hqLocation: "Denver, CO",
    legalTeamSize: 7,
  },
];

// Contacts are the key data source for the signal engine. The PRESENCE or
// ABSENCE of contacts with specific roles drives the wedge signals (no Finance
// contact on an Evaluating+ deal = priority #4 violation).
export const contacts: Contact[] = [
  // Apex (Sara) — WEDGE: champion only, no Finance, no IT
  { id: "c_apex_1", accountId: "acc_apex", name: "Priya Raman", title: "Senior Counsel, Contracts", role: "Champion" },

  // Meridian (Sara) — Selected Vendor: champion + GC + Finance, but no Procurement
  { id: "c_mer_1", accountId: "acc_meridian", name: "Daniel Cohen", title: "Director, Legal Operations", role: "Champion" },
  { id: "c_mer_2", accountId: "acc_meridian", name: "Janet Liu", title: "General Counsel", role: "GC" },
  { id: "c_mer_3", accountId: "acc_meridian", name: "Robert Park", title: "VP Finance", role: "Finance/CFO" },

  // Cobalt (Sara) — Qualified: champion identified, but no demo activity
  { id: "c_cob_1", accountId: "acc_cobalt", name: "Maya Patel", title: "Head of Legal", role: "Champion" },

  // Northwind (Sara) — Demo Sat: strong champion + Legal Ops + early Finance touch
  { id: "c_nw_1", accountId: "acc_northwind", name: "Charles Whitfield", title: "Deputy GC", role: "Champion" },
  { id: "c_nw_2", accountId: "acc_northwind", name: "Linda Park", title: "Legal Operations Manager", role: "Legal Ops" },
  { id: "c_nw_3", accountId: "acc_northwind", name: "Tom Ostrov", title: "Director of Procurement", role: "Procurement" },

  // Helios (Sara) — Evaluating + HEALTHY: champion, GC, Finance, IT all engaged
  { id: "c_hel_1", accountId: "acc_helios", name: "Rachel Nguyen", title: "Senior Counsel", role: "Champion" },
  { id: "c_hel_2", accountId: "acc_helios", name: "James Okafor", title: "General Counsel", role: "GC" },
  { id: "c_hel_3", accountId: "acc_helios", name: "Maria Santos", title: "CFO", role: "Finance/CFO" },
  { id: "c_hel_4", accountId: "acc_helios", name: "Kevin Wu", title: "Director of IT Security", role: "IT/Security" },

  // Sentinel (Sara) — Selected Vendor stalled: Finance engaged, IT brief never sent
  { id: "c_sen_1", accountId: "acc_sentinel", name: "Amelia Hart", title: "Associate GC", role: "Champion" },
  { id: "c_sen_2", accountId: "acc_sentinel", name: "Greg Foster", title: "VP Finance", role: "Finance/CFO" },
  { id: "c_sen_3", accountId: "acc_sentinel", name: "Brian Tu", title: "Procurement Lead", role: "Procurement" },

  // Vector (Sara) — Evaluating: champion DEPARTED to a competitor (the worst-
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

  // Atlas (Marcus) — Selected Vendor, healthy
  { id: "c_atl_1", accountId: "acc_atlas", name: "Roberto Diaz", title: "GC", role: "Champion" },
  { id: "c_atl_2", accountId: "acc_atlas", name: "Kim Andersson", title: "CFO", role: "Finance/CFO" },
  { id: "c_atl_3", accountId: "acc_atlas", name: "Marcus Lee", title: "Procurement Director", role: "Procurement" },

  // Quantum (Marcus) — Evaluating, SINGLE THREAD: only champion
  { id: "c_qua_1", accountId: "acc_quantum", name: "Yusuf Abadi", title: "Senior Counsel", role: "Champion" },

  // Horizon (Jenna) — Contracting, healthy
  { id: "c_hor_1", accountId: "acc_horizon", name: "Diane Mercer", title: "Deputy GC", role: "Champion" },
  { id: "c_hor_2", accountId: "acc_horizon", name: "Frank Olson", title: "VP Legal", role: "GC" },
  { id: "c_hor_3", accountId: "acc_horizon", name: "Anita Krishnan", title: "Director Finance", role: "Finance/CFO" },
  { id: "c_hor_4", accountId: "acc_horizon", name: "Carlos Vega", title: "IT Security Manager", role: "IT/Security" },

  // Stratos (Jenna) — Qualified, stalled
  { id: "c_str_1", accountId: "acc_stratos", name: "Tracy Bell", title: "Legal Manager", role: "Champion" },
];

// Opportunities — engineered with deliberate stage-ages and contact attachments
// to exercise the signal engine. Each one is a "demo moment."
export const opportunities: Opportunity[] = [
  {
    id: "opp_apex",
    accountId: "acc_apex",
    name: "Apex Pharmaceuticals — Legal Service Hub",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 180000,
    enteredStageAt: "2026-04-26", // 25 days = past Evaluating benchmark of 21
    createdAt: "2026-02-18",
    closeDate: "2026-07-15",
    contactRoleIds: ["c_apex_1"],
  },
  {
    id: "opp_meridian",
    accountId: "acc_meridian",
    name: "Meridian Capital — Matter Management",
    ownerId: "rep_sc",
    stage: "Selected Vendor",
    amount: 240000,
    enteredStageAt: "2026-05-03",
    createdAt: "2026-01-12",
    closeDate: "2026-06-30",
    contactRoleIds: ["c_mer_1", "c_mer_2", "c_mer_3"],
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
    name: "Northwind Energy — Legal Service Hub",
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
    name: "Helios Healthcare — Full Platform",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 145000,
    enteredStageAt: "2026-05-07",
    createdAt: "2026-03-21",
    closeDate: "2026-07-22",
    contactRoleIds: ["c_hel_1", "c_hel_2", "c_hel_3", "c_hel_4"],
  },
  {
    id: "opp_sentinel",
    accountId: "acc_sentinel",
    name: "Sentinel Insurance — Workflow Automation",
    ownerId: "rep_sc",
    stage: "Selected Vendor",
    amount: 90000,
    enteredStageAt: "2026-04-16", // 35 days, way past benchmark
    createdAt: "2025-12-04",
    closeDate: "2026-06-05",
    contactRoleIds: ["c_sen_1", "c_sen_2", "c_sen_3"],
  },
  {
    id: "opp_vector",
    accountId: "acc_vector",
    name: "Vector Aerospace — Enterprise Deployment",
    ownerId: "rep_sc",
    stage: "Evaluating",
    amount: 400000,
    enteredStageAt: "2026-05-13",
    createdAt: "2026-02-02",
    closeDate: "2026-09-15",
    contactRoleIds: ["c_vec_1", "c_vec_2"],
  },
  {
    id: "opp_atlas",
    accountId: "acc_atlas",
    name: "Snowflake — Contract Lifecycle",
    ownerId: "rep_mw",
    stage: "Selected Vendor",
    amount: 75000,
    enteredStageAt: "2026-04-29",
    createdAt: "2026-02-10",
    closeDate: "2026-06-22",
    contactRoleIds: ["c_atl_1", "c_atl_2", "c_atl_3"],
  },
  {
    id: "opp_quantum",
    accountId: "acc_quantum",
    name: "Quantum Logistics — Matter Management",
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
    name: "Stratos Energy — NDA Automation",
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
  // Apex — quiet for 11 days (champion not ghosting but no momentum)
  { id: "a_apex_1", oppId: "opp_apex", contactId: "c_apex_1", type: "email_sent", occurredAt: "2026-05-10", summary: "Sent follow-up on POC scope" },
  { id: "a_apex_2", oppId: "opp_apex", contactId: "c_apex_1", type: "email_received", occurredAt: "2026-05-12", summary: "Priya confirmed POC continuing, asked about pricing model" },
  { id: "a_apex_3", oppId: "opp_apex", contactId: "c_apex_1", type: "dock_visit", occurredAt: "2026-05-15", summary: "Priya viewed pricing page (3 min)" },

  // Meridian — active Finance conversation but procurement not introduced
  { id: "a_mer_1", oppId: "opp_meridian", contactId: "c_mer_3", type: "meeting", occurredAt: "2026-05-15", summary: "Finance review call with Robert Park (VP Finance) — 45 min" },
  { id: "a_mer_2", oppId: "opp_meridian", contactId: "c_mer_3", type: "email_received", occurredAt: "2026-05-17", summary: "Robert asked for revised TCO model" },
  { id: "a_mer_3", oppId: "opp_meridian", contactId: "c_mer_1", type: "dock_visit", occurredAt: "2026-05-19", summary: "Daniel reviewed security questionnaire" },

  // Cobalt — booked, then quiet
  { id: "a_cob_1", oppId: "opp_cobalt", contactId: "c_cob_1", type: "call", occurredAt: "2026-05-09", summary: "Discovery call with Maya Patel" },
  { id: "a_cob_2", oppId: "opp_cobalt", contactId: "c_cob_1", type: "email_sent", occurredAt: "2026-05-11", summary: "Sent Chili Piper link for demo booking" },
  { id: "a_cob_3", oppId: "opp_cobalt", contactId: "c_cob_1", type: "email_sent", occurredAt: "2026-05-18", summary: "Follow-up nudge — demo still unbooked" },

  // Northwind — strong post-demo momentum, trial conversation starting
  { id: "a_nw_1", oppId: "opp_northwind", contactId: "c_nw_1", type: "meeting", occurredAt: "2026-05-14", summary: "Demo delivered — strong reception, asked about trial structure" },
  { id: "a_nw_2", oppId: "opp_northwind", contactId: "c_nw_2", type: "dock_visit", occurredAt: "2026-05-17", summary: "Linda spent 22 min in deal room, watched 2 customer story videos" },
  { id: "a_nw_3", oppId: "opp_northwind", contactId: "c_nw_1", type: "email_received", occurredAt: "2026-05-19", summary: "Charles asked: 'What does a POC look like for us?'" },

  // Helios — healthy, multithreaded, active
  { id: "a_hel_1", oppId: "opp_helios", contactId: "c_hel_3", type: "meeting", occurredAt: "2026-05-13", summary: "Finance brief delivered to CFO Maria Santos" },
  { id: "a_hel_2", oppId: "opp_helios", contactId: "c_hel_4", type: "meeting", occurredAt: "2026-05-15", summary: "IT/Security review with Kevin Wu — SSO + SOC2 walkthrough" },
  { id: "a_hel_3", oppId: "opp_helios", contactId: "c_hel_1", type: "dock_visit", occurredAt: "2026-05-19", summary: "Rachel logged in, downloaded ROI calculator" },
  { id: "a_hel_4", oppId: "opp_helios", contactId: "c_hel_2", type: "dock_visit", occurredAt: "2026-05-20", summary: "GC James Okafor reviewed contract terms section" },

  // Sentinel — IT brief never sent, deal stalled
  { id: "a_sen_1", oppId: "opp_sentinel", contactId: "c_sen_2", type: "meeting", occurredAt: "2026-04-22", summary: "Finance brief delivered to Greg Foster — strong response" },
  { id: "a_sen_2", oppId: "opp_sentinel", contactId: "c_sen_1", type: "email_received", occurredAt: "2026-05-04", summary: "Amelia: 'security team has questions about SSO setup'" },
  { id: "a_sen_3", oppId: "opp_sentinel", contactId: "c_sen_1", type: "email_sent", occurredAt: "2026-05-12", summary: "Sent follow-up checking on security review status" },

  // Vector — champion DEPARTED to competitor. The 12 days of silence is now
  // explained by the LinkedIn signal that landed yesterday.
  { id: "a_vec_1", oppId: "opp_vector", contactId: "c_vec_1", type: "meeting", occurredAt: "2026-05-09", summary: "Discovery + product walkthrough with Samuel Brooks" },
  { id: "a_vec_2", oppId: "opp_vector", contactId: "c_vec_1", type: "email_sent", occurredAt: "2026-05-13", summary: "Sent recap + next steps" },
  { id: "a_vec_3", oppId: "opp_vector", contactId: "c_vec_1", type: "email_sent", occurredAt: "2026-05-18", summary: "Follow-up — no response" },
  { id: "a_vec_4", oppId: "opp_vector", contactId: "c_vec_1", type: "external_signal", occurredAt: "2026-05-20", summary: "LinkedIn Sales Navigator alert: Samuel Brooks updated profile to 'Head of Legal @ Ironclad' — left Vector Aerospace. Ironclad is the competitor he mentioned on the 5/9 call." },

  // Atlas — multithreaded, healthy
  { id: "a_atl_1", oppId: "opp_atlas", contactId: "c_atl_2", type: "meeting", occurredAt: "2026-05-16", summary: "CFO Kim Andersson finance review — TCO approved" },
  { id: "a_atl_2", oppId: "opp_atlas", contactId: "c_atl_3", type: "email_received", occurredAt: "2026-05-18", summary: "Procurement: 'sending paperwork to legal'" },

  // Quantum — single-thread, champion responsive but alone
  { id: "a_qua_1", oppId: "opp_quantum", contactId: "c_qua_1", type: "call", occurredAt: "2026-05-15", summary: "Trial check-in with Yusuf — using daily" },
  { id: "a_qua_2", oppId: "opp_quantum", contactId: "c_qua_1", type: "dock_visit", occurredAt: "2026-05-19", summary: "Yusuf reviewed pricing" },

  // Horizon — Contracting, legal review active
  { id: "a_hor_1", oppId: "opp_horizon", contactId: "c_hor_2", type: "email_received", occurredAt: "2026-05-18", summary: "GC Frank Olson: redlines on MSA section 7.3" },
  { id: "a_hor_2", oppId: "opp_horizon", contactId: "c_hor_4", type: "meeting", occurredAt: "2026-05-19", summary: "IT security: SSO setup confirmed, ready for signature" },

  // Stratos — stalled, single contact, no movement
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
      "Demo delivered. Strong reception from both Charles (Deputy GC) and Linda (Legal Ops). Multiple buying signals: asked about trial structure, asked about implementation timeline, asked about other Pharma references. Linda offered to introduce IT 'when we're ready.'",
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
  // Apex — no Finance brief delivered despite Priya explicitly asking
  { oppId: "opp_apex", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-30" },
  { oppId: "opp_apex", asset: "kpi_assessment", deliveredAt: "2026-05-01" },
  { oppId: "opp_apex", asset: "dock_room", deliveredAt: "2026-04-30" },
  // MISSING: finance_meeting_brief, cfo_leave_behind, it_zero_lift_one_pager

  // Meridian — Finance engaged with brief, but Procurement assets not sent
  { oppId: "opp_meridian", asset: "outcome_first_trial_brief", deliveredAt: "2026-03-22" },
  { oppId: "opp_meridian", asset: "kpi_assessment", deliveredAt: "2026-03-25" },
  { oppId: "opp_meridian", asset: "pre_seeded_demo", deliveredAt: "2026-03-30" },
  { oppId: "opp_meridian", asset: "finance_meeting_brief", deliveredAt: "2026-05-15" },
  { oppId: "opp_meridian", asset: "cfo_leave_behind", deliveredAt: "2026-05-15" },
  { oppId: "opp_meridian", asset: "dock_room", deliveredAt: "2026-03-22" },

  // Cobalt — only initial discovery sent, no trial brief or demo prep
  { oppId: "opp_cobalt", asset: "dock_room", deliveredAt: "2026-05-09" },

  // Northwind — Demo Sat, NO outcome-first trial brief yet — priority #1 violation
  { oppId: "opp_northwind", asset: "dock_room", deliveredAt: "2026-03-12" },

  // Helios — full play executed; gold standard
  { oppId: "opp_helios", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-10" },
  { oppId: "opp_helios", asset: "kpi_assessment", deliveredAt: "2026-04-12" },
  { oppId: "opp_helios", asset: "pre_seeded_demo", deliveredAt: "2026-04-18" },
  { oppId: "opp_helios", asset: "finance_meeting_brief", deliveredAt: "2026-05-13" },
  { oppId: "opp_helios", asset: "cfo_leave_behind", deliveredAt: "2026-05-13" },
  { oppId: "opp_helios", asset: "it_zero_lift_one_pager", deliveredAt: "2026-05-15" },
  { oppId: "opp_helios", asset: "dock_room", deliveredAt: "2026-04-10" },

  // Sentinel — Finance brief sent but IT brief never followed
  { oppId: "opp_sentinel", asset: "outcome_first_trial_brief", deliveredAt: "2026-01-20" },
  { oppId: "opp_sentinel", asset: "kpi_assessment", deliveredAt: "2026-01-25" },
  { oppId: "opp_sentinel", asset: "finance_meeting_brief", deliveredAt: "2026-04-22" },
  { oppId: "opp_sentinel", asset: "cfo_leave_behind", deliveredAt: "2026-04-22" },
  { oppId: "opp_sentinel", asset: "dock_room", deliveredAt: "2026-01-20" },
  // MISSING: it_zero_lift_one_pager — the asset that would unblock this deal

  // Vector — outcome-first trial brief sent, but champion went dark before Finance touch
  { oppId: "opp_vector", asset: "outcome_first_trial_brief", deliveredAt: "2026-05-05" },
  { oppId: "opp_vector", asset: "kpi_assessment", deliveredAt: "2026-05-07" },
  { oppId: "opp_vector", asset: "dock_room", deliveredAt: "2026-05-05" },

  // Atlas — full play executed
  { oppId: "opp_atlas", asset: "outcome_first_trial_brief", deliveredAt: "2026-03-01" },
  { oppId: "opp_atlas", asset: "kpi_assessment", deliveredAt: "2026-03-05" },
  { oppId: "opp_atlas", asset: "finance_meeting_brief", deliveredAt: "2026-05-05" },
  { oppId: "opp_atlas", asset: "cfo_leave_behind", deliveredAt: "2026-05-05" },
  { oppId: "opp_atlas", asset: "it_zero_lift_one_pager", deliveredAt: "2026-05-08" },
  { oppId: "opp_atlas", asset: "dock_room", deliveredAt: "2026-03-01" },

  // Quantum — only trial brief sent
  { oppId: "opp_quantum", asset: "outcome_first_trial_brief", deliveredAt: "2026-04-15" },
  { oppId: "opp_quantum", asset: "kpi_assessment", deliveredAt: "2026-04-20" },
  { oppId: "opp_quantum", asset: "dock_room", deliveredAt: "2026-04-15" },

  // Horizon — full execution all the way to Contracting
  { oppId: "opp_horizon", asset: "outcome_first_trial_brief", deliveredAt: "2026-02-15" },
  { oppId: "opp_horizon", asset: "kpi_assessment", deliveredAt: "2026-02-20" },
  { oppId: "opp_horizon", asset: "pre_seeded_demo", deliveredAt: "2026-02-25" },
  { oppId: "opp_horizon", asset: "finance_meeting_brief", deliveredAt: "2026-04-12" },
  { oppId: "opp_horizon", asset: "cfo_leave_behind", deliveredAt: "2026-04-12" },
  { oppId: "opp_horizon", asset: "it_zero_lift_one_pager", deliveredAt: "2026-04-25" },
  { oppId: "opp_horizon", asset: "dock_room", deliveredAt: "2026-02-15" },

  // Stratos — early stage, just initial materials
  { oppId: "opp_stratos", asset: "dock_room", deliveredAt: "2026-04-30" },
];
