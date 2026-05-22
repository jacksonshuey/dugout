import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExternalSignalType,
  NewExternalSignal,
} from "./external-signals";

// Web search adapter — uses Claude's built-in web_search tool to surface
// recent material events for a given account, then extracts them into our
// ExternalSignal shape.
//
// Why this approach: Claude does the search + synthesis + citation extraction
// server-side, so we get clean structured data without managing search
// infrastructure ourselves. Costs ~$0.01 per company per day at our prompt
// size; budget impact is negligible.

const MODEL = "claude-sonnet-4-6";

// Same env fallback pattern as src/lib/claude.ts — handles agentic dev harnesses
// that export an empty ANTHROPIC_API_KEY (which would otherwise win over .env.local).
function getKey(): string | null {
  const env = process.env.ANTHROPIC_API_KEY;
  if (env && env.trim().length > 0) return env.trim();
  try {
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const match = raw.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function client(): Anthropic {
  const key = getKey();
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  // Per-request timeout: 40s. The web_search tool can take 20-30s
  // internally (multiple searches + synthesis). 40s leaves headroom but
  // bails before Vercel's 60s function cap kills the whole batch.
  // Drop retries (default 2) since we already have 40s; better to fail
  // a single account than block the batch on retries.
  return new Anthropic({ apiKey: key, maxRetries: 1, timeout: 40_000 });
}

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

// Prompt: instruct Claude to surface only material business events from the
// last 30 days, return as a JSON array. We ask for JSON in a fenced block so
// parsing is reliable even if Claude adds preamble.
function buildPrompt(companyName: string, industry: string): string {
  return `Search the web for material business events about "${companyName}" (${industry}) from the last 30 days that would be relevant to a B2B sales team selling to them.

Focus on:
- Leadership changes (CEO, CFO, CTO, GC, Head of Legal, VP changes)
- M&A activity (acquired, acquired by, merger, spin-off)
- Funding rounds (Series A/B/C/etc, IPO, secondary)
- Layoffs or significant headcount changes
- Earnings reports (revenue / guidance shifts)
- Major product launches
- Significant press releases or announcements
- Regulatory actions (lawsuits, settlements, compliance issues)
- Partnerships or strategic deals

Skip routine news, opinion pieces, and analyst predictions. Only include events with credible source URLs.

Return your findings as a JSON array inside a \`\`\`json code fence. Each item must have these fields exactly:

{
  "type": one of "leadership_change" | "champion_job_change" | "ma_acquisition" | "funding_round" | "layoff" | "earnings" | "product_launch" | "press_release" | "competitor_mention" | "regulatory_action" | "partnership" | "other",
  "summary": "1-2 sentence plain-text description, ≤200 chars, no markdown",
  "occurred_at": "ISO 8601 date — when the event actually happened, not when reported",
  "url": "source URL — required, must be a working link"
}

If you find no relevant events, return an empty array \`[]\`. Do not invent or speculate. Return ONLY the JSON code fence, no preamble.`;
}

interface AdapterResult {
  signals: NewExternalSignal[];
  rawResponseLength: number;
}

export async function fetchSignalsForCompany(
  accountId: string,
  companyName: string,
  industry: string,
): Promise<AdapterResult> {
  const c = client();
  const message = await c.messages.create({
    model: MODEL,
    // Reduced from 4000 to 2000. We only need a few signals + brief synthesis;
    // higher max_tokens encourages longer generations and burns wall time
    // we don't have.
    max_tokens: 2000,
    messages: [{ role: "user", content: buildPrompt(companyName, industry) }],
    tools: [{ type: "web_search_20260209" as const, name: "web_search" }],
  });

  // Claude may emit multiple text blocks (one per "step" of reasoning between
  // searches). The JSON block is in the final text. Concatenate all text and
  // extract the fenced JSON.
  const allText = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  const fenceMatch = allText.match(/```json\s*([\s\S]*?)```/i);
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : allText.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // If parsing fails (Claude didn't follow the format), return no signals
    // rather than throwing — the cron should continue with other accounts.
    return { signals: [], rawResponseLength: allText.length };
  }

  if (!Array.isArray(parsed)) {
    return { signals: [], rawResponseLength: allText.length };
  }

  // Normalize + validate each item. Skip anything malformed.
  const signals: NewExternalSignal[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = typeof r.type === "string" && VALID_TYPES.includes(r.type as ExternalSignalType)
      ? (r.type as ExternalSignalType)
      : "other";
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    const occurredAt = typeof r.occurred_at === "string" ? r.occurred_at.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : null;
    if (!summary || !occurredAt) continue;
    // Sanity check the date — must parse as a valid ISO date
    if (Number.isNaN(new Date(occurredAt).getTime())) continue;
    signals.push({
      account_id: accountId,
      source: "claude_web_search",
      type,
      summary: summary.slice(0, 500),
      occurred_at: occurredAt,
      url,
      is_demo: false,
    });
  }

  return { signals, rawResponseLength: allText.length };
}
