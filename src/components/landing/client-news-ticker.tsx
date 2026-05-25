"use client";

import { useEffect, useState } from "react";

// Live ticker for account-mentioning signals. Renders the existing
// `marquee-right` CSS keyframe from globals.css with a slower
// `animationDuration` override (240s) for a calmer scroll, and uses
// larger fixed-width cards than the prior version.
//
// Polls /api/landing/ticker-signals every 30s so the ticker visibly
// refreshes between the page's 60s ISR cycle. Polling pauses (no fetch
// fires) when the tab is hidden, to avoid spinning on backgrounded tabs.
//
// Fails soft to an empty state if the initial fetch fails — the loop
// keeps trying, so a transient Supabase blip self-heals.

interface TickerItem {
  id: string;
  summary: string;
  accountName: string;
  occurredAt: string;
}

const POLL_INTERVAL_MS = 30_000;
const TICKER_CARD_WIDTH_PX = 420;
const TICKER_ANIMATION_DURATION = "240s";

export function ClientNewsTicker() {
  const [items, setItems] = useState<TickerItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchItems() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/landing/ticker-signals", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { items: TickerItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch {
        // Swallow — keep prior items rendered, try again on next tick.
      }
    }

    fetchItems();
    const id = setInterval(fetchItems, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (items === null) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-4 text-xs text-muted">
        Loading live ticker...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-4 text-xs text-muted">
        No account-scoped signals in the last 72h. The ticker resumes as
        soon as the news pipeline tags a new account.
      </div>
    );
  }

  return (
    <div className="mt-4 marquee-container overflow-hidden border border-border rounded-lg bg-foreground/[0.02] py-4">
      <div
        className="marquee-track flex gap-4 w-max"
        style={{ animationDuration: TICKER_ANIMATION_DURATION }}
      >
        {[...items, ...items].map((s, i) => (
          <TickerCard key={`${s.id}-${i}`} item={s} />
        ))}
      </div>
    </div>
  );
}

function TickerCard({ item }: { item: TickerItem }) {
  const ageLabel = relativeAge(item.occurredAt);
  return (
    <div
      className="shrink-0 rounded-lg border border-border bg-background p-4 flex flex-col gap-2"
      style={{ width: `${TICKER_CARD_WIDTH_PX}px` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 px-2 rounded border border-brand/40 bg-brand/10 text-brand">
          {item.accountName}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
          {ageLabel}
        </span>
      </div>
      <div className="text-sm font-medium tracking-tight leading-snug line-clamp-3">
        {item.summary}
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
