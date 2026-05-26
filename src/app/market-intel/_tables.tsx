"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { SignalSourceChip } from "@/components/signal-source-chip";
import type { ExternalSignal } from "@/lib/external-signals";
import type { RankedItem } from "@/lib/ranker-types";
import { displayNameFor } from "@/lib/inbound-publishers";
import { accounts } from "@/data/seed";

// Load-more pagination: render the first INITIAL_ROWS rows on mount, then
// reveal STEP_ROWS more each time the button is clicked. Keeps the initial
// DOM small (faster first paint, less hydration cost) without losing access
// to the long tail. State is local to each table — no URL persistence.

const INITIAL_ROWS = 10;
const STEP_ROWS = 10;

// ---------------------------------------------------------------------------
// Shared helpers — duplicated from page.tsx so this client-bundle file
// doesn't depend on the page module. Pure functions, safe everywhere.
// ---------------------------------------------------------------------------

interface SignalMeta {
  sender_domain?: string;
  newsletter_subject?: string;
  inbound_email_id?: string;
  mention?: string;
}

function readMeta(s: ExternalSignal): SignalMeta {
  if (!s.meta || typeof s.meta !== "object") return {};
  return s.meta as SignalMeta;
}

function chipPropsFor(s: ExternalSignal) {
  const meta = readMeta(s);
  return {
    signalId: s.id,
    publisherDisplayName: s.publisher_canonical_name
      ? displayNameFor(s.publisher_canonical_name)
      : null,
    senderDomainFallback: meta.sender_domain ?? null,
    emailSubject: s.email_subject ?? meta.newsletter_subject ?? null,
    sourceUrl: s.source_url ?? s.url ?? null,
    inboundEmailId: s.inbound_email_id ?? meta.inbound_email_id ?? null,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TYPE_LABELS: Record<string, string> = {
  leadership_change: "Leadership",
  champion_job_change: "Champion move",
  ma_acquisition: "M&A",
  funding_round: "Funding",
  layoff: "Layoff",
  earnings: "Earnings",
  product_launch: "Product",
  press_release: "Press",
  competitor_mention: "Competitor",
  regulatory_action: "Regulatory",
  partnership: "Partnership",
  other: "Other",
};

function renderRationale(rationale: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\[citation:([^\]\s]+)\]/g;
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rationale)) !== null) {
    if (m.index > lastIndex) parts.push(rationale.slice(lastIndex, m.index));
    const id = m[1];
    parts.push(
      <span
        key={`c-${key++}`}
        className="inline-flex items-center align-baseline mx-0.5 px-1 h-4 rounded text-[9px] font-mono bg-brand/10 text-brand border border-brand/30"
        title={`signal ${id}`}
      >
        {id.slice(0, 12)}
      </span>,
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < rationale.length) parts.push(rationale.slice(lastIndex));
  return parts;
}

// ---------------------------------------------------------------------------
// LoadMoreFooter — shared button row that sits below a table card. Shows
// how many rows are hidden + lets the user reveal more in batches.
// ---------------------------------------------------------------------------

function LoadMoreFooter({
  visible,
  total,
  onShowMore,
}: {
  visible: number;
  total: number;
  onShowMore: () => void;
}) {
  if (visible >= total) {
    if (total <= INITIAL_ROWS) return null; // nothing was ever hidden
    return (
      <div className="px-4 py-3 border-t border-border text-xs text-muted text-center">
        Showing all {total} items
      </div>
    );
  }
  const hidden = total - visible;
  const nextBatch = Math.min(STEP_ROWS, hidden);
  return (
    <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
      <span className="text-xs text-muted">
        Showing {visible} of {total} · {hidden} more
      </span>
      <button
        type="button"
        onClick={onShowMore}
        className="text-xs font-medium px-3 py-1 rounded-md border border-border bg-background hover:border-foreground/30 hover:bg-foreground/[0.04] transition-colors"
      >
        Load {nextBatch} more
      </button>
    </div>
  );
}

function useShown(total: number) {
  const [shown, setShown] = useState(INITIAL_ROWS);
  const visibleCount = Math.min(shown, total);
  const showMore = () => setShown((n) => Math.min(total, n + STEP_ROWS));
  return { visibleCount, showMore };
}

// ---------------------------------------------------------------------------
// AccountNamedTable — "Your tracked accounts" section. Each row links the
// account name + summary + source. Sort key: workspace_relevance HIGH
// before MEDIUM, then newest first inside each band.
// ---------------------------------------------------------------------------

export function AccountNamedTable({
  signals,
}: {
  signals: ExternalSignal[];
}) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const sorted = [...signals].sort((a, b) => {
    const ra = a.workspace_relevance === "high" ? 0 : 1;
    const rb = b.workspace_relevance === "high" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });
  const { visibleCount, showMore } = useShown(sorted.length);
  const visible = sorted.slice(0, visibleCount);

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.02] text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Account</th>
            <th className="px-4 py-2 font-medium">Relevance</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => {
            const account = accountById.get(s.account_id);
            const typeLabel = TYPE_LABELS[s.type] ?? s.type;
            return (
              <tr
                key={s.id}
                className="border-t border-border align-top hover:bg-black/[0.02]"
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {formatDate(s.occurred_at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-medium">
                  {account ? (
                    <Link
                      href={`/account/${account.id}/prep`}
                      className="hover:text-brand"
                    >
                      {account.name}
                    </Link>
                  ) : (
                    s.account_id
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider uppercase border ${
                      s.workspace_relevance === "high"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    {s.workspace_relevance === "high" ? "High" : "Medium"}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border border-border bg-black/[0.04]">
                    {typeLabel}
                  </span>
                </td>
                <td className="px-4 py-3 space-y-2">
                  <div>{s.summary}</div>
                  <SignalSourceChip {...chipPropsFor(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMoreFooter
        visible={visibleCount}
        total={sorted.length}
        onShowMore={showMore}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RankedTable — items from the Haiku ranker, ordered by item.rank.
// ---------------------------------------------------------------------------

export function RankedTable({
  signals,
  items,
}: {
  signals: ExternalSignal[];
  items: RankedItem[];
}) {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const { visibleCount, showMore } = useShown(items.length);
  const visible = items.slice(0, visibleCount);

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.02] text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-2 font-medium w-10">#</th>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Mention</th>
            <th className="px-4 py-2 font-medium">Rationale</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => {
            const s = byId.get(item.signal_id);
            if (!s) return null;
            const meta = readMeta(s);
            const mention = meta.mention ?? "-";
            const typeLabel = TYPE_LABELS[s.type] ?? s.type;
            return (
              <tr
                key={item.signal_id}
                className="border-t border-border align-top hover:bg-black/[0.02]"
              >
                <td className="px-4 py-3 text-muted font-mono text-xs">
                  {item.rank}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {formatDate(s.occurred_at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border border-border bg-black/[0.04]">
                    {typeLabel}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-medium">
                  {mention}
                </td>
                <td className="px-4 py-3 space-y-2">
                  <div>{renderRationale(item.rationale)}</div>
                  <SignalSourceChip {...chipPropsFor(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMoreFooter
        visible={visibleCount}
        total={items.length}
        onShowMore={showMore}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SignalTable — chronological feed of all signals in the lookback window.
// ---------------------------------------------------------------------------

export function SignalTable({ signals }: { signals: ExternalSignal[] }) {
  const { visibleCount, showMore } = useShown(signals.length);
  const visible = signals.slice(0, visibleCount);

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-black/[0.02] text-left text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Date</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Mention</th>
            <th className="px-4 py-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => {
            const meta = readMeta(s);
            const sender = meta.sender_domain ?? "-";
            const mention = meta.mention ?? "-";
            const typeLabel = TYPE_LABELS[s.type] ?? s.type;
            return (
              <tr
                key={s.id}
                className="border-t border-border align-top hover:bg-black/[0.02]"
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted">
                  {formatDate(s.occurred_at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted font-mono text-xs">
                  {sender}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border border-border bg-black/[0.04]">
                    {typeLabel}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-medium">
                  {mention}
                </td>
                <td className="px-4 py-3 space-y-2">
                  <div>{s.summary}</div>
                  <SignalSourceChip {...chipPropsFor(s)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMoreFooter
        visible={visibleCount}
        total={signals.length}
        onShowMore={showMore}
      />
    </Card>
  );
}
