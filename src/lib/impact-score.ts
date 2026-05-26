// Single source of truth for the AI-determined `impact_score` (0-100)
// attached to each external signal. Parallel structure to
// workspace-relevance.ts (rubric + tool schema fragment + coercer).
//
// `impact_score` answers a different question than `workspace_relevance`:
//   - workspace_relevance is a categorical "should we surface this at all"
//     tier (high/medium/low/none) used by the AE Brief filter.
//   - impact_score is a continuous magnitude (0-100) used by the workspace
//     feed's "Magnitude" sort to surface the past-week's biggest stories
//     regardless of whether they directly name a tracked account.
//
// The DB column lives on `external_signals.impact_score` (migration
// 20260526_external_signals_impact_score.sql). Nullable for backward
// compatibility; the sort path falls back to a derived heuristic when
// null so legacy rows and not-yet-migrated adapters still render.

export const IMPACT_SCORE_MIN = 0;
export const IMPACT_SCORE_MAX = 100;

// Verbatim prose every Haiku tool-use prompt embeds so the model sees the
// exact same rubric regardless of call site. Anchored at concrete event
// archetypes so the score is comparable across newsletters / news /
// scrapes / filings.
export const IMPACT_SCORE_DEFINITION = `Impact score (0-100, integer) - how big a deal is this story to a B2B sales team that tracks enterprise tech / AI accounts? Score the underlying event, not the article quality. Anchors:

- 90-100: Industry-defining. M&A involving a foundation-model lab, a top-10 tech name buying or being bought, household-name leadership change (CEO / founder departure at a $10B+ company), market-shaking regulatory action (EU AI Act enforcement, FTC blocking a major deal), frontier-model release that resets the competitive landscape.
- 70-89:  Major. $500M+ funding round, top-50 tech company layoff round, household-name product launch with clear competitive impact, mid-size M&A ($1B+), exec change at a named AI vendor, significant regulatory rule change.
- 50-69:  Notable. $50-500M funding rounds, mid-tier M&A, named-vendor product launches without clear competitive shift, partnerships between named enterprise vendors, second-tier exec moves, earnings surprises.
- 30-49:  Routine industry news. Smaller funding rounds (<$50M), minor product updates from named vendors, generic enterprise SaaS coverage with a real AI angle, mid-tier partnerships.
- 10-29:  Tangential. Listicles, opinion pieces, vague macro commentary, minor product changelog items, generic news with weak workspace relevance.
- 0-9:    Off-topic or noise.

Score the event in isolation. Do not double-count workspace_relevance - a story can be highly relevant (named account) but low-impact (minor product update), or low-relevance (unnamed company) but high-impact (frontier model release).` as const;

// JSON-schema fragment for the `impact_score` property - reused by every
// tool-use schema that emits a signal (newsletter-adapter,
// web-scrape-classifier, news-filter Stage 2). Constrained to integer
// 0-100 so the DB check constraint never trips.
export const IMPACT_SCORE_TOOL_PROPERTY = {
  type: "integer" as const,
  minimum: IMPACT_SCORE_MIN,
  maximum: IMPACT_SCORE_MAX,
  description:
    "Integer 0-100 per IMPACT_SCORE_DEFINITION. Score the event's magnitude to a B2B sales team, not the article quality.",
};

// Defensive validator - returns the clamped integer or null when the input
// is not a valid 0-100 number. Same shape as coerceWorkspaceRelevance.
export function coerceImpactScore(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n < IMPACT_SCORE_MIN || n > IMPACT_SCORE_MAX) return null;
  return n;
}
