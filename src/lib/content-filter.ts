// Shared contract for every "is this content worth surfacing?" Haiku call
// site in the pipeline. Today each source-specific adapter (newsletter,
// web_scrape, newsapi via news-filter-v3) defines its own input/output
// shapes; this module gives them all one type vocabulary so future
// orchestration code can speak about "a content filter" without caring
// about the source.
//
// Design constraints:
//   1. Type-only module - no runtime imports beyond WorkspaceRelevance.
//      Keeps the dependency graph shallow so adapters can import without
//      pulling in supabase, anthropic, etc.
//   2. Generic over the content payload `T` so newsletter adapters can
//      pass `InboundEmail`, news adapters can pass `ArticleInput`, and
//      web-scrape adapters can pass `WebScrape` without losing type info.
//   3. The orchestration (Stage 1 → Stage 2 → audit) lives in each
//      source-specific adapter, NOT here. This is purely the contract.
//
// Alignment with news-filter-v3: that branch defines its own
// `FilterContext` and `Stage2Result` shapes in `news-filter-types.ts`.
// Both shapes are compatible with this contract - news-filter-v3's
// `FilterContext` is a superset of ours; its `Stage2Result` is a
// `FilterResult` plus a `model` field. When v3 merges, that file should
// re-export `WorkspaceRelevance` from here and converge on this
// `FilterContext` shape.

import type { WorkspaceRelevance } from "./workspace-relevance";

// Per-call context the Haiku prompt embeds in the user message. Required
// fields are the minimum every filter needs; optional fields are present
// for account-aware filters (news, web_scrape) and absent for purely
// workspace-scoped filters (some newsletter call sites).
export interface FilterContext {
  account_name?: string;
  account_industry?: string | null;
  account_id?: string;
  workspace_name: string;
  // Primary vertical of the workspace - e.g. "tech_ai". The
  // WORKSPACE_RELEVANCE_DEFINITION prose uses this to anchor the rubric.
  primary_vertical: string;
}

// Where the filter input came from. Drives audit row routing + the
// minified signal payload the ranker eventually sees.
export type ContentFilterSource =
  | "newsletter"   // inbound email body, classified by newsletter-adapter
  | "newsapi"      // NewsAPI article, classified by news-filter (v3 branch)
  | "web_scrape";  // Firecrawl markdown, classified by web-scrape-classifier

// Generic content envelope. `T` is the source-specific payload (email
// row, article projection, web-scrape row). Adapters narrow `T` to their
// own type when implementing the filter.
export interface FilterInput<T> {
  content: T;
  context: FilterContext;
  source: ContentFilterSource;
}

// Source-agnostic verdict + relevance tier. Every adapter post-validates
// the Haiku tool output against this shape before persisting.
//
// `verdict` is the gate decision:
//   - "newsworthy" → keep + surface
//   - "low_signal" → keep but tag low; AE Brief filter hides, drawer keeps
//   - "rejected"   → drop entirely (drawer + brief both hide)
//
// `workspace_relevance` is independent of verdict in spirit but coerced
// to "none" whenever verdict is "rejected" (every adapter enforces this
// in post-validation).
export type ContentFilterVerdict = "newsworthy" | "low_signal" | "rejected";

export interface FilterResult {
  verdict: ContentFilterVerdict;
  workspace_relevance: WorkspaceRelevance;
  confidence: number;    // 0..1 inclusive; ≥0.7 = trusted, <0.7 = needs_review
  reasoning: string;     // ≤220 chars, plain prose, one sentence
}
