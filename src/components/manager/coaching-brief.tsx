// Per-Rep Coaching Brief panel — clusters CallTranscript.riskFlags across each
// rep's calls in the last 30 days into recurring themes, surfaces the top 3
// themes per rep with a link to the most recent call where each appeared, and
// recommends a "review this call" CTA: the most recent call with the most
// riskFlags.
//
// Pure derivation — no LLM call. The Gong-moment recommender is the highest
// risk-density call by date, scoped to the rep.
//
// Note on the "uncoached" count: coaching notes live in the localStorage Task
// layer (lib/tasks.ts) and aren't readable from a server component. The count
// shown here is "recent risky calls" — the pool that needs coaching action.
// Once tasks move to Supabase, this count can subtract calls whose linked task
// already has a coaching note.

import Link from "next/link";
import type {
  Account,
  CallTranscript,
  Opportunity,
  Rep,
} from "@/lib/types";
import { daysBetween, formatDate } from "@/lib/utils";

const COACHING_WINDOW_DAYS = 30;
const TOP_THEMES_PER_REP = 3;

export interface CoachingTheme {
  flag: string;
  count: number;
  mostRecentCall: CallTranscript;
  mostRecentOpp: Opportunity;
  mostRecentAccount: Account;
}

export interface CoachingBrief {
  rep: Rep;
  totalRecentCalls: number;
  uncoachedRiskyCallCount: number;
  topThemes: CoachingTheme[];
  // Gong-moment recommender: the most-recent call with the most riskFlags.
  // Undefined if the rep has no risky calls in window.
  recommendedReviewCall?: {
    call: CallTranscript;
    opp: Opportunity;
    account: Account;
    riskCount: number;
  };
}

// ─── Pure builder ────────────────────────────────────────────────────────

export function buildCoachingBriefs({
  reps,
  calls,
  opportunities,
  accounts,
}: {
  reps: Rep[];
  calls: CallTranscript[];
  opportunities: Opportunity[];
  accounts: Account[];
}): CoachingBrief[] {
  const briefs: CoachingBrief[] = [];

  const aes = reps.filter((r) => r.role === "AE");
  // Pre-index opps + accounts for O(1) joins.
  const oppById = new Map(opportunities.map((o) => [o.id, o]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  for (const rep of aes) {
    // Which opps does this rep own → which calls roll up to this rep.
    const repOppIds = new Set(
      opportunities.filter((o) => o.ownerId === rep.id).map((o) => o.id),
    );
    const repRecentCalls = calls
      .filter((c) => repOppIds.has(c.oppId))
      .filter((c) => daysBetween(c.callDate) <= COACHING_WINDOW_DAYS)
      .sort((a, b) => (a.callDate < b.callDate ? 1 : -1)); // most recent first

    const riskyCalls = repRecentCalls.filter((c) => c.riskFlags.length > 0);

    // Cluster risk flags into themes. The most-recent call where each theme
    // appeared is the link target.
    const themeMap = new Map<
      string,
      { count: number; mostRecentCall: CallTranscript }
    >();
    for (const call of repRecentCalls) {
      for (const flag of call.riskFlags) {
        const existing = themeMap.get(flag);
        if (!existing) {
          themeMap.set(flag, { count: 1, mostRecentCall: call });
        } else {
          existing.count += 1;
          // repRecentCalls is sorted most-recent first, so the first call we
          // see for a flag IS the most recent. Keep mostRecentCall stable.
        }
      }
    }

    const topThemes: CoachingTheme[] = [];
    for (const [flag, agg] of themeMap.entries()) {
      const opp = oppById.get(agg.mostRecentCall.oppId);
      const account = opp ? accountById.get(opp.accountId) : undefined;
      if (!opp || !account) continue; // shouldn't happen with valid seed data
      topThemes.push({
        flag,
        count: agg.count,
        mostRecentCall: agg.mostRecentCall,
        mostRecentOpp: opp,
        mostRecentAccount: account,
      });
    }
    // Sort themes by count desc, then by most-recent call date desc.
    topThemes.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.mostRecentCall.callDate < b.mostRecentCall.callDate ? 1 : -1;
    });

    // Recommended review call: most riskFlags, tiebreak most recent.
    let recommended: CoachingBrief["recommendedReviewCall"];
    if (riskyCalls.length > 0) {
      const best = [...riskyCalls].sort((a, b) => {
        const r = b.riskFlags.length - a.riskFlags.length;
        if (r !== 0) return r;
        return a.callDate < b.callDate ? 1 : -1;
      })[0];
      const opp = oppById.get(best.oppId);
      const account = opp ? accountById.get(opp.accountId) : undefined;
      if (opp && account) {
        recommended = {
          call: best,
          opp,
          account,
          riskCount: best.riskFlags.length,
        };
      }
    }

    briefs.push({
      rep,
      totalRecentCalls: repRecentCalls.length,
      uncoachedRiskyCallCount: riskyCalls.length,
      topThemes: topThemes.slice(0, TOP_THEMES_PER_REP),
      recommendedReviewCall: recommended,
    });
  }

  // Sort briefs: most uncoached risky calls first (the reps who need attention
  // most), then by total recent call volume desc.
  briefs.sort((a, b) => {
    if (b.uncoachedRiskyCallCount !== a.uncoachedRiskyCallCount) {
      return b.uncoachedRiskyCallCount - a.uncoachedRiskyCallCount;
    }
    return b.totalRecentCalls - a.totalRecentCalls;
  });

  return briefs;
}

// ─── Component ───────────────────────────────────────────────────────────

export function CoachingBriefPanel({
  briefs,
}: {
  briefs: CoachingBrief[];
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Per-rep coaching brief
        </h2>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Recurring risk themes clustered across each rep&rsquo;s calls in the
          last {COACHING_WINDOW_DAYS} days, with the most recent call surfaced
          as a &ldquo;review this&rdquo; CTA.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {briefs.map((brief) => (
          <RepCard key={brief.rep.id} brief={brief} />
        ))}
      </div>
    </section>
  );
}

function RepCard({ brief }: { brief: CoachingBrief }): React.JSX.Element {
  const { rep, totalRecentCalls, uncoachedRiskyCallCount, topThemes, recommendedReviewCall } =
    brief;
  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{rep.name}</div>
          <div className="text-[11px] text-muted truncate">{rep.email}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Risky calls
          </div>
          <div
            className={
              uncoachedRiskyCallCount > 0
                ? "text-lg font-semibold text-severity-action tabular-nums"
                : "text-lg font-semibold text-severity-green tabular-nums"
            }
          >
            {uncoachedRiskyCallCount}
            <span className="text-[11px] text-muted font-normal ml-1">
              / {totalRecentCalls}
            </span>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Top themes */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono mb-2">
            Top themes (last {COACHING_WINDOW_DAYS}d)
          </div>
          {topThemes.length === 0 ? (
            <div className="text-[12px] text-muted italic">
              No risk themes detected — clean call sheet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {topThemes.map((theme) => (
                <li
                  key={theme.flag}
                  className="flex items-start justify-between gap-3 text-[12px] leading-snug"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">
                      {theme.flag}
                    </span>
                    <div className="text-[11px] text-muted">
                      Most recent:{" "}
                      <Link
                        href={`/account/${theme.mostRecentAccount.id}`}
                        className="hover:underline"
                      >
                        {theme.mostRecentOpp.name}
                      </Link>
                      {" · "}
                      {formatDate(theme.mostRecentCall.callDate)}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-muted shrink-0 tabular-nums">
                    &times;{theme.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recommended review CTA */}
        {recommendedReviewCall && (
          <div className="rounded-lg border border-severity-action/30 bg-severity-action/5 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-severity-action font-mono mb-1">
              Review this call
            </div>
            <Link
              href={`/account/${recommendedReviewCall.account.id}`}
              className="text-[12px] font-medium hover:underline block"
            >
              {recommendedReviewCall.opp.name}
            </Link>
            <div className="text-[11px] text-muted">
              {formatDate(recommendedReviewCall.call.callDate)} ·{" "}
              {recommendedReviewCall.call.durationMin} min ·{" "}
              {recommendedReviewCall.riskCount} risk flag
              {recommendedReviewCall.riskCount === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
