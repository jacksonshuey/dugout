import type { IntegrationSpec } from "./types";

export const XERO_SPEC: IntegrationSpec = {
  source: "Xero",
  tagline: "Accounting + invoicing.",
  direction: "read",
  auth: {
    method: "oauth2",
    docsUrl:
      "https://developer.xero.com/documentation/guides/oauth2/auth-flow/",
    notes:
      "Authorization Code + PKCE. After token exchange, call GET /connections to discover the tenantId of the connected organisation - the access token alone doesn't say which org you're in.",
  },
  baseUrl: "https://api.xero.com/api.xro/2.0",
  setupFields: [
    {
      key: "client_id",
      label: "OAuth Client ID",
      type: "text",
      required: true,
      description: "From the Xero developer app you registered.",
    },
    {
      key: "client_secret",
      label: "OAuth Client Secret",
      type: "password",
      required: false,
      secret: true,
      description:
        "Required for confidential clients. Omit for PKCE-only public clients.",
    },
    {
      key: "redirect_uri",
      label: "Redirect URI",
      type: "url",
      required: true,
      description:
        "Must exactly match what's registered in the Xero developer portal.",
      placeholder: "https://app.dugout.ai/oauth/xero/callback",
    },
  ],
  requiredScopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "accounting.transactions.read",
    "accounting.contacts.read",
    "accounting.settings.read",
    "accounting.reports.read",
    "accounting.attachments.read",
  ],
  webhooks: [
    { event: "INVOICE.CREATE", description: "New invoice created" },
    { event: "INVOICE.UPDATE", description: "Invoice changed (paid, voided, edited)" },
    { event: "CONTACT.CREATE", description: "New contact created" },
    { event: "CONTACT.UPDATE", description: "Contact record changed" },
    { event: "CREDITNOTE.CREATE", description: "New credit note" },
    { event: "CREDITNOTE.UPDATE", description: "Credit note changed" },
  ],
  webhookSigning:
    "x-xero-signature header (HMAC-SHA256). Webhook key generated when you save the webhook subscription. Endpoint must respond 200 within 5 seconds; respond 401 if signature invalid (intent-to-receive handshake).",
  rateLimit: "60 calls/min per tenant; 5,000 calls/day per tenant; 5 concurrent calls per tenant",
  syncModel: "webhooks",
  dataFreshness:
    "Seconds via webhook (INVOICE/CONTACT/CREDITNOTE); 1 hr for non-webhook categories (Bank Transactions, Reports, Payroll)",
  headlessSetup: false,
  keyGotchas: [
    "Fine-grained scope migration (2026-03-02 / 2026-04-29) means broad scopes like `accounting.reports.read` work on old apps but require granular replacements on new apps. Check developer.xero.com/documentation/guides/oauth2/scopes against your app's creation date.",
    "Intent-to-receive (ITR) handshake will fail if your endpoint isn't already live and returning 200 to the test ping when you save the webhook URL.",
    "Webhooks only cover INVOICE / CONTACT / CREDITNOTE. Bank Transactions, Reports, Payroll require polling.",
  ],
};
