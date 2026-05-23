import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./types";
import type { WebScrape } from "./web-scrapes";
import {
  type ExternalSignalType,
  type NewExternalSignal,
} from "./external-signals";

// Web-scrape classifier — takes a stored web_scrapes row (markdown content
// from a tracked account's site) and extracts material business signals
// via Haiku.
//
// Differs from newsletter-adapter.ts:
//   - Always per-account (the scrape is already keyed to a known account_id),
//     so no entity-matching post-hoc; every signal pins to the same account.
//   - The classifier sees the source URL up front, so it can attach
//     deep-link URLs from the page when present (e.g. press-release pages
//     linked from /news) rather than always re-using the scraped URL.
//   - We cap at 5 signals per page — homepages rarely have more than 1-2
//     newsworthy items; news index pages may have a few more.

const HAIKU_MODEL = "claude-haiku-4-5";

// Truncate markdown to this many characters before sending to Haiku. Real
// pages land at 2-15K markdown chars after Firecrawl's onlyMainContent
// strip; anything much longer is usually a content-farm "news" page where
// the signal density tails off fast.
const MAX_MARKDOWN_CHARS = 15_000;

// ---------------------------------------------------------------------------
// Env loading — same fallback as news-adapter.ts.
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
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Haiku classification
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

interface RawExtraction {
  type: ExternalSignalType;
  summary: string;
  url?: string;
  occurred_at?: string;
}

function buildPrompt(
  account: Account,
  scrape: WebScrape,
  markdown: string,
): string {
  return `You are extracting material business signals about ${account.name} from one of their own public web pages, for a B2B sales team that tracks this account.

SOURCE
Account: ${account.name}${account.ticker ? ` (${account.ticker})` : ""}
URL: ${scrape.url}
Scraped: ${scrape.scraped_at}

PAGE CONTENT (markdown)
${markdown}

YOUR JOB
Extract every material business event mentioned about ${account.name} that the sales team should know about. For each event:
1. Classify the type.
2. Write a 1-2 sentence factual summary (≤200 chars, no markdown).
3. If a specific URL is referenced in the markdown for that event (e.g. a press-release link), capture it. Otherwise omit url and the row will be tied to the source page above.
4. If a date is mentioned for the event (e.g. "March 12, 2026"), include it as ISO YYYY-MM-DD in occurred_at. Otherwise omit.

Skip:
- Generic marketing copy ("we build the best X", "join our newsletter")
- Stale items that have clearly been on the site for years (foundational bio copy, generic "about us")
- Items that are about a different company unless they directly involve ${account.name} (acquisition, partnership, competitor mention)
- Listicles, opinion pieces, blog posts that aren't tied to a concrete event

Output ONLY a JSON array inside a \`\`\`json code fence. At most 5 entries — the most material first. Each entry:

{
  "type": one of: "leadership_change" | "champion_job_change" | "ma_acquisition" | "funding_round" | "layoff" | "earnings" | "product_launch" | "press_release" | "competitor_mention" | "regulatory_action" | "partnership" | "other",
  "summary": "...",
  "url": "<absolute URL if explicitly present in the markdown, else omit>",
  "occurred_at": "<YYYY-MM-DD if a date is given, else omit>"
}

Return \`[]\` if the page contains no material events. Do not invent facts. No preamble.`;
}

async function classifyWithHaiku(
  account: Account,
  scrape: WebScrape,
): Promise<RawExtraction[]> {
  const markdown = (scrape.markdown ?? "").slice(0, MAX_MARKDOWN_CHARS);
  if (markdown.trim().length < 100) return [];

  const c = anthropicClient();
  const message = await c.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildPrompt(account, scrape, markdown) }],
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

  const out: RawExtraction[] = [];
  for (const raw of parsed.slice(0, 5)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type =
      typeof r.type === "string" && VALID_TYPES.includes(r.type as ExternalSignalType)
        ? (r.type as ExternalSignalType)
        : "other";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : undefined;
    const occurredRaw = typeof r.occurred_at === "string" ? r.occurred_at.trim() : "";
    const occurred_at = /^\d{4}-\d{2}-\d{2}/.test(occurredRaw)
      ? occurredRaw.slice(0, 10)
      : undefined;
    out.push({
      type,
      summary: summary.slice(0, 500),
      url,
      occurred_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WebScrapeClassification {
  signals: NewExternalSignal[];
  classifier_used: "haiku" | "none";
}

export async function classifyWebScrape(
  scrape: WebScrape,
  account: Account,
): Promise<WebScrapeClassification> {
  let extractions: RawExtraction[];
  let classifier_used: "haiku" | "none" = "haiku";
  try {
    extractions = await classifyWithHaiku(account, scrape);
  } catch (e) {
    console.warn(
      `[web-scrape-classifier] Haiku failed for ${scrape.id}:`,
      e instanceof Error ? e.message : String(e),
    );
    extractions = [];
    classifier_used = "none";
  }

  // Signals from web-scrape sources dedup by URL like every other adapter.
  // When the page doesn't reference a specific event URL, fall back to
  // {scraped url}#{first 40 chars of summary slug} so the same homepage
  // re-scrape tomorrow doesn't insert duplicate signals.
  const signals: NewExternalSignal[] = extractions.map((x) => {
    const url =
      x.url ??
      `${scrape.url}#${x.summary
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)}`;
    return {
      account_id: scrape.account_id,
      source: "web_scrape",
      type: x.type,
      summary: x.summary,
      occurred_at: x.occurred_at ?? scrape.scraped_at,
      url,
      meta: {
        web_scrape_id: scrape.id,
        scraped_url: scrape.url,
      },
      is_demo: false,
    };
  });

  return { signals, classifier_used };
}
