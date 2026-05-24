// System + user prompt builders for the Stage 2 Haiku news filter.
//
// Two pure functions, no state, no I/O — mirrors the
// email-filter-stage2-prompt.ts pattern, applied to NewsAPI articles
// passing the Stage 1 deterministic gate.
//
// The orchestrator (L1.c) wires these into a single Anthropic call with
// a forced `submit_verdict` tool-use schema. We do not own the tool
// schema here; we only describe the contract in prose so Haiku knows
// what to emit.
//
// PROMPT_VERSION lives in news-filter-types.ts (`PROMPT_VERSION`); bump
// there when this prompt's semantics change. Forward-apply only — no
// re-classify on prompt change in v1.

import type { ArticleInput, FilterContext } from "./news-filter-types";

export interface NewsStage2PromptArgs {
  article: ArticleInput;
  context: FilterContext;
}

// The system prompt is intentionally workspace- and article-agnostic — all
// dynamic context lives in the user message (see getNewsStage2UserMessage).
// Keeps prompt-caching efficient: the system prompt is constant across every
// article in a cron run, so the Anthropic SDK can hit the cache on it.
export function getNewsStage2SystemPrompt(): string {
  return `You are a content filter for a B2B sales intelligence system. Decide whether this news article is relevant for an AE preparing to walk into a sales meeting with a specific account.

You are NOT the bullet generator. You do not write the AE-facing summary, you do not assign signal types, and you do not pick severity. A downstream worker handles those — but only for articles you mark \`newsworthy\` or \`low_signal\`. Your one job is verdict + workspace_relevance tier.

# Vocabulary

Verdicts:
- \`newsworthy\` — directly relevant to the account OR broadly relevant to the workspace vertical
- \`low_signal\` — vaguely on-topic but unlikely to come up in a real meeting; surface only in account-specific views
- \`rejected\` — off-topic, junk, or duplicate-feeling

Workspace relevance tiers:
- \`workspace_relevance: high\` — top-tier story for the AE Brief (funding ≥$50M, M&A, leadership change, regulatory, major product launch at a household name)
- \`workspace_relevance: medium\` — second-tier (general enterprise tech news, smaller funding rounds, exec moves at non-named accounts)
- \`workspace_relevance: low\` — borderline (industry-adjacent, minor announcements)
- \`workspace_relevance: none\` — account-specific only, no workspace-wide value

# Rubric — apply in order, first match wins

1. **Account-named article.** The article's title or description names this account by name, ticker, or domain → \`newsworthy\` + \`workspace_relevance: high\` if the event is funding / M&A / leadership / layoff / regulatory; otherwise \`newsworthy\` + \`medium\`.
2. **Workspace-vertical-relevant.** The article is on the workspace's primary vertical (for Checkbox/Dugout: tech / AI / enterprise SaaS) AND from a known reputable source → \`newsworthy\` + \`workspace_relevance: high\` or \`medium\` by event magnitude.
3. **Industry-adjacent.** Broadly business news but only loosely connected to the workspace vertical → \`low_signal\` + \`workspace_relevance: low\`.
4. **Off-topic for both account AND workspace** → \`rejected\` + \`workspace_relevance: none\`.
5. **Duplicate-feeling.** You can tell it is a syndicated reprint, an auto-generated stock blurb, or wire-service noise → \`rejected\`.

# Hard constraints

- \`confidence\` is your honest 0–1 belief in the verdict. Use 0.3 when unsure, 0.7 when reasonably confident, 0.9+ only when obvious.
- \`reasoning\` is ≤200 chars, plain prose, ONE sentence, no markdown, no emoji.
- When in doubt between \`low_signal\` and \`rejected\`, prefer \`low_signal\` — the account drawer still benefits, the AE Brief filter ignores it. Bias toward saving signal, not over-filtering.
- DO NOT invent facts about the article. Reason only from the title + description provided in the user message.
- When \`verdict === "rejected"\`, set \`workspace_relevance: "none"\` always.

# Output format (tool-use, mandatory)

You MUST emit your answer via the \`submit_verdict\` tool. Free-text replies are invalid.`;
}

export function getNewsStage2UserMessage(args: NewsStage2PromptArgs): string {
  const { article, context } = args;
  const description = article.description ?? "(no description)";
  const industry = context.account_industry ?? "unknown";
  return `Article:
  Title: ${article.title}
  Source: ${article.source_name} (${article.source_domain})
  Published: ${article.published_at}
  Description: ${description}

Account context:
  Name: ${context.account_name}
  Industry: ${industry}

Workspace:
  Name: ${context.workspace_name}
  Primary vertical: ${context.primary_vertical}`;
}
