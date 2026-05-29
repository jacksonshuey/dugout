import { NextResponse } from "next/server";
import { ASK_MODEL, getOpenAIClient } from "@/lib/openai";
import { buildRuleChatSystemPrompt, validateRuleDraft } from "@/lib/rule-builder";
import type { RuleDraft } from "@/lib/rule-model";

// POST /api/build-rule — conversational rule builder behind the landing-page
// chat modal. Takes the running message history and returns BOTH a
// natural-language `reply` and an optional `rule` draft:
//
//   { reply: string, rule: RuleDraft | null, warnings?: string[] }
//
// The model builds a rule when the request maps onto the supported ontology
// fields/actions; otherwise it replies conversationally — asking a clarifying
// question or proposing the closest supported automation — instead of
// erroring. Null-safe: no OpenAI key returns a friendly reply (503). Public +
// unauthenticated to match /api/semantic-search.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MSG_CHARS = 600;
const MAX_TURNS = 24;

type ChatMessage = { role: "user" | "assistant"; content: string };

function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      continue;
    }
    const text = content.slice(0, MAX_MSG_CHARS).trim();
    if (text) msgs.push({ role, content: text });
  }
  return msgs;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const messages = sanitizeMessages((body as { messages?: unknown })?.messages);
  if (!messages || messages.length === 0 || messages[messages.length - 1]!.role !== "user") {
    return NextResponse.json(
      { error: "Send a non-empty conversation ending with a user message." },
      { status: 400 },
    );
  }

  const client = getOpenAIClient();
  if (!client) {
    return NextResponse.json(
      {
        reply:
          "The AI builder is offline right now (no OpenAI key configured), but you can still build a rule by hand in the composer.",
        rule: null,
      },
      { status: 503 },
    );
  }

  try {
    const completion = await client.chat.completions.create({
      model: ASK_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildRuleChatSystemPrompt() },
        ...messages,
      ],
    });

    const rawText = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { reply?: unknown; rule?: unknown };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json({
        reply: "Sorry — I garbled that. Could you rephrase what you want the rule to do?",
        rule: null,
      });
    }

    const reply =
      typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : "Tell me what should trigger the rule and what action to take.";

    // The model may emit a rule; validate it before trusting it. An invalid
    // rule degrades to a conversational nudge rather than a hard failure.
    let rule: RuleDraft | null = null;
    let warnings: string[] = [];
    if (parsed.rule && typeof parsed.rule === "object") {
      const result = validateRuleDraft(parsed.rule);
      rule = result.draft;
      warnings = result.warnings;
    }

    return NextResponse.json({ reply, rule, warnings });
  } catch (err) {
    console.warn(
      `[build-rule] OpenAI error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(
      {
        reply: "I hit an error reaching the model. Mind trying that again?",
        rule: null,
      },
      { status: 502 },
    );
  }
}
