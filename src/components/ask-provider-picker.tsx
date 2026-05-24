"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Shared provider/model picker for /ask and the drawer chat panel (D1).
//
// Renders a single dropdown with 4 options:
//   - Demo stub (always available)
//   - OpenAI · GPT-4o  (greyed when OPENAI_API_KEY missing)
//   - Claude Sonnet 4.6 (greyed when ANTHROPIC_API_KEY missing)
//   - Claude Haiku 4.5  (greyed when ANTHROPIC_API_KEY missing)
//
// Server availability comes from GET /api/ask/providers. We fetch once on
// mount; if the call fails we treat both providers as unavailable
// (everything but stub greys out) — defensive default keeps the demo
// usable on a Supabase outage.
//
// Sticky choice: persisted in localStorage under DUGOUT_ASK_CHOICE so a
// returning user doesn't have to re-pick. The value falls back to "stub"
// when nothing was previously stored.

export type AskProviderId = "openai" | "anthropic" | "stub";
export type AskModelId =
  | "gpt-4o"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | "stub-deterministic";

export type AskChoice = { provider: AskProviderId; model: AskModelId };

const DEFAULT_CHOICE: AskChoice = {
  provider: "stub",
  model: "stub-deterministic",
};

const LS_KEY = "DUGOUT_ASK_CHOICE";

type Option = {
  value: string; // serialized "provider:model"
  label: string;
  provider: AskProviderId;
  model: AskModelId;
  // The provider whose key must be present for this option to be enabled.
  // null = always available (stub). Stub itself is never `requiresProvider`
  // because the option is unconditional.
  requiresProvider: "openai" | "anthropic" | null;
};

const OPTIONS: Option[] = [
  {
    value: "stub:stub-deterministic",
    label: "Demo stub (deterministic)",
    provider: "stub",
    model: "stub-deterministic",
    requiresProvider: null,
  },
  {
    value: "openai:gpt-4o",
    label: "OpenAI · GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    requiresProvider: "openai",
  },
  {
    value: "anthropic:claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    requiresProvider: "anthropic",
  },
  {
    value: "anthropic:claude-haiku-4-5",
    label: "Claude Haiku 4.5 (cheap)",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    requiresProvider: "anthropic",
  },
];

type ProvidersResponse = { openai: boolean; anthropic: boolean };

export function useAskChoice(): {
  choice: AskChoice;
  setChoice: (c: AskChoice) => void;
  availability: ProvidersResponse;
  loaded: boolean;
} {
  // Lazy initializer reads from localStorage on first render. This avoids
  // the setState-in-effect pattern that triggers the `react-hooks/
  // set-state-in-effect` lint rule. We guard for SSR (window undefined)
  // by returning the default; the first client render will re-init from
  // localStorage on hydration if needed.
  const [storedChoice, setStoredChoice] = useState<AskChoice>(() => {
    if (typeof window === "undefined") return DEFAULT_CHOICE;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return DEFAULT_CHOICE;
      const parsed = JSON.parse(raw) as AskChoice;
      if (
        parsed &&
        (parsed.provider === "openai" ||
          parsed.provider === "anthropic" ||
          parsed.provider === "stub") &&
        typeof parsed.model === "string"
      ) {
        return parsed;
      }
    } catch {
      // ignore — corrupt LS falls back to the default
    }
    return DEFAULT_CHOICE;
  });

  const [availability, setAvailability] = useState<ProvidersResponse>({
    openai: false,
    anthropic: false,
  });
  const [loaded, setLoaded] = useState(false);

  // Fetch provider availability once on mount. Setting state inside an
  // async fetch callback is the canonical use of useEffect (sync external
  // → React state), so the lint rule doesn't fire here.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ask/providers", {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const json = (await res.json()) as ProvidersResponse;
        if (!cancelled) {
          setAvailability(json);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive the "effective" choice from the stored choice + availability —
  // no setState-in-effect needed. If the user persisted (say) "openai"
  // but the key isn't configured this session, the dropdown shows stub
  // without rewriting localStorage. As soon as the key shows up (server
  // env change between sessions) the persisted choice takes effect
  // again.
  const choice = useMemo<AskChoice>(() => {
    if (storedChoice.provider === "openai" && !availability.openai) {
      return DEFAULT_CHOICE;
    }
    if (storedChoice.provider === "anthropic" && !availability.anthropic) {
      return DEFAULT_CHOICE;
    }
    return storedChoice;
  }, [storedChoice, availability]);

  const setChoice = useCallback((c: AskChoice) => {
    setStoredChoice(c);
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(c));
    } catch {
      // ignore — non-persistent is fine
    }
  }, []);

  return { choice, setChoice, availability, loaded };
}

export function AskProviderPicker({
  choice,
  setChoice,
  availability,
  className,
}: {
  choice: AskChoice;
  setChoice: (c: AskChoice) => void;
  availability: ProvidersResponse;
  className?: string;
}) {
  const currentValue = `${choice.provider}:${choice.model}`;

  function isOptionDisabled(opt: Option): boolean {
    if (!opt.requiresProvider) return false;
    return !availability[opt.requiresProvider];
  }

  return (
    <select
      value={currentValue}
      onChange={(e) => {
        const opt = OPTIONS.find((o) => o.value === e.target.value);
        if (!opt) return;
        if (isOptionDisabled(opt)) return;
        setChoice({ provider: opt.provider, model: opt.model });
      }}
      className={cn(
        "text-xs h-7 px-2 rounded-md border border-border bg-background text-foreground",
        "focus:outline-none focus:border-foreground/40",
        className,
      )}
      title="Pick a provider · server-side API tokens"
    >
      {OPTIONS.map((opt) => {
        const disabled = isOptionDisabled(opt);
        return (
          <option key={opt.value} value={opt.value} disabled={disabled}>
            {opt.label}
            {disabled ? " · key missing" : ""}
          </option>
        );
      })}
    </select>
  );
}
