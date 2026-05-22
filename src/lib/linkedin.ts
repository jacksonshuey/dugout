// LinkedIn deep-link builders. Two-mode design:
//   1. Known profile → direct URL (linkedin.com/company/<slug>/ or full
//      linkedinUrl for contacts).
//   2. Unknown profile → LinkedIn search URL scoped to the name (+ account
//      name for people). This is what an SDR would type into LinkedIn
//      anyway, so the fallback is honest rather than synthetic.
//
// Why no programmatic scraping or slug-guessing: TOS violation, IP bans,
// fragile. We treat LinkedIn as a destination, not a data source.

import type { Account, Contact } from "./types";

const BASE = "https://www.linkedin.com";

export function companyLinkedinUrl(
  account: Pick<Account, "linkedinSlug" | "name">,
): string {
  if (account.linkedinSlug) {
    return `${BASE}/company/${account.linkedinSlug}/`;
  }
  return `${BASE}/search/results/companies/?keywords=${encodeURIComponent(account.name)}`;
}

export function contactLinkedinUrl(
  contact: Pick<Contact, "linkedinUrl" | "name">,
  accountName?: string,
): string {
  if (contact.linkedinUrl) return contact.linkedinUrl;
  const query = accountName ? `${contact.name} ${accountName}` : contact.name;
  return `${BASE}/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

// True when the link resolves directly to a known profile (vs a search page).
// Surfaces in the UI title attribute so users know what a click will do.
export function isDirectCompanyLink(
  account: Pick<Account, "linkedinSlug">,
): boolean {
  return !!account.linkedinSlug;
}

export function isDirectContactLink(
  contact: Pick<Contact, "linkedinUrl">,
): boolean {
  return !!contact.linkedinUrl;
}
