// Types for the market-intel ranker.
//
// Pure type module — no imports beyond ExternalSignal. Keeps the ranker
// dependency graph shallow: the cache, stub, prompt, and main entry all
// import from here and nowhere else for shared shapes.
//
// Design doc: /docs/ranker-design.md §3.

import type { ExternalSignal } from "./external-signals";

// What the ranker receives. Workspace-scoped, time-windowed.
export interface RankerInput {
  workspaceKey: string; // slug of WorkspaceConfig.companyName
  signals: ExternalSignal[]; // last-48h workspace signals (pre-filtered)
  accountKeywords: AccountKeyword[]; // for relevance fan-in; cheap match hints
  topN?: number; // default 20; cap 50
  now: Date; // pass-in for testability (no Date.now in core)
}

// Tracked-account context. The ranker uses this to recognize when a signal
// references one of the workspace's named accounts. Cheap subset of Account.
//
// `domain_slug` is the bare apex slug derived from Account.website (e.g.
// "modernatx.com" → "modernatx"). When an account has no website on the seed
// row we set domain_slug to undefined and fall back to name + ticker matching.
export interface AccountKeyword {
  account_id: string; // e.g. "acc_helios"
  name: string; // "Helios Manufacturing"
  ticker?: string; // "HLOS"
  domain_slug?: string; // "helios"
}

// One ranked item. Does NOT carry the full ExternalSignal; consumers join by
// signal_id. Keeps cache payload small and refactors to ExternalSignal don't
// cascade into the ranker.
export interface RankedItem {
  signal_id: string; // → ExternalSignal.id
  rank: number; // 1..topN, dense, no gaps
  rationale: string; // ≤25 words, plain prose, must include "[citation:<signal_id>]" inline
  related_account_ids?: string[]; // optional; matches AccountKeyword.account_id
}

// Wrapper returned by rankSignals().
export interface RankerResult {
  items: RankedItem[]; // length ≤ topN; may be []
  generated_at: string; // ISO; for cache-age UI hint
  source: "haiku" | "stub"; // which path produced this
  stubReason?: StubReason; // set only when source === "stub"
  cache_hit: boolean; // for log/debug; not displayed
}

// Why the ranker degraded to deterministic.
export type StubReason =
  | "no_api_key" // ANTHROPIC_API_KEY missing
  | "haiku_5xx" // any 5xx from Anthropic (after SDK retries)
  | "haiku_timeout" // request exceeded 15s wall clock
  | "haiku_malformed_json" // parser couldn't validate response
  | "haiku_schema_violation" // valid JSON, failed our schema (>20, missing field, bad signal_id, citation mismatch, items>signals)
  | "empty_input"; // signals: [] — short-circuit to empty result

// Cache key composition — deterministic, no Date.now inside the type.
export interface CacheKey {
  workspace_key: string; // slugified workspace name
  date_bucket: string; // formatHourBucketUTC(now) → "2026-05-23-17"
}

// Cache row as stored in Supabase.
export interface CacheEntry {
  workspace_key: string; // primary key part 1
  date_bucket: string; // primary key part 2
  result_json: RankerResult; // serialized RankerResult
  created_at: string; // ISO; ranker treats >1h as expired
}
