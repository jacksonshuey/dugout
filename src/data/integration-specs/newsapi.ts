import type { IntegrationSpec } from "./types";

export const NEWSAPI_SPEC: IntegrationSpec = {
  source: "NewsAPI",
  tagline:
    "News article search. Single API key. No webhooks — poll the /everything and /top-headlines endpoints.",
  direction: "read",
  auth: {
    method: "api_key",
    docsUrl: "https://newsapi.org/docs/authentication",
    notes:
      "Single API key from newsapi.org/register. Send via X-Api-Key header (preferred), never the query string.",
  },
  baseUrl: "https://newsapi.org/v2",
  setupFields: [
    {
      key: "api_key",
      label: "API key",
      type: "password",
      required: true,
      secret: true,
      description: "From newsapi.org/register.",
      placeholder: "32-hex-char string",
    },
    {
      key: "default_sources",
      label: "Default sources (optional)",
      type: "text",
      required: false,
      description:
        "Comma-separated source IDs to default to (e.g., bloomberg,reuters,techcrunch). Blank = all.",
    },
    {
      key: "default_language",
      label: "Default language",
      type: "select",
      required: false,
      options: ["en", "es", "fr", "de", "it", "nl", "no", "pt", "ru", "zh"],
      description: "ISO-639-1 language filter.",
    },
    {
      key: "default_country",
      label: "Default country (top-headlines)",
      type: "select",
      required: false,
      options: ["us", "gb", "au", "ca", "in", "de", "fr"],
      description: "ISO-3166-1 country code for /top-headlines.",
    },
  ],
  requiredScopes: [],
  webhooks: [],
  webhookSigning: "n/a",
  rateLimit: "Per plan tier (Developer 100/day, Business 250k/mo, Advanced 2M/mo). Max 100 articles per response.",
  syncModel: "hourly_poll",
  dataFreshness: "Real-time on paid tiers; 24h delay on Developer tier",
  headlessSetup: true,
  keyGotchas: [
    "Developer (free) tier is dev/test only - production use is a TOS violation and will get the key revoked.",
    "Pass key via X-Api-Key header, not query string - query strings leak into logs and CDN caches.",
    "/v2/everything requires at least one of q, qInTitle, sources, or domains. Empty queries 400.",
  ],
};
