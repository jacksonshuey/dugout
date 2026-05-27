// Integration setup specs - drives the "Connect" popup on the
// Integrations tab. Each source declares its auth method, the form
// fields the user fills in, the OAuth scopes (if any), webhook events,
// and the operational shape (sync model, rate limit, freshness).

export type AuthMethod =
  | "oauth2"
  | "api_key"
  | "personal_access_token"
  | "jwt"
  | "none";

export type SetupFieldType = "text" | "password" | "url" | "select";

export type SyncModel =
  | "realtime"
  | "webhooks"
  | "hourly_poll"
  | "daily_sync"
  | "bulk_export"
  | "on_demand";

export interface SetupField {
  key: string;
  label: string;
  type: SetupFieldType;
  required: boolean;
  description: string;
  placeholder?: string;
  options?: readonly string[]; // for select
  // True for sensitive fields - the value is masked in the UI and stored
  // in Supabase Vault, not plain environment variables.
  secret?: boolean;
}

export interface WebhookEvent {
  event: string;
  description: string;
}

// Direction of data flow from Dugout's perspective.
// - read: Dugout pulls data only. Source of truth is the vendor.
// - write: Dugout pushes only. No reads happen here (Slack, Calendly).
// - both: Dugout reads AND writes (rare; reserved for systems that need
//   round-trip sync). Dugout's policy is read-only on CRMs.
export type DataDirection = "read" | "write" | "both";

export interface IntegrationSpec {
  source: string;
  brandKey?: string;
  tagline: string;
  // The direction matters because read sources never need write scopes
  // and write sources never need pull cadence. Surfaced as a badge in
  // the popup so the customer immediately knows "Dugout is touching my
  // data" vs "Dugout is just delivering to a channel I picked".
  direction: DataDirection;
  // For write/both integrations only: a 1-line summary of what Dugout
  // actually writes. e.g., "AE-targeted Slack DMs on blocking signals."
  writes?: string;
  auth: {
    method: AuthMethod;
    docsUrl: string;
    notes: string;
  };
  baseUrl: string;
  // Ordered: render top-to-bottom in the popup.
  setupFields: readonly SetupField[];
  // Empty array means no scopes (API key or public). Order matters - we
  // show the user the list before they click "Authorize".
  requiredScopes: readonly string[];
  // Empty array means poll-only. With at least one entry, the popup shows
  // "Dugout will receive these events" and surfaces the webhook URL the
  // user pastes into the vendor's admin console.
  webhooks: readonly WebhookEvent[];
  // How webhooks are verified. "n/a" when no webhooks.
  webhookSigning: string;
  rateLimit: string;
  syncModel: SyncModel;
  dataFreshness: string;
  // True if connect-popup is fully self-serve (no out-of-band admin
  // clickthrough). False when the user has to do something in the vendor
  // admin console too; details in keyGotchas.
  headlessSetup: boolean;
  keyGotchas: readonly string[];
}
