import Link from "next/link";
import { Card } from "@/components/ui";
import { AEBrief } from "@/components/ae-brief";
import { RankerBanner } from "@/components/ranker-banner";
import { SignalSourceChip } from "@/components/signal-source-chip";
import {
  getWorkspaceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";
import { displayNameFor } from "@/lib/inbound-publishers";
import { rankSignals } from "@/lib/ranker";
import type {
  AccountKeyword,
  RankedItem,
  RankerResult,
} from "@/lib/ranker-types";
import { accounts } from "@/data/seed";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { workspaceKey } from "@/lib/workspace";
import { DEFAULT_CONFIG } from "@/lib/workspace";

// Browser for workspace-scoped market intel signals — the items extracted
// by the newsletter classifier (src/lib/newsletter-adapter.ts) that didn't
// match any tracked account. Complements the morning digest's "Market intel"
// section: the digest summarizes; this page lists.
//
// Two tables now:
//   1. "Ranked by relevance" — top 20 from the Haiku ranker (or stub
//      fallback). Hidden entirely when items.length === 0.
//   2. "All signals (chronological)" — the existing full list, newest first.
//
// Read-only server render. Fails soft if Supabase is unreachable or the
// inbound_emails / external_signals pipeline hasn't been set up yet — the
// page renders a "no intel yet" empty state pointing at the README.

// Force per-request rendering. The page reads from Supabase and otherwise
// Next would prerender it as static at build time (when no env vars are
// reachable and the catch returns the empty state).
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 30;
const MAX_ITEMS = 200;

// Ranker window — 48h per design doc §0. Distinct from LOOKBACK_DAYS
// (which gates the chronological table) so the ranker focuses on the
// freshest material.
const RANKER_LOOKBACK_HOURS = 48;

interface SignalMeta {
  sender_domain?: string;
  newsletter_subject?: string;
  mention?: string;
  inbound_email_id?: string;
  matched?: boolean;
}

function readMeta(s: ExternalSignal): SignalMeta {
  if (!s.meta || typeof s.meta !== "object") return {};
  return s.meta as SignalMeta;
}

// Map an ExternalSignal to the props the source chip needs. Centralized
// so both tables render identical attribution. Handles Q8 fallback:
// `publisher_canonical_name` is preferred; meta.sender_domain is the
// fallback for older rows.
function chipPropsFor(s: ExternalSignal) {
  const meta = readMeta(s);
  return {
    signalId: s.id,
    publisherDisplayName: s.publisher_canonical_name
      ? displayNameFor(s.publisher_canonical_name)
      : null,
    senderDomainFallback: meta.sender_domain ?? null,
    emailSubject:
      s.email_subject ?? meta.newsletter_subject ?? null,
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

// Build the AccountKeyword[] the ranker uses for account fan-in. Cheap
// projection of the seed accounts that are marked trackable. `domain_slug`
// is derived from `Account.website` when present — e.g. "modernatx.com"
// → "modernatx". Falls back to undefined when the seed row has no
// website, in which case name + ticker matching is what the ranker uses.
function buildAccountKeywords(): AccountKeyword[] {
  return accounts
    .filter((a) => a.trackable !== false)
    .map((a) => {
      const slug = a.website
        ? a.website.replace(/^www\./i, "").split(".")[0]?.toLowerCase()
        : undefined;
      return {
        account_id: a.id,
        name: a.name,
        ticker: a.ticker,
        domain_slug: slug && slug.length >= 3 ? slug : undefined,
      };
    });
}

export default async function MarketIntelPage() {
  // Server component with force-dynamic — reading current time is fine here
  // because the page re-runs per request. The react-hooks/purity rule can't
  // tell server components apart from client ones, so suppress this line.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const since = new Date(nowMs - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let signals: ExternalSignal[] | null = null;
  let fetchError: string | null = null;
  try {
    signals = await getWorkspaceSignals(since, MAX_ITEMS);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  // Workspace config drives the ranker's workspace_key and prompt
  // workspaceContext. Falls back to DEFAULT_CONFIG when the cookie isn't
  // present (most demo loads).
  let workspaceName = DEFAULT_CONFIG.companyName;
  try {
    const cfg = await getWorkspaceConfig();
    workspaceName = cfg.companyName;
  } catch {
    // keep default
  }

  // Hoisted so both the ranker and <AEBrief /> see the same 48h window.
  const sinceRankerMs = nowMs - RANKER_LOOKBACK_HOURS * 60 * 60 * 1000;
  const rankerSignals: ExternalSignal[] =
    signals && !fetchError
      ? signals.filter((s) => Date.parse(s.occurred_at) >= sinceRankerMs)
      : [];

  // Run the ranker over the last 48h of workspace signals. Wrapped in its
  // own try so a ranker bug never bubbles up and 500s the page — the
  // ranker module also has an outer try/catch, this is belt-and-braces.
  let rankerResult: RankerResult | null = null;
  if (signals && signals.length > 0 && !fetchError) {
    try {
      rankerResult = await rankSignals({
        workspaceKey: workspaceKey(workspaceName),
        signals: rankerSignals,
        accountKeywords: buildAccountKeywords(),
        now: new Date(nowMs),
      });
    } catch (e) {
      // Belt: the ranker's own try/catch should always return a result.
      // Braces: if it somehow throws, log and degrade silently rather
      // than 500ing the page. The chronological table still renders.
      console.warn(
        `[market-intel] ranker threw despite outer try/catch: ${e instanceof Error ? e.message : String(e)}`,
      );
      rankerResult = null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="space-y-3 mb-8">
        <div className="text-xs uppercase tracking-wider text-muted font-medium">
          Market intel
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Workspace-wide market intelligence
        </h1>
        <p className="text-base text-muted max-w-2xl">
          Signals extracted from subscribed newsletters that aren&apos;t tied to
          any specific tracked account. Account-specific items show up in the
          drawer for that account instead. Last {LOOKBACK_DAYS} days.
        </p>
        <div className="text-sm pt-2">
          <Link href="/" className="text-muted hover:text-foreground">
            ← Back to console
          </Link>
        </div>
      </div>

      {fetchError ? (
        <Card className="p-6 text-sm space-y-2">
          <div className="font-medium">Supabase unreachable</div>
          <div className="text-muted">
            The <code>external_signals</code> read failed. If you haven&apos;t
            set up the newsletter inbox yet, run{" "}
            <code>supabase/migrations/20260522_inbound_emails.sql</code> in
            Supabase Studio and configure <code>SUPABASE_URL</code> /{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </div>
          <div className="font-mono text-xs text-muted pt-1 break-all">
            {fetchError}
          </div>
        </Card>
      ) : signals && signals.length > 0 ? (
        <div className="space-y-8">
          <AEBrief
            signals={rankerSignals}
            rankedItems={rankerResult?.items ?? []}
            now={new Date(nowMs)}
          />
          {rankerResult && <RankerBanner stubReason={rankerResult.stubReason} />}
          {rankerResult && rankerResult.items.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold tracking-tight mb-3">
                Ranked by relevance
              </h2>
              <RankedTable signals={signals} items={rankerResult.items} />
            </section>
          )}
          <section>
            <h2 className="text-lg font-semibold tracking-tight mb-3">
              All signals (chronological)
            </h2>
            <SignalTable signals={signals} />
          </section>
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="p-6 text-sm space-y-2">
      <div className="font-medium">No market intel yet</div>
      <div className="text-muted">
        Subscribe newsletters to the workspace inbox and material items land
        here within seconds. Setup steps live in the README under{" "}
        <span className="font-mono text-xs">## Newsletter inbox</span>.
      </div>
    </Card>
  );
}

// Ranked-by-relevance table. Joins the page's signal list against the
// ranker's items[] by signal_id. Items whose signal_id is no longer in the
// chronological list (shouldn't happen — same fetch — but defensive) are
// skipped silently. The rationale renders the [citation:id] marker as a
// small monospace chip so it's visually distinct from the prose.
function RankedTable({
  signals,
  items,
}: {
  signals: ExternalSignal[];
  items: RankedItem[];
}) {
  const byId = new Map(signals.map((s) => [s.id, s]));
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
          {items.map((item) => {
            const s = byId.get(item.signal_id);
            if (!s) return null;
            const meta = readMeta(s);
            const mention = meta.mention ?? "—";
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
    </Card>
  );
}

// Render a rationale, replacing every [citation:signal_id] marker with a
// small chip. Keeps the visual contract symmetric with /ask citations
// (see ask-chat-panel.tsx renderAnswer).
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

function SignalTable({ signals }: { signals: ExternalSignal[] }) {
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
          {signals.map((s) => {
            const meta = readMeta(s);
            const sender = meta.sender_domain ?? "—";
            const mention = meta.mention ?? "—";
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
    </Card>
  );
}
