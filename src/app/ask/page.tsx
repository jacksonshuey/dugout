"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

// /ask — the natural-language query layer (U4).
//
// Simple chat-style UI: text input at the top, submit button, answer panel
// below. POSTs to /api/ask and renders the response.
//
// Two display affordances called out in the brief:
//   1. Inline citation chips — every [citation:signal_id] in the answer body
//      becomes a small badge linked to /account/<slug>#signal-<id>. Today
//      that deep link doesn't resolve (the per-account drawer page doesn't
//      exist yet), so we render the chip as a static label until the
//      target page lands. The href format is set so it'll Just Work when
//      that route ships.
//   2. "How I got this answer" — collapsible tool-call trace, so the demo
//      audience can see the agent picked tools deliberately, not magically.

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
  accountSlug: string | null;
  warnings?: string[];
};

const SAMPLE_QUESTIONS = [
  "Why is acc_sentinel stalling?",
  "Which deals lost momentum this week?",
  "What's the latest on acc_atlas?",
  "Brief me on acc_meridian",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);

  // Rotate the placeholder every 4s so a passive viewer sees the canonical
  // demo questions cycle. Pause when the user has started typing.
  useEffect(() => {
    if (question.length > 0) return;
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % SAMPLE_QUESTIONS.length);
    }, 4000);
    return () => clearInterval(t);
  }, [question.length]);

  async function submit() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    setShowTrace(false);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as AskResponse;
      setResponse(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const isStubMode = response?.model === "stub-deterministic";

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ask Dugout</h1>
        <p className="text-sm text-muted mt-1">
          Natural-language queries across your unified signal store. Every
          claim cites the underlying signal — click a chip to see the source.
        </p>
      </header>

      <Card className="p-4 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={SAMPLE_QUESTIONS[placeholderIdx]}
          rows={3}
          className="w-full resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted"
        />
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_QUESTIONS.slice(0, 3).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuestion(q)}
                className="text-xs px-2 h-6 rounded-md border border-border text-muted hover:bg-foreground/5"
              >
                {q}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!question.trim() || loading}
            className={cn(
              "text-sm h-8 px-3 rounded-md bg-foreground text-background font-medium",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "hover:bg-foreground/90",
            )}
          >
            {loading ? "Thinking…" : "Ask (⌘↵)"}
          </button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-800">
            Request failed: {error}
          </p>
        </Card>
      )}

      {response && (
        <>
          {isStubMode && (
            <Card className="p-3 bg-amber-50 border-amber-300">
              <p className="text-xs text-amber-900">
                Showing demo response. Real OpenAI integration activates when{" "}
                <code>OPENAI_API_KEY</code> is configured.
              </p>
            </Card>
          )}

          <Card className="p-5 space-y-4">
            <div className="text-sm leading-relaxed whitespace-pre-wrap">
              <AnswerWithCitations
                answer={response.answer}
                citations={response.citations}
                accountSlug={response.accountSlug}
              />
            </div>

            {response.warnings && response.warnings.length > 0 && (
              <div className="text-xs text-amber-700 border-t border-border pt-3">
                <p className="font-medium mb-1">Warnings</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {response.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {response.citations.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium text-muted mb-2">
                  Citations ({response.citations.length})
                </p>
                <ul className="space-y-1 text-xs">
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
              </div>
            )}
          </Card>

          <Card className="p-4">
            <button
              type="button"
              onClick={() => setShowTrace((s) => !s)}
              className="text-xs text-muted hover:text-foreground flex items-center gap-1"
            >
              <span>{showTrace ? "▼" : "▶"}</span>
              How I got this answer · {response.toolCalls.length} tool call
              {response.toolCalls.length === 1 ? "" : "s"} · model:{" "}
              <code className="font-mono">{response.model}</code>
            </button>
            {showTrace && (
              <ol className="mt-3 space-y-2 text-xs">
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
        </>
      )}
    </main>
  );
}

// Render the answer text with inline citation chips substituted for
// `[citation:signal_id]` markers. Unknown citation ids render as a muted
// fallback chip rather than disappearing — debugging aid.
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
  // Deep link target. The /account/[slug] route exists; when no slug is
  // resolvable (cross-account question), fall back to a no-op chip so the
  // user isn't bounced to a 404. The signal-<id> anchor lets the account
  // page (or a future enhancement to it) scroll to the cited row.
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
