import { supabaseAdmin } from "./supabase";
import type { AccountId } from "./types";

// External signals: source-agnostic event store keyed by account.
// Persisted in Supabase (table `external_signals`). Source attribution
// tells the UI whether a signal came from live web search, seeded demo
// data, SEC filings, or a manual entry.

export type ExternalSignalSource =
  | "newsapi" // NewsAPI + Haiku classification
  | "sec_edgar" // public-company 8-K filings
  | "newsletter" // workspace-wide intel via the AgentMail webhook
  | "web_scrape" // per-account Firecrawl markdown scrape + Haiku classifier
  | "claude_web_search" // deprecated - too slow for sync 60s budget
  | "manual"
  | "demo";

// Sentinel account_id for signals that aren't tied to any specific tracked
// account - e.g. a newsletter article about a broad market trend. Stored as
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
  account_id: AccountId;
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
  // suppressed rows don't render on /market-intel (Q0 resolution - see
  // docs/filter-design.md §12).
  suppressed_at?: string | null;
  // Universal source-content persistence (20260524_signal_source_content):
  // the exact body the analyzer used to derive the signal, normalized to
  // markdown (or plain text for SEC filings). Drives the non-email render
  // path in SourcePreviewModal. Newsletter signals also populate this so
  // every signal carries its derivation source in one canonical column.
  source_content_md?: string | null;
  source_content_kind?:
    | "email_html"
    | "email_text"
    | "news_article_md"
    | "firecrawl_md"
    | "sec_filing_md"
    | null;
  // Workspace relevance tier set by the news content filter (Stage 2 Haiku).
  // Optional + nullable so existing rows (NULL) type-check correctly. The AE
  // Brief query at /market-intel filters on this; see migration
  // 20260524_news_filter.sql.
  workspace_relevance?: "high" | "medium" | "low" | "none" | null;
  created_at: string;
}

export interface NewExternalSignal {
  account_id: AccountId;
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
  source_content_md?: string | null;
  source_content_kind?: ExternalSignal["source_content_kind"];
  // Workspace-relevance tier set by the upstream Haiku content filter
  // (newsletter-adapter, web-scrape-classifier, news-filter). Optional so
  // legacy demo/manual writers keep type-checking; the AE Brief filter
  // hides NULL rows (treated as 'none'). See migration
  // 20260524_news_filter.sql for the column + check constraint.
  workspace_relevance?: ExternalSignal["workspace_relevance"];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSignalsForAccount(
  accountId: AccountId,
  limit = 50,
): Promise<ExternalSignal[]> {
  const sb = supabaseAdmin();
  // Quality filter: for NewsAPI signals, only surface rows that the Haiku
  // content filter marked 'high' or 'medium' workspace_relevance. Rows with
  // workspace_relevance NULL are pre-filter legacy signals; rows tagged 'low'
  // or 'none' are low-quality results (lifestyle, sports, off-topic) that
  // passed the old heuristic but should not reach the AE.
  //
  // Non-NewsAPI sources (newsletter, sec_edgar, demo, manual, web_scrape) are
  // always shown - they were filtered upstream by their own pipelines.
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .eq("account_id", accountId)
    .or(
      "source.neq.newsapi,workspace_relevance.in.(high,medium)",
    )
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
  // Universal-source filter: only return signals that carry a verifiable
  // source - either an inbound_email_id (newsletter body in inbound_emails)
  // or persisted source_content_md (NewsAPI / Firecrawl / SEC). Signals
  // without either are hidden until backfill catches them up. Honors the
  // principle "every signal must verify against the exact derivation source".
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .eq("account_id", WORKSPACE_ACCOUNT_ID)
    .is("suppressed_at", null)
    .or("inbound_email_id.not.is.null,source_content_md.not.is.null")
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as ExternalSignal[];
}

// Account-level signals tagged as high or medium workspace relevance by the
// two-stage Haiku news filter (PR #31). These are account-specific items
// (account_id != WORKSPACE_ACCOUNT_ID) that the filter determined are worth
// surfacing in the workspace-wide AE Brief. The 48h lookback keeps the Brief
// focused on the freshest material; 100-row limit is belt-and-braces.
//
// Used by /market-intel to merge a second signal pool into the AE Brief
// alongside the workspace-scoped newsletter pool (WS3).
export async function getHighRelevanceSignals(
  lookbackMs: number,
): Promise<ExternalSignal[]> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - lookbackMs).toISOString();
  const { data, error } = await sb
    .from("external_signals")
    .select("*")
    .neq("account_id", WORKSPACE_ACCOUNT_ID)
    .in("workspace_relevance", ["high", "medium"])
    .is("suppressed_at", null)
    .or("inbound_email_id.not.is.null,source_content_md.not.is.null")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(100);
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
// This is good-enough dedup for daily cron runs - real production would use
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
    if (!s.url) return true; // can't dedup without URL - let it through
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
