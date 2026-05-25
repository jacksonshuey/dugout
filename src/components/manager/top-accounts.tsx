// Named accounts momentum card — ranks Strategic / Enterprise accounts by
// recent external research-signal volume (Account.abmTrigger). The first
// manager surface for the P6 named-accounts motion: shows which accounts are
// heating up in the wild, who owns them, and what the obvious next step is.
//
// Pure server component. All inputs flow from the same in-process state the
// rest of the manager page reads — no fetch, no localStorage.
//
// TODO: real-mode populates abmTrigger by aggregating external_signals from
// Supabase (last 7d, high-relevance only), same path as the daily ingestion
// cron in src/app/api/account-context/route.ts.

import Link from "next/link";
import type { Account, Opportunity, Rep } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const TOP_N = 5;

export function TopAccountsCard({
  accounts,
  opportunities,
  reps,
}: {
  accounts: Account[];
  opportunities: Opportunity[];
  reps: Rep[];
}): React.JSX.Element {
  // Pre-index for O(1) joins inside the row map.
  const repById = new Map(reps.map((r) => [r.id, r]));
  const oppsByAccountId = new Map<string, Opportunity[]>();
  for (const opp of opportunities) {
    const bucket = oppsByAccountId.get(opp.accountId);
    if (bucket) bucket.push(opp);
    else oppsByAccountId.set(opp.accountId, [opp]);
  }

  const ranked = accounts
    .filter((a) => a.abmTrigger !== undefined)
    .sort(
      (a, b) =>
        (b.abmTrigger?.highRelevanceSignalsLast7d ?? 0) -
        (a.abmTrigger?.highRelevanceSignalsLast7d ?? 0),
    )
    .slice(0, TOP_N);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Named accounts momentum
        </h2>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Strategic and Enterprise accounts ranked by recent signal activity.
          The first prompt for the named-accounts motion (P6) — proactive
          outreach when external research clusters before a deal exists.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-background overflow-hidden">
        {ranked.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted italic text-center">
            No named accounts have research-signal activity yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Account</th>
                <th className="text-left px-4 py-3 font-medium">Segment</th>
                <th className="text-right px-4 py-3 font-medium">Signals</th>
                <th className="text-left px-4 py-3 font-medium">Sources</th>
                <th className="text-left px-4 py-3 font-medium">AE owner</th>
                <th className="text-left px-4 py-3 font-medium">Next step</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((account) => {
                const trigger = account.abmTrigger;
                if (!trigger) return null; // type-narrow guard
                const accountOpps = oppsByAccountId.get(account.id) ?? [];
                const primaryOpp =
                  [...accountOpps].sort((a, b) =>
                    a.createdAt < b.createdAt ? 1 : -1,
                  )[0] ?? undefined;
                const owner = primaryOpp
                  ? repById.get(primaryOpp.ownerId)
                  : undefined;
                const nextStep = primaryOpp
                  ? `Continue ${primaryOpp.name}`
                  : "Schedule intro — no active opp";

                return (
                  <tr key={account.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <Link
                        href={`/account/${account.id}`}
                        className="font-medium hover:underline"
                      >
                        {account.name}
                      </Link>
                      <div className="text-[11px] text-muted">
                        Last signal {formatDate(trigger.lastSignalAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          account.segment === "Strategic"
                            ? "inline-flex items-center rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white"
                            : "inline-flex items-center rounded-full border border-border bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-muted"
                        }
                      >
                        {account.segment}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {trigger.highRelevanceSignalsLast7d}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {trigger.sources.map((source) => (
                          <span
                            key={source}
                            className="inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted"
                          >
                            {source}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {owner ? (
                        <div>
                          <div className="font-medium text-foreground">
                            {owner.name}
                          </div>
                          <div className="text-[11px] text-muted truncate">
                            {owner.email}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted italic">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted leading-snug">
                      {nextStep}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
