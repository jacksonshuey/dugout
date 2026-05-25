import { supabaseAdmin } from "./supabase";
import type { Account, AccountSegment, Industry } from "./types";

// DB-backed accounts helper. Pairs with the `accounts` table introduced in
// supabase/migrations/20260524_accounts_table.sql. seed.ts is still the
// source of truth for demo scenarios (acc_atlas, acc_meridian, acc_sentinel
// + the 8 other seeded fixtures); this module is the production-addition
// path, used by POST /api/accounts (Phase 4 onboarding).
//
// Design notes:
// - We keep the seed.ts vs DB split deliberate. The signal engine,
//   metrics.md SV Health assertions, and demo-verification script all
//   read seed.ts - moving those into the DB would force every test +
//   demo run to maintain DB state. Production additions (AE adds Cisco
//   mid-quarter) need to live somewhere persistent, hence this table.
// - listTrackableAccounts() returns ONLY DB rows. Callers that want the
//   combined view (seed + DB) merge in the seed list themselves - keeps
//   the seam clean and avoids importing seed.ts from server lib code.
// - id is a uuid, generated server-side by Postgres. seed.ts uses the
//   `acc_<name>` slug convention - those won't collide with uuids.

export interface NewAccountInput {
  name: string;
  website: string;
  industry?: string;
  segment?: string;
  ticker?: string;
  domain?: string;
  paths?: string[];
}

interface AccountRow {
  id: string;
  name: string;
  website: string;
  domain: string | null;
  industry: string | null;
  segment: string | null;
  ticker: string | null;
  trackable: boolean;
  paths: string[] | null;
  is_demo_scenario: boolean;
  created_at: string;
}

// Best-effort cast back to the shared Account interface. Industry +
// segment are stored as freeform text in Postgres but the in-memory
// Account type narrows them - we cast through `unknown` so callers don't
// have to widen. If a DB row has a value outside the narrowed unions,
// downstream consumers either render it as-is or fall through to "Other".
function rowToAccount(row: AccountRow): Account {
  // Derive hqLocation/legalTeamSize as empty values - DB-added accounts
  // don't yet carry these (Phase 4 keeps onboarding minimal). The signal
  // engine's stage-age + complexity rules are tolerant of zero values.
  return {
    id: row.id,
    name: row.name,
    industry: (row.industry ?? "SaaS") as Industry,
    segment: (row.segment ?? "Mid-Market") as AccountSegment,
    hqLocation: "",
    legalTeamSize: 0,
    trackable: row.trackable,
    website: row.website,
    domain: row.domain ?? undefined,
    ticker: row.ticker ?? undefined,
    isDemoScenario: row.is_demo_scenario,
    paths: row.paths ?? undefined,
  };
}

export async function insertAccount(input: NewAccountInput): Promise<Account> {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("account name required");
  }
  if (!input.website || input.website.trim().length === 0) {
    throw new Error("account website required");
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("accounts")
    .insert({
      name: input.name.trim(),
      website: input.website.trim(),
      domain: input.domain ?? null,
      industry: input.industry ?? null,
      segment: input.segment ?? null,
      ticker: input.ticker ?? null,
      paths: input.paths && input.paths.length > 0 ? input.paths : null,
      trackable: true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`accounts insert failed: ${error.message}`);
  }

  return rowToAccount(data as AccountRow);
}

// Returns trackable accounts from the DB only. Callers that want the
// combined seed + DB view merge `accounts` from seed.ts themselves -
// keeps server-lib code free of import cycles into the seed fixtures.
export async function listTrackableAccounts(): Promise<Account[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("accounts")
    .select("*")
    .eq("trackable", true)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`accounts read failed: ${error.message}`);
  }

  return ((data ?? []) as AccountRow[]).map(rowToAccount);
}
