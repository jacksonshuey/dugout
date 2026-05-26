"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Small refresh control that triggers a re-fetch of the server-rendered
// market intel data via router.refresh(). Sits next to a section header
// and gives the visitor a way to pull the latest signals without a full
// browser reload.
//
// Why router.refresh() vs a custom fetch: the workspace feed is already
// driven by server components reading Supabase via ISR (revalidate=60).
// router.refresh() invalidates the in-memory client cache and re-runs
// the server components — exactly the path a fresh visit would take —
// without losing client-side state (filters, modals, etc.).
export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const handleClick = () => {
    startTransition(() => {
      router.refresh();
      setLastRefreshed(new Date());
    });
  };

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-background text-[11px] font-medium hover:border-foreground/30 hover:bg-foreground/[0.04] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        aria-label={label}
      >
        <span
          aria-hidden
          className={"text-[12px] " + (isPending ? "animate-spin" : "")}
        >
          ↻
        </span>
        <span>{isPending ? "Refreshing…" : label}</span>
      </button>
      {lastRefreshed && !isPending && (
        <span className="text-[10px] font-mono text-muted">
          {formatRefreshTime(lastRefreshed)}
        </span>
      )}
    </div>
  );
}

function formatRefreshTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `refreshed ${hh}:${mm}`;
}
