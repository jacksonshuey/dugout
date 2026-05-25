// Types for the email content filter (Stage 1 deterministic + Stage 2 Haiku).
//
// Pure type module — no imports beyond InboundEmail. Keeps the filter
// dependency graph shallow: stage1, stage2 prompt, audit CRUD, and main
// entry all import from here and nowhere else for shared shapes.
//
// Design doc: /docs/filter-design.md §3.

import type { InboundEmail } from "./inbound-email";

// Resolved publisher identity. The same publication can route through
// multiple sender domains (Endpoints uses endpts.com AND endpointsnews.com
// AND Campaign Monitor relays). `publisher_canonical_name` is the join
// key; `display_name` is what the UI shows; `source_url_origin` is an
// optional hint for extractLeadArticleUrl() when a publisher has a known
// article-URL pattern (e.g. all Substack lead URLs share an origin).
export interface PublisherInfo {
  publisher_canonical_name: string; // "endpoints_news" — slug, lowercase
  display_name: string; // "Endpoints News"
  source_url_origin?: string; // "https://endpts.com" — optional hint
  is_known: boolean; // false when we fell back to sender_domain
}

// What the filter receives. Single email, already persisted to
// inbound_emails. publisherInfo is resolved upstream (by the webhook/
// pipeline) so the filter doesn't have to re-do publisher lookup.
export interface FilterInput {
  email: InboundEmail; // full row, including text_body + html_body
  publisherInfo: PublisherInfo; // already resolved (may be a degenerate
  //                              "unknown" entry — see PublisherInfo)
  headers?: Record<string, string>; // raw email headers (lowercased keys);
  //                                  used by Stage 1 for auto-reply/bounce/
  //                                  list-id/content-type checks
  now: Date; // pass-in for testability — no Date.now in core
}

// The 5 deterministic rejection families. Each maps to a Stage 1 rule
// group in design §5. `detail` on Stage1Result.rejected carries which
// sub-rule fired (e.g., "subject_regex:password_reset").
export type EmailFilterRejectReason =
  | "subject_pattern" // §5.1 subject regex hit (also: ics attachment)
  | "sender_role" // §5.2 no-reply/billing/support/etc.
  | "body_thin_or_link_only" // §5.3 <200 words OR >90% link content OR only unsubscribe/preferences
  | "auto_reply_or_bounce" // §5.4 Auto-Submitted / X-Autoreply / Delivery-Status header
  | "empty_body"; // §5.5 trimmed body <50 chars after stripHtml

// Stage 1 deterministic output. `accepted` means "pass through to Stage 2";
// `rejected` means "do not call Haiku, write audit row, mark the inbound
// email classified with 0 signals."
export type Stage1Result =
  | {
      accepted: true;
      body_chars: number;
      link_ratio: number;
      list_id: string | null;
    }
  | {
      accepted: false;
      reason: EmailFilterRejectReason;
      detail: string;
    };

// Stage 2 Haiku verdict. The full enum is the 4 values from design §0.
export type Stage2Verdict =
  | "newsworthy"
  | "logistics"
  | "promotional"
  | "other";

// Tool-use output shape. Haiku is forced to call `submit_verdict` with
// exactly this object. The implementer post-validates length + range
// defensively (matches ranker pattern).
//
// `workspace_relevance` was added in the Phase 3 unification — previously
// the email filter only emitted a verdict, leaving the ranker without a
// relevance hint for newsletter-derived signals. Now every email decision
// carries one of the four workspace-relevance tiers per
// WORKSPACE_RELEVANCE_DEFINITION (src/lib/workspace-relevance.ts).
export interface Stage2Output {
  verdict: Stage2Verdict;
  workspace_relevance: import("./workspace-relevance").WorkspaceRelevance;
  confidence: number; // 0..1 inclusive
  reasoning: string; // 10..200 chars, plain prose, one sentence
}

// Why Stage 2 didn't return a usable verdict. All of these route to
// needs_review (fail-CLOSED) including `no_api_key` (the operator's
// deployment choice — see design §8 for the rationale).
export type Stage2FailureReason =
  | "no_api_key" // ANTHROPIC_API_KEY missing
  | "haiku_5xx" // any 5xx from Anthropic (after SDK retries)
  | "haiku_timeout" // request exceeded 15s wall clock
  | "haiku_malformed_json" // parser couldn't validate response
  | "haiku_schema_violation" // valid JSON, failed our schema
  | "low_confidence"; // verdict ok but confidence < 0.7

// A single audit row. Written at every gate decision branch — including
// rejects (stage=1) and low-confidence routing (stage=2,
// manually_overridden stays false until a human flips it via the
// feedback API).
export interface FilterDecision {
  inbound_email_id: string; // FK → inbound_emails.id
  stage: 1 | 2; // which gate produced the decision
  verdict: Stage2Verdict | "stage1_rejected"; // 5 distinct values total
  confidence: number | null; // null on Stage 1 rejects; 0 on no_api_key + other Stage 2 fail-closed paths
  reasoning: string; // Stage 1: which sub-rule fired. Stage 2: model's prose.
  model: string | null; // "claude-haiku-4-5" or null on Stage 1
  prompt_version: string; // "stage2-v1" (matches STAGE2_PROMPT_VERSION)
  manually_overridden?: boolean; // false by default; flipped by feedback API
  override_reason?: string | null; // free-text from the operator
}

// Final result returned to the caller (cron sweeper or webhook pipeline).
// The caller dispatches based on `decision`:
//   - "proceed"      → run the existing newsletter classifier
//   - "needs_review" → mark classified, signals_emitted=0; future admin page surfaces these
//   - "rejected"     → mark classified, signals_emitted=0
export interface FilterResult {
  decision: "proceed" | "needs_review" | "rejected";
  stage1: Stage1Result;
  stage2?: Stage2Output; // present only when Stage 1 accepted + Stage 2 ran
  stage2_failure?: Stage2FailureReason; // present only on fail-closed paths
  publisherInfo: PublisherInfo; // echoed for the classifier to pass through
  decision_id?: string; // PK of the audit row, when write succeeded
}
