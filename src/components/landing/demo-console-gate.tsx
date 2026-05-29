"use client";

import { useEffect, useState } from "react";
import { Console } from "@/components/console";

// Gates the landing demo dashboard behind an explicit "Inject seed data"
// action. Default state is EMPTY — visitors see a clean, production-like
// dashboard until they opt in. The choice is remembered in localStorage so it
// survives a refresh (per-device, never the default), and reading it
// client-side keeps the landing route fully static/ISR.

const KEY = "dugout-demo-seed";

export function DemoConsoleGate(props: React.ComponentProps<typeof Console>) {
  // Server renders the empty state (no localStorage); the client reconciles on
  // mount. `ready` avoids a flash of empty for visitors who already injected.
  const [injected, setInjected] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setInjected(localStorage.getItem(KEY) === "1");
    setReady(true);
  }, []);

  const inject = () => {
    localStorage.setItem(KEY, "1");
    setInjected(true);
  };
  const clear = () => {
    localStorage.removeItem(KEY);
    setInjected(false);
  };

  if (ready && injected) {
    return (
      <div>
        <div className="max-w-6xl mx-auto px-6 mb-3 flex items-center justify-end gap-3">
          <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-muted">
            Demo seed data injected
          </span>
          <button
            type="button"
            onClick={clear}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-border bg-background hover:border-foreground/30 hover:bg-foreground/[0.04] transition-colors"
          >
            Clear
          </button>
        </div>
        <Console {...props} />
      </div>
    );
  }

  return (
    <div className="px-6 pb-20">
      <div className="max-w-6xl mx-auto rounded-xl border border-dashed border-border bg-foreground/[0.02] p-12 text-center">
        <div className="text-sm font-semibold tracking-tight">
          This dashboard is empty.
        </div>
        <p className="mt-2 text-xs text-muted max-w-md mx-auto leading-relaxed">
          A fresh workspace starts with no data. Inject demo seed data to see
          the full pipeline, signals, and pre-meeting brief in action. It stays
          on this device until you clear it.
        </p>
        <button
          type="button"
          onClick={inject}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand text-white text-sm font-medium hover:bg-brand-dark transition-colors"
        >
          Inject seed data
        </button>
      </div>
    </div>
  );
}
