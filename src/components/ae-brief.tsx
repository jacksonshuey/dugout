import { Card } from "@/components/ui";
import { SignalSourceChip } from "@/components/signal-source-chip";
import type { ExternalSignal } from "@/lib/external-signals";
import type { RankedItem } from "@/lib/ranker-types";
import { displayNameFor } from "@/lib/inbound-publishers";
import { verticalFor, isTechOrAI } from "@/lib/newsletter-verticals";
import { dedupByEntity } from "@/lib/signal-entity-dedup";

// "Today's AE Brief — tech & AI". Read-only server component that renders
// above the existing /market-intel tables. Joins ranker output to the 48h
// signal list, filters to tech/AI verticals, dedups by entity, scores by
// rank + recency, and renders the top 10 with provenance.
//
// Pure render — no Supabase calls, no client hooks (per BUILD_ALIGNMENT
// #7 + #9). Every bullet renders SignalSourceChip for citation (#6).

interface AEBriefProps {
  signals: ExternalSignal[]; // 48h-filtered, workspace-scoped
  rankedItems: RankedItem[]; // rankSignals().items
  now: Date; // injected for testability + consistent rendering
}

interface SignalMeta {
  sender_domain?: string;
  newsletter_subject?: string;
  mention?: string;
  inbound_email_id?: string;
}

function readMeta(s: ExternalSignal): SignalMeta {
  if (!s.meta || typeof s.meta !== "object") return {};
  return s.meta as SignalMeta;
}

// Mirror of market-intel/page.tsx chipPropsFor. Copied locally to avoid
// touching the page file's helper surface; the two should stay in sync.
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function relativeAge(occurredAt: string, now: Date): string {
  const hours = (now.getTime() - Date.parse(occurredAt)) / 3_600_000;
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AEBrief({ signals, rankedItems, now }: AEBriefProps) {
  const signalById = new Map(signals.map((s) => [s.id, s]));
  const totalRanked = Math.max(rankedItems.length, 1);

  // 1. Join ranked → signals. Skip rankedItems whose signal isn't present.
  // 2. Filter to tech/AI verticals.
  const joined: { signal: ExternalSignal; rank: number }[] = [];
  for (const item of rankedItems) {
    const sig = signalById.get(item.signal_id);
    if (!sig) continue;
    if (!sig.publisher_canonical_name) continue;
    if (!isTechOrAI(verticalFor(sig.publisher_canonical_name))) continue;
    joined.push({ signal: sig, rank: item.rank });
  }

  // 3. Dedup by entity. dedupByEntity preserves order, so we can rebuild
  // the rank lookup afterwards.
  const rankBySignalId = new Map(joined.map((j) => [j.signal.id, j.rank]));
  const deduped = dedupByEntity(joined.map((j) => j.signal));

  // 4. Score by 0.6 * normalizedRank + 0.4 * recencyDecay (24h-ish half-life).
  const scored = deduped.map((sig) => {
    const rank = rankBySignalId.get(sig.id) ?? totalRanked;
    const normalizedRank = 1 - (rank - 1) / totalRanked;
    const hoursOld = (now.getTime() - Date.parse(sig.occurred_at)) / 3_600_000;
    const recencyDecay = Math.exp(-hoursOld / 24);
    const score = 0.6 * normalizedRank + 0.4 * recencyDecay;
    return { signal: sig, rank, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.rank - b.rank;
  });

  // 5. Top 10.
  const top = scored.slice(0, 10);

  // 6. Empty state — muted card only, no section header.
  if (top.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted">
        No tech/AI intel in the last 48h.
      </Card>
    );
  }

  return (
    <section>
      <div className="space-y-1 mb-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Today&apos;s AE Brief — tech &amp; AI
        </h2>
        <p className="text-sm text-muted">
          Top tech and AI signals from the last 48 hours, deduped and ranked
          by impact + recency.
        </p>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {top.map(({ signal }) => (
            <li key={signal.id} className="px-4 py-3 space-y-2">
              <div className="text-sm">{truncate(signal.summary, 120)}</div>
              <SignalSourceChip {...chipPropsFor(signal)} />
              <div className="text-[11px] font-mono text-muted">
                {relativeAge(signal.occurred_at, now)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
