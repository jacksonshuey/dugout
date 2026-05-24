// Workspace configuration — the runtime values that make Dugout a
// platform rather than a Checkbox-specific demo.
//
// Architecture choice: the SHAPE of the system (signal engine, severity
// tiers, deal health computation, playbook framework) is universal. The
// CONTENT (strategic priorities, asset names, integration choices) is
// per-workspace and lives in this config.
//
// Storage: cookies. They work in both server and client components, persist
// across reloads, and don't require a database. Production would back this
// with a real workspaces table.

export interface StrategicPriority {
  id: string; // stable identifier referenced by signal rules
  name: string;
  description: string;
}

export interface StandardAsset {
  id: string; // referenced by signal rules
  name: string; // what the AE sees
  description: string;
}

export interface IntegrationStack {
  crm: string;
  conversationIntelligence: string;
  salesEngagement: string;
  dealRooms: string;
  meetingScheduling: string;
  prospectingEnrichment: string;
}

export interface WorkspaceConfig {
  // Identity
  companyName: string;
  industry: string;
  region: string;
  icpDescription: string; // 1-2 sentence ICP — feeds the digest synthesis prompt
  killPoint: string; // 1-sentence "this is where deals die at this company" — the wedge

  // Strategic priorities — rules tag themselves with one of these IDs
  priorities: StrategicPriority[];

  // Standard sales assets — referenced by signal rules ("send the X asset")
  assets: StandardAsset[];

  // Stack — display names only (no real integrations); flows to digest prompt
  // and architecture data-layer copy
  stack: IntegrationStack;

  // Slack — optional webhook for the live digest demo
  slackWebhookUrl?: string;

  // Bookkeeping
  presetName?: string; // "Checkbox" / "Generic B2B SaaS" / "Custom"
}

// ---------------------------------------------------------------------------
// Preset: Checkbox
// All values pulled directly from the GTM Engineer case context document.
// This is what loads by default and what the Checkbox interview will see.
// ---------------------------------------------------------------------------
export const CHECKBOX_PRESET: WorkspaceConfig = {
  companyName: "Checkbox",
  industry: "Legal-tech SaaS",
  region: "US (primary), AU, RoW",
  icpDescription:
    "US enterprise in-house legal teams. ACVs $20k–$400k (avg ~$90k), sales cycles ~4 months.",
  killPoint:
    "Deals die at Selected Vendor: budget approval fails because Finance/IT were engaged too late.",
  priorities: [
    {
      id: "P1",
      name: "Outcome-First Trial Motion",
      description:
        "Deploy an outcome-based trial on every Evaluating+ deal before the next meeting. SE returns KPI Assessment + pre-seeded demo within 48 hours.",
    },
    {
      id: "P2",
      name: "Finance + IT Enablement Package",
      description:
        "Standard handoff at Selected Vendor: CFO Leave-Behind, IT Zero-Lift one-pager, Finance Meeting Brief. Assets are built; adoption is the work.",
    },
    {
      id: "P3",
      name: "AI-Powered Deal Execution Stack",
      description:
        "Prompt library + Gong deal health + Dock standardized on every Evaluating+ deal. Goal: AEs spend 70%+ of time in customer conversations.",
    },
    {
      id: "P4",
      name: "Stakeholder Engagement Sequencing",
      description:
        "Surface bottom-of-funnel blockers at the top of the funnel. Get Finance and IT engaged during Evaluating, not Contracting.",
    },
    {
      id: "P5",
      name: "Sales Motion Maturity",
      description:
        "Expand relationship-first motion to also win procurement-heavy RFPs. Focus: execution consistency, RFP discipline, multithreading.",
    },
    {
      id: "P6",
      name: "ABM",
      description:
        "Move toward named-accounts motion. Lacks the systems architecture today.",
    },
  ],
  assets: [
    {
      id: "outcome_first_trial_brief",
      name: "Outcome-First Trial Brief",
      description: "Owns the AE→SE intake at Demo Sat → Evaluating transition.",
    },
    {
      id: "kpi_assessment",
      name: "KPI Assessment",
      description: "SE-built assessment of buyer's success metrics, returned within 48h.",
    },
    {
      id: "pre_seeded_demo",
      name: "Pre-Seeded Demo",
      description: "Demo environment loaded with buyer's actual scenarios.",
    },
    {
      id: "cfo_leave_behind",
      name: "CFO Leave-Behind",
      description: "One-pager the champion forwards to Finance to start the budget conversation.",
    },
    {
      id: "finance_meeting_brief",
      name: "Finance Meeting Brief",
      description: "AE preparation doc for the Finance review meeting.",
    },
    {
      id: "it_zero_lift_one_pager",
      name: "IT Zero-Lift One-Pager",
      description: "Security/SSO/deployment summary that pre-empts IT review back-and-forth.",
    },
    {
      id: "dock_room",
      name: "Deal Room",
      description: "Shared async surface (Dock) where the buyer self-educates.",
    },
  ],
  stack: {
    crm: "Salesforce",
    conversationIntelligence: "Gong",
    salesEngagement: "Outreach",
    dealRooms: "Dock",
    meetingScheduling: "Chili Piper",
    prospectingEnrichment: "ZoomInfo",
  },
  presetName: "Checkbox",
};

// ---------------------------------------------------------------------------
// Preset: Generic B2B SaaS
// A different shape — different priorities, different assets, different
// integrations. Proves the system isn't Checkbox-specific.
// ---------------------------------------------------------------------------
export const GENERIC_SAAS_PRESET: WorkspaceConfig = {
  companyName: "Acme Software",
  industry: "B2B SaaS",
  region: "US (primary)",
  icpDescription:
    "Mid-market and enterprise B2B SaaS buyers. ACVs $25k–$250k, sales cycles ~6 weeks for mid-market, ~5 months for enterprise.",
  killPoint:
    "Deals die in Procurement: single-threaded champions can't carry the deal past Legal review.",
  priorities: [
    {
      id: "P1",
      name: "POC Velocity",
      description: "Time-to-POC under 5 business days on every qualified opportunity.",
    },
    {
      id: "P2",
      name: "Multithreading Discipline",
      description: "Every Eval+ deal has Champion + Economic Buyer + IT identified before stage progression.",
    },
    {
      id: "P3",
      name: "Pricing Confidence",
      description: "AEs deliver pricing at first qualified meeting; no late-stage discounting requests.",
    },
    {
      id: "P4",
      name: "Renewal-First Sales",
      description: "Every new logo signed with a clear renewal expansion path priced in.",
    },
    {
      id: "P5",
      name: "Outbound Velocity",
      description: "BDR-sourced pipeline ≥ 30% of total. Sequence quality > volume.",
    },
  ],
  assets: [
    { id: "outcome_first_trial_brief", name: "POC Scope Doc", description: "Defines POC success criteria." },
    { id: "kpi_assessment", name: "Success Plan", description: "Maps buyer KPIs to product capabilities." },
    { id: "pre_seeded_demo", name: "Tailored Demo", description: "Demo scoped to buyer's stack." },
    { id: "cfo_leave_behind", name: "Pricing Justifier", description: "ROI doc for finance review." },
    { id: "finance_meeting_brief", name: "Finance Conversation Guide", description: "AE prep for budget conversation." },
    { id: "it_zero_lift_one_pager", name: "Security Brief", description: "SOC2 + SSO + data residency one-pager." },
    { id: "dock_room", name: "Shared Workspace", description: "Async buyer collaboration space." },
  ],
  stack: {
    crm: "HubSpot",
    conversationIntelligence: "Granola",
    salesEngagement: "Apollo",
    dealRooms: "Aligned",
    meetingScheduling: "Calendly",
    prospectingEnrichment: "Clay",
  },
  presetName: "Generic B2B SaaS",
};

export const PRESETS: Record<string, WorkspaceConfig> = {
  Checkbox: CHECKBOX_PRESET,
  "Generic B2B SaaS": GENERIC_SAAS_PRESET,
};

export const DEFAULT_CONFIG = CHECKBOX_PRESET;

// Slugify a workspace company name into a stable lowercase key suitable for
// use as a cache/lookup partition. Pure: no clock, no I/O.
//
// Rules: lowercase, replace any non-alphanumeric run with a single "-",
// trim leading/trailing dashes. Returns "workspace" when the input
// collapses to an empty string (defensive — should never happen in
// practice since companyName has a fallback in DEFAULT_CONFIG).
//
// Examples:
//   workspaceKey("Checkbox")           → "checkbox"
//   workspaceKey("Acme Software")      → "acme-software"
//   workspaceKey("KKR & Co.")          → "kkr-co"
//   workspaceKey("  ")                 → "workspace"
//
// Reuse-ready: the ranker module uses this for ranker_cache.workspace_key,
// and a future ask-rate-limit integration could use it for workspace_id.
export function workspaceKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}
