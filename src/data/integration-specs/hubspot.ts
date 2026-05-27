import type { IntegrationSpec } from "./types";

export const HUBSPOT_SPEC: IntegrationSpec = {
  source: "HubSpot",
  tagline: "Marketing automation + secondary CRM.",
  direction: "read",
  auth: {
    method: "personal_access_token",
    docsUrl:
      "https://developers.hubspot.com/docs/guides/apps/private-apps/overview",
    notes:
      "A super-admin creates a Private App in Settings > Integrations > Private Apps, ticks the scope checkboxes, and reveals the token once.",
  },
  baseUrl: "https://api.hubapi.com",
  setupFields: [
    {
      key: "access_token",
      label: "Private App access token",
      type: "password",
      required: true,
      secret: true,
      description:
        "From Settings > Integrations > Private Apps > [your app] > Auth tab > Show token. Starts with `pat-`.",
      placeholder: "pat-na1-xxxxxxxx-...",
    },
    {
      key: "hub_id",
      label: "Hub ID (portal)",
      type: "text",
      required: false,
      description:
        "Optional. Auto-detected from the first authenticated call.",
      placeholder: "12345678",
    },
  ],
  requiredScopes: [
    "crm.objects.contacts.read",
    "crm.objects.companies.read",
    "crm.objects.deals.read",
    "crm.objects.line_items.read",
    "crm.objects.owners.read",
    "crm.objects.users.read",
    "crm.lists.read",
    "crm.schemas.contacts.read",
    "crm.schemas.deals.read",
    "sales-email-read",
    "tickets",
    "conversations.read",
  ],
  webhooks: [
    { event: "contact.creation", description: "New contact created" },
    { event: "contact.propertyChange", description: "Contact property changed" },
    { event: "contact.associationChange", description: "Contact association changed" },
    { event: "company.creation", description: "New company created" },
    { event: "company.propertyChange", description: "Company property changed" },
    { event: "deal.creation", description: "New deal created" },
    { event: "deal.propertyChange", description: "Deal property changed (stage, amount, close date)" },
    { event: "deal.associationChange", description: "Deal contact/company association changed" },
    { event: "ticket.creation", description: "New support ticket" },
    { event: "ticket.propertyChange", description: "Ticket property changed" },
    { event: "conversation.newMessage", description: "New inbox message" },
  ],
  webhookSigning:
    "v3 signatures. HMAC-SHA256 over (method + uri + body + timestamp), keyed with the app Client Secret, base64. Reject if X-HubSpot-Request-Timestamp drift > 5 min.",
  rateLimit:
    "Pro: 190 req/10s, 625k/day. Enterprise: 190 req/10s, 1M/day. Search API: separate 5 req/sec cap.",
  syncModel: "webhooks",
  dataFreshness: "~5-30 seconds via webhooks; 1 hr for non-event-covered properties",
  headlessSetup: false,
  keyGotchas: [
    "Webhook fires only if the read scope for the object is marked **Required** in the Private App, not just enabled. Easy to miss.",
    "`tickets` scope is monolithic: granting read also grants write. Flag this for security-conscious customers.",
    "Webhook signature uses the app Client Secret, not the Developer API key. Customers paste the wrong one all the time.",
  ],
};
