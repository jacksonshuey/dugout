import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ExternalSignalType,
  NewExternalSignal,
} from "./external-signals";
import { filterArticle } from "./news-filter";
import { writeNewsFilterDecisions } from "./news-filter-decisions";
import type { ArticleInput, FilterContext, NewsFilterDecision } from "./news-filter-types";
import { supabaseAdmin } from "./supabase";
import { DEFAULT_CONFIG } from "./workspace";
import { scrapeUrl } from "./firecrawl-client";

// News adapter — fetches recent articles per company from NewsAPI, runs the
// Stage 1 + Stage 2 content filter (src/lib/news-filter.ts), generates a
// Haiku bullet (src/lib/news-bullet-generator.ts), and persists kept signals
// + every audit decision (kept and rejected).
//
// Replaces the prior single-shot batch-classifier path (`classifyArticles`)
// which produced ~80% garbage in production. The new pipeline:
//   1. NewsAPI fetch (~1s)
//   2. Per-article Stage 1 deterministic rules (pure, no I/O)
//   3. Per-article Stage 2 Haiku verdict (~2s, parallel across articles)
//   4. Per-article Haiku bullet rewriter for kept articles (~1s, parallel)
//   5. Direct insert + audit write (kept) OR audit write only (rejected)
//
// Writes happen in this module — not in the cron route — so that the
// audit row can be tied to the inserted signal's id. The signals are also
// returned to the caller so the existing cron-route bookkeeping continues
// to work; the cron's downstream insertSignalsDedup call no-ops on them via
// URL-based dedup.
//
// Cost per cron run (3 trackable accounts, daily):
//   - 3 NewsAPI calls (free tier)
//   - up to (3 × 10 articles) × (Stage 2 + bullet) Haiku calls ≈ 60 × ~500 tokens
//   - Total: ~$0.03/day. Still negligible.

const NEWS_BASE = "https://newsapi.org/v2/everything";
const ARTICLES_PER_QUERY = 10;
const LOOKBACK_DAYS = 30;
const CLASSIFIER_TAG = "news-filter-v1.0";

// ---------------------------------------------------------------------------
// Env loading — same fallback as src/lib/claude.ts. Some dev harnesses export
// an empty key into the shell, which would otherwise win over .env.local.
// ---------------------------------------------------------------------------

function getEnvOrFile(name: string): string | null {
  const env = process.env[name];
  if (env && env.trim().length > 0) return env.trim();
  try {
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = raw.match(new RegExp(`^${escaped}=(.*)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// NewsAPI fetch
// ---------------------------------------------------------------------------

interface NewsApiArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  urlToImage: string | null;
  publishedAt: string;
  content: string | null;
}

interface NewsApiResponse {
  status: "ok" | "error";
  totalResults?: number;
  articles?: NewsApiArticle[];
  code?: string;
  message?: string;
}

async function fetchArticles(companyName: string): Promise<NewsApiArticle[]> {
  const key = getEnvOrFile("NEWSAPI_KEY");
  if (!key) throw new Error("NEWSAPI_KEY not set");

  const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const params = new URLSearchParams({
    // Quote the company name so multi-word names match as a phrase
    q: `"${companyName}"`,
    from,
    sortBy: "publishedAt",
    language: "en",
    pageSize: String(ARTICLES_PER_QUERY),
    apiKey: key,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${NEWS_BASE}?${params.toString()}`, {
      signal: controller.signal,
    });
    const data = (await res.json()) as NewsApiResponse;
    if (data.status !== "ok") {
      throw new Error(
        `NewsAPI error: ${data.code ?? "unknown"} — ${data.message ?? "no message"}`,
      );
    }
    return data.articles ?? [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Heuristic type tagging
//
// Maps an article to one of the 12 canonical ExternalSignalType values via
// keyword regex on title + description. Used to populate `external_signals.type`
// after the new content filter has decided the article is keepable. The
// keyword set is the same one the old fallback path used — preserving
// BUILD_ALIGNMENT #2 (canonical signal_type only) without re-spending a
// Haiku call.
// ---------------------------------------------------------------------------

function heuristicType(article: NewsApiArticle): ExternalSignalType {
  const text = `${article.title ?? ""} ${article.description ?? ""}`.toLowerCase();
  if (/\b(acquires?|acquired|acquisition|merger|merging|to buy)\b/.test(text)) return "ma_acquisition";
  if (/\b(series [a-z]\b|raises? \$|funding|valuation|round led by)\b/.test(text)) return "funding_round";
  if (/\b(layoffs?|workforce reduction|cuts \d+ jobs|fires \d+)\b/.test(text)) return "layoff";
  if (/\b(cfo|ceo|cto|coo|appoint|step ?down|named (new )?(chief|head|svp|vp))\b/.test(text)) return "leadership_change";
  if (/\b(earnings|quarterly|q[1-4] (results|revenue)|guidance)\b/.test(text)) return "earnings";
  if (/\b(launch(es|ed)?|announces|unveils|releases?|introduces)\b/.test(text)) return "product_launch";
  if (/\b(partnership|partner(ed|s)? with|collaboration)\b/.test(text)) return "partnership";
  if (/\b(lawsuit|sued|fine|settlement|sec|ftc|investigation|probe)\b/.test(text)) return "regulatory_action";
  return "other";
}

// ---------------------------------------------------------------------------
// Article projection — NewsAPI shape → filter input shape
// ---------------------------------------------------------------------------

function deriveDomain(article: NewsApiArticle): string {
  try {
    return new URL(article.url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function toArticleInput(article: NewsApiArticle): ArticleInput {
  return {
    url: article.url,
    title: (article.title ?? "").trim(),
    description: article.description,
    source_name: article.source?.name ?? "",
    source_domain: deriveDomain(article),
    published_at: article.publishedAt,
    author: article.author,
  };
}

// ---------------------------------------------------------------------------
// Public API — same shape as the prior adapter so the cron route doesn't
// have to change.
// ---------------------------------------------------------------------------

export interface AdapterResult {
  signals: NewExternalSignal[];
  rawResponseLength: number; // diagnostic — number of articles seen
}

export async function fetchSignalsForCompany(
  accountId: string,
  companyName: string,
  industry: string,
): Promise<AdapterResult> {
  const articles = await fetchArticles(companyName);
  if (articles.length === 0) {
    return { signals: [], rawResponseLength: 0 };
  }

  const context: FilterContext = {
    account_name: companyName,
    account_industry: industry,
    account_id: accountId,
    // The cron runs without a request context (no cookies) so the per-
    // workspace `getWorkspaceConfig` path always falls back to DEFAULT_CONFIG.
    // Inline the default to avoid pulling next/headers into this module.
    workspace_name: DEFAULT_CONFIG.companyName,
    primary_vertical: "tech_ai",
  };

  // Process articles in parallel — Stage 1 is pure, Stage 2 + bullet are
  // independent per-article Haiku calls. Concurrency cap = ARTICLES_PER_QUERY
  // so we never have more than ~10 in-flight Anthropic requests per account.
  const processed = await Promise.all(
    articles.map(async (article) => {
      const input = toArticleInput(article);
      const { decision, bullet } = await filterArticle({ article: input, context });
      return { article, articleInput: input, decision, bullet };
    }),
  );

  // ── Persist & audit ──────────────────────────────────────────────────
  const sb = (() => {
    try {
      return supabaseAdmin();
    } catch (e) {
      console.warn(
        `[news-adapter] account=${accountId}: supabase unavailable, skipping persist: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  })();

  const keptSignals: NewExternalSignal[] = [];
  const decisions: Array<{
    article_url: string;
    external_signal_id: string | null;
    account_id: string;
    decision: NewsFilterDecision;
  }> = [];
  let rejected = 0;
  let kept = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const { article, articleInput, decision, bullet } of processed) {
    if (decision.verdict === "rejected") {
      rejected += 1;
      if (sb) {
        decisions.push({
          article_url: articleInput.url,
          external_signal_id: null,
          account_id: accountId,
          decision,
        });
      }
      continue;
    }

    // Universal source-content persistence — Firecrawl-scrape the article
    // body before building the signal so the SourcePreviewModal can render
    // the exact text the AE Brief surfaced. Skip the signal entirely on
    // scrape failure: principle is "every signal verifiable against its
    // exact source"; we'd rather drop a signal than ship one we can't
    // verify against. The audit row is still written below so news_filter_
    // decisions reflects the intent.
    let scrapedMd: string | null = null;
    try {
      const scrape = await scrapeUrl(article.url);
      if (scrape.ok && scrape.markdown && scrape.markdown.trim().length > 0) {
        scrapedMd = scrape.markdown;
      } else {
        console.warn(
          `[news-adapter] scrape failed url=${article.url} status=${scrape.ok ? "empty_body" : scrape.statusCode ?? "err"} — skipping signal`,
        );
      }
    } catch (e) {
      // scrapeUrl throws ONLY on 429 (Firecrawl rate limit). Propagate so
      // the cron handler sees it and breaks the loop rather than burning
      // through Firecrawl credits silently.
      throw e;
    }
    if (!scrapedMd) {
      if (sb) {
        decisions.push({
          article_url: articleInput.url,
          external_signal_id: null,
          account_id: accountId,
          decision,
        });
      }
      continue;
    }

    // Kept: build the signal row.
    const signal: NewExternalSignal = {
      account_id: accountId,
      source: "newsapi",
      type: heuristicType(article),
      // Overwrite the prior "first 200 chars of title" path with the Haiku
      // bullet (or its fallback). Always non-empty per news-bullet-generator.
      summary: (bullet ?? articleInput.title).slice(0, 500),
      occurred_at: article.publishedAt,
      url: article.url,
      // Origin of the article URL — matches newsletter-adapter convention so
      // SignalSourceChip can render a "View source" link.
      source_url: article.url,
      meta: {
        source_name: article.source?.name ?? null,
        author: article.author,
        classifier: CLASSIFIER_TAG,
        // workspace_relevance is dual-written: top-level column for the AE
        // Brief filter query, meta for audit/historical trace. Don't strip
        // either.
        workspace_relevance: decision.workspace_relevance,
      },
      is_demo: false,
      source_content_md: scrapedMd,
      source_content_kind: "news_article_md",
    };

    // Direct insert + select id so we can populate `external_signal_id` on
    // the audit row. We bypass `insertSignalsDedup` here because we need the
    // returned id; the cron route's subsequent insertSignalsDedup call will
    // see this URL as already-present and skip it.
    let insertedId: string | null = null;
    if (sb) {
      try {
        const { data, error } = await sb
          .from("external_signals")
          .insert({
            ...signal,
            workspace_relevance: decision.workspace_relevance,
          })
          .select("id")
          .single();
        if (error) {
          // Most likely a unique-violation race or RLS misconfig. We still
          // want the audit row even if the insert failed — record it with
          // external_signal_id=null and continue.
          console.warn(
            `[news-adapter] account=${accountId}: insert failed url=${article.url} — ${error.message}`,
          );
        } else {
          insertedId =
            data && typeof data === "object" && "id" in data
              ? String((data as { id: unknown }).id)
              : null;
        }
      } catch (e) {
        console.warn(
          `[news-adapter] account=${accountId}: insert threw url=${article.url} — ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      decisions.push({
        article_url: articleInput.url,
        external_signal_id: insertedId,
        account_id: accountId,
        decision,
      });
    }

    kept += 1;
    if (decision.workspace_relevance === "high") highCount += 1;
    else if (decision.workspace_relevance === "medium") mediumCount += 1;
    else if (decision.workspace_relevance === "low") lowCount += 1;

    keptSignals.push(signal);
  }

  // Flush audit rows in a single round-trip per account (replaces the prior
  // per-article writeNewsFilterDecision calls).
  if (sb && decisions.length > 0) {
    await writeNewsFilterDecisions(decisions);
  }

  console.warn(
    `[news-adapter] account=${accountId}: rejected=${rejected} kept=${kept} (high=${highCount} medium=${mediumCount} low=${lowCount})`,
  );

  return { signals: keptSignals, rawResponseLength: articles.length };
}
