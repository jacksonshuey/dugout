"use client";

import type { ExternalSignal } from "@/lib/external-signals";

// "Top news of the week" feed — a pure renderer. The server (fetchWorkspaceFeed)
// already ranks by relevance/impact and diversifies by publisher
// (rankTopWorkspaceNews), so this just renders the rows in the given order.

export function SortableWorkspaceFeed({
  signals,
}: {
  signals: ExternalSignal[];
}) {
  if (signals.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-6 text-sm text-muted">
        Workspace inbox is quiet right now. Newer items will land here as
        the pipeline tags them.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {signals.map((signal) => (
        <FeedRow key={signal.id} signal={signal} />
      ))}
    </div>
  );
}

function FeedRow({ signal }: { signal: ExternalSignal }) {
  const publisher =
    signal.publisher_canonical_name ??
    signal.email_subject?.split(" - ")[0] ??
    signal.source.replace(/_/g, " ");
  const typeLabel = signal.type.replace(/_/g, " ");
  const ageLabel = relativeAge(signal.occurred_at);
  const relevance = signal.workspace_relevance;
  return (
    <div className="rounded-lg border border-border bg-background p-3 flex items-start gap-3">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 rounded border border-border bg-foreground/[0.04] text-muted shrink-0 inline-flex items-center justify-start w-40 truncate px-2">
        {publisher}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium tracking-tight leading-snug line-clamp-2">
          {signal.summary}
        </div>
        <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
          <span className="font-mono uppercase tracking-[0.08em]">
            {typeLabel}
          </span>
          <span aria-hidden>·</span>
          <span>{ageLabel}</span>
          {relevance && relevance !== "none" && (
            <>
              <span aria-hidden>·</span>
              <span
                className={`font-mono uppercase tracking-[0.08em] ${
                  relevance === "high" ? "text-brand" : "text-foreground/70"
                }`}
              >
                {relevance} relevance
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeAge(isoTimestamp: string): string {
  const ageH = Math.max(
    1,
    Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 3600000),
  );
  return ageH < 24 ? `${ageH}h ago` : `${Math.floor(ageH / 24)}d ago`;
}
