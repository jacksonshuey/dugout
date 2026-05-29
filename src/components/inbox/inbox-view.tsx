"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ExternalSignal } from "@/lib/external-signals";
import { SourceEmailPanel } from "./source-email-panel";

interface RecallHit {
  id: string;
  subject: string | null;
  publisher: string | null;
  received_at: string;
  snippet: string;
}

// Two-pane inbox view. Left: filterable bullet list. Right: source email
// detail. Client-side because the filter chips + selected-bullet state are
// interactive and the email is lazy-fetched on selection.

type Filter = "all" | "tracked" | "magnitude";

interface Props {
  bullets: ExternalSignal[];
  loadError: string | null;
  workspaceId: string;
  accountNameById: Record<string, string>;
}

const HIGH_MAGNITUDE_THRESHOLD = 60;

export function InboxView({
  bullets,
  loadError,
  workspaceId,
  accountNameById,
}: Props) {
  const [filter, setFilter] = useState<Filter>("tracked");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Recall search: when active (query ≥ 2 chars), the bullet list is hidden
  // and the recall results render in its place; clicking a hit drives the
  // side panel via selectedEmailId.
  const [query, setQuery] = useState("");
  const [hitsByQuery, setHitsByQuery] = useState<Record<string, RecallHit[]>>(
    {},
  );
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length >= 2;
  const hits = searching ? hitsByQuery[trimmedQuery] ?? null : null;

  useEffect(() => {
    // Only fire fetches for valid searches. The render branch reads from
    // hitsByQuery to display either cached results, a loading state, or the
    // bullet list when no query is active.
    if (!searching) return;
    if (hitsByQuery[trimmedQuery]) return; // already cached
    if (debounce.current) clearTimeout(debounce.current);
    const ac = new AbortController();
    debounce.current = setTimeout(() => {
      fetch(
        `/api/inbox/recall?q=${encodeURIComponent(trimmedQuery)}`,
        { signal: ac.signal },
      )
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits?: RecallHit[] }) =>
          setHitsByQuery((m) => ({ ...m, [trimmedQuery]: d.hits ?? [] })),
        )
        .catch(() => undefined);
    }, 200);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      ac.abort();
    };
  }, [trimmedQuery, searching, hitsByQuery]);

  const visible = useMemo(() => {
    return bullets.filter((b) => {
      if (filter === "tracked") return b.account_id !== workspaceId;
      if (filter === "magnitude")
        return (b.impact_score ?? 0) >= HIGH_MAGNITUDE_THRESHOLD;
      return true;
    });
  }, [bullets, filter, workspaceId]);

  const selected = useMemo(
    () => bullets.find((b) => b.id === selectedId) ?? null,
    [bullets, selectedId],
  );

  const counts = useMemo(() => {
    const tracked = bullets.filter((b) => b.account_id !== workspaceId).length;
    const magnitude = bullets.filter(
      (b) => (b.impact_score ?? 0) >= HIGH_MAGNITUDE_THRESHOLD,
    ).length;
    return { all: bullets.length, tracked, magnitude };
  }, [bullets, workspaceId]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Recall: search every newsletter body…"
          className="w-full mb-4 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:border-brand/50"
        />

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <FilterChip
            active={filter === "tracked"}
            label="Tracked-account hits"
            count={counts.tracked}
            onClick={() => setFilter("tracked")}
          />
          <FilterChip
            active={filter === "magnitude"}
            label="High magnitude"
            count={counts.magnitude}
            onClick={() => setFilter("magnitude")}
          />
          <FilterChip
            active={filter === "all"}
            label="All"
            count={counts.all}
            onClick={() => setFilter("all")}
          />
        </div>

        {searching ? (
          <RecallResults
            hits={hits}
            query={trimmedQuery}
            selectedEmailId={selectedEmailId}
            onPick={(id) => {
              setSelectedId(null);
              setSelectedEmailId(id);
            }}
          />
        ) : loadError ? (
          <EmptyState
            title="Couldn't load the inbox."
            body={loadError}
            tone="error"
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nothing in this view."
            body={
              filter === "tracked"
                ? "No tracked-account mentions in the last 14 days. Switch to All to see workspace-pool bullets."
                : "No bullets above the magnitude threshold yet."
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((b) => (
              <BulletRow
                key={b.id}
                bullet={b}
                accountName={
                  b.account_id === workspaceId
                    ? null
                    : accountNameById[b.account_id] ?? b.account_id
                }
                selected={selectedId === b.id}
                onClick={() => {
                  setSelectedEmailId(null);
                  setSelectedId(b.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <SourceEmailPanel
          bullet={selectedEmailId ? null : selected}
          emailId={selectedEmailId}
        />
      </aside>
    </div>
  );
}

function RecallResults({
  hits,
  query,
  selectedEmailId,
  onPick,
}: {
  hits: RecallHit[] | null;
  query: string;
  selectedEmailId: string | null;
  onPick: (id: string) => void;
}) {
  if (hits === null) {
    return (
      <EmptyState
        title={`Searching for “${query}”…`}
        body="Recall scans every newsletter body Dugout has ever received."
      />
    );
  }
  if (hits.length === 0) {
    return (
      <EmptyState
        title={`No matches for “${query}”`}
        body="Recall searches the full text of every newsletter body Dugout has ever received."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {hits.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            onClick={() => onPick(h.id)}
            className={
              "w-full text-left rounded-lg border p-3 transition-colors " +
              (selectedEmailId === h.id
                ? "border-brand/50 bg-brand/[0.04]"
                : "border-border bg-background hover:border-foreground/30")
            }
          >
            <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
              <span className="px-2 py-0.5 rounded border border-border bg-foreground/[0.04]">
                recall
              </span>
              <span>{h.publisher ?? "newsletter"}</span>
              <span aria-hidden>·</span>
              <span>{relativeAge(h.received_at)}</span>
            </div>
            <div className="mt-1.5 text-sm font-medium tracking-tight leading-snug text-foreground/90">
              {h.subject || "(no subject)"}
            </div>
            {h.snippet && (
              <div className="mt-1.5 text-xs text-muted leading-snug">
                {h.snippet}
              </div>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-[11px] font-medium transition-colors " +
        (active
          ? "border-brand/50 bg-brand/[0.08] text-foreground"
          : "border-border bg-background text-muted hover:text-foreground")
      }
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function BulletRow({
  bullet,
  accountName,
  selected,
  onClick,
}: {
  bullet: ExternalSignal;
  accountName: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  const publisher =
    bullet.publisher_canonical_name ?? bullet.source.replace(/_/g, " ");
  const typeLabel = bullet.type.replace(/_/g, " ");
  const impact = bullet.impact_score ?? null;
  const isInboxOnly = Boolean(bullet.inbox_only);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          "w-full text-left rounded-lg border p-3 transition-colors " +
          (selected
            ? "border-brand/50 bg-brand/[0.04]"
            : "border-border bg-background hover:border-foreground/30")
        }
      >
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
          {accountName ? (
            <span className="px-2 py-0.5 rounded border border-brand/40 bg-brand/10 text-brand">
              {accountName}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded border border-border bg-foreground/[0.04]">
              workspace
            </span>
          )}
          <span>{publisher}</span>
          <span aria-hidden>·</span>
          <span>{typeLabel}</span>
          <span aria-hidden>·</span>
          <span>{relativeAge(bullet.occurred_at)}</span>
          {impact != null && (
            <>
              <span aria-hidden>·</span>
              <span className="text-brand">impact {impact}</span>
            </>
          )}
          {isInboxOnly && (
            <span className="ml-auto px-1.5 py-0.5 rounded bg-foreground/[0.05] text-[9px]">
              inbox-only
            </span>
          )}
        </div>
        <div className="mt-1.5 text-sm font-medium tracking-tight leading-snug text-foreground/90">
          {bullet.summary}
        </div>
      </button>
    </li>
  );
}

function EmptyState({
  title,
  body,
  tone = "muted",
}: {
  title: string;
  body: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={
        "rounded-lg border border-dashed p-6 text-sm " +
        (tone === "error"
          ? "border-severity-blocking/40 bg-severity-blocking-bg/40 text-foreground"
          : "border-border bg-foreground/[0.015] text-muted")
      }
    >
      <div className="font-medium text-foreground/90">{title}</div>
      <div className="mt-1 leading-snug">{body}</div>
    </div>
  );
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.max(1, Math.floor(ms / 3600000));
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
