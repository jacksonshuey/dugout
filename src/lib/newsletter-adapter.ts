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
import type { PublisherInfo } from "./email-filter-types";
import { extractLeadArticleUrl } from "./extract-lead-article-url";
import {
  WORKSPACE_RELEVANCE_DEFINITION,
  WORKSPACE_RELEVANCE_TOOL_PROPERTY,
  WORKSPACE_RELEVANCE_VALUES,
  coerceWorkspaceRelevance,
  type WorkspaceRelevance,
} from "./workspace-relevance";

// Newsletter adapter — takes a stored inbound email, extracts material
// business signals via Haiku, and maps them to either a tracked account
// (when a known company is named) or the workspace sentinel (general
// market intelligence).
//
// Mirrors the structure of news-adapter.ts so the two pipelines stay
// legible together. Key differences:
//   - One Haiku call per email, not per company.
//   - Output is { mention, type, summary, url?, workspace_relevance } —
//     the mention is a free-text entity name we match against trackable
//     accounts post-hoc.
//   - Unmatched mentions become workspace-scoped signals.
//
// Determinism: temperature=0.1 + forced tool-use via `submit_extraction`,
// modeled on news-filter.ts. Replaced the free-text ```json fence parser
// to eliminate brittle re-prompts when Haiku decorates its output.
//
// Cost: typical newsletter is 2-10 material items, ~3K input tokens, ~500
// output tokens. ~$0.005 per email at Haiku 4.5 sticker.

const HAIKU_MODEL = "claude-haiku-4-5";

// Wall-clock budget for the classifier call. Tighter than the previous
// implicit 20s SDK default to keep the cron sweeper inside Vercel's per-
// function budget on long newsletter days.
const HAIKU_TIMEOUT_MS = 15_000;

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
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: HAIKU_TIMEOUT_MS });
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
  workspace_relevance: WorkspaceRelevance;
  url?: string;
}

// ---------------------------------------------------------------------------
// Forced tool-use schema. Modeled on news-filter.ts's submit_verdict tool:
// single tool, forced tool_choice, schema-validated post-hoc. The model
// returns { items: [...] } — one extraction per material event.
// ---------------------------------------------------------------------------

const TOOL_NAME = "submit_extraction";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Submit the extracted material business events. Call this exactly once with the full list (empty array is allowed when nothing is material).",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array" as const,
        maxItems: 25,
        items: {
          type: "object" as const,
          additionalProperties: false,
          required: ["mention", "type", "summary", "workspace_relevance"],
          properties: {
            mention: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description:
                "Company or entity name exactly as it appears in the newsletter text.",
            },
            type: {
              type: "string",
              enum: VALID_TYPES as unknown as string[],
            },
            summary: {
              type: "string",
              minLength: 5,
              maxLength: 500,
              description:
                "1-2 sentence factual summary (≤200 chars, no markdown).",
            },
            workspace_relevance: WORKSPACE_RELEVANCE_TOOL_PROPERTY,
            url: {
              type: "string",
              description:
                "Absolute URL for this specific event if explicitly referenced; omit otherwise.",
            },
          },
        },
      },
    },
  },
} as const;

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
2. Classify the event type using one of: leadership_change, champion_job_change, ma_acquisition, funding_round, layoff, earnings, product_launch, press_release, competitor_mention, regulatory_action, partnership, other.
3. Write a 1-2 sentence factual summary (≤200 chars, no markdown).
4. Tag the workspace_relevance tier per the rubric below — REQUIRED on every extraction.
5. If a specific URL is referenced for that event, capture it (omit if no URL).

Skip:
- Opinion pieces, commentary, predictions, listicles
- Routine product changelog items, minor releases
- Items where the entity is too generic to track ("the market", "AI startups")
- Items that are clearly ads or sponsored content

${WORKSPACE_RELEVANCE_DEFINITION}

# Output format — forced tool-use, mandatory
You MUST emit your answer via the \`${TOOL_NAME}\` tool. Free-text replies are invalid. Return an empty items array when the newsletter contains no material events. Do not invent facts. No preamble.`;
}

// Test seam: callers (tests) can inject a fake Haiku call so we never hit
// the network. Returns the tool_use.input payload or throws.
export type NewsletterHaikuCall = (args: {
  systemPromptUserMessage: string;
  toolSchema: typeof TOOL_SCHEMA;
  timeoutMs: number;
}) => Promise<unknown>;

async function callHaikuReal(args: {
  systemPromptUserMessage: string;
  toolSchema: typeof TOOL_SCHEMA;
  timeoutMs: number;
}): Promise<unknown> {
  const c = anthropicClient();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs);
  try {
    const response = await c.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 2000,
        // Locked at 0.1 (was implicit SDK default ~1.0). Newsletter
        // classification needs determinism, not creativity — same email
        // should yield the same extraction list across re-runs.
        temperature: 0.1,
        tools: [
          {
            name: args.toolSchema.name,
            description: args.toolSchema.description,
            input_schema:
              args.toolSchema.input_schema as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: args.toolSchema.name },
        messages: [{ role: "user", content: args.systemPromptUserMessage }],
      },
      { signal: ac.signal },
    );
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === args.toolSchema.name,
    );
    if (!toolUse) throw new Error("Haiku returned no tool_use block");
    return toolUse.input;
  } finally {
    clearTimeout(timer);
  }
}

async function classifyWithHaiku(
  email: InboundEmail,
  haikuCall?: NewsletterHaikuCall,
): Promise<RawExtraction[]> {
  const body = emailBodyForClassification(email);
  if (body.trim().length < 50) return [];

  const prompt = buildClassifierPrompt(email, body);
  const call = haikuCall ?? callHaikuReal;
  const toolInput = await call({
    systemPromptUserMessage: prompt,
    toolSchema: TOOL_SCHEMA,
    timeoutMs: HAIKU_TIMEOUT_MS,
  });

  if (!toolInput || typeof toolInput !== "object") return [];
  const itemsRaw = (toolInput as Record<string, unknown>).items;
  if (!Array.isArray(itemsRaw)) return [];

  const out: RawExtraction[] = [];
  for (const raw of itemsRaw) {
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
    const relevance =
      coerceWorkspaceRelevance(r.workspace_relevance) ??
      // Defensive default: when Haiku returns a missing/invalid tier,
      // treat the item as low-relevance rather than dropping it. The AE
      // Brief filter still hides low/none rows; the drawer still gets them.
      ("low" as WorkspaceRelevance);
    out.push({
      mention: mention.slice(0, 200),
      type,
      summary: summary.slice(0, 500),
      workspace_relevance: relevance,
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

// Optional injection seam — tests can pass `haikuCall` to skip the network
// entirely. Production callers omit it and the real Anthropic SDK is used.
export interface ClassifyNewsletterDeps {
  haikuCall?: NewsletterHaikuCall;
}

export async function classifyNewsletter(
  email: InboundEmail,
  trackableAccounts: Account[],
  publisherInfo?: PublisherInfo,
  deps: ClassifyNewsletterDeps = {},
): Promise<NewsletterClassification> {
  let extractions: RawExtraction[];
  let classifier_used: "haiku" | "none" = "haiku";
  try {
    extractions = await classifyWithHaiku(email, deps.haikuCall);
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

  // Source attribution. Lead-article URL is extracted once per email (cheap,
  // pure) and reused for any signal whose Haiku-extracted URL was empty.
  // The chip + view-source link on /market-intel reads
  // `external_signals.source_url`. See docs/filter-design.md §9.
  const fallbackSourceUrl =
    extractLeadArticleUrl(email.html_body ?? email.text_body ?? "");
  if (!fallbackSourceUrl) {
    console.log(
      `[email-filter] extract_lead_url_returned=null from=${email.from_domain} id=${email.id}`,
    );
  }
  const publisherCanonical =
    publisherInfo?.publisher_canonical_name ??
    email.publisher_canonical_name ??
    email.from_domain;

  let matched = 0;
  let workspace = 0;
  const signals: NewExternalSignal[] = extractions.map((x) => {
    const acc = matchAccount(x.mention, trackableAccounts);
    if (acc) matched++;
    else workspace++;
    const signalUrl = x.url ?? null;
    return {
      account_id: acc ?? WORKSPACE_ACCOUNT_ID,
      source: "newsletter",
      type: x.type,
      summary: x.summary,
      occurred_at: email.received_at,
      url: signalUrl,
      meta: {
        inbound_email_id: email.id,
        sender_domain: email.from_domain,
        newsletter_subject: email.subject,
        mention: x.mention,
        matched: Boolean(acc),
        // Capture the ingestion time independently of occurred_at so the
        // ranker has access to "when Dugout learned this" distinct from
        // "when the event happened" — newsletter classifiers usually
        // align them, but a digest published on Monday about a Saturday
        // event has a real gap the ranker should see.
        received_at: email.received_at,
      },
      is_demo: false,
      // Parallel top-level surface so /market-intel queries don't need to
      // dig into JSONB. Keeps the legacy meta keys for backward-compat.
      publisher_canonical_name: publisherCanonical,
      source_url: signalUrl ?? fallbackSourceUrl ?? null,
      inbound_email_id: email.id,
      email_subject: email.subject ?? null,
      // Universal source-content persistence. Newsletters keep their
      // inbound_emails row as the canonical render path (HTML iframe), but
      // we also persist a normalized snapshot on the signal so the page
      // query "verifiable source present" filter is uniform across source
      // types. Prefer html_body for fidelity; fall back to text_body.
      source_content_md: email.html_body ?? email.text_body ?? null,
      source_content_kind: email.html_body ? "email_html" : "email_text",
      // Workspace relevance tier set by Haiku — drives the AE Brief filter.
      workspace_relevance: x.workspace_relevance,
    } as NewExternalSignal;
  });

  return { signals, classifier_used, matched, workspace };
}

// Exported for tests so the suite can assert the schema shape it cares
// about (enum lists, required fields) without hitting Haiku.
export const _internal = {
  TOOL_NAME,
  TOOL_SCHEMA,
  VALID_TYPES,
  WORKSPACE_RELEVANCE_VALUES,
};
