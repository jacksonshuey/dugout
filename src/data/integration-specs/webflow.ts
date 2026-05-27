import type { IntegrationSpec } from "./types";

export const WEBFLOW_SPEC: IntegrationSpec = {
  source: "Webflow",
  tagline: "Marketing site CMS + form submissions.",
  direction: "read",
  auth: {
    method: "oauth2",
    docsUrl: "https://developers.webflow.com/data/reference/authentication",
    notes:
      "OAuth Authorization Code is the preferred path. Site Token alternative for single-site/internal use - generated per-site in Site Settings > Apps & Integrations > API Access.",
  },
  baseUrl: "https://api.webflow.com/v2",
  setupFields: [
    {
      key: "client_id",
      label: "OAuth Client ID",
      type: "text",
      required: true,
      description: "From the Webflow Data Client app you registered.",
    },
    {
      key: "client_secret",
      label: "OAuth Client Secret",
      type: "password",
      required: true,
      secret: true,
      description: "Used as the webhook HMAC signing key for OAuth apps.",
    },
    {
      key: "redirect_uri",
      label: "Redirect URI",
      type: "url",
      required: true,
      description:
        "Must exactly match (including trailing slash) what's registered on the Webflow app.",
      placeholder: "https://app.dugout.ai/oauth/webflow/callback",
    },
    {
      key: "site_ids",
      label: "Site IDs to subscribe (comma-separated)",
      type: "text",
      required: false,
      description:
        "After consent, list which sites this connection covers. Omit to prompt at install time.",
    },
  ],
  requiredScopes: [
    "sites:read",
    "pages:read",
    "cms:read",
    "forms:read",
    "ecommerce:read",
    "users:read",
    "authorized_user:read",
  ],
  webhooks: [
    {
      event: "form_submission",
      description: "Form submitted (filter by form name)",
    },
    { event: "site_publish", description: "Site published" },
    { event: "page_created", description: "New page created" },
    { event: "page_metadata_updated", description: "Page metadata changed" },
    { event: "collection_item_created", description: "New CMS item" },
    { event: "collection_item_changed", description: "CMS item edited" },
    { event: "collection_item_deleted", description: "CMS item deleted" },
    { event: "ecomm_new_order", description: "Ecommerce order placed" },
    { event: "ecomm_order_changed", description: "Ecommerce order updated" },
  ],
  webhookSigning:
    "x-webflow-signature (SHA-256 HMAC hex) + x-webflow-timestamp (Unix ms). Canonical string: `timestamp:JSON.stringify(body)`. Signing key is the OAuth client_secret for OAuth apps, or per-webhook `secretKey` for Site Token webhooks (mandatory after April 2025). Reject drift > 5 min.",
  rateLimit:
    "60 req/min per access token (standard); 120 req/min on Enterprise. Bulk CMS endpoints separate 60/min cap.",
  syncModel: "webhooks",
  dataFreshness: "~2 seconds via webhook; reads are realtime",
  headlessSetup: true,
  keyGotchas: [
    "OAuth authorization codes are valid only 15 minutes. Don't queue token exchange behind a long workflow step.",
    "Webhook secret strategy changed in April 2025: Site Token webhooks now get a unique `secretKey` per webhook (returned only at create time). Store alongside the webhook ID or signature verification fails.",
    "redirect_uri must match exactly between authorize and token-exchange steps (trailing slash, scheme, port). One mismatch = invalid_grant.",
  ],
};
