import { Card } from "@/components/ui";
import { SignalSourceChip } from "@/components/signal-source-chip";
import type { ExternalSignal } from "@/lib/external-signals";
import type { RankedItem } from "@/lib/ranker-types";
import { displayNameFor } from "@/lib/inbound-publishers";
import { verticalFor, isTechOrAI } from "@/lib/newsletter-verticals";
import { dedupByEntity } from "@/lib/signal-entity-dedup";

// "Today's AE Brief — tech & AI". Read-only server component that renders
// above the existing /market-intel tables. Merges two signal pools, dedups
// by entity, scores by rank + recency, and renders the top 10 with
// provenance.
//
// Dual-pool logic (WS3):
//   1. Newsletter pool — workspace-scoped signals (account_id =
//      '__workspace__') filtered by isTechOrAI(verticalFor(publisher)).
//      These come in via the rankedItems join and must have a
//      publisher_canonical_name to pass the vertical gate.
//   2. Account signal pool — account-level signals tagged workspace_relevance
//      'high' or 'medium' by the Haiku news filter (PR #31). These have no
//      publisher_canonical_name (NewsAPI source) so they bypass the vertical
//      gate and are included directly.
//
// Both pools are passed in via `signals`; the join loop classifies each
// signal into exactly one gate. dedupByEntity() handles cross-pool dupes.
//
// Pure render — no Supabase calls, no client hooks (per BUILD_ALIGNMENT
// #7 + #9). Every bullet renders SignalSourceChip for citation (#6).

interface AEBriefProps {
  signals: ExternalSignal[]; // 48h-filtered, dual-pool (newsletter + account)
  rankedItems: RankedItem[]; // rankSignals().items (workspace pool only)
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

// Confidence tier from the Haiku Stage 2 filter (workspace_relevance).
// Renders only for account-pool signals — newsletter-pool rows have no
// workspace_relevance tag and the gate filters "low"/"none" out before
// reaching this component, so in practice this renders for "high" and
// "medium" only.
function RelevancePill({
  rel,
}: {
  rel: ExternalSignal["workspace_relevance"];
}) {
  if (rel === "high") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider border border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
        HIGH RELEVANCE
      </span>
    );
  }
  if (rel === "medium") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider border border-amber-500/30 bg-amber-500/10 text-amber-700">
        MEDIUM
      </span>
    );
  }
  return null;
}

export function AEBrief({ signals, rankedItems, now }: AEBriefProps) {
  const signalById = new Map(signals.map((s) => [s.id, s]));
  const totalRanked = Math.max(rankedItems.length, 1);

  // 1. Join ranked → signals. Skip rankedItems whose signal isn't present.
  // 2a. Newsletter gate: must have publisher_canonical_name in a tech/AI
  //     vertical (existing behaviour, unchanged).
  // 2b. Account-signal gate: no publisher_canonical_name, but tagged
  //     workspace_relevance 'high' or 'medium' by the Haiku filter (WS3).
  //     These signals aren't in rankedItems, so we append them directly
  //     below with a synthetic rank = totalRanked (lowest priority vs.
  //     newsletter items, but recency decay can still pull them up).
  const joined: { signal: ExternalSignal; rank: number }[] = [];
  for (const item of rankedItems) {
    const sig = signalById.get(item.signal_id);
    if (!sig) continue;
    const isNewsletterSignal = !!sig.publisher_canonical_name;
    const includedByVertical =
      isNewsletterSignal &&
      isTechOrAI(verticalFor(sig.publisher_canonical_name!));
    const includedByRelevance =
      !isNewsletterSignal &&
      (sig.workspace_relevance === "high" ||
        sig.workspace_relevance === "medium");
    if (!includedByVertical && !includedByRelevance) continue;
    joined.push({ signal: sig, rank: item.rank });
  }

  // Append account signals that weren't in rankedItems (they're
  // account-scoped and the ranker only sees workspace-scoped signals).
  // Use a set of already-joined ids to avoid double-counting the rare
  // case where an account signal also appears in rankedItems.
  const joinedIds = new Set(joined.map((j) => j.signal.id));
  for (const sig of signals) {
    if (joinedIds.has(sig.id)) continue;
    if (!!sig.publisher_canonical_name) continue; // newsletter — skip (handled above)
    if (
      sig.workspace_relevance !== "high" &&
      sig.workspace_relevance !== "medium"
    )
      continue;
    joined.push({ signal: sig, rank: totalRanked });
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
              <div className="flex items-center gap-2 text-[11px] font-mono text-muted">
                <span>{relativeAge(signal.occurred_at, now)}</span>
                <RelevancePill rel={signal.workspace_relevance} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
