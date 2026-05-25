import {
  getHighRelevanceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";
import { accounts } from "@/data/seed";

// Horizontal scrolling marquee of recent high-relevance signals tied to
// specific tracked accounts. Renders the existing `marquee-right` CSS
// keyframe (defined in globals.css) so there's no JS animation cost and
// the loop pauses on hover + respects `prefers-reduced-motion`.
//
// Data source: `getHighRelevanceSignals(48h)` — account-scoped (not
// workspace-scoped), high or medium workspace_relevance. Account names
// are resolved from the seed `accounts` array; the chip shows the human
// name, not the raw `account_id`.
//
// Fails soft to a single muted placeholder card if the fetch errors so a
// Supabase outage doesn't break the landing.

const TICKER_LOOKBACK_HOURS = 72;

export async function ClientNewsTicker() {
  let signals: ExternalSignal[] = [];
  try {
    signals = await getHighRelevanceSignals(
      TICKER_LOOKBACK_HOURS * 60 * 60 * 1000,
    );
  } catch {
    signals = [];
  }

  if (signals.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-foreground/[0.02] p-4 text-xs text-muted">
        No account-scoped signals in the last {TICKER_LOOKBACK_HOURS}h. The
        ticker resumes as soon as the news pipeline tags a new account.
      </div>
    );
  }

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  return (
    <div className="mt-4 marquee-container overflow-hidden border border-border rounded-lg bg-foreground/[0.02] py-3">
      <div className="marquee-track flex gap-3 w-max">
        {[...signals, ...signals].map((s, i) => (
          <TickerCard
            key={`${s.id}-${i}`}
            signal={s}
            accountName={accountNameById.get(s.account_id) ?? s.account_id}
          />
        ))}
      </div>
    </div>
  );
}

function TickerCard({
  signal,
  accountName,
}: {
  signal: ExternalSignal;
  accountName: string;
}) {
  const ageLabel = relativeAge(signal.occurred_at);
  return (
    <div className="w-[300px] shrink-0 rounded-lg border border-border bg-background p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 px-2 rounded border border-brand/40 bg-brand/10 text-brand">
          {accountName}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
          {ageLabel}
        </span>
      </div>
      <div className="text-xs font-medium tracking-tight leading-snug line-clamp-2">
        {signal.summary}
      </div>
    </div>
  );
}

function relativeAge(isoTimestamp: string): string {
  const ageH = Math.max(
    1,
    Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 3600000),
  );
  return ageH < 24 ? `${ageH}h ago` : `${Math.floor(ageH / 24)}d ago`;
}
