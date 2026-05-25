"use client";

// One row in the unified signal timeline. Click expands to show the raw
// payload, the derived JSONB, and the source citation chain (source_tool +
// source_event_id, or "engine-derived" when source_event_id is null).
//
// Per BUILD_ALIGNMENT principle #6 (evidence chain mandatory): every signal
// MUST surface its citation. Where source_event_id is missing - which
// happens for the deterministic rule-engine signals - we render an explicit
// "engine-derived" note so the user understands why there's no link to a
// raw source row. The unifier currently stamps `sourceEventId = ruleId` for
// engine signals, so the null path is reserved for future cases (e.g. if we
// add a synthesized correlation row to the timeline).
//
// Voice rules (#8): plain language. No emojis, no exclamations.

import { useState } from "react";
import type { UnifiedSignal } from "@/lib/unify-signals";
import { SeverityBadge } from "@/components/ui";
import { cn, daysBetween, formatDate } from "@/lib/utils";

export function TimelineRow({ signal }: { signal: UnifiedSignal }) {
  const [expanded, setExpanded] = useState(false);

  const dayDelta = daysBetween(signal.occurredAt);
  const relativeLabel =
    dayDelta <= 0
      ? "today"
      : dayDelta === 1
        ? "1 day ago"
        : `${dayDelta} days ago`;

  const directionGlyph =
    signal.direction === "positive"
      ? "▲"
      : signal.direction === "negative"
        ? "▼"
        : "-";
  const directionClass =
    signal.direction === "positive"
      ? "text-severity-green"
      : signal.direction === "negative"
        ? "text-severity-blocking"
        : "text-muted";

  const sourceLabel = SOURCE_LABEL[signal.sourceTool] ?? signal.sourceTool;
  const sourceIcon = SOURCE_ICON[signal.sourceTool] ?? "·";

  // Citation chip - either a "view source" affordance (when source_event_id
  // exists) or a plain "engine-derived" note. We don't currently navigate
  // anywhere on click - the affordance is the visible source attribution
  // itself, which is what the alignment principle requires.
  const citationLabel = signal.sourceEventId
    ? `${sourceLabel} · ${truncate(signal.sourceEventId, 28)}`
    : `${sourceLabel} · engine-derived (no source event)`;

  return (
    <li
      id={`signal-${signal.id}`}
      className={cn(
        "rounded-xl border border-border bg-background overflow-hidden transition-colors scroll-mt-16",
        expanded && "ring-1 ring-brand/20",
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className={cn("font-mono text-base leading-none", directionClass)}
            aria-hidden
            title={`Direction: ${signal.direction}`}
          >
            {directionGlyph}
          </span>
          <span
            className="text-base leading-none"
            aria-hidden
            title={sourceLabel}
          >
            {sourceIcon}
          </span>
          <SeverityBadge severity={signal.severity} />
          <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border">
            {humanizeSignalType(signal.signalType)}
          </span>
          <span className="text-sm flex-1 min-w-0">{signal.summary}</span>
          <time
            className="text-[11px] text-muted font-mono shrink-0"
            title={signal.occurredAt}
          >
            {relativeLabel} · {formatDate(signal.occurredAt)}
          </time>
          <span
            className="text-muted/60 font-mono text-[10px] w-3 inline-block shrink-0"
            aria-hidden
          >
            {expanded ? "▾" : "▸"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border bg-slate-50/40 space-y-2">
          <div className="flex items-baseline gap-2 flex-wrap text-[11px]">
            <span className="text-muted">View source:</span>
            <span
              className={cn(
                "font-mono px-1.5 py-0.5 rounded border",
                signal.sourceEventId
                  ? "bg-background text-foreground border-border"
                  : "bg-slate-100 text-muted border-border italic",
              )}
              title={
                signal.sourceEventId ??
                "Engine-derived signal - no source_event_id"
              }
            >
              {citationLabel}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Field label="signal_type" value={signal.signalType} />
            <Field label="severity" value={signal.severity} />
            <Field label="direction" value={signal.direction} />
            <Field label="source_tool" value={signal.sourceTool} />
            <Field
              label="source_event_id"
              value={signal.sourceEventId ?? "(null - engine-derived)"}
            />
            <Field label="occurred_at" value={signal.occurredAt} />
          </div>

          {signal.derived && Object.keys(signal.derived).length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted hover:text-foreground">
                derived payload
              </summary>
              <pre className="mt-1 rounded-md bg-foreground/90 text-background p-2 overflow-x-auto font-mono text-[10.5px] leading-snug">
                {safeStringify(signal.derived)}
              </pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted font-mono uppercase tracking-wider text-[10px]">
        {label}
      </div>
      <div
        className="font-mono text-foreground break-all"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

// Mirrors the labels used in /api/account-context callers so the timeline
// reads consistently with the rest of the surface.
const SOURCE_LABEL: Record<string, string> = {
  signal_engine: "Engine",
  newsapi: "NewsAPI",
  sec_edgar: "SEC EDGAR",
  newsletter: "Newsletter",
  claude_web_search: "Web search",
  granola: "Granola",
  demo: "Demo",
  manual: "Manual",
};

// Source icons - emojis intentionally avoided per voice rule #8. Using
// monospace glyphs as inline source markers instead. Replaced 1:1 with the
// simple-icons SVGs once the design pass lands.
const SOURCE_ICON: Record<string, string> = {
  signal_engine: "⌬",
  newsapi: "❏",
  sec_edgar: "§",
  newsletter: "✉",
  claude_web_search: "⌖",
  granola: "◐",
  demo: "·",
  manual: "✎",
};

function humanizeSignalType(t: string): string {
  return t.replace(/_/g, " ");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
