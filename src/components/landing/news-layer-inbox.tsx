"use client";

import { useEffect, useState } from "react";

// News-layer synthesis visual. Three live feeds at the top (AgentMail
// inbox · NewsAPI · SEC EDGAR) funnel through an SVG converging path
// into the AI parser, which emits one sorted unified table below.
//
// Motion: ticks round-robin through the three sources at a slow cadence.
// On each tick:
//   1. The active source's cell refreshes with a new incoming item
//   2. Only the active source's SVG path flows; the other two are dim
//   3. A new row matching the active source is added to the top of the
//      unified output table
// This makes the synthesis feel sequential — one feed at a time — so
// the eye can track the flow from a single source into the output.

type SourceKey = "agentmail" | "newsapi" | "sec";

interface FeedItem {
  sender: string;
  subject: string;
  taggedTo: string;
}

interface Feed {
  source: SourceKey;
  label: string;
  items: FeedItem[];
}

const FEEDS: Feed[] = [
  {
    source: "agentmail",
    label: "AgentMail inbox",
    items: [
      { sender: "endpts@endpointsnews.com", subject: "Moderna Q3 trial results expand mRNA pipeline", taggedTo: "acc_moderna" },
      { sender: "team@biopharmadive.com", subject: "Biotech legal spend up 14% YoY", taggedTo: "vertical · biotech" },
      { sender: "alerts@lawyerist.com", subject: "Enterprise SaaS legal benchmark 2026", taggedTo: "vertical · enterprise software" },
      { sender: "newsletter@pehub.com", subject: "PE firm legal-ops trends 2026", taggedTo: "vertical · financial services" },
    ],
  },
  {
    source: "newsapi",
    label: "NewsAPI",
    items: [
      { sender: "Reuters", subject: "SAP Q1 cloud revenue beats; legal team expansion announced", taggedTo: "acc_sap" },
      { sender: "Bloomberg", subject: "KKR closes $19B private equity fund", taggedTo: "acc_kkr" },
      { sender: "TechCrunch", subject: "Atlassian acquires AI startup for $300M", taggedTo: "acc_atlassian" },
      { sender: "Forbes", subject: "Snowflake announces Series F at $40B valuation", taggedTo: "acc_snowflake" },
    ],
  },
  {
    source: "sec",
    label: "SEC EDGAR",
    items: [
      { sender: "SEC EDGAR", subject: "Snowflake Inc · 10-K updates AI vendor disclosure", taggedTo: "acc_snowflake" },
      { sender: "SEC EDGAR", subject: "CNA Financial · 8-K leadership transition disclosed", taggedTo: "acc_cna" },
      { sender: "SEC EDGAR", subject: "Hitachi Ltd · 6-K EMEA legal reorganization", taggedTo: "acc_hitachi" },
      { sender: "SEC EDGAR", subject: "Moderna Inc · 8-K SVP Legal & Compliance hired", taggedTo: "acc_moderna" },
    ],
  },
];

interface OutputRow {
  source: SourceKey;
  sender: string;
  subject: string;
  taggedTo: string;
}

// Initial output state — populated so the table doesn't open empty.
const INITIAL_OUTPUT: OutputRow[] = [
  { source: "newsapi", sender: "Bloomberg", subject: "KKR closes $19B private equity fund", taggedTo: "acc_kkr" },
  { source: "sec", sender: "SEC EDGAR", subject: "CNA Financial · 8-K leadership transition disclosed", taggedTo: "acc_cna" },
  { source: "agentmail", sender: "team@biopharmadive.com", subject: "Biotech legal spend up 14% YoY", taggedTo: "vertical · biotech" },
];

const TICK_MS = 4200;
const OUTPUT_MAX = 6;

export function NewsLayerInbox() {
  // activeIdx cycles 0 → 1 → 2 → 0. Each transition is one synthesis event.
  // Start at 2 so the first interval tick lands on AgentMail (idx 0).
  const [activeIdx, setActiveIdx] = useState(2);
  const [counters, setCounters] = useState<[number, number, number]>([0, 0, 0]);
  const [output, setOutput] = useState<OutputRow[]>(INITIAL_OUTPUT);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = setInterval(() => {
      setActiveIdx((prevActive) => {
        const next = (prevActive + 1) % 3;
        const feed = FEEDS[next];
        setCounters((c) => {
          const updated: [number, number, number] = [c[0], c[1], c[2]];
          const nextItemIdx = (c[next] + 1) % feed.items.length;
          updated[next] = nextItemIdx;
          // Push the matching item to the top of the output.
          const newItem = feed.items[nextItemIdx];
          setOutput((q) => {
            const newRow: OutputRow = {
              source: feed.source,
              sender: newItem.sender,
              subject: newItem.subject,
              taggedTo: newItem.taggedTo,
            };
            return [newRow, ...q].slice(0, OUTPUT_MAX);
          });
          return updated;
        });
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden shadow-sm">
      <Header activeLabel={FEEDS[activeIdx].label} />

      {/* Three current items (one per feed). Only the active one highlights. */}
      <div className="grid grid-cols-3 divide-x divide-border bg-foreground/[0.015]">
        {FEEDS.map((feed, idx) => (
          <FeedCell
            key={feed.source}
            feed={feed}
            itemIdx={counters[idx]}
            isActive={idx === activeIdx}
          />
        ))}
      </div>

      {/* Funnel — active lane flows; the other two are dim and still. */}
      <FunnelVisual activeIdx={activeIdx} />

      {/* Unified output — top row is whatever the active source just sent. */}
      <UnifiedOutput rows={output} />

      <style>{`
        @keyframes news-flow-dash {
          to { stroke-dashoffset: -32; }
        }
        :where(.news-flow-active) {
          animation: news-flow-dash 1.8s linear infinite;
        }
        :where(.news-flow-trunk) {
          animation: news-flow-dash 1.5s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          :where(.news-flow-active),
          :where(.news-flow-trunk) {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — workspace inbox with live indicator + currently-ingesting label.
// ---------------------------------------------------------------------------

function Header({ activeLabel }: { activeLabel: string }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-foreground/[0.02]">
      <span
        aria-hidden
        className="inline-flex w-1.5 h-1.5 rounded-full bg-severity-green animate-pulse"
      />
      <h3 className="text-sm font-semibold tracking-tight">Workspace inbox</h3>
      <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        Live · synthesizing
      </span>
      <span className="ml-auto text-[10px] uppercase tracking-[0.15em] font-mono text-brand">
        Ingesting · {activeLabel}
      </span>
    </header>
  );
}

// ---------------------------------------------------------------------------
// FeedCell — only the active cell renders the brand-tinted background and
// "incoming" flag. The other two show their last-known item dimmed.
// ---------------------------------------------------------------------------

function FeedCell({
  feed,
  itemIdx,
  isActive,
}: {
  feed: Feed;
  itemIdx: number;
  isActive: boolean;
}) {
  const item = feed.items[itemIdx];
  return (
    <div className="flex flex-col">
      <div
        className={
          "px-3 py-2 flex items-center gap-2 border-b border-border " +
          (isActive
            ? "bg-brand/[0.08]"
            : "bg-foreground/[0.015]")
        }
      >
        <SourceIcon source={feed.source} />
        <span
          className={
            "text-[10px] font-mono uppercase tracking-[0.15em] " +
            (isActive ? "text-brand" : "text-muted")
          }
        >
          {feed.label}
        </span>
        {isActive && (
          <span className="ml-auto text-[9px] uppercase tracking-[0.15em] font-mono text-brand animate-pulse">
            incoming
          </span>
        )}
      </div>
      <div
        // key forces remount so the fade-in transition fires on each item swap.
        key={`${feed.source}-${itemIdx}`}
        className={
          "px-3 py-3 flex-1 transition-colors duration-1000 " +
          (isActive ? "bg-brand/[0.04]" : "bg-background opacity-60")
        }
      >
        <div className="text-[10px] font-mono text-muted truncate">
          {item.sender}
        </div>
        <div className="mt-1 text-[12px] text-foreground leading-snug line-clamp-3">
          {item.subject}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FunnelVisual — SVG funnel with three converging paths. Only the path
// corresponding to the active source flows; the other two are dim and
// static. The trunk (merge → output) always flows since something is
// always being emitted.
// ---------------------------------------------------------------------------

function FunnelVisual({ activeIdx }: { activeIdx: number }) {
  // Paths for left/middle/right sources converging to (150, 60).
  const paths = [
    "M 50 0 Q 50 35 150 60",
    "M 150 0 L 150 60",
    "M 250 0 Q 250 35 150 60",
  ];
  return (
    <div className="relative bg-foreground/[0.03] border-y border-border">
      <svg
        viewBox="0 0 300 100"
        preserveAspectRatio="none"
        className="w-full h-24"
        aria-hidden
      >
        {paths.map((d, idx) => {
          const isActive = idx === activeIdx;
          return (
            <path
              key={idx}
              d={d}
              stroke="currentColor"
              strokeWidth={isActive ? 2 : 1.25}
              fill="none"
              strokeDasharray={isActive ? "6 5" : "3 6"}
              strokeLinecap="round"
              className={
                isActive ? "text-brand news-flow-active" : "text-muted/30"
              }
            />
          );
        })}
        {/* Trunk: always flowing — output never stops emitting */}
        <path
          d="M 150 60 L 150 100"
          stroke="currentColor"
          strokeWidth="2.5"
          fill="none"
          strokeDasharray="8 4"
          strokeLinecap="round"
          className="text-brand/70 news-flow-trunk"
        />
      </svg>
      {/* AI engine pill positioned at the convergence point */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ top: "calc(60% - 14px)" }}
      >
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand text-background text-[10px] uppercase tracking-[0.15em] font-mono shadow-md">
          <span
            aria-hidden
            className="inline-flex w-1.5 h-1.5 rounded-full bg-background animate-pulse"
          />
          AI parser
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnifiedOutput — synthesized rows. Top row is the most-recent arrival;
// its background flashes brand-tinted on each tick (via the React key
// remount + CSS transition).
// ---------------------------------------------------------------------------

function UnifiedOutput({ rows }: { rows: OutputRow[] }) {
  return (
    <div>
      <div className="px-4 py-2 flex items-center justify-between bg-foreground/[0.015]">
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          Unified output · sorted by relevance
        </span>
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-severity-green">
          {rows.length} synthesized
        </span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row, idx) => (
          <li
            // The key changes on every tick for the new top row so React
            // remounts it and the entry transition fires fresh.
            key={`out-${idx}-${row.subject}`}
            className={
              "px-4 py-2.5 flex items-baseline gap-3 transition-colors duration-1000 " +
              (idx === 0 ? "bg-brand/[0.06]" : "bg-background")
            }
          >
            <SourceIcon source={row.source} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-foreground leading-snug truncate">
                {row.subject}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px]">
                <span className="font-mono text-muted truncate max-w-[40%]">
                  {row.sender}
                </span>
                <span className="text-muted">·</span>
                <code className="font-mono text-brand">{row.taggedTo}</code>
              </div>
            </div>
            {idx === 0 && (
              <span className="text-[9px] uppercase tracking-[0.15em] font-mono text-brand shrink-0 animate-pulse">
                new
              </span>
            )}
          </li>
        ))}
      </ul>
      <footer className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-foreground/[0.02] text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        <div className="flex items-center gap-3">
          <SourceBadge source="agentmail" />
          <SourceBadge source="newsapi" />
          <SourceBadge source="sec" />
        </div>
        <span>AI tags each row before the team sees it</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared source iconography.
// ---------------------------------------------------------------------------

function SourceIcon({ source }: { source: SourceKey }) {
  const styles: Record<SourceKey, { label: string; cls: string }> = {
    agentmail: { label: "✉", cls: "border-border bg-background text-foreground/70" },
    newsapi: { label: "N", cls: "border-border bg-background text-foreground/70" },
    sec: { label: "§", cls: "border-border bg-background text-foreground/70" },
  };
  const s = styles[source];
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-mono font-semibold shrink-0 ${s.cls}`}
      title={source}
    >
      {s.label}
    </span>
  );
}

function SourceBadge({ source }: { source: SourceKey }) {
  const label: Record<SourceKey, string> = {
    agentmail: "Inbox",
    newsapi: "NewsAPI",
    sec: "SEC EDGAR",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <SourceIcon source={source} />
      <span className="text-muted">{label[source]}</span>
    </span>
  );
}
