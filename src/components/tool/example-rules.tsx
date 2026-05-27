"use client";

// Example cross-integration rules surfaced at the top of the Actions
// tab. The point: show what becomes possible once a customer wires up
// the stack. Each example chains a TRIGGER source -> a CONDITION -> an
// ACTION destination, with a brand-colored chip per system involved.
//
// These are visualizations only. Real authoring lives in the Rules tab
// (InteractiveSignals composer). When a user clicks "Use this template"
// here, in a future iteration we'd seed the composer with the trigger /
// condition / action chain. For now the button is illustrative.

interface ExampleRule {
  id: string;
  trigger: { source: string; verb: string };
  condition: string;
  action: { source: string; verb: string };
  fullSentence: string;
  // The audience that gets the resulting nudge.
  recipient: string;
}

const RULES: readonly ExampleRule[] = [
  {
    id: "calendly-slack-meetings",
    trigger: { source: "Calendly", verb: "Calendar check" },
    condition: "SDR has fewer than 5 in-person meetings booked this week",
    action: { source: "Slack", verb: "Ping the SDR" },
    fullSentence:
      "If Calendly shows an SDR is short on in-person meetings this week, ping them in Slack.",
    recipient: "the SDR",
  },
  {
    id: "substack-slack-champion",
    trigger: { source: "Substack", verb: "Newsletter mention" },
    condition: "A champion's name appears in a departure / job-change item",
    action: { source: "Slack", verb: "DM the AE" },
    fullSentence:
      "If a Substack newsletter mentions a champion has left their company, alert the AE on that account.",
    recipient: "the account AE",
  },
  {
    id: "granola-email-followup",
    trigger: { source: "Granola", verb: "Call wrap-up" },
    condition: "Customer call completes with transcript + summary",
    action: { source: "Email", verb: "Draft follow-up" },
    fullSentence:
      "If Granola wraps a customer call, draft the follow-up email for the AE to review and send.",
    recipient: "the AE who hosted the call",
  },
];

// Brand colors keyed by display source name. Matches the palette used in
// connectivity-graph.tsx where applicable; new entries for Calendly,
// Substack, Granola, and Email (the generic outbound channel).
const BRAND_COLORS: Record<string, string> = {
  Calendly: "#006BFF",
  Substack: "#FF6719",
  Granola: "#65C18C",
  Slack: "#4A154B",
  Email: "#C26F3E",
};

export function ExampleRules() {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
        Starter rule templates · {RULES.length}
      </div>
      <p className="text-sm text-foreground/80 leading-relaxed max-w-3xl mb-4">
        Each card is a complete rule: trigger + action. Click &ldquo;Use
        template&rdquo; to drop it into the composer below, or build your
        own from scratch.
      </p>
      <div className="grid md:grid-cols-3 gap-3 auto-rows-fr">
        {RULES.map((r) => (
          <RuleCard key={r.id} rule={r} />
        ))}
      </div>
    </div>
  );
}

function RuleCard({ rule }: { rule: ExampleRule }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-3 h-full">
      <div className="flex items-stretch gap-2">
        <SourcePill name={rule.trigger.source} sub={rule.trigger.verb} />
        <Arrow />
        <SourcePill name={rule.action.source} sub={rule.action.verb} />
      </div>
      <div className="rounded-md border border-border bg-foreground/[0.02] px-2.5 py-2">
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted mb-1">
          When
        </div>
        <div className="text-xs leading-snug">{rule.condition}</div>
      </div>
      <p className="text-[11px] text-muted leading-snug flex-1">
        {rule.fullSentence}
      </p>
      <div className="flex items-center justify-between gap-2 mt-auto">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
          Nudges {rule.recipient}
        </span>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-md border border-border hover:border-brand hover:text-brand transition-colors font-mono"
        >
          Use template
        </button>
      </div>
    </div>
  );
}

function SourcePill({ name, sub }: { name: string; sub: string }) {
  const color = BRAND_COLORS[name] ?? "#6B7280";
  return (
    <div
      className="flex-1 rounded-md border px-2.5 py-1.5"
      style={{ borderColor: color + "55", background: color + "0d" }}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="text-xs font-semibold truncate">{name}</span>
      </div>
      <div className="text-[10px] text-muted mt-0.5 leading-tight">{sub}</div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="self-center shrink-0">
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4 text-muted"
        aria-hidden
      >
        <path d="M3 8 L13 8" />
        <path d="M9 4 L13 8 L9 12" />
      </svg>
    </div>
  );
}
