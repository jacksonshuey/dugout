// Legacy account_id → display-name map. Supabase external_signals rows
// written before the brand-aligned pkey rename (session 2026-05-26) still
// carry the original codename pkeys. Without this map the UI falls back to
// rendering "acc_atlas" or "acc_cobalt" verbatim in chips and tables.
//
// Remove an entry only after the underlying Supabase rows have been
// migrated to the new pkey. Until then, this map is the single source of
// truth for legacy ID resolution.

export const LEGACY_ACCOUNT_ALIASES: Record<string, string> = {
  acc_atlas: "Snowflake",
  acc_meridian: "KKR & Co.",
  acc_sentinel: "CNA Financial",
  acc_horizon: "Atlassian",
  acc_cobalt: "Stripe",
  acc_apex: "Moderna",
  acc_northwind: "ConocoPhillips",
  acc_helios: "UnitedHealth",
  acc_vector: "Boeing",
  acc_quantum: "UPS",
  acc_stratos: "Civitas",
};
