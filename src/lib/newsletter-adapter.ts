import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./types";
import type { InboundEmail } from "./inbound-email";
import {
  WORKSPACE_ACCOUNT_ID,
  type ExternalSignalType,
  type NewExternalSignal,
} from "./external-signals";

// Newsletter adapter — takes a stored inbound email, extracts material
// business signals via Haiku, and maps them to either a tracked account
// (when a known company is named) or the workspace sentinel (general
// market intelligence).
//
// Mirrors the structure of news-adapter.ts so the two pipelines stay
// legible together. Key differences:
//   - One Haiku call per email, not per company.
//   - Output is { mention, type, summary, url? } — the mention is a free-
//     text entity name we match against trackable accounts post-hoc.
//   - Unmatched mentions become workspace-scoped signals.
//
// Cost: typical newsletter is 2-10 material items, ~3K input tokens, ~500
// output tokens. ~$0.005 per email at Haiku 4.5 sticker.

const HAIKU_MODEL = "claude-haiku-4-5";

// Truncate email body to this many characters before sending to Haiku.
// Newsletters past this length (e.g. 50K-char digests) get costly and the
// signal-density drops off fast — earliest content is usually the lead.
const MAX_BODY_CHARS = 12_000;

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
// HTML → plaintext fallback. Minimal regex stripper — good enough for
// newsletters that don't include text_body. Avoids adding cheerio/parse5
// as a dependency just for this.
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function emailBodyForClassification(email: InboundEmail): string {
  const text = email.text_body && email.text_body.length > 100
    ? email.text_body
    : email.html_body
      ? stripHtml(email.html_body)
      : (email.text_body ?? "");
  return text.slice(0, MAX_BODY_CHARS);
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
  mention: string;
  type: ExternalSignalType;
  summary: string;
  url?: string;
}

function buildClassifierPrompt(email: InboundEmail, body: string): string {
  return `You are extracting material business signals from a newsletter for a B2B sales team that tracks specific companies and monitors the broader market.

NEWSLETTER METADATA
Sender: ${email.from_domain}
Subject: ${email.subject ?? "(no subject)"}

NEWSLETTER BODY
${body}

YOUR JOB
Extract every material business event mentioned that the sales team should know about. For each event:
1. Identify the company/entity it concerns (the "mention" — exactly as it appears in the text, e.g. "Stripe", "Moderna", "OpenAI").
2. Classify the event type.
3. Write a 1-2 sentence factual summary (≤200 chars, no markdown).
4. If a specific URL is referenced for that event, capture it (omit if no URL).

Skip:
- Opinion pieces, commentary, predictions, listicles
- Routine product changelog items, minor releases
- Items where the entity is too generic to track ("the market", "AI startups")
- Items that are clearly ads or sponsored content

Output ONLY a JSON array inside a \`\`\`json code fence. One entry per material event. Each entry:

{
  "mention": "<company or entity name as it appears in the text>",
  "type": one of: "leadership_change" | "ma_acquisition" | "funding_round" | "layoff" | "earnings" | "product_launch" | "press_release" | "competitor_mention" | "regulatory_action" | "partnership" | "other",
  "summary": "...",
  "url": "<absolute URL if explicitly present, else omit>"
}

Return \`[]\` if the newsletter contains no material events. Do not invent facts. No preamble.`;
}

async function classifyWithHaiku(email: InboundEmail): Promise<RawExtraction[]> {
  const body = emailBodyForClassification(email);
  if (body.trim().length < 50) return [];

  const c = anthropicClient();
  const message = await c.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    messages: [
      { role: "user", content: buildClassifierPrompt(email, body) },
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

  const out: RawExtraction[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const mention = typeof r.mention === "string" ? r.mention.trim() : "";
    if (!mention) continue;
    const type =
      typeof r.type === "string" && VALID_TYPES.includes(r.type as ExternalSignalType)
        ? (r.type as ExternalSignalType)
        : "other";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : undefined;
    out.push({
      mention: mention.slice(0, 200),
      type,
      summary: summary.slice(0, 500),
      url,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Account matching — deterministic, post-hoc against the mention text.
// We match against account name, ticker, and a normalized website slug
// (e.g. "modernatx.com" → matches mention "Moderna" via name; mention
// "MRNA" via ticker).
// ---------------------------------------------------------------------------

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function accountKeywords(acc: Account): string[] {
  const out = [normalizeForMatch(acc.name)];
  if (acc.ticker) out.push(acc.ticker.toLowerCase());
  if (acc.website) {
    // "modernatx.com" → "modernatx"; "kkr.com" → "kkr"
    const slug = acc.website.replace(/^www\./i, "").split(".")[0];
    if (slug && slug.length >= 3) out.push(slug.toLowerCase());
  }
  return out.filter((k) => k.length >= 3);
}

function matchAccount(mention: string, accounts: Account[]): string | null {
  const m = normalizeForMatch(mention);
  if (m.length < 3) return null;
  for (const acc of accounts) {
    for (const kw of accountKeywords(acc)) {
      // Match on word boundaries (the normalized strings only contain
      // letters/digits/spaces, so " kw " or kw-at-edge is sufficient).
      if (m === kw || m.startsWith(kw + " ") || m.endsWith(" " + kw) || m.includes(" " + kw + " ")) {
        return acc.id;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NewsletterClassification {
  signals: NewExternalSignal[];
  classifier_used: "haiku" | "none";
  matched: number;
  workspace: number;
}

export async function classifyNewsletter(
  email: InboundEmail,
  trackableAccounts: Account[],
): Promise<NewsletterClassification> {
  let extractions: RawExtraction[];
  let classifier_used: "haiku" | "none" = "haiku";
  try {
    extractions = await classifyWithHaiku(email);
  } catch (e) {
    // No heuristic fallback here — newsletters are too varied for keyword
    // matching to produce useful signals. Better to leave them unclassified
    // and let a re-run pick them up when Haiku is healthy again.
    console.warn(
      `[newsletter-adapter] Haiku failed for ${email.id}:`,
      e instanceof Error ? e.message : String(e),
    );
    extractions = [];
    classifier_used = "none";
  }

  let matched = 0;
  let workspace = 0;
  const signals: NewExternalSignal[] = extractions.map((x) => {
    const acc = matchAccount(x.mention, trackableAccounts);
    if (acc) matched++;
    else workspace++;
    return {
      account_id: acc ?? WORKSPACE_ACCOUNT_ID,
      source: "newsletter",
      type: x.type,
      summary: x.summary,
      occurred_at: email.received_at,
      url: x.url ?? null,
      meta: {
        inbound_email_id: email.id,
        sender_domain: email.from_domain,
        newsletter_subject: email.subject,
        mention: x.mention,
        matched: Boolean(acc),
      },
      is_demo: false,
    };
  });

  return { signals, classifier_used, matched, workspace };
}
