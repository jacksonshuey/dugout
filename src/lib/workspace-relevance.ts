// Single source of truth for the workspace_relevance tier used across
// every Haiku call site that emits a relevance signal (newsletter
// classifier, web-scrape classifier, email-filter Stage 2, news-filter
// Stage 2).
//
// Before this module, each call site defined "relevance" differently — or
// not at all. Centralizing it here gives:
//   1. One enum every adapter imports (no drift on string literals).
//   2. One prose definition every Haiku prompt embeds verbatim
//      (`WORKSPACE_RELEVANCE_DEFINITION`).
//   3. One JSON-schema fragment every tool-use call reuses for the
//      `workspace_relevance` property (`WORKSPACE_RELEVANCE_TOOL_PROPERTY`).
//
// The matching DB column lives on `external_signals.workspace_relevance`
// with the same four-value check constraint (added in migration
// 20260524_news_filter.sql). The AE Brief render path filters
// `workspace_relevance IN ('high','medium')`.
//
// Coordinated with the news-filter-v3 branch (news-filter-types.ts already
// defines an identical `WorkspaceRelevance` type). When that branch
// merges, news-filter-types.ts should re-export from here to keep one
// canonical definition.

export type WorkspaceRelevance = "high" | "medium" | "low" | "none";

export const WORKSPACE_RELEVANCE_VALUES: ReadonlyArray<WorkspaceRelevance> = [
  "high",
  "medium",
  "low",
  "none",
];

// Verbatim prose every Haiku tool-use prompt embeds so the model sees the
// exact same rubric regardless of call site. Wording is tuned for the
// `tech_ai` workspace vertical (Checkbox's primary lens) — when other
// verticals land, parameterize the bracketed examples but keep the
// four-tier shape constant.
export const WORKSPACE_RELEVANCE_DEFINITION = `Workspace relevance tiers (apply uniformly across every Haiku call site):

- "high"   — tracked-account-named event OR major industry move directly
             relevant to the workspace vertical. For tech_ai: frontier
             model release (GPT/Claude/Gemini class), $50M+ AI infra
             funding, M&A involving a foundation-model lab, regulatory
             action on AI (EU AI Act, US executive order, FTC/SEC AI rule),
             leadership change at a household-name AI company, layoff
             round at a top-50 AI vendor.
- "medium" — adjacent industry development. Broader enterprise tech
             coverage, smaller funding rounds, exec moves at non-named
             adjacent companies, mid-tier product launches, partnership
             announcements between named enterprise vendors.
- "low"    — industry-tangential. Minor product news, generic enterprise
             SaaS coverage without an AI angle, listicles, opinion pieces,
             vague macro commentary.
- "none"   — unrelated to the workspace vertical (consumer goods, sports,
             entertainment, local news, off-topic syndication).` as const;

// JSON-schema fragment for the `workspace_relevance` property — reused by
// every tool-use schema (newsletter-adapter, web-scrape-classifier,
// email-filter Stage 2, news-filter Stage 2). Keeps the enum in lockstep
// with WORKSPACE_RELEVANCE_VALUES at compile time.
export const WORKSPACE_RELEVANCE_TOOL_PROPERTY = {
  type: "string" as const,
  enum: WORKSPACE_RELEVANCE_VALUES as unknown as string[],
  description:
    "Workspace relevance tier per WORKSPACE_RELEVANCE_DEFINITION. Set to 'none' whenever the verdict is 'rejected'.",
};

// Defensive validator — same shape every adapter post-validates against
// after the model returns its tool input. Returns the typed enum value or
// null when the input is not one of the four allowed strings.
export function coerceWorkspaceRelevance(
  v: unknown,
): WorkspaceRelevance | null {
  if (typeof v !== "string") return null;
  return (WORKSPACE_RELEVANCE_VALUES as ReadonlyArray<string>).includes(v)
    ? (v as WorkspaceRelevance)
    : null;
}
