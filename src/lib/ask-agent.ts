// Provider-agnostic agent loop for /ask (D1).
//
// One entry point — runAskAgent() — picks the right tool-use shape per
// provider and drives the same 8-tool dispatcher. The route handler in
// /api/ask only cares about the AskResponse shape; it never branches on
// provider internals.
//
// Provider failure → stub fallback. The route enforces rate-limit caps;
// this loop assumes the request has already been admitted. Provider-side
// network/API errors here fall back to the deterministic stub WITH
// `stubReason` set so the UI can show "we tried Claude, it 529'd, here's a
// canned answer instead" without breaking the demo.
//
// Hard limits (per Jackson's brief):
//   - Max 8 tool calls per turn
//   - Max 4 turns total
//
// Citation chain preservation: every signal id we pass to the model via a
// tool result is also pushed onto `allCitations`. The final AskResponse
// includes the dedup'd citations array regardless of which provider
// answered, so the UI's chip-rendering logic stays provider-blind.

import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";

import {
  ASK_TOOL_SCHEMAS_ANTHROPIC,
  ASK_TOOL_SCHEMAS_OPENAI,
  collectCitations,
  dispatchTool,
  getAccountContext,
  type Citation,
} from "@/lib/ask-tools";
import { getAskSystemPrompt } from "@/lib/ask-system-prompt";
import { HAS_OPENAI_KEY, getOpenAIClient } from "@/lib/openai";
import {
  ASK_ANTHROPIC_HAIKU_MODEL,
  ASK_ANTHROPIC_SONNET_MODEL,
  HAS_ANTHROPIC_KEY,
  getAnthropicClient,
} from "@/lib/anthropic-ask";
import { DEMO_SCENARIO_ACCOUNTS, accounts } from "@/data/seed";

// ─── Public types ───────────────────────────────────────────────────────

export type AskProvider = "openai" | "anthropic" | "stub";
export type AskModel =
  | "gpt-4o"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "stub-deterministic";

export type ToolCallRecord = {
  tool: string;
  args: Record<string, unknown>;
  resultSummary: string;
};

export type RunAskAgentArgs = {
  question: string;
  accountSlug?: string;
  provider: AskProvider;
  model: AskModel;
};

export type RunAskAgentResult = {
  answer: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  model: AskModel;
  provider: AskProvider;
  accountSlug: string | null;
  warnings: string[];
  stubReason?: string;
};

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_TOOL_CALLS_PER_TURN = 8;
const MAX_AGENT_TURNS = 4;

// The OpenAI model id Jackson exposed in the dropdown is "gpt-4o"; the
// actual model identifier we send to the API is the dated snapshot for
// stability. Map UI → API here so a future bump (gpt-5) is a one-line
// change without touching the UI types.
const OPENAI_API_MODEL_ID = "gpt-4o-2024-08-06";

// Provider/model validity matrix. The dropdown ought to enforce this on
// the client; we re-enforce server-side because (a) defense in depth,
// (b) the agent loop branches on it directly.
const VALID_MODELS_BY_PROVIDER: Record<AskProvider, AskModel[]> = {
  openai: ["gpt-4o"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5"],
  stub: ["stub-deterministic"],
};

export function isValidProviderModel(
  provider: AskProvider,
  model: AskModel,
): boolean {
  return VALID_MODELS_BY_PROVIDER[provider]?.includes(model) ?? false;
}

// ─── Entry point ────────────────────────────────────────────────────────

export async function runAskAgent(
  args: RunAskAgentArgs,
): Promise<RunAskAgentResult> {
  const { question, accountSlug, provider, model } = args;

  // Stub explicitly requested.
  if (provider === "stub") {
    return runStub(question, accountSlug);
  }

  // Mismatched provider/model — defensive. The /api/ask route should
  // sanity-check before calling us, but if it doesn't we don't want to
  // ship a confusing wire to OpenAI.
  if (!isValidProviderModel(provider, model)) {
    const stub = await runStub(question, accountSlug);
    return {
      ...stub,
      stubReason: `Invalid provider/model combination: ${provider}/${model}`,
      warnings: [...stub.warnings, `invalid_provider_model: ${provider}/${model}`],
    };
  }

  // Env key missing — degrade to stub with reason, so the UI can show
  // "key not configured" instead of a confusing API error.
  if (provider === "openai" && !HAS_OPENAI_KEY) {
    const stub = await runStub(question, accountSlug);
    return { ...stub, stubReason: "OPENAI_API_KEY not configured" };
  }
  if (provider === "anthropic" && !HAS_ANTHROPIC_KEY) {
    const stub = await runStub(question, accountSlug);
    return { ...stub, stubReason: "ANTHROPIC_API_KEY not configured" };
  }

  try {
    if (provider === "openai") {
      return await runOpenAILoop({
        question,
        accountSlug,
        model: model as "gpt-4o",
      });
    }
    if (provider === "anthropic") {
      return await runAnthropicLoop({
        question,
        accountSlug,
        model: model as "claude-sonnet-4-6" | "claude-haiku-4-5",
      });
    }
    // Unreachable given the validity check above. TypeScript exhaustiveness.
    const _: never = provider;
    void _;
    throw new Error(`Unhandled provider: ${provider as string}`);
  } catch (e) {
    // Provider-side failure → fall back to stub. The route logs but does
    // not 500, so the demo doesn't break on a transient blip.
    const stub = await runStub(question, accountSlug);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...stub,
      stubReason: `${provider}_error: ${msg}`,
      warnings: [...stub.warnings, `${provider}_error: ${msg}`],
    };
  }
}

// ─── OpenAI loop ────────────────────────────────────────────────────────
//
// Same shape as the original /api/ask route loop, lifted unchanged into
// this provider-agnostic module so the route can stay thin.

async function runOpenAILoop(args: {
  question: string;
  accountSlug?: string;
  model: "gpt-4o";
}): Promise<RunAskAgentResult> {
  const { question, accountSlug, model } = args;
  const client = getOpenAIClient();
  if (!client) throw new Error("OpenAI client unavailable");

  const resolvedSlug: string | null =
    accountSlug ?? findAccountSlugInText(question);
  const userPreamble = accountSlug
    ? `Current account in scope: ${accountSlug}. Question: ${question}`
    : question;

  const systemPrompt = getAskSystemPrompt({ accountSlug });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPreamble },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  const warnings: string[] = [];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let toolCallsRemaining = MAX_TOOL_CALLS_PER_TURN;
    const completion = await client.chat.completions.create({
      model: OPENAI_API_MODEL_ID,
      messages,
      tools: ASK_TOOL_SCHEMAS_OPENAI,
      temperature: 0.3,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) throw new Error("OpenAI returned no message");

    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      const answer = msg.content ?? "";
      const dedup = dedupCitations(allCitations);
      const unknown = extractCitationIds(answer).filter(
        (id) => !dedup.some((c) => c.id === id),
      );
      if (unknown.length > 0) {
        warnings.push(
          `Model cited ${unknown.length} signal id(s) not present in tool results: ${unknown.slice(0, 3).join(", ")}`,
        );
      }
      return {
        answer,
        citations: dedup,
        toolCalls,
        model,
        provider: "openai",
        accountSlug: resolvedSlug,
        warnings,
      };
    }

    if (toolCallsRemaining <= 0) {
      warnings.push(
        `Tool call cap (${MAX_TOOL_CALLS_PER_TURN}) reached; stopping agent loop.`,
      );
      return {
        answer:
          msg.content ??
          "I exceeded my tool-call budget before reaching a final answer.",
        citations: dedupCitations(allCitations),
        toolCalls,
        model,
        provider: "openai",
        accountSlug: resolvedSlug,
        warnings,
      };
    }

    for (const call of calls) {
      if (toolCallsRemaining <= 0) {
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
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(call.function.arguments || "{}");
      } catch {
        toolArgs = {};
      }
      const result = await dispatchTool(name, toolArgs);
      toolCalls.push({
        tool: name,
        args: toolArgs,
        resultSummary: summarizeResult(result),
      });
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

  warnings.push(`Agent turn cap (${MAX_AGENT_TURNS}) reached without final answer.`);
  return {
    answer:
      "I made multiple tool calls but didn't converge on a final answer. Try rephrasing the question or narrowing to a specific account.",
    citations: dedupCitations(allCitations),
    toolCalls,
    model,
    provider: "openai",
    accountSlug: resolvedSlug,
    warnings,
  };
}

// ─── Anthropic loop ─────────────────────────────────────────────────────
//
// Anthropic's tool-use protocol is structurally the same as OpenAI's but
// shaped differently:
//   - Messages content is an array of typed blocks (text, tool_use,
//     tool_result), not a string + tool_calls array.
//   - System prompt is a top-level param on messages.create, not a
//     message.
//   - stop_reason of "tool_use" means we have at least one tool_use block
//     to handle; anything else (end_turn / max_tokens / stop_sequence)
//     means we're done.

async function runAnthropicLoop(args: {
  question: string;
  accountSlug?: string;
  model: "claude-sonnet-4-6" | "claude-haiku-4-5";
}): Promise<RunAskAgentResult> {
  const { question, accountSlug, model } = args;
  const client = getAnthropicClient();
  if (!client) throw new Error("Anthropic client unavailable");

  const apiModel =
    model === "claude-haiku-4-5"
      ? ASK_ANTHROPIC_HAIKU_MODEL
      : ASK_ANTHROPIC_SONNET_MODEL;

  const resolvedSlug: string | null =
    accountSlug ?? findAccountSlugInText(question);
  const userPreamble = accountSlug
    ? `Current account in scope: ${accountSlug}. Question: ${question}`
    : question;

  const systemPrompt = getAskSystemPrompt({ accountSlug });

  // Anthropic message history. Builds turn by turn; assistant blocks come
  // straight from the response, user blocks carry tool_result entries.
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPreamble },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const allCitations: Citation[] = [];
  const warnings: string[] = [];

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let toolCallsRemaining = MAX_TOOL_CALLS_PER_TURN;
    const response = await client.messages.create({
      model: apiModel,
      system: systemPrompt,
      max_tokens: 2000,
      temperature: 0.3,
      tools: ASK_TOOL_SCHEMAS_ANTHROPIC,
      messages,
    });

    // Replay the assistant message back into the conversation so the next
    // turn's tool_result blocks can reference the right tool_use ids.
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const answerSoFar = textBlocks.map((b) => b.text).join("\n").trim();

    // No tool calls this turn → we're done. Take the text content as the
    // final answer.
    if (toolUses.length === 0) {
      const dedup = dedupCitations(allCitations);
      const unknown = extractCitationIds(answerSoFar).filter(
        (id) => !dedup.some((c) => c.id === id),
      );
      if (unknown.length > 0) {
        warnings.push(
          `Model cited ${unknown.length} signal id(s) not present in tool results: ${unknown.slice(0, 3).join(", ")}`,
        );
      }
      return {
        answer: answerSoFar,
        citations: dedup,
        toolCalls,
        model,
        provider: "anthropic",
        accountSlug: resolvedSlug,
        warnings,
      };
    }

    // Tool-call cap exhausted. Refuse remaining calls so the model knows
    // to wrap up.
    if (toolCallsRemaining <= 0) {
      warnings.push(
        `Tool call cap (${MAX_TOOL_CALLS_PER_TURN}) reached; stopping agent loop.`,
      );
      return {
        answer:
          answerSoFar ||
          "I exceeded my tool-call budget before reaching a final answer.",
        citations: dedupCitations(allCitations),
        toolCalls,
        model,
        provider: "anthropic",
        accountSlug: resolvedSlug,
        warnings,
      };
    }

    // Dispatch each tool_use, gather results into a single user message.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      if (toolCallsRemaining <= 0) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify({
            ok: false,
            error: "Tool-call budget exhausted for this turn.",
          }),
          is_error: true,
        });
        continue;
      }
      toolCallsRemaining -= 1;

      const name = use.name;
      const toolArgs =
        (use.input as Record<string, unknown> | null | undefined) ?? {};
      const result = await dispatchTool(name, toolArgs);
      toolCalls.push({
        tool: name,
        args: toolArgs,
        resultSummary: summarizeResult(result),
      });
      if (result.ok) {
        for (const c of collectCitations(result.data)) allCitations.push(c);
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  warnings.push(`Agent turn cap (${MAX_AGENT_TURNS}) reached without final answer.`);
  return {
    answer:
      "I made multiple tool calls but didn't converge on a final answer. Try rephrasing the question or narrowing to a specific account.",
    citations: dedupCitations(allCitations),
    toolCalls,
    model,
    provider: "anthropic",
    accountSlug: resolvedSlug,
    warnings,
  };
}

// ─── Stub mode ──────────────────────────────────────────────────────────
//
// Lifted from the original /api/ask route. Two intents — "stalling" and
// "brief" — get bespoke narrations; everything else returns a generic
// pointer. The narration calls real tools to fetch real citation chips so
// the demo still shows the citation UX.

async function runStub(
  question: string,
  accountSlug?: string,
): Promise<RunAskAgentResult> {
  const toolCalls: ToolCallRecord[] = [];

  const slug =
    accountSlug ??
    findAccountSlugInText(question) ??
    DEMO_SCENARIO_ACCOUNTS.critical;

  const isStalling = /stall|stuck|risk|losing|momentum|going dark|quiet/i.test(
    question,
  );
  const isBrief = /brief|summary|overview|catch.*up|tell me about|latest on/i.test(
    question,
  );

  if (!isStalling && !isBrief) {
    return {
      answer:
        "Provider credentials not configured. This is a stub response. The /ask agent will produce live answers from your unified signal store the moment an API key is set. In the meantime, try asking 'Why is acc_sentinel stalling?' or 'Brief me on acc_atlas'.",
      citations: [],
      toolCalls: [],
      model: "stub-deterministic",
      provider: "stub",
      accountSlug: null,
      warnings: [],
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
      answer: `I couldn't find an account matching '${slug}'. (Stub mode — set an API key to enable conversational follow-ups.)`,
      citations: [],
      toolCalls,
      model: "stub-deterministic",
      provider: "stub",
      accountSlug: null,
      warnings: [],
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

  const cited = citations.slice(0, 3).map((c) => `[citation:${c.id}]`).join(" ");

  let answer: string;
  if (isStalling) {
    answer = [
      `${accountName} is showing late-stage stall signals. ${health}.`,
      `Open deal: ${oppLine}.`,
      `${corrLine} ${cited}`,
      data.signals.length > 0
        ? `Most recent signal: ${data.signals[0].summary} [citation:${data.signals[0].id}].`
        : "No recent signals.",
      "(Stub mode — real provider integration activates when an API key is configured.)",
    ].join("\n\n");
  } else {
    answer = [
      `${accountName} brief: ${oppLine}.`,
      `Committee: ${summarizeCommittee(data.contactsByRole)}.`,
      `${health}.`,
      `Recent activity: ${corrLine} ${cited}`,
      "(Stub mode — real provider integration activates when an API key is configured.)",
    ].join("\n\n");
  }

  return {
    answer,
    citations,
    toolCalls,
    model: "stub-deterministic",
    provider: "stub",
    accountSlug: slug,
    warnings: data.warnings,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

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
  const explicit = text.match(/\bacc_[a-z0-9_]+\b/i);
  if (explicit) {
    const slug = explicit[0].toLowerCase();
    if (accounts.some((a) => a.id === slug)) return slug;
  }
  const lower = text.toLowerCase();
  for (const a of accounts) {
    const first = a.name.split(/[\s,&]+/)[0]?.toLowerCase();
    if (first && first.length >= 4 && lower.includes(first)) return a.id;
  }
  return null;
}

function dedupCitations(cs: Citation[]): Citation[] {
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

function summarizeResult(result: {
  ok: boolean;
  data?: unknown;
  error?: string;
}): string {
  if (!result.ok) return `error: ${result.error ?? "unknown"}`;
  const d = result.data as Record<string, unknown> | undefined;
  if (!d) return "ok";
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
