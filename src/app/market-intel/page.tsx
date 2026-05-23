import Link from "next/link";
import { Card } from "@/components/ui";
import {
  getWorkspaceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";

// Browser for workspace-scoped market intel signals — the items extracted
// by the newsletter classifier (src/lib/newsletter-adapter.ts) that didn't
// match any tracked account. Complements the morning digest's "Market intel"
// section: the digest summarizes; this page lists.
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
        <SignalTable signals={signals} />
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
        Subscribe newsletters to your SendGrid Inbound Parse address and
        material items will land here within seconds of arrival. Setup steps
        live in the README under{" "}
        <span className="font-mono text-xs">## Newsletter inbox</span>.
      </div>
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
                <td className="px-4 py-3">
                  <div>{s.summary}</div>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand hover:underline mt-1 inline-block break-all"
                    >
                      {s.url}
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
