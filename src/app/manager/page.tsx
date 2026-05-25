import Link from "next/link";
import {
  DEMO_SCENARIO_ACCOUNTS,
  accounts,
  activities,
  assetDeliveries,
  calls,
  contacts,
  demoSignals,
  opportunities,
  reps,
} from "@/data/seed";
import { computeDealHealth, evaluateAll } from "@/lib/signal-engine";
import { computeSVHealthScore } from "@/lib/sv-health";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { cn, formatCurrency } from "@/lib/utils";
import type { Account, DealHealth, Opportunity } from "@/lib/types";
import { SVHealthHeroDashboard } from "@/components/sv-health-hero";
import type { SVHealthScore } from "@/lib/sv-health";
import {
  ForecastConfidencePanel,
  buildForecastConfidenceRows,
} from "@/components/manager/forecast-confidence";
import {
  CoachingBriefPanel,
  buildCoachingBriefs,
} from "@/components/manager/coaching-brief";
import { TopAccountsCard } from "@/components/manager/top-accounts";

// Manager view. Derived entirely from the signal engine — same source as the
// AE Console, just aggregated by owner. Server-rendered (no localStorage,
// unlike the task layer which is per-browser).
//
// v1 scope:
//   - Team aggregates: deal counts by health, blocking-signal volume
//   - Per-AE table: deals owned + health distribution + open blocking + ACV
//
// v1.5 (not yet shipped): task completion rate, action latency, deal velocity.
// These require persisting tasks server-side (currently localStorage). When
// tasks move to Supabase, this page is the natural surface for those metrics.

export default async function ManagerPage() {
  const workspace = await getWorkspaceConfig();
  const ctx = {
    opportunities,
    accounts,
    contacts,
    activities,
    calls,
    deliveries: assetDeliveries,
    reps,
    config: {
      companyName: workspace.companyName,
      assets: workspace.assets,
      stack: workspace.stack,
      contractIdleAmountFloor: workspace.contractIdleAmountFloor,
    },
  };
  const signals = evaluateAll(ctx);

  // ── Hero #0: SV Health dashboard scenarios ──────────────────────────
  // Compute the three SV Health Scores for the labeled demo scenarios. Inputs
  // mirror the /api/account-context shape: engine signals + demoSignals
  // filtered to each opp's account, plus that opp's OCR contacts. Demo data
  // is allowed in server components per BUILD_ALIGNMENT principle #10.
  const scenarios = (
    Object.entries(DEMO_SCENARIO_ACCOUNTS) as [
      keyof typeof DEMO_SCENARIO_ACCOUNTS,
      string,
    ][]
  )
    .map(([label, accountId]) => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return null;
      // First Selected Vendor / Contracting opp on the account — matches the
      // SV+ gating used by /api/account-context.
      const opp = opportunities.find(
        (o) =>
          o.accountId === accountId &&
          (o.stage === "Selected Vendor" || o.stage === "Contracting"),
      );
      if (!opp) return null;
      const oppContacts = contacts.filter((c) =>
        opp.contactRoleIds.includes(c.id),
      );
      const allOppSignals = [...signals, ...demoSignals].filter(
        (s) => s.oppId === opp.id,
      );
      const score: SVHealthScore = computeSVHealthScore({
        account,
        opportunity: opp,
        contacts: oppContacts,
        signals: allOppSignals,
        externalSignals: [],
      });
      return { label, account, opportunity: opp, score };
    })
    .filter(
      (
        s,
      ): s is {
        label: "healthy" | "watch" | "critical";
        account: Account;
        opportunity: Opportunity;
        score: SVHealthScore;
      } => s !== null,
    );

  // SV Health Score per opportunity — used by the Forecast Confidence panel
  // below. We compute it for every opp (not just the 3 demo scenarios above)
  // so the panel grades the full open book. Same composition as the hero card.
  const svHealthByOpp: Record<string, SVHealthScore | undefined> = {};
  for (const opp of opportunities) {
    const account = accounts.find((a) => a.id === opp.accountId);
    if (!account) continue;
    const oppContacts = contacts.filter((c) =>
      opp.contactRoleIds.includes(c.id),
    );
    const allOppSignals = [...signals, ...demoSignals].filter(
      (s) => s.oppId === opp.id,
    );
    svHealthByOpp[opp.id] = computeSVHealthScore({
      account,
      opportunity: opp,
      contacts: oppContacts,
      signals: allOppSignals,
      externalSignals: [],
    });
  }

  // Forecast confidence rows + coaching briefs — both pure derivations from
  // the same in-process state the rest of the page reads. Computed at render
  // time so the manager view stays a single server render with no client work.
  const forecastRows = buildForecastConfidenceRows({
    opportunities,
    accounts,
    reps,
    signals,
    svHealthByOpp,
  });
  const coachingBriefs = buildCoachingBriefs({
    reps,
    calls,
    opportunities,
    accounts,
  });

  // Per-AE roll-up. Filter to AE role specifically — managers, SDRs, SEs
  // don't own deals in the seed.
  const aes = reps.filter((r) => r.role === "AE");

  const perRep = aes
    .map((rep) => {
      const repOpps = opportunities.filter((o) => o.ownerId === rep.id);
      const healthCounts: Record<DealHealth, number> = {
        Healthy: 0,
        Monitor: 0,
        "At Risk": 0,
        Critical: 0,
      };
      for (const opp of repOpps) {
        healthCounts[computeDealHealth(opp, signals)]++;
      }
      const blockingCount = signals.filter(
        (s) =>
          s.severity === "blocking" &&
          repOpps.some((o) => o.id === s.oppId),
      ).length;
      const actionCount = signals.filter(
        (s) =>
          s.severity === "action" &&
          repOpps.some((o) => o.id === s.oppId),
      ).length;
      const acv = repOpps.reduce((sum, o) => sum + o.amount, 0);
      return {
        rep,
        dealCount: repOpps.length,
        healthCounts,
        blockingCount,
        actionCount,
        acv,
      };
    })
    .sort((a, b) => b.healthCounts.Critical - a.healthCounts.Critical);

  // Team aggregates.
  const totalDeals = opportunities.length;
  const dealsCritical = perRep.reduce(
    (s, r) => s + r.healthCounts.Critical,
    0,
  );
  const dealsAtRisk = perRep.reduce(
    (s, r) => s + r.healthCounts["At Risk"],
    0,
  );
  const dealsHealthy = perRep.reduce(
    (s, r) => s + r.healthCounts.Healthy,
    0,
  );
  const dealsMonitor = perRep.reduce(
    (s, r) => s + r.healthCounts.Monitor,
    0,
  );
  const totalBlocking = signals.filter((s) => s.severity === "blocking").length;
  const totalAction = signals.filter((s) => s.severity === "action").length;
  const teamAcv = perRep.reduce((s, r) => s + r.acv, 0);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Manager view
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          {workspace.companyName} team intelligence
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Team health at a glance. Rep-level metrics derived from the signal
          engine — same source as the AE Console at{" "}
          <Link href="/console" className="text-foreground hover:underline">
            /console
          </Link>
          , aggregated by owner. Read-only v1.
        </p>
      </div>

      {/* Hero #0 — SV Health Score dashboard. The demo opening shot per
         discovery/information-requirements.md "Hero Surface #0". */}
      {scenarios.length > 0 && <SVHealthHeroDashboard scenarios={scenarios} />}

      {/* Team aggregate cards */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Team aggregates
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total deals" value={String(totalDeals)} sub={`${formatCurrency(teamAcv)} ACV`} />
          <StatCard
            label="Critical"
            value={String(dealsCritical)}
            tone="blocking"
            sub={`${dealsCritical} of ${totalDeals} deals`}
          />
          <StatCard
            label="At risk"
            value={String(dealsAtRisk)}
            tone="action"
            sub={`${dealsAtRisk} of ${totalDeals} deals`}
          />
          <StatCard
            label="Healthy"
            value={String(dealsHealthy)}
            tone="green"
            sub={`${dealsMonitor} on monitor`}
          />
        </div>
      </section>

      {/* Signal volume */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Open signal volume
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            label="Blocking (page now)"
            value={String(totalBlocking)}
            tone="blocking"
          />
          <StatCard
            label="Action (morning digest)"
            value={String(totalAction)}
            tone="action"
          />
          <StatCard
            label="Total deals tracked"
            value={String(totalDeals)}
          />
        </div>
      </section>

      {/* Per-rep breakdown */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Per AE · sorted by Critical deal count
        </h2>
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">AE</th>
                <th className="text-right px-4 py-3 font-medium">Deals</th>
                <th className="text-right px-4 py-3 font-medium">ACV</th>
                <th className="text-right px-4 py-3 font-medium">Healthy</th>
                <th className="text-right px-4 py-3 font-medium">Monitor</th>
                <th className="text-right px-4 py-3 font-medium">At risk</th>
                <th className="text-right px-4 py-3 font-medium">Critical</th>
                <th className="text-right px-4 py-3 font-medium">Blocking</th>
                <th className="text-right px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {perRep.map((r) => (
                <tr key={r.rep.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.rep.name}</div>
                    <div className="text-[11px] text-muted">{r.rep.email}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{r.dealCount}</td>
                  <td className="px-4 py-3 text-right text-muted">
                    {formatCurrency(r.acv)}
                  </td>
                  <td className="px-4 py-3 text-right text-severity-green">
                    {r.healthCounts.Healthy}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {r.healthCounts.Monitor}
                  </td>
                  <td className="px-4 py-3 text-right text-severity-action">
                    {r.healthCounts["At Risk"]}
                  </td>
                  <td className="px-4 py-3 text-right text-severity-blocking font-medium">
                    {r.healthCounts.Critical}
                  </td>
                  <td className="px-4 py-3 text-right text-severity-blocking font-mono">
                    {r.blockingCount}
                  </td>
                  <td className="px-4 py-3 text-right text-severity-action font-mono">
                    {r.actionCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Forecast confidence — per-opp A/B/C/D grade from SV Health + signal
         evidence vs AE forecast category. D-grade rows surface first so the
         manager sees overcommit risk before anything else. */}
      <ForecastConfidencePanel rows={forecastRows} />

      {/* Per-rep coaching brief — clusters CallTranscript.riskFlags into
         recurring themes per rep, recommends the highest-density risky call
         as a "review this" CTA. */}
      <CoachingBriefPanel briefs={coachingBriefs} />

      {/* Named accounts momentum — ranks strategic/enterprise accounts by
         recent external research-signal volume (P6: ABM motion). Pairs with
         the ABM_SHADOW_RESEARCH rule. */}
      <TopAccountsCard
        accounts={accounts}
        opportunities={opportunities}
        reps={reps}
      />

      {/* v1.5 note */}
      <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted leading-relaxed">
        <span className="font-semibold text-foreground">v1.5 roadmap:</span>{" "}
        task completion rate, action latency (time-from-signal-to-action), and
        deal velocity (stage age vs benchmark). All require persisting tasks
        server-side — currently localStorage in the Console. When tasks move to
        Supabase, this page is the natural surface.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard — local to this page; mirrors the visual language of the
// drawer/settings stat tiles without taking a dep on a shared component.
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "blocking" | "action" | "green";
}) {
  const valueColor =
    tone === "blocking"
      ? "text-severity-blocking"
      : tone === "action"
        ? "text-severity-action"
        : tone === "green"
          ? "text-severity-green"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tracking-tight", valueColor)}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
