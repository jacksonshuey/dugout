"use client";

import { useEffect, useRef, useState } from "react";

// Reusable semantic-search box. Hits /api/semantic-search and renders
// meaning-ranked matches over the ingested intel (signals, news, filings,
// transcripts, emails). Used in the dashboard + ontology section.
//
// Degrades cleanly: until the vector tier is populated (migration applied +
// embeddings backfilled) the API returns no matches and we show an empty
// state rather than erroring.

interface Hit {
  id: string;
  summary: string;
  content: string;
  sourceTable: string;
  sourceId: string;
  kind: string | null;
  similarity: number;
}

const DEBOUNCE_MS = 350;

type Scope = "intel" | "schema";

export function SemanticSearchBox({
  placeholder = "Search by meaning — e.g. “pricing pressure on enterprise deals”",
  accountSlug,
  dualScope = false,
}: {
  placeholder?: string;
  accountSlug?: string;
  // When true, render an Intel / Schema toggle (used in the ontology section).
  // Intel = ingested content; Schema = the canonical ontology fields.
  dualScope?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("intel");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setState("idle");
      return;
    }
    setState("loading");
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (accountSlug) params.set("account", accountSlug);
        if (dualScope) params.set("scope", scope);
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
  }, [query, accountSlug, dualScope, scope]);

  return (
    <div>
      {dualScope && (
        <div className="flex items-center gap-2 mb-2">
          {(["intel", "schema"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`text-[10px] font-mono uppercase tracking-[0.1em] py-1 px-2.5 rounded border transition-colors ${
                scope === s
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-border bg-background text-muted hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {s === "intel" ? "Intel" : "Schema"}
            </button>
          ))}
        </div>
      )}
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
          No matches yet. (Semantic search is live once the vector index is
          populated.)
        </div>
      )}

      {hits.length > 0 && (
        <div className="mt-3 space-y-2">
          {hits.map((h) => (
            <div
              key={h.id}
              className="rounded-lg border border-border bg-background p-3 flex items-start gap-3"
            >
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 px-2 rounded border border-border bg-foreground/[0.04] text-muted shrink-0 inline-flex items-center justify-center tabular-nums">
                {(h.similarity * 100).toFixed(0)}%
              </span>
              <div className="flex-1 min-w-0">
                {h.sourceTable === "ontology_field" && (
                  <div className="text-[13px] font-mono font-semibold tracking-tight">
                    {h.sourceId}
                  </div>
                )}
                <div className="text-sm tracking-tight leading-snug line-clamp-3">
                  {h.content || h.summary}
                </div>
                <div className="text-[11px] text-muted mt-1 flex items-center gap-2 flex-wrap font-mono uppercase tracking-[0.08em]">
                  <span>{h.sourceTable.replace(/_/g, " ")}</span>
                  {h.kind && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{h.kind.replace(/_/g, " ")}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
