import { supabaseAdmin } from "./supabase";

// External signals: source-agnostic event store keyed by account.
// Persisted in Supabase (table `external_signals`). Source attribution
// tells the UI whether a signal came from live web search, seeded demo
// data, SEC filings, or a manual entry.

export type ExternalSignalSource =
  | "newsapi" // primary v1 source — NewsAPI + Haiku classification
  | "sec_edgar" // future — public-company 8-K filings
  | "newsletter" // workspace-wide intel via SendGrid Inbound Parse
  | "claude_web_search" // deprecated — too slow for sync 60s budget
  | "manual"
  | "demo";

// Sentinel account_id for signals that aren't tied to any specific tracked
// account — e.g. a newsletter article about a broad market trend. Stored as
// a string so the existing schema (NOT NULL account_id) doesn't need a
// migration. Queries that scope per-account (`.eq("account_id", id)`) will
// never match this value because no real Account uses it.
export const WORKSPACE_ACCOUNT_ID = "__workspace__";

export type ExternalSignalType =
  | "leadership_change"
  | "champion_job_change"
  | "ma_acquisition"
  | "funding_round"
  | "layoff"
  | "earnings"
  | "product_launch"
  | "press_release"
  | "competitor_mention"
  | "regulatory_action"
  | "partnership"
  | "other";

export interface ExternalSignal {
  id: string;
  account_id: string;
  source: ExternalSignalSource;
  type: ExternalSignalType;
  summary: string;
  occurred_at: string; // ISO timestamp
  url?: string | null;
  meta?: Record<string, unknown> | null;
  is_demo: boolean;
  created_at: string;
}

export interface NewExternalSignal {
  account_id: string;
  source: ExternalSignalSource;
  type: ExternalSignalType;
  summary: string;
  occurred_at: string;
  url?: string | null;
  meta?: Record<string, unknown> | null;
  is_demo?: boolean;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSignalsForAccount(
  accountId: string,
  limit = 50,
): Promise<ExternalSignal[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .eq("account_id", accountId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as ExternalSignal[];
}

export async function getAllSignals(limit = 500): Promise<ExternalSignal[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as ExternalSignal[];
}

// Workspace-scoped signals (account_id = WORKSPACE_ACCOUNT_ID). These are
// market-wide items extracted from newsletters that aren't tied to any
// specific tracked account. The digest synthesizer reads from here to add a
// "market intelligence" block above the per-deal signals.
export async function getWorkspaceSignals(
  sinceIso: string,
  limit = 50,
): Promise<ExternalSignal[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .eq("account_id", WORKSPACE_ACCOUNT_ID)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as ExternalSignal[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Insert one signal. Returns the persisted row.
export async function insertSignal(
  signal: NewExternalSignal,
): Promise<ExternalSignal> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("external_signals")
    .insert({ ...signal, is_demo: signal.is_demo ?? false })
    .select()
    .single();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data as ExternalSignal;
}

// Bulk insert with simple dedup-by-url: if a signal with the same account_id
// + url already exists, skip it. Returns the inserted count.
//
// This is good-enough dedup for daily cron runs — real production would use
// a unique constraint + ON CONFLICT, but this keeps the schema simple and
// works fine at our volume.
export async function insertSignalsDedup(
  signals: NewExternalSignal[],
): Promise<{ inserted: number; skipped: number }> {
  if (signals.length === 0) return { inserted: 0, skipped: 0 };
  const sb = supabaseAdmin();

  // Pull existing URLs for these accounts to dedup against
  const accountIds = [...new Set(signals.map((s) => s.account_id))];
  const { data: existing } = await sb
    .from("external_signals")
    .select("account_id, url")
    .in("account_id", accountIds)
    .not("url", "is", null);
  const existingKey = new Set(
    (existing ?? []).map((r) => `${r.account_id}::${r.url}`),
  );

  const toInsert = signals.filter((s) => {
    if (!s.url) return true; // can't dedup without URL — let it through
    return !existingKey.has(`${s.account_id}::${s.url}`);
  });

  if (toInsert.length === 0) return { inserted: 0, skipped: signals.length };

  const { error } = await sb.from("external_signals").insert(
    toInsert.map((s) => ({ ...s, is_demo: s.is_demo ?? false })),
  );
  if (error) throw new Error(`Supabase bulk insert failed: ${error.message}`);

  return {
    inserted: toInsert.length,
    skipped: signals.length - toInsert.length,
  };
}
