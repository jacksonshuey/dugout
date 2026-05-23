import { NextResponse } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import {
  ASK_MODEL,
  HAS_OPENAI_KEY,
  getOpenAIClient,
} from "@/lib/openai";
import {
  ASK_TOOL_SCHEMAS,
  collectCitations,
  dispatchTool,
  getAccountContext,
  type Citation,
} from "@/lib/ask-tools";
import { DEMO_SCENARIO_ACCOUNTS, accounts } from "@/data/seed";

// /api/ask — the natural-language query layer (U4).
//
// Two modes, picked at request time:
//   1. STUB MODE (HAS_OPENAI_KEY === false) — returns a deterministic answer
//      drawn from the tools directly, no LLM in the loop. Lets the demo work
//      pre-credits. Substring-matches the question for "stalling" / "brief" /
//      "atlas" so the canonical demo questions all return citation-bearing
//      answers.
//   2. REAL MODE (HAS_OPENAI_KEY === true) — runs the OpenAI tool-use loop.
//      Sends the question + the 8 tool schemas, fans out tool_calls (cap 8
//      per turn), then asks for a final answer with [citation:signal_id]
//      markers.
//
// The response shape is identical across modes — the only visible difference
// is `model` ("stub-deterministic" vs the real model id) so the UI can show
// a banner in stub mode.
//
// Hard rules (per BUILD_ALIGNMENT.md):
//   - Read-only. All 8 tools in ASK_TOOL_SCHEMAS read; none mutate.
//   - Citation enforced. Every claim must reference a signal_id from the
//     tools' returned data. The route logs (but doesn't fail) when the model
//     cites an id not present in the collected data.
//   - Max 8 tool_calls per turn — the loop exits hard at that count.
//   - signal_type values: canonical 12 only. Tool schemas enforce via enum.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Request / response shapes ──────────────────────────────────────────

type AskRequest = {
  question: string;
  accountSlug?: string;
};

type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
};

type AskResponse = {
  answer: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  model: string;
  // The account in scope, when one is resolvable from the question or the
  // accountSlug body field. Used by the UI to build the citation deep links
  // (/account/<slug>#signal-<id>). Null when the question is cross-account
  // (e.g. "which deals lost momentum this week?").
  accountSlug: string | null;
  warnings?: string[];
};

const MAX_TOOL_CALLS_PER_TURN = 8;
const MAX_AGENT_TURNS = 4; // cap on the outer while-loop too

// Voice in the system prompt mirrors BUILD_ALIGNMENT principle #8.
// "Don't invent" is the bright-line rule: every claim ties to a signal_id
// the agent has seen from a tool. If it hasn't seen it, it says so.
const SYSTEM_PROMPT = `You are Dugout's sales intelligence assistant. You answer questions about deals using only the data returned by the tools.

Rules:
- Cite every factual claim inline using [citation:signal_id], where signal_id is the exact id of a signal returned by one of your tools.
- If you don't have evidence in the tool results, say so. Do not speculate. Do not invent signal ids.
- Be direct and plain. No marketing language. No exclamation marks. Short paragraphs.
- For "why is X stalling" questions: call get_account_context first, then look at correlations and signals. If multiple sources agree (a correlation), say that explicitly.
- For "brief me on this account" questions: call get_account_context, then summarize the open opportunity, the contacts, the most recent signals, and the SV Health Score if present.

You have a maximum of 8 tool calls per turn. Plan accordingly.`;

// ─── Route handler ──────────────────────────────────────────────────────

export async function POST(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json(
      { error: "Missing 'question' in request body" },
      { status: 400 },
    );
  }

  if (!HAS_OPENAI_KEY) {
    const stub = await runStubAnswer(question, body.accountSlug);
    return NextResponse.json(stub);
  }

  try {
    const real = await runAgentLoop(question, body.accountSlug);
    return NextResponse.json(real);
  } catch (e) {
    // Don't 500 — fall back to the stub so the demo doesn't break on a
    // provider blip. Note the failure in warnings so the UI can surface it.
    const stub = await runStubAnswer(question, body.accountSlug);
    stub.warnings = [
      ...(stub.warnings ?? []),
      `openai_error: ${e instanceof Error ? e.message : String(e)}`,
    ];
    return NextResponse.json(stub);
  }
}

// ─── Stub mode ──────────────────────────────────────────────────────────
//
// Deterministic answers for the canonical demo questions. Each branch calls
// the real tool implementations to fetch real citations — only the
// synthesis prose is deterministic, not the evidence chain. So the demo
// shows the same citation-chip UX the real mode would render.

async function runStubAnswer(
  question: string,
  accountSlug?: string,
): Promise<AskResponse> {
  const toolCalls: ToolCallRecord[] = [];

  // Resolve which account to talk about. Explicit slug wins; else look for
  // a known acc_ token in the question text; else default to the critical
  // demo account so the canonical "why is X stalling" question works
  // verbatim.
  const slug =
    accountSlug ??
    findAccountSlugInText(question) ??
    DEMO_SCENARIO_ACCOUNTS.critical;

  // For "stalling" or "brief" questions, call get_account_context and
  // narrate from the data. For anything else, default to a generic stub.
  const isStalling = /stall|stuck|risk|losing|momentum|going dark|quiet/i.test(
    question,
  );
  const isBrief = /brief|summary|overview|catch.*up|tell me about|latest on/i.test(
    question,
  );

  if (!isStalling && !isBrief) {
    return {
      answer:
        "OpenAI credentials not yet configured. This is a stub response. The /ask agent will produce live answers from your unified signal store the moment OPENAI_API_KEY is set. In the meantime, try asking 'Why is acc_sentinel stalling?' or 'Brief me on acc_atlas'.",
      citations: [],
      toolCalls: [],
      model: "stub-deterministic",
      accountSlug: null,
    };
  }

  const ctx = await getAccountContext({ account_slug: slug });
  toolCalls.push({
    tool: "get_account_context",
    args: { account_slug: slug, days: 90 },
    resultSummary: ctx.ok
      ? `${ctx.data.signals.length} signals, ${ctx.data.correlations.length} correlations, SV Health: ${ctx.data.svHealthScore?.score ?? "n/a"}`
      : ctx.error,
  });

  if (!ctx.ok) {
    return {
      answer: `I couldn't find an account matching '${slug}'. (Stub mode — set OPENAI_API_KEY to enable conversational follow-ups.)`,
      citations: [],
      toolCalls,
      model: "stub-deterministic",
      accountSlug: null,
    };
  }

  const data = ctx.data;
  const citations = collectCitations(data).slice(0, 5);
  const accountName = data.account.name;
  const opp = data.openOpportunities[0];
  const oppLine = opp
    ? `${opp.name} (${opp.stage}, $${opp.amount.toLocaleString()} ACV, in stage since ${opp.enteredStageAt})`
    : "No open opportunities";
  const health = data.svHealthScore
    ? `SV Health Score ${data.svHealthScore.score} (${data.svHealthScore.tier})`
    : "no SV Health Score (not in SV+ stage)";

  const topCorr = data.correlations[0];
  const corrLine = topCorr
    ? `${topCorr.sourceCount} sources agree on ${topCorr.correlationType} (severity: ${topCorr.derivedSeverity}). Sources: ${topCorr.sourceTools.join(", ")}.`
    : "No multi-source correlations in the last 90 days.";

  const cited = citations
    .slice(0, 3)
    .map((c) => `[citation:${c.id}]`)
    .join(" ");

  let answer: string;
  if (isStalling) {
    answer = [
      `${accountName} is showing late-stage stall signals. ${health}.`,
      `Open deal: ${oppLine}.`,
      `${corrLine} ${cited}`,
      data.signals.length > 0
        ? `Most recent signal: ${data.signals[0].summary} [citation:${data.signals[0].id}].`
        : "No recent signals.",
      "(Stub mode — real OpenAI integration activates when OPENAI_API_KEY is configured.)",
    ].join("\n\n");
  } else {
    // brief
    answer = [
      `${accountName} brief: ${oppLine}.`,
      `Committee: ${summarizeCommittee(data.contactsByRole)}.`,
      `${health}.`,
      `Recent activity: ${corrLine} ${cited}`,
      "(Stub mode — real OpenAI integration activates when OPENAI_API_KEY is configured.)",
    ].join("\n\n");
  }

  return {
    answer,
    citations,
    toolCalls,
    model: "stub-deterministic",
    accountSlug: slug,
    warnings: data.warnings.length > 0 ? data.warnings : undefined,
  };
}

function summarizeCommittee(
  byRole: Awaited<ReturnType<typeof getAccountContext>> extends infer R
    ? R extends { ok: true; data: { contactsByRole: infer C } }
      ? C
      : never
    : never,
): string {
  const labels: { key: keyof typeof byRole; label: string }[] = [
    { key: "champion", label: "Champion" },
    { key: "economic_buyer", label: "EB" },
    { key: "finance", label: "Finance" },
    { key: "it_security", label: "IT/Sec" },
    { key: "legal", label: "Legal" },
  ];
  const present = labels.filter((l) => byRole[l.key].length > 0).map((l) => l.label);
  const missing = labels.filter((l) => byRole[l.key].length === 0).map((l) => l.label);
  return [
    present.length ? `present: ${present.join(", ")}` : "no roles mapped",
    missing.length ? `missing: ${missing.join(", ")}` : "all 5 roles present",
  ].join("; ");
}

function findAccountSlugInText(text: string): string | null {
  // Look for an explicit acc_<id> token.
  const explicit = text.match(/\bacc_[a-z0-9_]+\b/i);
  if (explicit) {
    const slug = explicit[0].toLowerCase();
    if (accounts.some((a) => a.id === slug)) return slug;
  }
  // Fuzzy name fallback — match an account name word against the question.
  const lower = text.toLowerCase();
  for (const a of accounts) {
    const first = a.name.split(/[\s,&]+/)[0]?.toLowerCase();
    if (first && first.length >= 4 && lower.includes(first)) return a.id;
  }
  return null;
}

// ─── Real mode (OpenAI tool-use loop) ───────────────────────────────────

async function runAgentLoop(
  question: string,
  accountSlug?: string,
): Promise<AskResponse> {
  const client = getOpenAIClient();
  if (!client) {
    // Shouldn't reach here — HAS_OPENAI_KEY guard upstream. Defensive.
    throw new Error("OpenAI client unavailable");
  }

  const resolvedSlug: string | null = accountSlug ?? findAccountSlugInText(question);
  const userPreamble = accountSlug
    ? `Current account in scope: ${accountSlug}. Question: ${question}`
    : question;

  const messages: import("openai/resources").ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPreamble },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  let toolCallsRemaining = MAX_TOOL_CALLS_PER_TURN;
  const warnings: string[] = [];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const completion = await client.chat.completions.create({
      model: ASK_MODEL,
      messages,
      tools: ASK_TOOL_SCHEMAS,
      temperature: 0.3,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      throw new Error("OpenAI returned no message");
    }

    // Push the assistant's message so the next iteration sees the tool_call
    // ids it emitted (required for tool-role responses).
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      // No tool calls — model is done. Take its content as the answer.
      const answer = msg.content ?? "";
      const dedupCitations = dedupCitations_(allCitations);
      const cited = extractCitationIds(answer);
      const unknown = cited.filter(
        (id) => !dedupCitations.some((c) => c.id === id),
      );
      if (unknown.length > 0) {
        // Don't break the demo — but warn that the model fabricated ids.
        console.warn(
          `[ask] model cited signal ids not in tool results: ${unknown.join(", ")}`,
        );
        warnings.push(
          `Model cited ${unknown.length} signal id(s) not present in tool results: ${unknown.slice(0, 3).join(", ")}`,
        );
      }
      return {
        answer,
        citations: dedupCitations,
        toolCalls,
        model: ASK_MODEL,
        accountSlug: resolvedSlug,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    // Hard cap — refuse further tool calls once we've spent the budget.
    if (toolCallsRemaining <= 0) {
      warnings.push(
        `Tool call cap (${MAX_TOOL_CALLS_PER_TURN}) reached; stopping agent loop.`,
      );
      return {
        answer:
          msg.content ??
          "I exceeded my tool-call budget before reaching a final answer.",
        citations: dedupCitations_(allCitations),
        toolCalls,
        model: ASK_MODEL,
        accountSlug: resolvedSlug,
        warnings,
      };
    }

    for (const call of calls) {
      if (toolCallsRemaining <= 0) {
        // Respond with an error to the remaining calls so the model knows
        // to wrap up.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: "Tool-call budget exhausted for this turn.",
          }),
        });
        continue;
      }
      toolCallsRemaining -= 1;

      // The OpenAI SDK types tool_calls as a union of function calls and
      // "custom" calls. We only register function tools, so anything else
      // is a no-op response to keep the conversation in sync.
      if (call.type !== "function") {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: `Unsupported tool_call type: ${call.type}`,
          }),
        });
        continue;
      }
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await dispatchTool(name, args);
      const summary = summarizeResult(result);
      toolCalls.push({ tool: name, args, resultSummary: summary });

      if (result.ok) {
        for (const c of collectCitations(result.data)) allCitations.push(c);
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Out of turns. Bail with whatever the model last said.
  warnings.push(`Agent turn cap (${MAX_AGENT_TURNS}) reached without final answer.`);
  return {
    answer:
      "I made multiple tool calls but didn't converge on a final answer. Try rephrasing the question or narrowing to a specific account.",
    citations: dedupCitations_(allCitations),
    toolCalls,
    model: ASK_MODEL,
    accountSlug: resolvedSlug,
    warnings,
  };
}

function dedupCitations_(cs: Citation[]): Citation[] {
  const seen = new Set<string>();
  return cs.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function extractCitationIds(text: string): string[] {
  const out: string[] = [];
  const re = /\[citation:([^\]\s]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function summarizeResult(result: { ok: boolean; data?: unknown; error?: string }): string {
  if (!result.ok) return `error: ${result.error ?? "unknown"}`;
  const d = result.data as Record<string, unknown> | undefined;
  if (!d) return "ok";
  // Best-effort one-liner — favour the keys our tools actually return.
  if (Array.isArray((d as { signals?: unknown }).signals)) {
    const arr = (d as { signals: unknown[] }).signals;
    return `${arr.length} signals`;
  }
  if (Array.isArray((d as { correlations?: unknown }).correlations)) {
    const arr = (d as { correlations: unknown[] }).correlations;
    return `${arr.length} correlations`;
  }
  if ((d as { account?: { name?: string } }).account?.name) {
    return `account: ${(d as { account: { name: string } }).account.name}`;
  }
  if (Array.isArray((d as { presentRoles?: unknown }).presentRoles)) {
    const present = (d as { presentRoles: string[] }).presentRoles;
    const missing = (d as { missingRoles: string[] }).missingRoles ?? [];
    return `present: [${present.join(", ")}], missing: [${missing.join(", ")}]`;
  }
  if (typeof (d as { note?: string }).note === "string") {
    return (d as { note: string }).note;
  }
  return "ok";
}
