import Link from "next/link";
import { Card } from "@/components/ui";
import { WorkspaceDigest } from "@/components/ae-brief";
import { RankerBanner } from "@/components/ranker-banner";
import { SignalSourceChip } from "@/components/signal-source-chip";
import {
  getWorkspaceSignals,
  getHighRelevanceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";
import {
  getInboundQueueSummary,
  type InboundQueueSummary,
} from "@/lib/inbound-email";
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

  // Hoisted so both the ranker and <WorkspaceDigest /> see the same 48h window.
  const sinceRankerMs = nowMs - RANKER_LOOKBACK_HOURS * 60 * 60 * 1000;
  const rankerSignals: ExternalSignal[] =
    signals && !fetchError
      ? signals.filter((s) => Date.parse(s.occurred_at) >= sinceRankerMs)
      : [];

  // WS3: fetch account-level signals tagged high/medium workspace relevance
  // by the Haiku news filter (PR #31). Fail-soft: if Supabase is
  // unreachable or the workspace_relevance column isn't migrated yet, we
  // fall back to an empty array and the Brief renders with just the
  // workspace newsletter pool.
  let highRelevanceSignals: ExternalSignal[] = [];
  try {
    highRelevanceSignals = await getHighRelevanceSignals(
      RANKER_LOOKBACK_HOURS * 60 * 60 * 1000,
    );
  } catch (e) {
    console.warn(
      `[market-intel] getHighRelevanceSignals failed (fail-soft): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Merge newsletter pool + account-relevance pool, dedup by signal id.
  // rankerSignals is the workspace-scoped newsletter pool (48h);
  // highRelevanceSignals is the new account-scoped pool. Both sets may
  // contain the same signal id in theory (shouldn't happen given the
  // account_id constraint, but dedup is cheap insurance).
  const seen = new Set<string>();
  const allBriefSignals = [...rankerSignals, ...highRelevanceSignals].filter(
    (s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    },
  );

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
        <div className="space-y-10">
          {/* Section 1: account-named signals first — audit P2 #16. The
              prior order put workspace newsletters above account-named
              intel; reversed here so the AE sees the items tied to a
              tracked account (KKR, Snowflake, etc.) before generic
              workspace feeds. */}
          {highRelevanceSignals.length > 0 && (
            <section>
              <div className="space-y-1 mb-3">
                <h2 className="text-lg font-semibold tracking-tight">
                  Your tracked accounts
                </h2>
                <p className="text-sm text-muted">
                  High and medium relevance items mentioning accounts you track,
                  from the last {Math.round(RANKER_LOOKBACK_HOURS / 24)} days.
                </p>
              </div>
              <AccountNamedTable signals={highRelevanceSignals} />
            </section>
          )}

          {/* Divider between the two pools so the visual hierarchy is
              unambiguous, even when both sections have content. */}
          {highRelevanceSignals.length > 0 && (
            <div className="border-t border-border pt-2" aria-hidden />
          )}

          {/* Section 2: workspace intel — newsletters + the legacy AE
              brief synthesis. Renamed component, same shape. */}
          <section className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">
                Workspace intel
              </h2>
              <p className="text-sm text-muted">
                Newsletters and market-wide signals not tied to any single
                tracked account.
              </p>
            </div>
            <WorkspaceDigest
              signals={allBriefSignals}
              rankedItems={rankerResult?.items ?? []}
              now={new Date(nowMs)}
            />
            {rankerResult && <RankerBanner stubReason={rankerResult.stubReason} />}
            {rankerResult && rankerResult.items.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold tracking-tight mb-2 uppercase tracking-wider text-muted font-mono">
                  Ranked by relevance
                </h3>
                <RankedTable signals={signals} items={rankerResult.items} />
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold tracking-tight mb-2 uppercase tracking-wider text-muted font-mono">
                All signals (chronological)
              </h3>
              <SignalTable signals={signals} />
            </div>
          </section>
        </div>
      ) : (
        <EmptyStateAsync />
      )}
    </div>
  );
}

// Server component — queries the inbox so the empty state can distinguish
// "literally no newsletters yet" from "newsletters received, classifier
// hasn't run." Fail-soft: if the inbox query throws, fall back to the
// generic empty state.
async function EmptyStateAsync() {
  let summary: InboundQueueSummary | null = null;
  try {
    summary = await getInboundQueueSummary(5);
  } catch (e) {
    console.warn(
      `[market-intel] getInboundQueueSummary failed (fail-soft): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!summary || summary.totalCount === 0) return <NoNewslettersYet />;
  return <PendingClassificationState summary={summary} />;
}

function NoNewslettersYet() {
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

function PendingClassificationState({
  summary,
}: {
  summary: InboundQueueSummary;
}) {
  const { totalCount, pendingCount, recent } = summary;
  return (
    <Card className="p-6 text-sm space-y-4">
      <div className="space-y-1">
        <div className="font-medium">
          {pendingCount > 0
            ? `${pendingCount} newsletter${pendingCount === 1 ? "" : "s"} waiting to be parsed`
            : `${totalCount} newsletter${totalCount === 1 ? "" : "s"} received — no material signals extracted yet`}
        </div>
        <div className="text-muted">
          {pendingCount > 0
            ? "Newsletters have landed in the inbox. The classifier emits signals here as it runs — usually within seconds of arrival, or on the next sweeper pass."
            : "Every received newsletter was parsed; nothing in the last batch matched a tracked account or hit the material-event bar."}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted font-medium">
            Latest in inbox
          </div>
          <ul className="space-y-1.5">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex items-baseline gap-3 text-xs leading-snug"
              >
                <span className="text-muted font-mono shrink-0 w-20">
                  {formatDate(row.received_at)}
                </span>
                <span className="text-muted font-mono shrink-0 truncate max-w-[160px]">
                  {row.from_domain}
                </span>
                <span className="flex-1 truncate">
                  {row.subject ?? <span className="text-muted">(no subject)</span>}
                </span>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-wider font-mono ${
                    row.classified_at
                      ? "text-severity-green"
                      : "text-severity-action"
                  }`}
                >
                  {row.classified_at ? "parsed" : "pending"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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

// Table for the "Your tracked accounts" section. Each row links the
// account name + summary + source. Sort key: workspace_relevance HIGH
// before MEDIUM, then newest first inside each band — keeps the most
// material items at the top regardless of recency drift.
function AccountNamedTable({ signals }: { signals: ExternalSignal[] }) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const sorted = [...signals].sort((a, b) => {
    const ra = a.workspace_relevance === "high" ? 0 : 1;
    const rb = b.workspace_relevance === "high" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.occurred_at < b.occurred_at ? 1 : -1;
  });

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
          {sorted.map((s) => {
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
    </Card>
  );
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
