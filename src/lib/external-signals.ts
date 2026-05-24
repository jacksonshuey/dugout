import { supabaseAdmin } from "./supabase";

// External signals: source-agnostic event store keyed by account.
// Persisted in Supabase (table `external_signals`). Source attribution
// tells the UI whether a signal came from live web search, seeded demo
// data, SEC filings, or a manual entry.

export type ExternalSignalSource =
  | "newsapi" // NewsAPI + Haiku classification
  | "sec_edgar" // public-company 8-K filings
  | "newsletter" // workspace-wide intel via the AgentMail webhook
  | "web_scrape" // per-account Firecrawl markdown scrape + Haiku classifier
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
  // Source-attribution columns (20260525 migration). All optional so old
  // rows continue to type-check; the newsletter-adapter populates them on
  // every new write going forward.
  publisher_canonical_name?: string | null;
  source_url?: string | null;
  inbound_email_id?: string | null;
  email_subject?: string | null;
  // Set by /api/admin/signal-feedback when an operator marks a signal as
  // bad. `getWorkspaceSignals()` filters `where suppressed_at is null` so
  // suppressed rows don't render on /market-intel (Q0 resolution — see
  // docs/filter-design.md §12).
  suppressed_at?: string | null;
  // Workspace relevance tier set by the news content filter (Stage 2 Haiku).
  // Optional + nullable so existing rows (NULL) type-check correctly. The AE
  // Brief query at /market-intel filters on this; see migration
  // 20260524_news_filter.sql.
  workspace_relevance?: "high" | "medium" | "low" | "none" | null;
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
  publisher_canonical_name?: string | null;
  source_url?: string | null;
  inbound_email_id?: string | null;
  email_subject?: string | null;
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
  // `suppressed_at is null` filter implements Q0: signals that an operator
  // manually flagged via /api/admin/signal-feedback disappear from
  // /market-intel. Older rows that pre-date the column also satisfy this
  // (NULL is null), so the filter is backward-compatible.
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .eq("account_id", WORKSPACE_ACCOUNT_ID)
    .is("suppressed_at", null)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as ExternalSignal[];
}

// Suppress a single signal from the workspace feed. Sets `suppressed_at`
// to now(). Idempotent (multiple suppress calls just refresh the
// timestamp). Returns the count of rows updated (0 or 1).
//
// Used by /api/admin/signal-feedback so a "Mark as bad signal" click
// makes the row disappear from /market-intel. See Q0 in
// docs/filter-design.md §12.
export async function suppressSignal(signalId: string): Promise<number> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("external_signals")
    .update({ suppressed_at: new Date().toISOString() })
    .eq("id", signalId)
    .select("id");
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
  return (data ?? []).length;
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
//
// DO NOT convert this to .upsert() with column updates without auditing
// news-adapter.ts. News-adapter writes its own rows directly (to capture
// the inserted id for news_filter_decisions FK linkage), then passes them
// back to the cron, which calls this function expecting the URL dedup to
// no-op. An upsert that updates columns would clobber the Haiku-generated
// bullet, workspace_relevance, and meta.classifier on those rows.
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
