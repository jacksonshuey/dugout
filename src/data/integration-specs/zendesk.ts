import type { IntegrationSpec } from "./types";

export const ZENDESK_SPEC: IntegrationSpec = {
  source: "Zendesk",
  tagline:
    "Support ticketing. API token (recommended) sent as Basic Auth with admin email.",
  direction: "read",
  auth: {
    method: "api_key",
    docsUrl:
      "https://developer.zendesk.com/api-reference/introduction/security-and-auth/",
    notes:
      "API token issued in Admin Center > Apps and integrations > Zendesk API > API Tokens. Sent as Basic Auth: base64(`{email}/token:{token}`).",
  },
  baseUrl: "https://{subdomain}.zendesk.com/api/v2",
  setupFields: [
    {
      key: "subdomain",
      label: "Zendesk subdomain",
      type: "text",
      required: true,
      description: "The part before `.zendesk.com`.",
      placeholder: "acme",
    },
    {
      key: "admin_email",
      label: "Admin email",
      type: "text",
      required: true,
      description: "Email of the admin user the token belongs to.",
      placeholder: "admin@acme.com",
    },
    {
      key: "api_token",
      label: "API token",
      type: "password",
      required: true,
      secret: true,
      description: "40-char token from Admin Center > Apps and integrations > Zendesk API.",
    },
  ],
  requiredScopes: [],
  webhooks: [
    {
      event: "zen:event-type:ticket.created",
      description: "New ticket opened",
    },
    {
      event: "zen:event-type:ticket.updated",
      description: "Ticket field changed",
    },
    {
      event: "zen:event-type:ticket.status_changed",
      description: "Ticket status changed",
    },
    {
      event: "zen:event-type:user.created",
      description: "New end-user or agent created",
    },
    {
      event: "zen:event-type:conversation.created",
      description: "New messaging conversation",
    },
  ],
  webhookSigning:
    "X-Zendesk-Webhook-Signature + X-Zendesk-Webhook-Signature-Timestamp. HMAC-SHA256 over `timestamp + raw_body`. Per-webhook secret.",
  rateLimit:
    "Per plan tier: Essential 10 rpm, Team 200 rpm, Pro 400 rpm, Enterprise 700 rpm, Enterprise Plus 2500 rpm",
  syncModel: "webhooks",
  dataFreshness: "Seconds via webhook; 1 min via incremental polling",
  headlessSetup: true,
  keyGotchas: [
    "API token auth must be sent as base64(`{email}/token:{token}`) under Authorization: Basic. The `/token` literal suffix is easy to mis-format.",
    "Token access is OFF by default in fresh Zendesk instances. Admin must toggle it on under Admin Center > Apps and integrations > Zendesk API.",
    "Rate limit is tied to plan tier. Essential (10 rpm) will choke any non-trivial sync - surface a plan check before saving.",
  ],
};
