import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./types";
import type { WebScrape } from "./web-scrapes";
import {
  type ExternalSignalType,
  type NewExternalSignal,
} from "./external-signals";
import {
  WORKSPACE_RELEVANCE_DEFINITION,
  WORKSPACE_RELEVANCE_TOOL_PROPERTY,
  coerceWorkspaceRelevance,
  type WorkspaceRelevance,
} from "./workspace-relevance";

// Web-scrape classifier - takes a stored web_scrapes row (markdown content
// from a tracked account's site) and extracts material business signals
// via Haiku. In addition to signal classification it extracts STRUCTURED
// AE-BRIEF FIELDS (company_one_liner, exec_change, recent_funding,
// key_risks, strategic_focus) which the AE Brief surface reads to pre-fill
// pre-call context without re-prompting Haiku.
//
// Differs from newsletter-adapter.ts:
//   - Always per-account (the scrape is already keyed to a known account_id),
//     so no entity-matching post-hoc; every signal pins to the same account.
//   - The classifier sees the source URL up front, so it can attach
//     deep-link URLs from the page when present (e.g. press-release pages
//     linked from /news) rather than always re-using the scraped URL.
//   - We cap at 5 signals per page - homepages rarely have more than 1-2
//     newsworthy items; news index pages may have a few more.
//   - Workspace relevance + structured AE-brief fields are emitted via
//     forced tool-use, no free-text JSON.
//
// Determinism: temperature=0.1 + forced `submit_extraction` tool-use,
// modeled on news-filter.ts.

const HAIKU_MODEL = "claude-haiku-4-5";

// Wall-clock budget for the classifier call. Tighter than the previous
// implicit 20s default to keep the per-account cron sweep fast.
const HAIKU_TIMEOUT_MS = 15_000;

// Truncate markdown to this many characters before sending to Haiku. Real
// pages land at 2-15K markdown chars after Firecrawl's onlyMainContent
// strip; anything much longer is usually a content-farm "news" page where
// the signal density tails off fast.
const MAX_MARKDOWN_CHARS = 15_000;

// ---------------------------------------------------------------------------
// Env loading - same fallback as news-adapter.ts.
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

const VALID_EXEC_CHANGES = ["joined", "left", "promoted"] as const;
type ExecChangeKind = (typeof VALID_EXEC_CHANGES)[number];

// Structured AE-brief fields - persisted under
// external_signals.meta.brief_fields (JSONB) so we don't have to migrate
// columns every time the AE Brief surface needs another structured field.
// The /accounts/:id surface reads these to populate pre-call context.
export interface BriefFields {
  company_one_liner: string | null;       // ≤120 chars
  exec_change: {
    name: string;
    role: string;
    change: ExecChangeKind;
    date: string | null;                   // ISO date if present in markdown
  } | null;
  recent_funding: {
    amount: string;                         // free-text - "$50M", "Series B", etc.
    lead_investor: string | null;
    date: string | null;                    // ISO date if present
  } | null;
  key_risks: string[];                      // max 3
  strategic_focus: string | null;
}

interface RawExtraction {
  type: ExternalSignalType;
  summary: string;
  workspace_relevance: WorkspaceRelevance;
  url?: string;
  occurred_at?: string;
}

// ---------------------------------------------------------------------------
// Forced tool-use schema. Schema models two top-level fields:
//   1. items[] - the same per-event extractions newsletter-adapter
//      produces, capped at 5 per page.
//   2. brief_fields - structured AE-brief metadata extracted from the
//      same markdown in the same Haiku call. One extraction shared across
//      every signal we write from this page.
// ---------------------------------------------------------------------------

const TOOL_NAME = "submit_extraction";

const TOOL_SCHEMA = {
  name: TOOL_NAME,
  description:
    "Submit the extracted material events AND the structured AE-brief fields. Call this exactly once with both fields populated.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["items", "brief_fields"],
    properties: {
      items: {
        type: "array" as const,
        maxItems: 5,
        description:
          "Material business events on this page (most material first). Empty array allowed when the page has no material events.",
        items: {
          type: "object" as const,
          additionalProperties: false,
          required: ["type", "summary", "workspace_relevance"],
          properties: {
            type: {
              type: "string",
              enum: VALID_TYPES as unknown as string[],
            },
            summary: {
              type: "string",
              minLength: 5,
              maxLength: 500,
              description: "1-2 sentence factual summary (≤200 chars, no markdown).",
            },
            workspace_relevance: WORKSPACE_RELEVANCE_TOOL_PROPERTY,
            url: {
              type: "string",
              description:
                "Absolute URL for this event if explicitly present in the markdown; omit otherwise.",
            },
            occurred_at: {
              type: "string",
              description:
                "ISO YYYY-MM-DD if a specific event date is mentioned; omit otherwise.",
            },
          },
        },
      },
      brief_fields: {
        type: "object" as const,
        additionalProperties: false,
        required: ["company_one_liner", "exec_change", "recent_funding", "key_risks", "strategic_focus"],
        properties: {
          company_one_liner: {
            type: ["string", "null"],
            maxLength: 120,
            description:
              "What this company does in one line (≤120 chars). Null if the page does not state it.",
          },
          exec_change: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["name", "role", "change", "date"],
            properties: {
              name: { type: "string", minLength: 1 },
              role: { type: "string", minLength: 1 },
              change: {
                type: "string",
                enum: VALID_EXEC_CHANGES as unknown as string[],
              },
              date: { type: ["string", "null"] },
            },
            description:
              "A recent executive change mentioned on this page. Null when no exec change is mentioned.",
          },
          recent_funding: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["amount", "lead_investor", "date"],
            properties: {
              amount: { type: "string", minLength: 1 },
              lead_investor: { type: ["string", "null"] },
              date: { type: ["string", "null"] },
            },
            description:
              "Recent funding round if mentioned on this page. Null when no funding is mentioned.",
          },
          key_risks: {
            type: "array",
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: 200 },
            description:
              "Up to 3 risks an AE should know about (e.g. lawsuit, regulatory inquiry, customer concentration, layoff). Empty array allowed.",
          },
          strategic_focus: {
            type: ["string", "null"],
            maxLength: 200,
            description:
              "Current strategic priority if explicitly stated (e.g. 'AI-native rebuild', 'international expansion'). Null when not stated.",
          },
        },
      },
    },
  },
} as const;

function buildPrompt(
  account: Account,
  scrape: WebScrape,
  markdown: string,
): string {
  return `You are extracting material business signals AND structured AE-brief metadata about ${account.name} from one of their own public web pages, for a B2B sales team that tracks this account.

SOURCE
Account: ${account.name}${account.ticker ? ` (${account.ticker})` : ""}
URL: ${scrape.url}
Scraped: ${scrape.scraped_at}

PAGE CONTENT (markdown)
${markdown}

YOUR JOB
1. Extract every material business event mentioned about ${account.name} that the sales team should know about. For each event, populate items[] with type, summary, workspace_relevance, and optional url + occurred_at.
2. Extract STRUCTURED AE-BRIEF FIELDS for the AE pre-call context surface - company_one_liner, exec_change, recent_funding, key_risks, strategic_focus. These are populated ONCE per page (not per event). Use null/[] when the page does not state the field.

EVENT EXTRACTION RULES
- Classify the type using one of: leadership_change, champion_job_change, ma_acquisition, funding_round, layoff, earnings, product_launch, press_release, competitor_mention, regulatory_action, partnership, other.
- Write a 1-2 sentence factual summary (≤200 chars, no markdown).
- Tag workspace_relevance per the rubric below - REQUIRED on every event.
- If a specific URL is referenced in the markdown for that event (e.g. a press-release link), capture it. Otherwise omit url and the row will be tied to the source page above.
- If a date is mentioned for the event (e.g. "March 12, 2026"), include it as ISO YYYY-MM-DD in occurred_at. Otherwise omit.

EVENT SKIP RULES
- Generic marketing copy ("we build the best X", "join our newsletter")
- Stale items that have clearly been on the site for years (foundational bio copy, generic "about us")
- Items that are about a different company unless they directly involve ${account.name} (acquisition, partnership, competitor mention)
- Listicles, opinion pieces, blog posts that aren't tied to a concrete event
- At most 5 events - the most material first.

BRIEF-FIELD RULES
- company_one_liner: one sentence describing what ${account.name} does (≤120 chars). Pull from a hero tagline, "about" section, or product description. Null if the page doesn't say.
- exec_change: ONE recent exec change (joined/left/promoted) with name, role, and an ISO date if present. Null when not on this page.
- recent_funding: most recent round mentioned with amount (free-text - "$50M Series B" is fine), lead_investor (or null), and date (ISO if present). Null when not mentioned.
- key_risks: up to 3 risks an AE should know (lawsuit, regulatory inquiry, customer concentration, layoff, exec departure). Empty array allowed.
- strategic_focus: ONE current strategic priority if explicitly stated. Null otherwise.

${WORKSPACE_RELEVANCE_DEFINITION}

# Output format - forced tool-use, mandatory
You MUST emit your answer via the \`${TOOL_NAME}\` tool. Free-text replies are invalid. Do not invent facts - null/empty is correct when the page does not state a field.`;
}

// Test seam.
export type WebScrapeHaikuCall = (args: {
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
        // Locked at 0.1 (was implicit ~1.0 SDK default). Per-account
        // scrapes must be deterministic across re-runs so the dedup-by-url
        // path doesn't flap.
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

// ---------------------------------------------------------------------------
// Post-validation helpers
// ---------------------------------------------------------------------------

function isIsoDateLike(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s);
}

function validateBriefFields(raw: unknown): BriefFields {
  // Failsoft: if the model returned nothing structured, return the empty
  // brief shape so downstream code never has to null-check the whole field.
  const fallback: BriefFields = {
    company_one_liner: null,
    exec_change: null,
    recent_funding: null,
    key_risks: [],
    strategic_focus: null,
  };
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;

  const company_one_liner =
    typeof r.company_one_liner === "string" && r.company_one_liner.trim().length > 0
      ? r.company_one_liner.trim().slice(0, 120)
      : null;

  let exec_change: BriefFields["exec_change"] = null;
  if (r.exec_change && typeof r.exec_change === "object") {
    const e = r.exec_change as Record<string, unknown>;
    if (
      typeof e.name === "string" &&
      typeof e.role === "string" &&
      typeof e.change === "string" &&
      (VALID_EXEC_CHANGES as ReadonlyArray<string>).includes(e.change)
    ) {
      exec_change = {
        name: e.name.trim().slice(0, 200),
        role: e.role.trim().slice(0, 200),
        change: e.change as ExecChangeKind,
        date: isIsoDateLike(e.date) ? (e.date as string).slice(0, 10) : null,
      };
    }
  }

  let recent_funding: BriefFields["recent_funding"] = null;
  if (r.recent_funding && typeof r.recent_funding === "object") {
    const f = r.recent_funding as Record<string, unknown>;
    if (typeof f.amount === "string" && f.amount.trim().length > 0) {
      recent_funding = {
        amount: f.amount.trim().slice(0, 100),
        lead_investor:
          typeof f.lead_investor === "string" && f.lead_investor.trim().length > 0
            ? f.lead_investor.trim().slice(0, 200)
            : null,
        date: isIsoDateLike(f.date) ? (f.date as string).slice(0, 10) : null,
      };
    }
  }

  const key_risks = Array.isArray(r.key_risks)
    ? r.key_risks
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, 3)
        .map((s) => s.trim().slice(0, 200))
    : [];

  const strategic_focus =
    typeof r.strategic_focus === "string" && r.strategic_focus.trim().length > 0
      ? r.strategic_focus.trim().slice(0, 200)
      : null;

  return {
    company_one_liner,
    exec_change,
    recent_funding,
    key_risks,
    strategic_focus,
  };
}

async function classifyWithHaiku(
  account: Account,
  scrape: WebScrape,
  haikuCall?: WebScrapeHaikuCall,
): Promise<{ extractions: RawExtraction[]; brief_fields: BriefFields }> {
  const markdown = (scrape.markdown ?? "").slice(0, MAX_MARKDOWN_CHARS);
  if (markdown.trim().length < 100) {
    return {
      extractions: [],
      brief_fields: validateBriefFields(null),
    };
  }

  const prompt = buildPrompt(account, scrape, markdown);
  const call = haikuCall ?? callHaikuReal;
  const toolInput = await call({
    systemPromptUserMessage: prompt,
    toolSchema: TOOL_SCHEMA,
    timeoutMs: HAIKU_TIMEOUT_MS,
  });

  if (!toolInput || typeof toolInput !== "object") {
    return { extractions: [], brief_fields: validateBriefFields(null) };
  }
  const obj = toolInput as Record<string, unknown>;
  const itemsRaw = obj.items;
  const brief_fields = validateBriefFields(obj.brief_fields);

  if (!Array.isArray(itemsRaw)) {
    return { extractions: [], brief_fields };
  }

  const extractions: RawExtraction[] = [];
  for (const raw of itemsRaw.slice(0, 5)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type =
      typeof r.type === "string" && VALID_TYPES.includes(r.type as ExternalSignalType)
        ? (r.type as ExternalSignalType)
        : "other";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url) ? r.url : undefined;
    const occurred_at = isIsoDateLike(r.occurred_at)
      ? (r.occurred_at as string).slice(0, 10)
      : undefined;
    const relevance =
      coerceWorkspaceRelevance(r.workspace_relevance) ??
      ("low" as WorkspaceRelevance);
    extractions.push({
      type,
      summary: summary.slice(0, 500),
      workspace_relevance: relevance,
      url,
      occurred_at,
    });
  }
  return { extractions, brief_fields };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WebScrapeClassification {
  signals: NewExternalSignal[];
  classifier_used: "haiku" | "none";
  // Structured AE-brief metadata extracted from this page. Persisted on
  // every signal's meta.brief_fields; surfaces read it from the first
  // signal in a per-account batch. Empty/null fields are normal - they
  // mean the page didn't state the field.
  brief_fields: BriefFields;
}

export interface ClassifyWebScrapeDeps {
  haikuCall?: WebScrapeHaikuCall;
}

export async function classifyWebScrape(
  scrape: WebScrape,
  account: Account,
  deps: ClassifyWebScrapeDeps = {},
): Promise<WebScrapeClassification> {
  // Let Haiku failures (529 overload, transient network) propagate. The
  // caller (classifyScrape in classify-pending) catches them and skips
  // markWebScrapeClassified, leaving the row for the next sweep -
  // mirrors the newsletter-adapter flow. Swallowing the error here would
  // stamp the row permanently classified with zero signals.
  const { extractions, brief_fields } = await classifyWithHaiku(
    account,
    scrape,
    deps.haikuCall,
  );
  const classifier_used: "haiku" | "none" = "haiku";

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
      // occurred_at = "when Dugout learned this", matching the newsletter
      // adapter convention. The Haiku-extracted event date (e.g. "Q1 FY27
      // results May 27, 2026") lives in meta.event_date so future-scheduled
      // events don't sort above today's news in the recency-ordered ticker.
      occurred_at: scrape.scraped_at,
      url,
      meta: {
        web_scrape_id: scrape.id,
        scraped_url: scrape.url,
        // When Haiku extracted a date from the page (the date the event is
        // scheduled or happened, not the scrape time) — preserved here so
        // upcoming-events surfaces can still read it.
        event_date: x.occurred_at ?? null,
        // Brief fields live under meta.brief_fields so the AE pre-call
        // surface can read them without a column migration each time we
        // add a structured field. Stored on every signal from this page
        // (cheap duplication; ~200 bytes JSON) so the /accounts/:id query
        // doesn't need to join back to web_scrapes.
        brief_fields,
      },
      is_demo: false,
      source_url: scrape.url,
      // Universal source-content persistence: copy the Firecrawl markdown
      // onto the signal so the popup renders the exact scraped page the
      // analyzer used. scrape.markdown is guaranteed non-null here because
      // getUnclassifiedWebScrapes filters `.not("markdown", "is", null)`.
      source_content_md: scrape.markdown,
      source_content_kind: "firecrawl_md",
      workspace_relevance: x.workspace_relevance,
    } as NewExternalSignal;
  });

  return { signals, classifier_used, brief_fields };
}

// Exported for tests so the suite can assert the schema shape it cares
// about (enum lists, required fields) without hitting Haiku.
export const _internal = {
  TOOL_NAME,
  TOOL_SCHEMA,
  VALID_TYPES,
  VALID_EXEC_CHANGES,
  validateBriefFields,
};
