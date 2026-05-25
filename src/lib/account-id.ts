import type { AccountId } from "./types";

// Generates a deterministic `acc_<slug>` primary key for a new seed
// account from a company name. Production-onboarded accounts get a UUID
// from Supabase (`gen_random_uuid()` per the accounts-table migration)
// and should NOT use this helper — this exists so future seed additions
// follow the same `acc_xxx` convention the current seed uses.
//
// Behavior:
//   - lowercases + ASCII-folds the name
//   - collapses non-alphanumeric runs to a single underscore
//   - strips leading/trailing underscores
//   - caps the slug at 30 chars so account_id stays a comfortable column width
//   - prefixes with `acc_`
//
// Examples:
//   generateAccountId("SAP")                              → "acc_sap"
//   generateAccountId("Coca-Cola Europacific Partners")   → "acc_coca_cola_europacific_par"
//   generateAccountId("KKR & Co.")                        → "acc_kkr_co"
//   generateAccountId("  ")                               → throws

const MAX_SLUG_LEN = 30;

export function generateAccountId(companyName: string): AccountId {
  const slug = companyName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_SLUG_LEN)
    .replace(/_+$/g, ""); // re-strip trailing underscore if slice landed on one

  if (slug.length === 0) {
    throw new Error(
      `generateAccountId: company name "${companyName}" has no alphanumeric characters`,
    );
  }

  return `acc_${slug}` as AccountId;
}
