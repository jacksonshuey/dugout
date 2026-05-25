import type { BrandKey } from "@/components/landing/logos";

// Single source of truth for the integrations Dugout speaks to.
// Read by the landing constellation, the integrations matrix, and (eventually)
// the per-provider health endpoints. Adding a new source = one entry here.

export type IntegrationStatus = "live" | "beta" | "config";

export type AuthMethod =
  | "api-key"
  | "vault-stored-key"
  | "incoming-webhook"
  | "outgoing-webhook"
  | "service-role"
  | "oauth"
  | "public";

export type DeploymentMode =
  | "hosted"        // Dugout runs the adapter / cron / connection
  | "your-stack"    // workspace-config display only; runs against your existing tenant
  | "your-channel"; // delivery surface - your Slack workspace, etc.

export type DataDirection = "read" | "inbound" | "outbound" | "bidirectional";

export interface IntegrationSpec {
  brand: BrandKey;
  role: string;
  status: IntegrationStatus;
  auth: AuthMethod;
  deployment: DeploymentMode;
  direction: DataDirection;
  // Short, human-readable rate ceiling or quota. Empty for the display-only
  // workspace-config rows (those run on the customer's plan, not ours).
  limits: string;
  // Anchor on the landing constellation / setup reel. Reel pins Granola
  // first; ordering otherwise mirrors source-of-truth importance.
  pinFirst?: boolean;
}

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    brand: "anthropic",
    role: "Sonnet 4.6 + Haiku 4.5",
    status: "live",
    auth: "api-key",
    deployment: "hosted",
    direction: "read",
    limits: "Per-session 20/hr + 100/day; 500/day global",
  },
  {
    brand: "supabase",
    role: "Signals + Vault-encrypted keys",
    status: "live",
    auth: "service-role",
    deployment: "hosted",
    direction: "bidirectional",
    limits: "Dugout-owned tenant",
  },
  {
    brand: "newsapi",
    role: "Material news classification",
    status: "live",
    auth: "api-key",
    deployment: "hosted",
    direction: "read",
    limits: "Daily cron; per-account scoped",
  },
  {
    brand: "sec",
    role: "8-K filings · public-co signals",
    status: "live",
    auth: "public",
    deployment: "hosted",
    direction: "read",
    limits: "10 req/s (SEC fair-use)",
  },
  {
    brand: "firecrawl",
    role: "Per-account web scrape",
    status: "live",
    auth: "api-key",
    deployment: "hosted",
    direction: "read",
    limits: "Daily cron; per-account markdown",
  },
  {
    brand: "slack",
    role: "Severity-tiered delivery",
    status: "live",
    auth: "outgoing-webhook",
    deployment: "your-channel",
    direction: "outbound",
    limits: "Blocking → DM <1hr; Action → digest; Awareness → weekly",
  },
  {
    brand: "granola",
    role: "Meeting signal extraction",
    status: "beta",
    auth: "vault-stored-key",
    deployment: "hosted",
    direction: "read",
    limits: "Pulled hourly per workspace",
    pinFirst: true,
  },
  {
    brand: "salesforce",
    role: "CRM read",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Salesforce plan",
  },
  {
    brand: "gong",
    role: "Call transcripts",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Gong plan",
  },
  {
    brand: "outreach",
    role: "Sales engagement",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Outreach plan",
  },
  {
    brand: "dock",
    role: "Deal rooms",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Dock plan",
  },
  {
    brand: "chilipiper",
    role: "Scheduling",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Chili Piper plan",
  },
  {
    brand: "hubspot",
    role: "CRM read (alt to Salesforce)",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your HubSpot plan",
  },
  {
    brand: "zoominfo",
    role: "Prospecting · firmographic enrichment",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your ZoomInfo plan",
  },
  {
    brand: "nooks",
    role: "AI-assisted dialer · call dispositions",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Nooks plan",
  },
  {
    brand: "swyftai",
    role: "AI deal capture · MEDDPICC hygiene",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Swyft AI plan",
  },
  {
    brand: "xero",
    role: "Finance · invoices · billing events",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Xero plan",
  },
  {
    brand: "zendesk",
    role: "Support tickets · customer health",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Zendesk plan",
  },
  {
    brand: "webflow",
    role: "Marketing forms · inbound leads",
    status: "config",
    auth: "oauth",
    deployment: "your-stack",
    direction: "read",
    limits: "Runs on your Webflow plan",
  },
];

// ---------------------------------------------------------------------------
// Display helpers - keep the matrix and the constellation aligned without
// each surface inventing its own label vocabulary.
// ---------------------------------------------------------------------------

export const AUTH_LABEL: Record<AuthMethod, string> = {
  "api-key": "API key (env)",
  "vault-stored-key": "API key (Vault)",
  "incoming-webhook": "Signed webhook in",
  "outgoing-webhook": "Webhook URL",
  "service-role": "Service role",
  "oauth": "OAuth",
  "public": "Public · no auth",
};

export const DEPLOYMENT_LABEL: Record<DeploymentMode, string> = {
  "hosted": "Dugout-hosted",
  "your-stack": "Your tenant",
  "your-channel": "Your channel",
};

export const DIRECTION_LABEL: Record<DataDirection, string> = {
  "read": "Read",
  "inbound": "Inbound",
  "outbound": "Outbound",
  "bidirectional": "Read · write",
};

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  "live": "Live",
  "beta": "Beta",
  "config": "Display",
};
