import type { IntegrationSpec } from "./types";

export const EDGAR_SPEC: IntegrationSpec = {
  source: "SEC EDGAR",
  tagline: "Public SEC filings.",
  direction: "read",
  auth: {
    method: "none",
    docsUrl:
      "https://www.sec.gov/search-filings/edgar-application-programming-interfaces",
    notes:
      "Public API with no signup. SEC requires a non-generic User-Agent in the `<name> <email>` format for fair-access logging.",
  },
  baseUrl: "https://data.sec.gov",
  setupFields: [
    {
      key: "contact_name",
      label: "Contact name",
      type: "text",
      required: true,
      description: "SEC will see this in your User-Agent header.",
      placeholder: "Acme Compliance",
    },
    {
      key: "contact_email",
      label: "Contact email",
      type: "text",
      required: true,
      description: "SEC can use this to reach you if your traffic causes issues.",
      placeholder: "ops@acme.com",
    },
    {
      key: "watchlist_ciks",
      label: "Watched CIKs (optional)",
      type: "text",
      required: false,
      description:
        "Comma-separated CIK numbers. Leave blank to monitor all 8-K filers.",
      placeholder: "0000320193,0001318605",
    },
  ],
  requiredScopes: [],
  webhooks: [],
  webhookSigning: "n/a",
  rateLimit: "10 req/sec per IP hard ceiling. Recommended sustained 8 req/sec with 0.12s gap.",
  syncModel: "hourly_poll",
  dataFreshness: "Filings appear in EDGAR within minutes of acceptance; data.sec.gov endpoint lags by a few minutes",
  headlessSetup: true,
  keyGotchas: [
    "Missing or generic User-Agent (e.g. `python-requests/2.x`) gets a 403 with no body. Must be `\"<name> <email>\"` format.",
    "CIKs must be zero-padded to 10 digits in URLs (e.g. `CIK0000320193.json`). Pad everywhere defensively.",
    "data.sec.gov and www.sec.gov share the same rate-limit pool. Throttle the combined stream, not each host separately.",
  ],
};
