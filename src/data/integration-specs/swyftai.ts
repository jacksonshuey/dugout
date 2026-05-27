import type { IntegrationSpec } from "./types";

// Swyft AI does not publish a public outbound data API. It OAuths INTO
// Salesforce/Gong/Salesloft and writes back MEDDPICC-style fields.
// Dugout reads Swyft's outputs from those downstream systems. The
// "connect" popup is really a configuration hint, not a credential
// exchange.

export const SWYFTAI_SPEC: IntegrationSpec = {
  source: "Swyft AI",
  tagline:
    "AI deal-capture. Derived integration — Swyft writes MEDDPICC fields to Salesforce; Dugout reads them from there.",
  direction: "read",
  auth: {
    method: "none",
    docsUrl: "https://help.swyftai.com/en/articles/10592152-salesforce-integration-guide",
    notes:
      "Swyft does not expose a public outbound API. Dugout detects Swyft's writes by polling Salesforce for `LastModifiedById = <Swyft service user>`. Connect Salesforce first; configure the Swyft user ID below for attribution.",
  },
  baseUrl: "n/a",
  setupFields: [
    {
      key: "salesforce_user_id",
      label: "Swyft service user ID (Salesforce)",
      type: "text",
      required: true,
      description:
        "The Salesforce user ID Swyft uses to write back fields. Dugout filters on this to attribute changes correctly.",
      placeholder: "005A0000001abcD",
    },
    {
      key: "swyft_workspace_slug",
      label: "Swyft workspace slug (display only)",
      type: "text",
      required: false,
      description: "Your Swyft workspace name. For labeling only.",
      placeholder: "acme",
    },
    {
      key: "fields_tracked",
      label: "Salesforce fields Swyft writes to",
      type: "text",
      required: false,
      description:
        "Comma-separated. e.g. NextStep, Decision_Criteria__c, Economic_Buyer__c",
      placeholder: "NextStep, Decision_Criteria__c, Champion__c",
    },
  ],
  requiredScopes: [],
  webhooks: [],
  webhookSigning: "n/a",
  rateLimit: "Bounded by Salesforce daily API limit (downstream read)",
  syncModel: "hourly_poll",
  dataFreshness: "5-15 min after a call ends (Swyft's write to SF) + your SF poll cadence",
  headlessSetup: false,
  keyGotchas: [
    "Connect Salesforce first - this integration is fully derived from Salesforce reads.",
    "Swyft requires Salesloft admin privileges + all requested scopes granted. Partial scopes break it silently.",
    "Gong integration on the Swyft side requires the customer's Gong Technical Administrator seat - same constraint as the Gong connection here.",
  ],
};
