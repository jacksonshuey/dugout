import type { IntegrationSpec } from "./types";

export const ZOOMINFO_SPEC: IntegrationSpec = {
  source: "ZoomInfo",
  tagline: "Prospecting + intent.",
  direction: "read",
  auth: {
    method: "oauth2",
    docsUrl: "https://docs.zoominfo.com/docs/authorization",
    notes:
      "Client Credentials flow produces a Bearer token (~1000s TTL). PKI path issues a 60-min JWT from /authenticate using a PEM private key.",
  },
  baseUrl: "https://api.zoominfo.com/gtm/v1/data",
  setupFields: [
    {
      key: "auth_path",
      label: "Auth path",
      type: "select",
      required: true,
      options: ["Client Credentials (modern)", "PKI JWT (legacy enterprise)"],
      description: "Which auth flow your DevPortal app supports.",
    },
    {
      key: "client_id",
      label: "Client ID",
      type: "text",
      required: true,
      description: "From ZoomInfo DevPortal app, OR Admin Portal for PKI.",
    },
    {
      key: "client_secret",
      label: "Client Secret",
      type: "password",
      required: false,
      secret: true,
      description: "OAuth path only. Shown once at app creation.",
    },
    {
      key: "username",
      label: "Username",
      type: "text",
      required: false,
      description: "PKI path only. The ZoomInfo console username (email).",
      placeholder: "jane@acme.com",
    },
    {
      key: "private_key",
      label: "Private key (PEM)",
      type: "password",
      required: false,
      secret: true,
      description:
        "PKI path only. Paste the full PEM block including BEGIN/END lines. Newlines must be preserved exactly.",
      placeholder: "-----BEGIN RSA PRIVATE KEY-----\n...",
    },
  ],
  requiredScopes: ["enterprise_api"],
  webhooks: [],
  webhookSigning: "n/a",
  rateLimit:
    "Per-account contractual quota (credit pool, e.g. 100k record-lookups/day). ~25 req/sec sustained recommended.",
  syncModel: "on_demand",
  dataFreshness:
    "Contact records refreshed every 30-90 days; intent signals refreshed daily",
  headlessSetup: false,
  keyGotchas: [
    "PKI requires preserving PEM newlines exactly. If the popup textarea collapses whitespace, signature generation silently 401s. Trim only outer whitespace.",
    "OAuth access_token TTL comes from `expires_in` in the response (~1000s). Never hardcode - honor the field.",
    "Enterprise data API has no webhook surface. All sync is request/response, so build a smart poll cadence for watched accounts.",
  ],
};
