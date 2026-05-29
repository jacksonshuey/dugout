import { NextResponse } from "next/server";
import { ASK_MODEL, getOpenAIClient } from "@/lib/openai";
import { buildRuleSystemPrompt, validateRuleDraft } from "@/lib/rule-builder";

// POST /api/build-rule — natural-language → rule draft for the landing-page
// composer. Embeds the live ontology schema in the system prompt, asks the
// model for strict JSON, then validates it down to fields/comparators/actions
// that actually exist. The client seeds the composer with the returned draft
// so the user can edit and Save.
//
// Null-safe like the rest of the OpenAI surface: no key → a friendly message
// and the user just builds the rule by hand. Public + unauthenticated to
// match /api/semantic-search (the composer lives on the public landing page).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 600;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const prompt = String((body as { prompt?: unknown })?.prompt ?? "")
    .slice(0, MAX_PROMPT_CHARS)
    .trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "Describe the automation you want." },
      { status: 400 },
    );
  }

  const client = getOpenAIClient();
  if (!client) {
    return NextResponse.json(
      {
        error:
          "AI rule builder is offline — no OpenAI key configured. You can still build a rule by hand below.",
      },
      { status: 503 },
    );
  }

  try {
    const completion = await client.chat.completions.create({
      model: ASK_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildRuleSystemPrompt() },
        { role: "user", content: prompt },
      ],
    });

    const rawText = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json(
        {
          error: "Couldn't parse the AI response. Try rephrasing your request.",
        },
        { status: 502 },
      );
    }

    const { draft, warnings } = validateRuleDraft(parsed);
    if (!draft) {
      return NextResponse.json(
        {
          error:
            warnings[0] ??
            "Couldn't turn that into a rule. Try naming a specific field or condition.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ rule: draft, warnings });
  } catch (err) {
    console.warn(
      `[build-rule] OpenAI error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(
      { error: "The AI rule builder hit an error. Please try again." },
      { status: 502 },
    );
  }
}
