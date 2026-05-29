"use client";

import { useEffect, useRef, useState } from "react";

// Semantic search over the ONTOLOGY: find canonical fields by meaning
// (e.g. "where does close date live" → Deal.close_date). Hits
// /api/semantic-search?scope=schema. Degrades cleanly to an empty state until
// the ontology index is populated (scripts/embed-ontology.ts).

interface Hit {
  id: string;
  content: string;
  sourceId: string; // canonical field path, e.g. "Deal.close_date"
  similarity: number;
}

const DEBOUNCE_MS = 350;

// The embedded content is "Object.field (type) — description. Mapped from: …".
// The field path is shown separately, so drop the redundant leading prefix.
function description(content: string): string {
  const dash = content.indexOf(" — ");
  return dash >= 0 ? content.slice(dash + 3) : content;
}

export function SemanticSearchBox({
  placeholder = "Search the ontology by meaning — e.g. “where does close date live?”",
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
      setHits([]);
      setState("idle");
      return;
    }
    setState("loading");
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, scope: "schema" });
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
          No matching fields. (Ontology search is live once the schema index is
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
              <span className="text-[10px] font-mono py-0.5 px-2 rounded border border-border bg-foreground/[0.04] text-muted shrink-0 inline-flex items-center justify-center tabular-nums mt-0.5">
                {(h.similarity * 100).toFixed(0)}%
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-mono font-semibold tracking-tight">
                  {h.sourceId}
                </div>
                <div className="text-[13px] text-muted leading-snug mt-0.5 line-clamp-2">
                  {description(h.content)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
