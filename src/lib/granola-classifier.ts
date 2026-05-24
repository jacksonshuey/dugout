import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Granola classifier — reads a meeting summary (and optionally transcript
// excerpts) and emits structured signals for the Dugout pipeline.
//
// Why Haiku, not Sonnet: this is structured extraction over short prose
// (typically <1k tokens of summary). Haiku 4.5 returns in ~1s with high
// fidelity for this kind of task. Sonnet would burn 10x cost for no quality
// gain. Same trade-off the news-adapter made.
//
// Why summary-first, not transcript-first: summary_text is purpose-built
// for human readability and is ~5x shorter than raw transcript turns.
// Classifying on summary alone is cheap and high-signal for the v1 signals
// we target. If we ever add fine-grained "quote-the-moment" signals, the
// adapter can pass an excerpt of the transcript alongside the summary.

const HAIKU_MODEL = "claude-haiku-4-5";
const MAX_SUMMARY_CHARS = 8_000;

// ---------------------------------------------------------------------------
// Signal types — keep tight. We ship 3 in v1; the schema validates against
// this list so a hallucinated type from Haiku gets dropped.
// ---------------------------------------------------------------------------

export const MEETING_SIGNAL_TYPES = [
  "finance_mentioned_not_engaged",
  "new_stakeholder_introduced",
  "champion_role_change",
  // Below ship in v1.5 — keep the schema open so the classifier prompt can
  // include them and we don't need a migration when we enable them.
  "competitor_mentioned",
  "legal_review_requested",
  "timeline_signal",
  "budget_concern",
] as const;

export type MeetingSignalType = (typeof MEETING_SIGNAL_TYPES)[number];

export type MeetingSignalSeverity = "blocking" | "action" | "awareness";

const SEVERITY_FOR_TYPE: Record<MeetingSignalType, MeetingSignalSeverity> = {
  // Selected Vendor wedge — late-stage stakeholder gaps are blocking.
  finance_mentioned_not_engaged: "blocking",
  // Champion loss is the case's load-bearing example of "deal dies silently."
  champion_role_change: "blocking",
  // New legal review = budget/time risk surfaced live in conversation.
  legal_review_requested: "action",
  budget_concern: "action",
  new_stakeholder_introduced: "action",
  competitor_mentioned: "awareness",
  timeline_signal: "awareness",
};

export interface ClassifiedMeetingSignal {
  type: MeetingSignalType;
  severity: MeetingSignalSeverity;
  summary: string;
  // Direct quote or paraphrase from the meeting that triggered the signal.
  // Used in the drawer to show "this is where it came from."
  rawExcerpt: string | null;
}

export interface ClassifierInput {
  meetingTitle: string | null;
  meetingDate: string | null;
  attendees: { name: string | null; email: string }[];
  organiserEmail: string | null;
  internalDomains: string[]; // organiser/rep domains, used in the prompt
  summary: string; // summary_text or summary_markdown, trimmed
}

// ---------------------------------------------------------------------------
// Env loading — same fallback as news-adapter / claude.ts so a missing
// shell env var doesn't trump .env.local in dev.
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
// Prompt. Built to be interview-defensible: the system prompt names the
// wedge explicitly so the model's bias is "find Finance/IT/Legal gaps."
// ---------------------------------------------------------------------------

function buildPrompt(input: ClassifierInput): string {
  const attendeeList = input.attendees
    .map((a) => `- ${a.name ?? "(unknown)"} <${a.email}>`)
    .join("\n");
  const summary = input.summary.slice(0, MAX_SUMMARY_CHARS);

  return `You are extracting buying-process signals from a B2B sales meeting summary.

This meeting's customer-side attendees matter — your job is to identify when
the conversation reveals a gap or risk that the AE needs to act on.

CONTEXT
Internal domains (vendor side, NOT the customer): ${input.internalDomains.join(", ") || "(none)"}
Meeting title: ${input.meetingTitle ?? "(no title)"}
Meeting date: ${input.meetingDate ?? "(unknown)"}
Organiser: ${input.organiserEmail ?? "(unknown)"}
Attendees:
${attendeeList || "(none)"}

MEETING SUMMARY
${summary}

SIGNAL TYPES (only emit a signal if it's clearly supported by the summary)

- finance_mentioned_not_engaged: The buyer references Finance/Procurement/CFO/budget approval as a step they'll need to take, but no Finance person was on this call. THIS IS THE HIGHEST-PRIORITY SIGNAL — late-stage deals die when Finance enters too late.
- new_stakeholder_introduced: A new buyer-side stakeholder (especially Finance, IT/Security, Legal, Procurement) joined this meeting for the first time, or was named as joining future meetings.
- champion_role_change: The buyer's champion mentions a role change, departure, new responsibilities, or being deprioritized.
- legal_review_requested: Buyer asks about legal, security, compliance, MSA, DPA, or red-line review.
- budget_concern: Explicit pushback on price, ROI, or budget timing.
- competitor_mentioned: A competitor product or vendor is named (by buyer OR by the rep responding to one).
- timeline_signal: Buyer states an explicit deadline, target close date, or fiscal-year constraint.

OUTPUT
A single JSON array inside a \`\`\`json fence. One entry per CLEARLY-supported signal. Each entry:

{
  "type": one of the values above,
  "summary": "1-2 sentences in active voice. The AE should be able to read this and know exactly what to do next. ≤200 chars.",
  "raw_excerpt": "the specific phrase or sentence from the summary that triggered this signal (≤300 chars). If you're paraphrasing rather than quoting, prefix with 'paraphrase: '."
}

Return \`[]\` if no signals are clearly supported. Do not invent. No preamble.`;
}

// ---------------------------------------------------------------------------
// Classifier entry point. Returns an empty array on parse/model failure
// rather than throwing — the adapter is responsible for treating "no
// signals extracted" as a valid outcome (most internal meetings produce
// nothing, and we don't want a single bad parse to break the cron run).
// ---------------------------------------------------------------------------

export async function classifyMeeting(
  input: ClassifierInput,
): Promise<ClassifiedMeetingSignal[]> {
  if (!input.summary || input.summary.trim().length < 40) {
    // Too little to classify — skip rather than spend tokens.
    return [];
  }
  let text: string;
  try {
    // Client init is inside the try block so a missing ANTHROPIC_API_KEY
    // returns [] (the documented contract) instead of bubbling up as a
    // per-note sync error.
    const c = anthropicClient();
    const message = await c.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: buildPrompt(input) }],
    });
    text = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
  } catch (e) {
    // 529 overloaded_error, missing key, or transient failure — log and
    // skip. The cron can re-classify on the next run when the same note is
    // still within the lookback window.
    console.warn(
      "[granola-classifier] Haiku call failed",
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }

  return parseClassification(text);
}

// Exported for testability — pure function over text → signals.
export function parseClassification(text: string): ClassifiedMeetingSignal[] {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  const jsonStr = fence ? fence[1].trim() : text.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const validTypes = new Set<string>(MEETING_SIGNAL_TYPES);
  const out: ClassifiedMeetingSignal[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.type !== "string" || !validTypes.has(r.type)) continue;
    const type = r.type as MeetingSignalType;
    const summary = typeof r.summary === "string" ? r.summary.trim() : "";
    if (!summary) continue;
    const rawExcerpt =
      typeof r.raw_excerpt === "string" && r.raw_excerpt.trim().length > 0
        ? r.raw_excerpt.trim().slice(0, 500)
        : null;
    out.push({
      type,
      severity: SEVERITY_FOR_TYPE[type],
      summary: summary.slice(0, 500),
      rawExcerpt,
    });
  }
  return out;
}
