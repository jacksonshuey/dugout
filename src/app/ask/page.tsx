"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  AskProviderPicker,
  useAskChoice,
} from "@/components/ask-provider-picker";

// /ask — chat-style natural-language query layer (D2 rewrite).
//
// Conversational thread renders each turn as a bubble (user) + answer card
// (assistant). Visual multi-turn only — each backend /api/ask call is still
// independent for now; conversational memory across turns lands in a
// follow-up when the agent accepts a message-history parameter.

type Citation = {
  id: string;
  sourceTool: string;
  sourceEventId: string | null;
  summary: string;
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
  provider: string;
  accountSlug: string | null;
  warnings?: string[];
  stubReason?: string;
};

type RateLimitInfo = {
  message: string;
  reason: string;
  retryAfterSeconds: number;
};

type UserTurn = {
  kind: "user";
  id: string;
  content: string;
  timestamp: number;
};

type AssistantTurn = {
  kind: "assistant";
  id: string;
  response: AskResponse;
  timestamp: number;
};

type ErrorTurn = {
  kind: "error";
  id: string;
  message: string;
  rateLimit: RateLimitInfo | null;
  timestamp: number;
};

type Turn = UserTurn | AssistantTurn | ErrorTurn;

// Suggestions reference real seeded accounts so a viewer sees the agent
// answer something they can verify against /console.
const SUGGESTIONS = [
  "Brief me on Stripe",
  "Why is CNA Financial stalling?",
  "Which deals lost momentum this week?",
  "What's new on Snowflake?",
  "Summarize KKR & Co.'s pipeline",
  "Show me Moderna's latest signals",
];

const mkId = () => crypto.randomUUID();

export default function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const { choice, setChoice, availability } = useAskChoice();

  // Rotate placeholder while empty + input untouched so the empty state
  // feels alive without being noisy mid-typing.
  useEffect(() => {
    if (input.length > 0 || turns.length > 0) return;
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % SUGGESTIONS.length);
    }, 4000);
    return () => clearInterval(t);
  }, [input.length, turns.length]);

  // Auto-scroll thread to the bottom on new turns / loading state.
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns.length, loading]);

  async function submit(content?: string) {
    const question = (content ?? input).trim();
    if (!question || loading) return;
    setInput("");

    const userTurn: UserTurn = {
      kind: "user",
      id: mkId(),
      content: question,
      timestamp: Date.now(),
    };
    setTurns((t) => [...t, userTurn]);
    setLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          provider: choice.provider,
          model: choice.model,
        }),
      });

      if (res.status === 429) {
        const body = (await res.json()) as {
          error?: string;
          reason?: string;
          retry_after_seconds?: number;
        };
        setTurns((t) => [
          ...t,
          {
            kind: "error",
            id: mkId(),
            message: body.error ?? "Rate limit hit. Try again later.",
            rateLimit: {
              message: body.error ?? "Rate limit hit. Try again later.",
              reason: body.reason ?? "unknown",
              retryAfterSeconds: body.retry_after_seconds ?? 3600,
            },
            timestamp: Date.now(),
          },
        ]);
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const json = (await res.json()) as AskResponse;
      setTurns((t) => [
        ...t,
        {
          kind: "assistant",
          id: mkId(),
          response: json,
          timestamp: Date.now(),
        },
      ]);
    } catch (e) {
      setTurns((t) => [
        ...t,
        {
          kind: "error",
          id: mkId(),
          message: e instanceof Error ? e.message : String(e),
          rateLimit: null,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = turns.length === 0;

  return (
    <main className="max-w-3xl mx-auto p-6 flex flex-col h-[calc(100vh-3rem)]">
      <header className="flex items-baseline justify-between gap-4 mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ask Dugout</h1>
          <p className="text-sm text-muted mt-1">
            Natural-language queries across your unified signal store. Every
            claim cites the underlying signal — click a chip for the source.
          </p>
        </div>
        {!isEmpty && (
          <button
            type="button"
            onClick={() => setTurns([])}
            className="text-xs text-muted hover:text-foreground shrink-0"
          >
            Clear conversation
          </button>
        )}
      </header>

      <div
        ref={threadRef}
        className={cn(
          "flex-1 overflow-y-auto pr-2 -mr-2",
          isEmpty && "flex items-center justify-center",
        )}
      >
        {isEmpty ? (
          <EmptyState
            onPick={(q) => {
              setInput(q);
            }}
          />
        ) : (
          <ol className="space-y-4 pb-4">
            {turns.map((turn) => (
              <li key={turn.id}>
                {turn.kind === "user" && <UserBubble turn={turn} />}
                {turn.kind === "assistant" && (
                  <AssistantCard turn={turn} />
                )}
                {turn.kind === "error" && <ErrorBubble turn={turn} />}
              </li>
            ))}
            {loading && (
              <li>
                <ThinkingIndicator provider={choice.provider} />
              </li>
            )}
          </ol>
        )}
      </div>

      <div className="shrink-0 pt-3 border-t border-border mt-3">
        <Card className="p-3 space-y-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              isEmpty
                ? SUGGESTIONS[placeholderIdx]
                : "Ask a follow-up…"
            }
            rows={2}
            className="w-full resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] text-muted">
              <kbd className="font-mono px-1 py-0.5 border border-border rounded">
                Cmd
              </kbd>{" "}
              +{" "}
              <kbd className="font-mono px-1 py-0.5 border border-border rounded">
                Enter
              </kbd>{" "}
              to send
            </div>
            <div className="flex items-center gap-2">
              <AskProviderPicker
                choice={choice}
                setChoice={setChoice}
                availability={availability}
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!input.trim() || loading}
                className={cn(
                  "text-sm h-8 px-4 rounded-md bg-foreground text-background font-medium",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  "hover:bg-foreground/90 transition-colors",
                )}
              >
                {loading ? "Thinking" : "Ask"}
              </button>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="text-center space-y-4 max-w-md">
      <div className="text-4xl">💬</div>
      <div>
        <p className="text-sm font-medium">Start a conversation</p>
        <p className="text-xs text-muted mt-1">
          Ask anything about your accounts, signals, or pipeline. Try one of
          these to start:
        </p>
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {SUGGESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="text-xs px-3 h-7 rounded-full border border-border text-foreground hover:bg-foreground/5 transition-colors"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ turn }: { turn: UserTurn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-foreground text-background rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
        {turn.content}
      </div>
    </div>
  );
}

function ErrorBubble({ turn }: { turn: ErrorTurn }) {
  if (turn.rateLimit) {
    const mins = Math.ceil(turn.rateLimit.retryAfterSeconds / 60);
    return (
      <Card className="p-3 border-amber-400 bg-amber-50">
        <p className="text-sm font-medium text-amber-900">
          Rate limit reached
        </p>
        <p className="text-sm text-amber-900 mt-1">
          {turn.rateLimit.message}
        </p>
        <p className="text-xs text-amber-800 mt-2">
          Cap: <code className="font-mono">{turn.rateLimit.reason}</code> ·
          retry in ~{mins} min
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-3 border-red-300 bg-red-50">
      <p className="text-sm text-red-800">Request failed: {turn.message}</p>
    </Card>
  );
}

function ThinkingIndicator({ provider }: { provider: string }) {
  const label =
    provider === "openai"
      ? "OpenAI"
      : provider === "anthropic"
        ? "Claude"
        : "Stub";
  return (
    <Card className="p-3 inline-flex items-center gap-2">
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse [animation-delay:300ms]" />
      </span>
      <span className="text-xs text-muted">{label} thinking…</span>
    </Card>
  );
}

function AssistantCard({ turn }: { turn: AssistantTurn }) {
  const { response } = turn;
  const isStub = response.model === "stub-deterministic";
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className="space-y-2">
      {isStub && (
        <p className="text-xs text-amber-700">
          {response.stubReason
            ? `Demo response (${response.stubReason}).`
            : "Demo response — pick a provider above for live answers."}
        </p>
      )}
      <Card className="p-4 space-y-3">
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          <AnswerWithCitations
            answer={response.answer}
            citations={response.citations}
            accountSlug={response.accountSlug}
          />
        </div>

        {response.warnings && response.warnings.length > 0 && (
          <div className="text-xs text-amber-700 border-t border-border pt-2">
            <p className="font-medium mb-1">Warnings</p>
            <ul className="list-disc list-inside space-y-0.5">
              {response.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {response.citations.length > 0 && (
          <details className="border-t border-border pt-2">
            <summary className="text-xs font-medium text-muted cursor-pointer hover:text-foreground">
              Citations ({response.citations.length})
            </summary>
            <ul className="space-y-1 text-xs mt-2">
              {response.citations.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2">
                  <CitationChip
                    citation={c}
                    accountSlug={response.accountSlug}
                  />
                  <span className="text-muted">{c.summary}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <button
          type="button"
          onClick={() => setShowTrace((s) => !s)}
          className="text-[10px] text-muted hover:text-foreground flex items-center gap-1 pt-1"
        >
          <span>{showTrace ? "▼" : "▶"}</span>
          How I got this · {response.toolCalls.length} tool call
          {response.toolCalls.length === 1 ? "" : "s"} ·{" "}
          <code className="font-mono">{response.provider}</code>:{" "}
          <code className="font-mono">{response.model}</code>
        </button>
        {showTrace && (
          <ol className="space-y-1.5 text-xs">
            {response.toolCalls.length === 0 && (
              <li className="text-muted">No tool calls.</li>
            )}
            {response.toolCalls.map((tc, i) => (
              <li
                key={i}
                className="border border-border rounded-md p-2 bg-foreground/[0.02]"
              >
                <div className="font-mono font-medium">{tc.tool}</div>
                <div className="font-mono text-muted truncate">
                  args: {JSON.stringify(tc.args)}
                </div>
                <div className="text-muted mt-1">→ {tc.resultSummary}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function AnswerWithCitations({
  answer,
  citations,
  accountSlug,
}: {
  answer: string;
  citations: Citation[];
  accountSlug: string | null;
}) {
  const byId = useMemo(() => {
    const m = new Map<string, Citation>();
    for (const c of citations) m.set(c.id, c);
    return m;
  }, [citations]);

  const parts: React.ReactNode[] = [];
  const re = /\[citation:([^\]\s]+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > lastIndex) {
      parts.push(answer.slice(lastIndex, m.index));
    }
    const id = m[1];
    const c = byId.get(id);
    parts.push(
      <CitationChip
        key={`c-${key++}`}
        citation={c ?? null}
        fallbackId={id}
        accountSlug={accountSlug}
      />,
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < answer.length) parts.push(answer.slice(lastIndex));
  return <>{parts}</>;
}

function CitationChip({
  citation,
  fallbackId,
  accountSlug,
}: {
  citation: Citation | null;
  fallbackId?: string;
  accountSlug: string | null;
}) {
  const id = citation?.id ?? fallbackId ?? "unknown";
  const tool = citation?.sourceTool ?? "?";
  const href = accountSlug ? `/account/${accountSlug}#signal-${id}` : "#";
  const isKnown = Boolean(citation);
  const isLinkable = Boolean(accountSlug) && isKnown;
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (!isLinkable) e.preventDefault();
      }}
      title={citation?.summary ?? `Unknown citation: ${id}`}
      className={cn(
        "inline-flex items-center gap-1 align-baseline mx-0.5 px-1.5 h-5 rounded text-[10px] font-mono",
        isKnown
          ? "bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20"
          : "bg-muted/10 text-muted border border-border line-through",
      )}
    >
      <span>{tool}</span>
      <span className="opacity-70">#{id.slice(0, 8)}</span>
    </Link>
  );
}
