import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExternalSignalType,
  NewExternalSignal,
} from "./external-signals";

// News adapter — fetches recent articles per company from NewsAPI, then
// classifies them via Claude Haiku 4.5 into the ExternalSignal shape.
//
// Replaces the prior `web-search-adapter.ts` (Claude web_search tool), which
// was too slow + variable to fit Vercel Hobby's 60s function cap. Typical
// runtime now: ~1s NewsAPI fetch + ~2-3s Haiku classification = ~5s per
// company. 50× faster than web_search; well under the budget.
//
// Cost per cron run (3 trackable accounts, daily): 3 NewsAPI calls (free
// tier) + 3 Haiku calls × ~2K tokens = ~$0.01/day total. Negligible.

const NEWS_BASE = "https://newsapi.org/v2/everything";
const HAIKU_MODEL = "claude-haiku-4-5";
const ARTICLES_PER_QUERY = 10;
const LOOKBACK_DAYS = 30;

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

function anthropicClient(): Anthropic {
  const key = getEnvOrFile("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  // Aggressive timeout — Haiku should respond in 2-3s. 20s is a hard ceiling.
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 20_000 });
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
// Haiku classification
//
// One Haiku call per company. Batches all articles into a single prompt;
// model returns a JSON array of classifications keyed by original_index so
// we can map results back to article URLs / dates.
//
// Haiku is appropriate here — this is structured extraction, not reasoning.
// Sonnet/Opus would be slower + more expensive for no quality gain.
// ---------------------------------------------------------------------------

const VALID_TYPES: ExternalSignalType[] = [
  "leadership_change",
  "champion_job_change",
  "ma_acquisition",
  "funding_round",
  "layoff",
  "earnings",
  "product_launch",
  "press_release",
  "competitor_mention",
  "regulatory_action",
  "partnership",
  "other",
];

interface Classification {
  original_index: number;
  type: ExternalSignalType;
  summary: string;
}

function buildClassifierPrompt(
  companyName: string,
  industry: string,
  articles: NewsApiArticle[],
): string {
  const numbered = articles
    .map((a, i) => {
      const title = a.title?.replace(/\s+/g, " ").trim() ?? "(no title)";
      const desc = (a.description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      return `[${i}] ${title}${desc ? ` — ${desc}` : ""}`;
    })
    .join("\n");

  return `You are classifying news articles about "${companyName}" (${industry}) for a B2B sales team that sells to this company.

For each article, decide:
1. Is it MATERIAL business news the sales team should know about? Skip:
   - Routine product updates, opinion pieces, analyst reports, listicles
   - Articles where the company is mentioned in passing but isn't the subject
   - Articles that are clearly about a different entity with the same name
2. If material, classify the type and write a 1-2 sentence factual summary (≤200 chars, no markdown).

Output ONLY a JSON array inside a \`\`\`json code fence. One entry per material article (skip non-material entirely). Each entry:

{
  "original_index": <number from the input>,
  "type": one of: "leadership_change" | "ma_acquisition" | "funding_round" | "layoff" | "earnings" | "product_launch" | "press_release" | "competitor_mention" | "regulatory_action" | "partnership" | "other",
  "summary": "..."
}

Return \`[]\` if no articles are material. Do not invent facts. No preamble.

ARTICLES:
${numbered}`;
}

async function classifyArticles(
  companyName: string,
  industry: string,
  articles: NewsApiArticle[],
): Promise<Classification[]> {
  if (articles.length === 0) return [];

  const c = anthropicClient();
  const message = await c.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    messages: [
      { role: "user", content: buildClassifierPrompt(companyName, industry, articles) },
    ],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const jsonStr = fence ? fence[1].trim() : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Classification[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const idx = typeof r.original_index === "number" ? r.original_index : -1;
    if (idx < 0 || idx >= articles.length) continue;
    const type =
      typeof r.type === "string" && VALID_TYPES.includes(r.type as ExternalSignalType)
        ? (r.type as ExternalSignalType)
        : "other";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    out.push({
      original_index: idx,
      type,
      summary: summary.slice(0, 500),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API — same shape as the old web_search adapter so the cron route
// doesn't have to change.
// ---------------------------------------------------------------------------

export interface AdapterResult {
  signals: NewExternalSignal[];
  rawResponseLength: number; // diagnostic — number of articles seen
}

// Cheap keyword-based fallback used when Haiku is unavailable (e.g., the
// Anthropic 529 capacity incidents we hit on 2026-05-22). Lower precision
// than Haiku but keeps signals flowing instead of dropping them.
function heuristicClassify(
  article: NewsApiArticle,
  idx: number,
): Classification | null {
  const text = `${article.title ?? ""} ${article.description ?? ""}`.toLowerCase();
  if (text.trim().length < 20) return null;
  const summary = (article.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  let type: ExternalSignalType = "other";
  if (/\b(acquires?|acquired|acquisition|merger|merging|to buy)\b/.test(text)) type = "ma_acquisition";
  else if (/\b(series [a-z]\b|raises? \$|funding|valuation|round led by)\b/.test(text)) type = "funding_round";
  else if (/\b(layoffs?|workforce reduction|cuts \d+ jobs|fires \d+)\b/.test(text)) type = "layoff";
  else if (/\b(cfo|ceo|cto|coo|appoint|step ?down|named (new )?(chief|head|svp|vp))\b/.test(text)) type = "leadership_change";
  else if (/\b(earnings|quarterly|q[1-4] (results|revenue)|guidance)\b/.test(text)) type = "earnings";
  else if (/\b(launch(es|ed)?|announces|unveils|releases?|introduces)\b/.test(text)) type = "product_launch";
  else if (/\b(partnership|partner(ed|s)? with|collaboration)\b/.test(text)) type = "partnership";
  else if (/\b(lawsuit|sued|fine|settlement|sec|ftc|investigation|probe)\b/.test(text)) type = "regulatory_action";
  return { original_index: idx, type, summary };
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

  let classifications: Classification[];
  let usedFallback = false;
  try {
    classifications = await classifyArticles(companyName, industry, articles);
    if (classifications.length === 0) {
      // Haiku ran but found nothing material. Fall back to keywords so the
      // demo still shows something the team can react to.
      usedFallback = true;
      classifications = articles
        .map((a, i) => heuristicClassify(a, i))
        .filter((c): c is Classification => c !== null);
    }
  } catch (e) {
    // Haiku failed (commonly 529 overloaded_error during Anthropic incidents).
    // Fall back to keyword classification so signals still flow.
    console.warn(
      `[news-adapter] ${companyName}: Haiku classification failed, using heuristic fallback`,
      e instanceof Error ? e.message : String(e),
    );
    usedFallback = true;
    classifications = articles
      .map((a, i) => heuristicClassify(a, i))
      .filter((c): c is Classification => c !== null);
  }

  const signals: NewExternalSignal[] = classifications.map((c) => {
    const article = articles[c.original_index];
    return {
      account_id: accountId,
      source: "newsapi",
      type: c.type,
      summary: c.summary,
      occurred_at: article.publishedAt,
      url: article.url,
      meta: {
        source_name: article.source.name,
        author: article.author,
        classifier: usedFallback ? "heuristic" : "haiku",
      },
      is_demo: false,
    };
  });

  return { signals, rawResponseLength: articles.length };
}
