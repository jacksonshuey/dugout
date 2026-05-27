import type { IntegrationSpec } from "./types";

// Slack is Dugout's primary OUTBOUND surface. Severity-tiered delivery:
// blocking signals DM the AE within an hour, action items roll up into a
// daily digest, awareness signals batch to a weekly roundup.

export const SLACK_SPEC: IntegrationSpec = {
  source: "Slack",
  tagline: "Outbound signal delivery.",
  direction: "write",
  writes:
    "Blocking signals → AE DM within 1 hour. Action items → daily channel digest. Awareness → weekly roundup.",
  auth: {
    method: "oauth2",
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
    notes:
      "Slack Bot OAuth. Customer admin installs the Dugout app on their workspace and picks delivery channels.",
  },
  baseUrl: "https://slack.com/api",
  setupFields: [
    {
      key: "workspace",
      label: "Workspace",
      type: "text",
      required: true,
      description: "Your Slack workspace name.",
      placeholder: "acme",
    },
    {
      key: "default_channel",
      label: "Default channel",
      type: "text",
      required: true,
      description:
        "Where action-tier digests land. Blocking signals DM the AE directly regardless.",
      placeholder: "#dugout-signals",
    },
  ],
  requiredScopes: [
    "chat:write",
    "chat:write.public",
    "channels:read",
    "users:read",
    "users:read.email",
    "im:write",
  ],
  webhooks: [],
  webhookSigning: "n/a (outbound only)",
  rateLimit: "1 message/sec per channel (Tier 1 web API limit)",
  syncModel: "realtime",
  dataFreshness: "n/a (outbound only)",
  headlessSetup: true,
  keyGotchas: [
    "Bot must be invited to private channels before it can post.",
    "users:read.email is required to resolve Salesforce User → Slack User by email.",
  ],
};
