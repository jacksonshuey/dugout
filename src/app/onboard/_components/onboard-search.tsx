"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type {
  ExistingMatch,
  ExternalMatch,
} from "@/lib/company-search";
import {
  addSessionAccount,
  getSessionAccountsServerSnapshot,
  getSessionAccountsSnapshot,
  readSessionAccounts,
  removeSessionAccount,
  subscribeSessionAccounts,
  type SessionAccount,
} from "@/lib/session-accounts";

// Single-screen onboarding search. Debounced query → API → two result
// sections. Bottom panel shows session-added accounts; user can remove
// individual entries.

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 2;

interface SearchResponse {
  existing: ExistingMatch[];
  external: ExternalMatch[];
}

export function OnboardSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse>({
    existing: [],
    external: [],
  });
  const [loading, setLoading] = useState(false);

  // Session-accounts state via useSyncExternalStore. The snapshot is the
  // raw JSON string from localStorage; useMemo re-parses on change. This
  // avoids the setState-in-effect hydration pattern that React 19 warns
  // about, and stays in sync across tabs via the storage event +
  // same-tab via the SESSION_ACCOUNTS_EVENT custom event.
  const snapshot = useSyncExternalStore(
    subscribeSessionAccounts,
    getSessionAccountsSnapshot,
    getSessionAccountsServerSnapshot,
  );
  const session = useMemo<SessionAccount[]>(() => {
    void snapshot; // re-runs when the raw localStorage string changes
    return readSessionAccounts();
  }, [snapshot]);

  // Debounced fetch. All setState calls live inside the setTimeout
  // callback so the effect body itself is side-effect-free at the React
  // level (only schedules + cleans up a timer). Short-query reset is
  // handled in the onChange handler, not here.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/onboarding/company-search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          setResults({ existing: [], external: [] });
          return;
        }
        const data = (await res.json()) as SearchResponse;
        setResults(data);
      } catch {
        setResults({ existing: [], external: [] });
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < MIN_QUERY_LEN) {
      setResults({ existing: [], external: [] });
      setLoading(false);
    }
  }

  function onAdd(match: ExternalMatch) {
    addSessionAccount({
      id: match.provisionalId,
      name: match.name,
      domain: match.domain,
      logoUrl: match.logoUrl,
    });
    // No setSession — the useSyncExternalStore subscription picks up the
    // change via the custom event dispatched inside writeSessionAccounts.
  }

  function onRemove(id: string) {
    removeSessionAccount(id);
  }

  return (
    <div className="space-y-8">
      <div>
        <label
          htmlFor="onboard-query"
          className="sr-only"
        >
          Search by company name
        </label>
        <input
          id="onboard-query"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by company name…"
          autoComplete="off"
          autoFocus
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-base placeholder:text-muted focus:outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
        />
        <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.1em] text-muted h-4">
          {loading
            ? "Searching…"
            : query.trim().length >= MIN_QUERY_LEN
              ? `${results.existing.length + results.external.length} matches`
              : "Type at least 2 characters"}
        </div>
      </div>

      {results.existing.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold tracking-tight text-foreground/80">
            Already tracked
          </h2>
          <p className="text-xs text-muted mt-1">
            Has a primary key + pipeline state. Click to open the account.
          </p>
          <ul className="mt-3 space-y-2">
            {results.existing.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/account/${m.id}`}
                  className="block rounded-lg border border-border bg-background p-3 hover:border-brand/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight truncate">
                        {m.name}
                      </div>
                      <div className="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                        {m.industry && <span>{m.industry}</span>}
                        {m.ticker && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="font-mono">{m.ticker}</span>
                          </>
                        )}
                        {m.domain && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{m.domain}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 px-2 rounded border border-brand/40 bg-brand/10 text-brand shrink-0"
                    >
                      Tracked
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results.external.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold tracking-tight text-foreground/80">
            Add to your session
          </h2>
          <p className="text-xs text-muted mt-1">
            From Clearbit&apos;s public directory. Adds live in your browser
            only.
          </p>
          <ul className="mt-3 space-y-2">
            {results.external.map((m) => {
              const alreadyAdded = session.some((s) => s.id === m.provisionalId);
              return (
                <li key={m.provisionalId}>
                  <div className="rounded-lg border border-border bg-background p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.logoUrl}
                        alt=""
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded bg-foreground/[0.04] shrink-0 object-contain"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold tracking-tight truncate">
                          {m.name}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {m.domain}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => onAdd(m)}
                      className={
                        alreadyAdded
                          ? "text-[10px] font-mono uppercase tracking-[0.1em] py-1 px-3 rounded border border-border bg-background text-muted shrink-0 cursor-default"
                          : "text-[10px] font-mono uppercase tracking-[0.1em] py-1 px-3 rounded border border-brand/40 bg-brand/10 text-brand shrink-0 hover:bg-brand/20 transition-colors"
                      }
                    >
                      {alreadyAdded ? "Added" : "Add"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {query.trim().length >= MIN_QUERY_LEN &&
        !loading &&
        results.existing.length === 0 &&
        results.external.length === 0 && (
          <div className="rounded-lg border border-border bg-foreground/[0.02] p-4 text-sm text-muted">
            No matches. Try a different name or a shorter query.
          </div>
        )}

      <section className="border-t border-border pt-6">
        <h2 className="text-sm font-semibold tracking-tight text-foreground/80">
          Your session accounts
          <span className="ml-2 text-[11px] font-mono uppercase tracking-[0.1em] text-muted">
            {session.length} added
          </span>
        </h2>
        <p className="text-xs text-muted mt-1">
          Stored in this browser only. Closing the tab keeps them; clearing
          site data wipes them.
        </p>
        {session.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-foreground/[0.02] p-4 text-xs text-muted">
            Nothing added yet. Search above and click &ldquo;Add&rdquo; on a
            result.
          </div>
        ) : (
          <ul className="mt-3 space-y-2">
            {session.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-border bg-background p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.logoUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="w-7 h-7 rounded bg-foreground/[0.04] shrink-0 object-contain"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium tracking-tight truncate">
                      {a.name}
                    </div>
                    <div className="text-xs text-muted truncate">{a.domain}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  className="text-[10px] font-mono uppercase tracking-[0.1em] py-1 px-3 rounded border border-border bg-background text-muted hover:text-foreground hover:border-foreground/30 shrink-0 transition-colors"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
