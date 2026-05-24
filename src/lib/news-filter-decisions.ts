// Supabase CRUD for `news_filter_decisions`.
//
// Dual-purpose audit shape: each row records EITHER a "kept" decision
// (verdict 'newsworthy' or 'low_signal' — external_signal_id set to the
// signal row just inserted) OR a "rejected" decision (verdict 'rejected' —
// external_signal_id is null, since no signal row was written). The
// `article_url` is always populated so rejected articles are still
// auditable end-to-end.
//
// Fail-soft: any write failure is logged + swallowed so a Supabase outage
// never breaks the news adapter. Intentionally side-effectful (writes
// Supabase) — BUILD_ALIGNMENT #7 "pure where possible" carve-out: audit
// I/O has to live somewhere, and isolating it here keeps the orchestrator
// pure. Mirrors `email-filter-decisions.ts`.

import { supabaseAdmin } from "./supabase";
import type { NewsFilterDecision } from "./news-filter-types";

const TABLE = "news_filter_decisions";

type DecisionRow = {
  article_url: string;
  external_signal_id: string | null;
  account_id: string;
  decision: NewsFilterDecision;
};

// Map the in-memory decision shape onto the table's column layout. Kept
// pure (no I/O) so both the single + bulk paths share one serializer.
function toInsert(row: DecisionRow) {
  return {
    article_url: row.article_url,
    external_signal_id: row.external_signal_id,
    account_id: row.account_id,
    stage: row.decision.stage,
    verdict: row.decision.verdict,
    workspace_relevance: row.decision.workspace_relevance,
    confidence: row.decision.confidence,
    rule: row.decision.rule,
    reasoning: row.decision.reasoning,
    model: row.decision.model,
    prompt_version: row.decision.prompt_version,
  };
}

/** Persist a single filter decision. Best-effort; logs and swallows errors
 *  so a Supabase outage never breaks the news adapter. */
export async function writeNewsFilterDecision(args: {
  article_url: string;
  external_signal_id: string | null;
  account_id: string;
  decision: NewsFilterDecision;
}): Promise<void> {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch (e) {
    console.warn(
      `[news-filter] supabase unavailable: ${e instanceof Error ? e.message : String(e)} url=${args.article_url} — continuing`,
    );
    return;
  }

  try {
    const { error } = await sb.from(TABLE).insert(toInsert(args));
    if (error) {
      console.warn(
        `[news-filter] audit_write_failed: ${error.message} url=${args.article_url} — continuing`,
      );
    }
  } catch (e) {
    console.warn(
      `[news-filter] audit_write_failed: ${e instanceof Error ? e.message : String(e)} url=${args.article_url} — continuing`,
    );
  }
}

/** Bulk insert — used by the news-adapter when processing a batch of
 *  articles from one NewsAPI call. Single round-trip per batch keeps
 *  audit I/O off the per-article hot path. */
export async function writeNewsFilterDecisions(
  decisions: Array<{
    article_url: string;
    external_signal_id: string | null;
    account_id: string;
    decision: NewsFilterDecision;
  }>,
): Promise<void> {
  if (decisions.length === 0) return;

  let sb;
  try {
    sb = supabaseAdmin();
  } catch (e) {
    console.warn(
      `[news-filter] supabase unavailable: ${e instanceof Error ? e.message : String(e)} count=${decisions.length} — continuing`,
    );
    return;
  }

  try {
    const { error } = await sb.from(TABLE).insert(decisions.map(toInsert));
    if (error) {
      console.warn(
        `[news-filter] audit_bulk_write_failed: ${error.message} count=${decisions.length} — continuing`,
      );
    }
  } catch (e) {
    console.warn(
      `[news-filter] audit_bulk_write_failed: ${e instanceof Error ? e.message : String(e)} count=${decisions.length} — continuing`,
    );
  }
}
