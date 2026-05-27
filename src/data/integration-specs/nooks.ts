import type { IntegrationSpec } from "./types";

// Nooks does not publish a direct data API. Nooks is a *consumer* of
// other integrations (Gong, Salesforce, Outreach) and pushes dialer
// activity back into those systems. The honest connect popup is a
// derived integration: connect Gong first, Nooks data lights up
// automatically via Gong.

export const NOOKS_SPEC: IntegrationSpec = {
  source: "Nooks",
  tagline:
    "AI-assisted parallel dialer. Derived integration — Nooks logs activity to Gong, so connecting Gong gives you Nooks coverage for free.",
  direction: "read",
  auth: {
    method: "none",
    docsUrl: "https://developer.nooks.in/",
    notes:
      "No public Nooks data API as of 2026. Dugout reads Nooks dialer activity via the customer's Gong connection. If a direct webhook is preferred, the customer can configure one through Zapier and paste our URL + shared secret below.",
  },
  baseUrl: "n/a",
  setupFields: [
    {
      key: "webhook_url_display",
      label: "Dugout webhook URL",
      type: "url",
      required: false,
      description:
        "Paste this into a Zapier zap on the customer's Nooks workspace. Read-only; auto-generated per tenant.",
      placeholder: "https://api.dugout.ai/webhooks/nooks/<tenant_id>",
    },
    {
      key: "shared_secret",
      label: "Shared secret",
      type: "password",
      required: false,
      secret: true,
      description:
        "Auto-generated. Paste into Zapier for HMAC-SHA256 verification.",
    },
    {
      key: "nooks_workspace_name",
      label: "Nooks workspace name (display only)",
      type: "text",
      required: false,
      description: "For your own labeling.",
      placeholder: "acme-sales",
    },
  ],
  requiredScopes: [],
  webhooks: [],
  webhookSigning:
    "HMAC-SHA256 on the customer-configured shared secret (Zapier-driven).",
  rateLimit: "Bounded by Gong's 3 req/sec ceiling when reading via Gong",
  syncModel: "webhooks",
  dataFreshness:
    "~1-2 min via Gong; up to 15 min if relying on Zapier polling triggers",
  headlessSetup: false,
  keyGotchas: [
    "Recommended path: connect Gong first. Nooks dialer activity (recordings, dispositions, notes) auto-flows to Gong Engage, so no separate Nooks credentials needed.",
    "If a Zapier-based push is required, customer must log into Nooks > Settings > Integrations and configure the Zap themselves.",
    "Do not promise direct Nooks API access in the demo - the public posture is 'we integrate INTO Gong/SF', not 'we publish a data API'.",
  ],
};
