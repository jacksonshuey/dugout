// Counts + evidence. The honest version of social proof when you don't yet
// have logos to slap on the page: numbers a reviewer can actually verify by
// clicking through to the repo. Each stat links to the source of truth.
//
// Numbers here are checked against the codebase before any change ships.
// If you add a rule, ingestion source, or test file, bump the counts.

const GITHUB_BASE = "https://github.com/jacksonshuey/dugout/blob/main";

interface Stat {
  value: string;
  label: string;
  body: string;
  evidence: { label: string; href: string };
}

const STATS: Stat[] = [
  {
    value: "196",
    label: "vitest cases",
    body: "Across 11 test files. CI gates every PR on green. The signal engine, SV Health Score, and inbound pipeline are all covered.",
    evidence: {
      label: "vitest.config.ts",
      href: `${GITHUB_BASE}/vitest.config.ts`,
    },
  },
  {
    value: "13",
    label: "deterministic rules",
    body: "Pure functions in one file. Each rule tags a strategic priority and a severity tier. The tier dictates routing (DM, digest, weekly). No tier = no signal ships.",
    evidence: {
      label: "signal-engine.ts",
      href: `${GITHUB_BASE}/src/lib/signal-engine.ts`,
    },
  },
  {
    value: "5",
    label: "live ingestion sources",
    body: "NewsAPI, SEC EDGAR, inbound newsletter pipeline, Granola meeting extraction, Firecrawl per-account web scrape. Adapter shape is shared — adding a sixth source is a file, not an architecture change.",
    evidence: {
      label: "Adapters",
      href: "https://github.com/jacksonshuey/dugout/tree/main/src/lib",
    },
  },
  {
    value: "12",
    label: "canonical signal types",
    body: "Cross-source correlation only works if every adapter's output joins on the same key. 49 source-specific signals across 13 tools collapse into 12 canonical types. The signal_type IS the contract.",
    evidence: {
      label: "synthesis.md",
      href: `${GITHUB_BASE}/orgs/checkbox/synthesis.md`,
    },
  },
  {
    value: "3",
    label: "AI providers via /ask with auto-fallback",
    body: "GPT-4o + Claude Sonnet 4.6 + Claude Haiku 4.5. User-picked per question. Provider 5xx falls back to a stub with a visible reason. Per-session rate cap (20/hr · 100/day · 500/day global) protects the budget at hard-stop 429.",
    evidence: {
      label: "ask-agent.ts",
      href: `${GITHUB_BASE}/src/lib/ask-agent.ts`,
    },
  },
  {
    value: "11",
    label: "real-public-company demo accounts",
    body: "Seed data uses 11 publicly-traded companies with deterministic SV Health Scores. Scenarios compute end-to-end against the same engine the live console runs.",
    evidence: {
      label: "seed.ts",
      href: `${GITHUB_BASE}/src/data/seed.ts`,
    },
  },
];

export function VerifiableProof() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
      {STATS.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </div>
  );
}

function StatCard({ stat }: { stat: Stat }) {
  return (
    <div className="bg-background p-5 sm:p-6 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">
          {stat.value}
        </span>
        <span className="text-xs text-muted leading-snug">{stat.label}</span>
      </div>
      <p className="text-sm text-foreground/75 leading-relaxed">{stat.body}</p>
      <a
        href={stat.evidence.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 pt-1 text-[11px] font-mono uppercase tracking-wider text-muted hover:text-brand transition-colors"
      >
        <span aria-hidden>→</span> {stat.evidence.label}
      </a>
    </div>
  );
}
