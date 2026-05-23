"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// AskChatPanel — the drawer / account-page surface for the /ask agent.
// Per synthesis.md "The AI query layer", there are two surfaces:
//   - /ask (full page) — the deep-work surface
//   - drawer chat panel — pre-scoped to the open account, the in-flow surface
//
// This component is the second. Mount it anywhere with an account in scope
// (e.g. inside <Drawer> or on /account/[slug]). It POSTs to /api/ask with
// the `accountSlug` body field, so the agent's resolver picks that account
// without the user typing the slug.
//
// Kept intentionally minimal: a one-line input, an answer panel, a "brief
// me on this account" pre-fill. No tool-call trace UI here — that lives on
// the full /ask page. The drawer is for quick answers in the flow.

type Citation = {
  id: string;
  sourceTool: string;
  sourceEventId: string | null;
  summary: string;
};

type AskResponse = {
  answer: string;
  citations: Citation[];
  toolCalls: unknown[];
  model: string;
  accountSlug: string | null;
};

export function AskChatPanel({
  accountSlug,
  className,
}: {
  accountSlug: string;
  className?: string;
}) {
  const [question, setQuestion] = useState("Brief me on this account");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          accountSlug,
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      setResponse((await res.json()) as AskResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask about this account…"
          className="flex-1 text-sm border border-border rounded-md px-2 h-8 bg-background focus:outline-none focus:border-foreground/40"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!question.trim() || loading}
          className={cn(
            "text-xs h-8 px-3 rounded-md bg-foreground text-background font-medium",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-700">Request failed: {error}</p>
      )}

      {response && (
        <div className="border border-border rounded-md p-3 bg-foreground/[0.02] space-y-2">
          {response.model === "stub-deterministic" && (
            <p className="text-[10px] text-amber-700">
              Demo response (set OPENAI_API_KEY for live answers).
            </p>
          )}
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            {renderAnswer(response.answer, response.citations, accountSlug)}
          </p>
          {response.citations.length > 0 && (
            <p className="text-[10px] text-muted">
              {response.citations.length} citation
              {response.citations.length === 1 ? "" : "s"} •{" "}
              <Link
                href={`/ask?account=${accountSlug}`}
                className="underline"
              >
                Open in /ask
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function renderAnswer(
  answer: string,
  citations: Citation[],
  accountSlug: string,
): React.ReactNode {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const parts: React.ReactNode[] = [];
  const re = /\[citation:([^\]\s]+)\]/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > lastIndex) parts.push(answer.slice(lastIndex, m.index));
    const id = m[1];
    const c = byId.get(id);
    const tool = c?.sourceTool ?? "?";
    parts.push(
      <Link
        key={`c-${key++}`}
        href={`/account/${accountSlug}#signal-${id}`}
        title={c?.summary ?? `Unknown citation: ${id}`}
        className={cn(
          "inline-flex items-center gap-1 align-baseline mx-0.5 px-1 h-4 rounded text-[9px] font-mono",
          c
            ? "bg-brand/10 text-brand border border-brand/30"
            : "bg-muted/10 text-muted border border-border line-through",
        )}
      >
        <span>{tool}</span>
      </Link>,
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < answer.length) parts.push(answer.slice(lastIndex));
  return parts;
}
