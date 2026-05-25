"use client";

// Error boundary for /account/[slug]. Renders when the server component
// throws - most likely cause is a Supabase outage in one of the three
// signal sources (the page swallows individual source failures into
// warnings[], so this fires only on unrecoverable errors).
//
// Voice: plain language. The slug is repeated so the user can verify they
// pasted the right one. No exclamations per principle #8.

import { useEffect } from "react";
import Link from "next/link";

export default function AccountErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the digest so we can correlate with server logs. The user-visible
    // copy stays plain - no stack trace dumped into the UI.
    console.error("[/account/[slug]] render error:", error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">
        Couldn&rsquo;t load this account
      </h1>
      <p className="text-sm text-muted leading-relaxed">
        {error.message ||
          "Something went wrong while loading the account context."}
      </p>
      <p className="text-sm text-muted">
        Confirm the account ID exists in{" "}
        <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
          src/data/seed.ts
        </code>
        . If it does, retry below - the signal-source fetches are independent
        and a transient Supabase blip will clear on reload.
      </p>
      {error.digest && (
        <p className="text-[11px] text-muted font-mono">
          Error digest · {error.digest}
        </p>
      )}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center px-4 h-9 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-dark transition-colors"
        >
          Retry
        </button>
        <Link
          href="/console"
          className="inline-flex items-center justify-center px-4 h-9 rounded-lg text-sm font-medium bg-slate-100 text-slate-900 hover:bg-slate-200 transition-colors"
        >
          Back to console
        </Link>
      </div>
    </div>
  );
}
