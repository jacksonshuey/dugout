"use client";

import { useEffect, useState } from "react";
import type { AgentStep, AgentTrace } from "@/lib/news-batches";

// "Watch the agent work" — plays through the four-agent chain that fires on
// every third inbound email. Each agent reveals in sequence (queued → running
// → done/skipped/error) with the input it saw, the output it produced, and how
// long it took. Driven by the most recent real batch run when one exists;
// falls back to a representative sample so the demo always shows the process.
//
// The animation is purely presentational: it replays an already-finished
// trace. Real per-step timings come from the recorded `duration_ms`; the
// reveal cadence is a fixed beat so a viewer can read each handoff.

const AGENT_META: Record<
  AgentStep["agent"],
  { n: number; role: string }
> = {
  gate: { n: 1, role: "decides: is this material news? (runs first)" },
  summarize: { n: 2, role: "distills the email to one summary" },
  categorize: { n: 3, role: "sorts into a news category" },
  append: { n: 4, role: "records the entry to the feed" },
};

const REVEAL_MS = 1900; // beat between steps — slow enough to read each handoff
const SKIP_MS = 750; // faster reveal for skipped steps

// Representative run used when no real run exists yet (migration not applied or
// no emails have flowed through). Mirrors the exact shape a real run produces:
// one email, gate-first.
const SAMPLE_TRACE: AgentTrace = {
  id: "sample",
  createdAt: new Date().toISOString(),
  emailSubjects: ["Lilly's oral GLP-1 reshapes the obesity market"],
  newsSources: ["FiercePharma"],
  summary:
    "Eli Lilly's lower-cost oral GLP-1 is pulling patients away from compounded therapies, signaling intensifying price competition in the obesity-drug market.",
  isNews: true,
  gateReasoning:
    "Describes a concrete competitive development a rep would act on.",
  category: "competitor_mention",
  status: "appended",
  steps: [
    {
      agent: "gate",
      label: "News gate",
      status: "ok",
      started_at: new Date().toISOString(),
      duration_ms: 1180,
      input_preview: "Lilly's oral GLP-1 reshapes the obesity market · FiercePharma",
      output_preview:
        "PASS · material news: describes a concrete competitive development a rep would act on.",
    },
    {
      agent: "summarize",
      label: "Summarize",
      status: "ok",
      started_at: new Date().toISOString(),
      duration_ms: 2240,
      input_preview:
        "Lilly's oral GLP-1 reshapes the obesity market · Eli Lilly's lower-cost oral pill is drawing patients off compounded GLP-1s…",
      output_preview:
        "Eli Lilly's lower-cost oral GLP-1 is pulling patients away from compounded therapies, signaling intensifying price competition…",
    },
    {
      agent: "categorize",
      label: "Categorize",
      status: "ok",
      started_at: new Date().toISOString(),
      duration_ms: 1410,
      input_preview: "Eli Lilly's lower-cost oral GLP-1 is pulling patients away…",
      output_preview: "competitor_mention · high relevance",
    },
    {
      agent: "append",
      label: "Append to feed",
      status: "ok",
      started_at: new Date().toISOString(),
      duration_ms: 60,
      input_preview: "competitor_mention · FiercePharma",
      output_preview: "entry appended · competitor_mention",
    },
  ],
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // SSR-safe: state starts false on the server; we read the real value
    // after mount to avoid a hydration mismatch, so this setState is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

export function AgentTraceVisual({ trace }: { trace: AgentTrace | null }) {
  const data = trace ?? SAMPLE_TRACE;
  const isLive = trace !== null;
  const steps = data.steps;

  const reduced = usePrefersReducedMotion();
  const [runId, setRunId] = useState(0);
  // Number of fully-completed steps. The step at index === cursor is the one
  // currently "running"; cursor === steps.length means the run is finished.
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (steps.length === 0) return;
    if (reduced) {
      // Reduced motion: skip the staged reveal and show the finished run.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCursor(steps.length);
      return;
    }
    setCursor(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (idx: number) => {
      const step = steps[idx];
      const delay = step?.status === "skipped" ? SKIP_MS : REVEAL_MS;
      timer = setTimeout(() => {
        i = idx + 1;
        setCursor(i);
        if (i < steps.length) schedule(i);
      }, delay);
    };
    schedule(0);
    return () => clearTimeout(timer);
  }, [runId, reduced, steps]);

  const finished = cursor >= steps.length;

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      {/* Header: what this batch was + final verdict */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border bg-foreground/[0.02]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-brand">
              Agent run
            </span>
            <span
              className={`text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border ${
                isLive
                  ? "border-severity-green/40 bg-severity-green-bg text-severity-green"
                  : "border-border bg-foreground/[0.04] text-muted"
              }`}
            >
              {isLive ? "live" : "sample"}
            </span>
          </div>
          <div className="mt-1 text-[12px] text-foreground/70 leading-snug">
            Triggered by {data.emailSubjects.length || 1} inbound email
            {(data.emailSubjects.length || 1) === 1 ? "" : "s"} ·{" "}
            <span className="text-muted">
              {data.newsSources.join(", ") || "unknown"}
            </span>
          </div>
        </div>
        <VerdictChip status={data.status} finished={finished} />
      </div>

      {/* The chain */}
      <ol className="px-5 py-5 space-y-1">
        {steps.map((step, i) => {
          const state: StepState =
            i < cursor
              ? step.status === "ok"
                ? "done"
                : step.status === "skipped"
                  ? "skipped"
                  : "error"
              : i === cursor
                ? "running"
                : "queued";
          const isLast = i === steps.length - 1;
          return (
            <StepRow
              key={`${runId}-${i}`}
              step={step}
              state={state}
              connector={!isLast}
            />
          );
        })}
      </ol>

      {/* Footer: replay + final summary line */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-foreground/[0.02]">
        <span className="text-[11px] text-muted font-mono">
          {finished
            ? data.status === "appended"
              ? "✓ entry appended to the live feed"
              : data.status === "rejected"
                ? "✕ batch rejected at the gate, nothing appended"
                : "! run errored"
            : "running…"}
        </span>
        <button
          type="button"
          onClick={() => setRunId((r) => r + 1)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-background text-[11px] font-medium hover:border-foreground/30 hover:bg-foreground/[0.04] transition-colors"
        >
          <span aria-hidden>↻</span> Replay
        </button>
      </div>
    </div>
  );
}

type StepState = "queued" | "running" | "done" | "skipped" | "error";

function StepRow({
  step,
  state,
  connector,
}: {
  step: AgentStep;
  state: StepState;
  connector: boolean;
}) {
  const meta = AGENT_META[step.agent];
  const active = state === "running";
  const revealed = state !== "queued";

  // Node ring + glyph color per state.
  const node =
    state === "done"
      ? "border-severity-green bg-severity-green-bg text-severity-green"
      : state === "running"
        ? "border-brand bg-brand/10 text-brand"
        : state === "skipped"
          ? "border-border bg-foreground/[0.03] text-muted"
          : state === "error"
            ? "border-severity-blocking bg-severity-blocking-bg text-severity-blocking"
            : "border-border bg-background text-muted/50";

  return (
    <li className="relative flex gap-3">
      {/* Rail: numbered node + connector line */}
      <div className="flex flex-col items-center">
        <div
          className={`relative flex items-center justify-center w-9 h-9 rounded-full border text-sm font-mono font-semibold transition-colors duration-300 ${node}`}
        >
          {state === "done" ? (
            <span aria-hidden>✓</span>
          ) : state === "error" ? (
            <span aria-hidden>!</span>
          ) : (
            <span aria-hidden>{meta.n}</span>
          )}
          {active && (
            <span className="absolute inset-0 rounded-full border-2 border-brand animate-ping opacity-60" />
          )}
        </div>
        {connector && (
          <div
            className={`w-px flex-1 my-1 transition-colors duration-500 ${
              state === "done" || state === "skipped" || state === "error"
                ? "bg-brand/40"
                : "bg-border"
            }`}
          />
        )}
      </div>

      {/* Body */}
      <div
        className={`flex-1 min-w-0 pb-5 transition-all duration-300 ${
          revealed ? "opacity-100 translate-y-0" : "opacity-40 translate-y-0.5"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm font-semibold tracking-tight">
              Agent {meta.n} · {step.label}
            </span>
            <div className="text-[11px] text-muted leading-snug">{meta.role}</div>
          </div>
          <StatusTag state={state} durationMs={step.duration_ms} />
        </div>

        {/* I/O — only once the step has been reached */}
        {revealed && (
          <div className="mt-2 space-y-1.5">
            {step.input_preview && (
              <IORow label="in" text={step.input_preview} tone="muted" />
            )}
            <IORow
              label="out"
              text={step.output_preview}
              tone={
                state === "error"
                  ? "error"
                  : state === "skipped"
                    ? "muted"
                    : "brand"
              }
            />
          </div>
        )}
      </div>
    </li>
  );
}

function IORow({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: "muted" | "brand" | "error";
}) {
  const toneCls =
    tone === "brand"
      ? "text-foreground/80"
      : tone === "error"
        ? "text-severity-blocking"
        : "text-muted";
  return (
    <div className="flex gap-2 text-[12px] leading-snug">
      <span className="shrink-0 mt-px text-[9px] font-mono uppercase tracking-[0.1em] text-muted/70 w-6">
        {label}
      </span>
      {/* Strip em dashes from any text — including LLM-generated reasoning
          and summaries — so the trace never renders one. */}
      <span className={`min-w-0 ${toneCls}`}>{text.replace(/—/g, "-")}</span>
    </div>
  );
}

function StatusTag({
  state,
  durationMs,
}: {
  state: StepState;
  durationMs: number;
}) {
  const map: Record<StepState, { text: string; cls: string }> = {
    queued: { text: "queued", cls: "text-muted/60 border-border" },
    running: {
      text: "running…",
      cls: "text-brand border-brand/40 bg-brand/[0.06]",
    },
    done: {
      text: `${durationMs}ms`,
      cls: "text-severity-green border-severity-green/40 bg-severity-green-bg",
    },
    skipped: { text: "skipped", cls: "text-muted border-border" },
    error: {
      text: "error",
      cls: "text-severity-blocking border-severity-blocking/40 bg-severity-blocking-bg",
    },
  };
  const { text, cls } = map[state];
  return (
    <span
      className={`shrink-0 text-[9px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border tabular-nums ${cls}`}
    >
      {text}
    </span>
  );
}

function VerdictChip({
  status,
  finished,
}: {
  status: AgentTrace["status"];
  finished: boolean;
}) {
  if (!finished) {
    return (
      <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border border-brand/40 bg-brand/[0.06] text-brand">
        in flight
      </span>
    );
  }
  const map = {
    appended: {
      text: "appended",
      cls: "border-severity-green/40 bg-severity-green-bg text-severity-green",
    },
    rejected: {
      text: "rejected",
      cls: "border-border bg-foreground/[0.04] text-muted",
    },
    error: {
      text: "error",
      cls: "border-severity-blocking/40 bg-severity-blocking-bg text-severity-blocking",
    },
  } as const;
  const { text, cls } = map[status];
  return (
    <span
      className={`shrink-0 text-[10px] font-mono uppercase tracking-[0.1em] px-2 py-1 rounded border ${cls}`}
    >
      {text}
    </span>
  );
}
