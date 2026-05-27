import type { IntegrationSpec } from "./types";

export const OUTREACH_SPEC: IntegrationSpec = {
  source: "Outreach",
  tagline:
    "Sales engagement cadences + dialer. OAuth 2.0 only. Manual app review by Outreach gates production.",
  direction: "read",
  auth: {
    method: "oauth2",
    docsUrl: "https://developers.outreach.io/api/oauth/",
    notes:
      "Authorization Code flow. Access tokens last 2 hours; refresh logic must be solid. App must be approved by Outreach before serving non-owning-org users in production.",
  },
  baseUrl: "https://api.outreach.io/api/v2",
  setupFields: [
    {
      key: "client_id",
      label: "Client ID",
      type: "text",
      required: true,
      description:
        "From Outreach developer account > Apps > [your app] > OAuth.",
    },
    {
      key: "client_secret",
      label: "Client Secret",
      type: "password",
      required: true,
      secret: true,
      description:
        "From the same OAuth page. URL-encode if it contains special characters.",
    },
    {
      key: "redirect_uri",
      label: "Redirect URI",
      type: "url",
      required: true,
      description:
        "Must EXACTLY match one of the redirect URIs on the Outreach app (trailing slash counts).",
      placeholder: "https://app.dugout.ai/oauth/outreach/callback",
    },
  ],
  requiredScopes: [
    "accounts.read",
    "prospects.read",
    "mailings.read",
    "sequences.read",
    "sequenceStates.read",
    "opportunities.read",
    "tasks.read",
    "calls.read",
    "users.read",
    "events.read",
    "webhooks.all",
  ],
  webhooks: [
    { event: "prospect.created", description: "New prospect added" },
    { event: "prospect.updated", description: "Prospect record changed" },
    { event: "mailing.delivered", description: "Email delivery confirmed" },
    { event: "mailing.opened", description: "Recipient opened email" },
    { event: "mailing.clicked", description: "Recipient clicked a link" },
    { event: "mailing.replied", description: "Recipient replied" },
    { event: "mailing.bounced", description: "Email bounced" },
    { event: "task.completed", description: "Task marked done" },
    { event: "sequenceState.advanced", description: "Prospect advanced sequence step" },
    { event: "sequenceState.finished", description: "Prospect finished a sequence" },
    { event: "call.created", description: "Call logged" },
    { event: "opportunity.updated", description: "Opportunity record changed" },
  ],
  webhookSigning:
    "Outreach-Webhook-Signature header = HMAC-SHA256(secret, raw_request_body) hex digest. Secret returned once at webhook creation in the `cleanupToken` field.",
  rateLimit: "10,000 requests / hour per OAuth user",
  syncModel: "webhooks",
  dataFreshness: "~30 seconds via webhooks (4-attempt delivery, 1s apart); 1 hr poll backfill",
  headlessSetup: false,
  keyGotchas: [
    "Outreach manually reviews production app submissions. Plan for 1-2 weeks of review before customers can connect with production credentials.",
    "Access tokens expire in 2 hours - refresh logic must be rock-solid or sync stalls every 2hr.",
    "Webhook secret is shown ONCE in the creation response. Store it immediately or recreate the webhook.",
  ],
};
