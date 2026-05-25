import { accounts } from "@/data/seed";
import type { Account } from "./types";

// Onboarding company search. Two-source lookup:
//   1. Existing tracked accounts — substring match against `accounts` (seed).
//      These already have a primary key (`acc_xxx`) and full pipeline state.
//   2. External candidates — Clearbit Autocomplete. Returns name + domain
//      for any reasonably-known company. No auth required (Clearbit's
//      autocomplete endpoint is a free, lightly rate-limited public API).
//
// Results are merged in the UI, not here — the API returns the two lists
// separately so the page can render "already tracked" above "add to your
// session" with distinct CTAs.

export interface ExistingMatch {
  /** AccountId of the seed/Supabase account. */
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  ticker?: string;
}

export interface ExternalMatch {
  /** Provisional id derived from the company domain. Becomes the AccountId
   *  when the user adds this candidate to their session. */
  provisionalId: string;
  name: string;
  domain: string;
  logoUrl: string;
}

const CLEARBIT_AUTOCOMPLETE =
  "https://autocomplete.clearbit.com/v1/companies/suggest";
const CLEARBIT_TIMEOUT_MS = 5_000;
const MAX_RESULTS = 6;

export async function searchExistingAccounts(
  query: string,
): Promise<ExistingMatch[]> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return accounts
    .filter((a) => a.name.toLowerCase().includes(q))
    .slice(0, MAX_RESULTS)
    .map(toExistingMatch);
}

export async function searchExternalCompanies(
  query: string,
): Promise<ExternalMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLEARBIT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${CLEARBIT_AUTOCOMPLETE}?query=${encodeURIComponent(q)}`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      name: string;
      domain: string;
      logo: string | null;
    }>;
    return data.slice(0, MAX_RESULTS).map(toExternalMatch);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toExistingMatch(a: Account): ExistingMatch {
  return {
    id: a.id,
    name: a.name,
    domain: a.domain,
    industry: a.industry,
    ticker: a.ticker,
  };
}

function toExternalMatch(c: {
  name: string;
  domain: string;
  logo: string | null;
}): ExternalMatch {
  const provisionalId = `acc_${c.domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
  return {
    name: c.name,
    domain: c.domain,
    provisionalId,
    logoUrl: `https://img.logo.dev/${c.domain}?token=${process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN ?? ""}`,
  };
}
