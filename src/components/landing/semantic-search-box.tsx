"use client";

import { useEffect, useRef, useState } from "react";

// Unified semantic search over EVERYTHING embedded — ontology fields,
// integrations, and ingested intel (signals, news, emails, transcripts) — by
// meaning. e.g. "where does close date live" → Deal.close_date; "salesforce" →
// the Salesforce integration + what it connects to. Hits
// /api/semantic-search?scope=all. Degrades cleanly to an empty state until the
// vector index is populated (scripts/embed-*.ts).

interface Hit {
  id: string;
  content: string;
  sourceId: string; // field path, integration name, or intel id
  sourceTable: string; // which corpus it came from
  similarity: number;
}

// Human label + whether the sourceId is worth showing as a title, per corpus.
const SOURCE_META: Record<string, { label: string; titled: boolean }> = {
  integration: { label: "Integration", titled: true },
  ontology_field: { label: "Schema", titled: true },
  external_signals: { label: "Signal", titled: false },
  inbound_emails: { label: "Email", titled: false },
  granola_transcripts: { label: "Transcript", titled: false },
  web_scrapes: { label: "Web", titled: false },
};

const DEBOUNCE_MS = 350;

// The embedded content is "Object.field (type) — description. Mapped from: …".
// The field path is shown separately, so drop the redundant leading prefix.
function description(content: string): string {
  const dash = content.indexOf(" — ");
  return dash >= 0 ? content.slice(dash + 3) : content;
}

export function SemanticSearchBox({
  placeholder = "Search anything by meaning — fields, integrations, signals, news…",
}: {
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      // Clear results when the query is emptied (debounced search effect).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      setState("idle");
      return;
    }
    setState("loading");
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, scope: "all" });
        const res = await fetch(`/api/semantic-search?${params}`);
        const data = (await res.json()) as { matches: Hit[] };
        if (id !== reqId.current) return; // a newer query superseded this one
        setHits(data.matches ?? []);
        setState("done");
      } catch {
        if (id !== reqId.current) return;
        setHits([]);
        setState("done");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div>
      <div className="relative">
        <span
          aria-hidden
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"
        >
          ⌕
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2.5 text-sm placeholder:text-muted/70 focus:outline-none focus:border-foreground/30"
        />
        {state === "loading" && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-muted">
            searching…
          </span>
        )}
      </div>

      {state === "done" && query.trim() && hits.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-border bg-foreground/[0.015] p-4 text-[12px] text-muted italic">
          No matches. (Search is live once the vector index is populated.)
        </div>
      )}

      {hits.length > 0 && (
        <div className="mt-3 space-y-2">
          {hits.map((h) => {
            const meta = SOURCE_META[h.sourceTable] ?? {
              label: h.sourceTable,
              titled: false,
            };
            return (
              <div
                key={h.id}
                className="rounded-lg border border-border bg-background p-3 flex items-start gap-3"
              >
                <span className="text-[10px] font-mono py-0.5 px-2 rounded border border-border bg-foreground/[0.04] text-muted shrink-0 inline-flex items-center justify-center tabular-nums mt-0.5">
                  {(h.similarity * 100).toFixed(0)}%
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono uppercase tracking-[0.1em] py-0.5 px-1.5 rounded border border-border text-muted shrink-0">
                      {meta.label}
                    </span>
                    {meta.titled && (
                      <span className="text-[13px] font-mono font-semibold tracking-tight truncate">
                        {h.sourceId}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-muted leading-snug mt-1 line-clamp-2">
                    {description(h.content)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
