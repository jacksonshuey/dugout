// Types for the news content filter (Stage 1 deterministic + Stage 2 Haiku).
//
// Pure type module — no imports. Keeps the filter dependency graph shallow:
// stage1, stage2 prompt, audit CRUD, and the news-adapter all import from
// here and nowhere else for shared shapes.
//
// Mirrors the email-filter-types.ts pattern, applied to NewsAPI articles.

// Combined per-article verdict emitted by stage 1 + stage 2 together.
//   - "newsworthy": pass-through; classify + generate bullet
//   - "low_signal": borderline; accept but tag workspace_relevance=low
//   - "rejected":   drop the article entirely
export type NewsVerdict = "newsworthy" | "low_signal" | "rejected";

// Workspace-relevance tier, persisted on external_signals.workspace_relevance.
// Drives the AE Brief filter at render time.
export type WorkspaceRelevance = "high" | "medium" | "low" | "none";

// Stage 1 deterministic gate output.
//   - "rejected": short-circuit; do not call Haiku
//   - "passed":   forward to stage 2
export interface Stage1Result {
  verdict: "rejected" | "passed";
  reason: string; // human-readable, ends up in audit row
  rule: string;   // machine-readable rule id (e.g. "domain_blacklist:foo.com",
  //                "title_listicle_pattern", "passthrough")
}

// Stage 2 Haiku-classified output. Returned by the model under tool-use,
// post-validated for range + length before being trusted.
export interface Stage2Result {
  verdict: NewsVerdict;
  workspace_relevance: WorkspaceRelevance;
  confidence: number;   // 0..1 inclusive
  reasoning: string;    // ≤200 chars, ends up in audit row
  model: string;        // "claude-haiku-4-5" or fallback identifier
}

// Combined orchestrator output. Exactly one of {rule, confidence} is
// populated depending on which stage decided.
//   - stage === 1 → rule is set, confidence is null
//   - stage === 2 → confidence is set, rule may be null
export interface NewsFilterDecision {
  verdict: NewsVerdict;
  workspace_relevance: WorkspaceRelevance;
  stage: 1 | 2;                // which stage decided
  rule: string | null;         // stage 1's rule id if stage===1
  confidence: number | null;   // stage 2's confidence if stage===2
  reasoning: string;
  model: string | null;
  prompt_version: string;      // bump when prompt changes
}

// Article shape we receive from news-adapter — minimal projection of
// NewsAPI's Article type. The filter doesn't need the full payload.
export interface ArticleInput {
  url: string;
  title: string;
  description: string | null;  // NewsAPI provides this; sometimes null
  source_name: string;         // e.g. "TechCrunch"
  source_domain: string;       // e.g. "techcrunch.com"
  published_at: string;        // ISO
  author: string | null;
}

// Context for the stage 2 call. The orchestrator builds this from the
// account/workspace config. primary_vertical is hardcoded to "tech_ai" in
// v1 — Checkbox's primary lens. Future: per-workspace.
export interface FilterContext {
  account_name: string;
  account_industry: string | null;
  account_id: string;
  workspace_name: string;
  primary_vertical: string;
}

// Bump version when prompt semantics change. Forward-apply only — new version
// invalidates any cached decisions so next cron run re-classifies fresh articles.
// v1.1: tightened Stage 2 to reject-by-default + explicit reject keyword list.
export const PROMPT_VERSION = "news-filter-v1.1";
