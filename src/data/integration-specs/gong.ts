import type { IntegrationSpec } from "./types";

export const GONG_SPEC: IntegrationSpec = {
  source: "Gong",
  tagline: "Conversation intelligence.",
  direction: "read",
  auth: {
    method: "api_key",
    docsUrl: "https://help.gong.io/docs/receive-access-to-the-api",
    notes:
      "Basic Auth using Access Key + Access Key Secret as username/password. OAuth is required only if you publish to the Gong Collective (multi-tenant). A Gong Technical Administrator must create the key in Admin > Settings > Ecosystem > API.",
  },
  baseUrl: "https://api.gong.io/v2",
  setupFields: [
    {
      key: "access_key",
      label: "Gong Access Key",
      type: "password",
      required: true,
      secret: true,
      description: "Username half of Basic Auth.",
      placeholder: "eyJhbGciOi...",
    },
    {
      key: "access_key_secret",
      label: "Gong Access Key Secret",
      type: "password",
      required: true,
      secret: true,
      description: "Password half of Basic Auth.",
    },
    {
      key: "workspace_id",
      label: "Workspace ID (optional)",
      type: "text",
      required: false,
      description:
        "Only if the customer has multiple Gong workspaces and you want to scope to one.",
      placeholder: "1234567890",
    },
  ],
  requiredScopes: [],
  webhooks: [
    {
      event: "call.completed (Automation Rule)",
      description:
        "Configured per Automation Rule. Fires when a call finishes that matches the rule filters (workspace, host, duration).",
    },
    {
      event: "call.transcript.ready",
      description: "Transcript processing finished. Typically 10-30 min after the call ends.",
    },
  ],
  webhookSigning:
    "JWT in the Authorization header. Verify signature using the public key Gong shows on the rule config screen.",
  rateLimit: "3 req/sec and 10,000 req/day per company",
  syncModel: "webhooks",
  dataFreshness: "~1 min for call metadata; 10-30 min for transcripts",
  headlessSetup: false,
  keyGotchas: [
    "Gong does NOT support user-level OAuth - auth is workspace-global. Individual reps can't connect their own Gong account.",
    "If using OAuth, every API call MUST use the per-customer `api_base_url_for_customer` from the token response. Hardcoding `api.gong.io` silently 404s on some customers.",
    "3 req/sec ceiling is brutal at scale. Cursor pagination + backoff are mandatory.",
  ],
};
