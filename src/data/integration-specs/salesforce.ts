import type { IntegrationSpec } from "./types";

export const SALESFORCE_SPEC: IntegrationSpec = {
  source: "Salesforce",
  tagline: "CRM system of record. Dugout reads only.",
  direction: "read",
  auth: {
    method: "oauth2",
    docsUrl:
      "https://help.salesforce.com/s/articleView?id=xcloud.connected_app_create_api_integration.htm",
    notes:
      "Connected App, Web Server Flow. Token response carries instance_url for REST calls.",
  },
  baseUrl: "https://login.salesforce.com",
  setupFields: [
    {
      key: "environment",
      label: "Environment",
      type: "select",
      required: true,
      options: ["Production", "Sandbox"],
      description: "Sandbox uses test.salesforce.com for auth.",
    },
    {
      key: "consumer_key",
      label: "Consumer Key",
      type: "password",
      required: true,
      secret: true,
      description: "From your Connected App.",
      placeholder: "3MVG9...",
    },
    {
      key: "consumer_secret",
      label: "Consumer Secret",
      type: "password",
      required: true,
      secret: true,
      description: "From the same Connected App.",
    },
  ],
  requiredScopes: ["api", "refresh_token"],
  webhooks: [
    {
      event: "Change Data Capture",
      description:
        "Opportunity, Account, Contact, Lead, Task — real-time change events over Pub-Sub gRPC.",
    },
  ],
  webhookSigning: "Channel-authenticated by the OAuth access token; no separate HMAC.",
  rateLimit: "100k API calls / 24h org-wide + 1k per user license",
  syncModel: "webhooks",
  dataFreshness: "~1 min via CDC",
  headlessSetup: false,
  keyGotchas: [
    "Connected App needs 2-10 min to propagate after creation — first OAuth attempt during that window fails.",
    "Daily API limit is org-wide. Shared across every integration the customer has connected.",
  ],
};
