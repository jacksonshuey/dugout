import type { IntegrationSpec } from "./types";

// Calendly is Dugout's OUTBOUND booking surface. When a rule fires an
// action like "Book a champion check-in," Dugout creates a single-use
// scheduling link scoped to the AE's Calendly account and DMs it via
// Slack. Read access is included so Dugout can confirm booking + sync
// the resulting meeting back to the Meeting canonical object.

export const CALENDLY_SPEC: IntegrationSpec = {
  source: "Calendly",
  tagline:
    "Outbound booking links. Dugout creates one-time links for the AE and reads back the resulting meeting.",
  direction: "both",
  writes:
    "Single-use scheduling links scoped to the assigned AE. Created when a rule fires a Book Meeting action.",
  auth: {
    method: "oauth2",
    docsUrl: "https://developer.calendly.com/api-docs/ZG9jOjIyMjA5",
    notes:
      "OAuth 2.0 Authorization Code. Each AE connects their own Calendly so links are personalized.",
  },
  baseUrl: "https://api.calendly.com",
  setupFields: [
    {
      key: "client_id",
      label: "OAuth Client ID",
      type: "text",
      required: true,
      description: "From the Calendly developer app you registered.",
    },
    {
      key: "client_secret",
      label: "OAuth Client Secret",
      type: "password",
      required: true,
      secret: true,
      description: "Used for token exchange and refresh.",
    },
    {
      key: "redirect_uri",
      label: "Redirect URI",
      type: "url",
      required: true,
      description: "Must match the URI registered on the Calendly app.",
      placeholder: "https://app.dugout.ai/oauth/calendly/callback",
    },
  ],
  requiredScopes: [],
  webhooks: [
    {
      event: "invitee.created",
      description: "Booking placed on a Dugout-issued single-use link.",
    },
    {
      event: "invitee.canceled",
      description: "Booking canceled (drives re-engagement rules).",
    },
  ],
  webhookSigning:
    "Calendly-Webhook-Signature header (HMAC-SHA256). Signing key returned at webhook subscription creation.",
  rateLimit: "1000 requests / minute per user token",
  syncModel: "webhooks",
  dataFreshness: "Seconds (webhook)",
  headlessSetup: true,
  keyGotchas: [
    "Single-use links require Standard tier or above on the AE's Calendly account.",
    "Webhook subscription is account-level, not per-user. One subscription handles every connected AE.",
  ],
};
