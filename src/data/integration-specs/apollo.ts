import type { IntegrationSpec } from "./types";

export const APOLLO_SPEC: IntegrationSpec = {
  source: "Apollo",
  tagline: "Prospecting + enrichment.",
  direction: "read",
  auth: {
    method: "api_key",
    docsUrl: "https://docs.apollo.io/reference/authentication",
    notes:
      "Generate in Settings > Integrations > Apollo API > API Keys. Sent as `X-Api-Key` header (case-sensitive).",
  },
  baseUrl: "https://api.apollo.io/v1",
  setupFields: [
    {
      key: "api_key",
      label: "Apollo API key",
      type: "password",
      required: true,
      secret: true,
      description: "From Settings > Integrations > Apollo API. Shown once.",
      placeholder: "xxxxxxxxxxxxxxxxxxxxxx",
    },
    {
      key: "key_type",
      label: "Key type",
      type: "select",
      required: true,
      options: ["master", "standard"],
      description:
        "Master keys can call usage_stats and create other keys. Standard keys are endpoint-scoped.",
    },
    {
      key: "workspace_name",
      label: "Workspace label (display only)",
      type: "text",
      required: false,
      description: "Free text label for your own reference.",
      placeholder: "Apollo - Prod",
    },
  ],
  requiredScopes: [],
  webhooks: [
    { event: "email_sent", description: "Apollo sequence email sent" },
    { event: "email_opened", description: "Recipient opened a sequence email" },
    { event: "email_clicked", description: "Recipient clicked a link" },
    { event: "email_replied", description: "Recipient replied" },
    { event: "email_bounced", description: "Email bounced" },
    { event: "meeting_booked", description: "Meeting booked from a sequence" },
    { event: "contact_created", description: "New contact added in Apollo" },
    { event: "contact_updated", description: "Contact record changed" },
  ],
  webhookSigning:
    "X-Apollo-Signature header (HMAC-SHA256 of raw body). Per-webhook secret shown once in Apollo UI.",
  rateLimit:
    "Per-account; query GET /api/v1/usage_stats/api_usage_stats (master keys only) at runtime",
  syncModel: "webhooks",
  dataFreshness:
    "Realtime on enrichment request; underlying contact database refreshes monthly-to-quarterly per record",
  headlessSetup: false,
  keyGotchas: [
    "Send the header as exactly `X-Api-Key` - case-sensitive in some SDKs. `x-api-key` and `Authorization` will both 401.",
    "Free Apollo plans cannot call People Search at all - you'll get 403 'endpoint not enabled' rather than a rate-limit error. Test against `GET /v1/auth/health` before saving.",
    "Master vs standard: only master keys can call `usage_stats` and create new keys. Reject standard keys if your popup needs to display quota.",
  ],
};
