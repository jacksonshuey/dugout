// /account/[slug] — the substrate surface. One account, full chronological
// timeline, every signal source unified, every signal citation-chain'd back
// to source_event_id. This is the click-through destination for citation
// chips from every other surface (drawer, console, /ask, manager, digest).
//
// Architecture:
//   - Next 16 server component. `params` is async per the Next 16 contract
//     (see node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-
//     and-pages.md and AGENTS.md "This is NOT the Next.js you know").
//   - Reads via the same `src/lib/*` helpers that back /api/account-context
//     (B3) — skipping the HTTP roundtrip per BUILD_ALIGNMENT principle #7
//     (server components prefer lib functions over self-fetch).
//   - Imports the SV Health Hero (U2) and Procurement Tracker (U3) via the
//     coordination contract names — those siblings own their files; this
//     page only renders them with the agreed prop shape.
//
// Layout, top to bottom (per the build brief):
//   1. Account header (brand-color band, name, domain, industry, segment,
//      owner of the most-advanced opp).
//   2. SV Health Score Hero — only when an SV/Contracting opp exists.
//   3. Open opportunities table.
//   4. Buying committee panel (grouped by role, engagement-coded).
//   5. Procurement tracker (SV/Contracting opps only).
//   6. External-context strip — news + SEC + newsletter, lifted out of the
//      timeline for visual prominence.
//   7. Unified signal timeline — every source, newest first, citation chips.
//
// Hard rules respected:
//   - No direct Supabase. Only `src/lib/*` helpers.
//   - Every signal in the timeline renders source_tool + source_event_id (or
//     "engine-derived" when source_event_id is null).
//   - severity/signal_type/direction values from the canonical sets only.
//   - Voice matches drawer.tsx / console.tsx. Plain language, no emojis in
//     alert copy, no exclamations.
//   - Demo data only (seed.ts via the lib helpers).

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  accounts,
  activities,
  assetDeliveries,
  calls,
  contacts as seedContacts,
  demoSignals,
  opportunities,
  reps,
} from "@/data/seed";
import { evaluateAll } from "@/lib/signal-engine";
import { computeSVHealthScore, type SVHealthScore } from "@/lib/sv-health";
import {
  getSignalsForAccount as getExternalSignalsForAccount,
  type ExternalSignal,
} from "@/lib/external-signals";
import {
  getMeetingSignalsForAccount,
  type MeetingSignalRow,
} from "@/lib/meeting-signals";
import { getIntegrationContext } from "@/lib/integration-context";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import type {
  Account,
  Activity,
  Contact,
  Opportunity,
  Stage,
} from "@/lib/types";
import {
  computeCorrelations,
  groupContactsByRole,
  unifyEngineSignal,
  unifyExternalSignal,
  unifyMeetingSignal,
  type ContactsByRole,
  type UnifiedSignal,
} from "@/lib/unify-signals";
import { SeverityBadge, StageBadge } from "@/components/ui";
import { cn, daysBetween, formatCurrency, formatDate } from "@/lib/utils";
import { SVHealthHero } from "@/components/sv-health-hero";
import { ProcurementTracker } from "@/components/procurement-tracker";
import { TimelineRow } from "./timeline-row";

// Force dynamic — this page reads workspace config + Supabase-backed signal
// stores and should never be statically prerendered. Mirrors the route handler.
export const dynamic = "force-dynamic";

// SV+ stages get the Hero + Procurement Tracker per metrics.md.
const SV_HEALTH_STAGES: Stage[] = ["Selected Vendor", "Contracting"];

const STAGE_RANK: Record<Stage, number> = {
  Intro: 0,
  Qualified: 1,
  "Demo Sat": 2,
  Evaluating: 3,
  "Selected Vendor": 4,
  Contracting: 5,
};

// External-context-eligible source tools — these get lifted out of the
// unified timeline into the "External context" strip for visual prominence.
const EXTERNAL_SOURCE_TOOLS = new Set([
  "newsapi",
  "sec_edgar",
  "newsletter",
  "claude_web_search",
  "demo",
  "manual",
]);

// ─── Page ───────────────────────────────────────────────────────────────

export default async function AccountPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const account = accounts.find((a) => a.id === slug);
  if (!account) {
    // notFound() renders the closest not-found.tsx; we lean on the global
    // 404 here. error.tsx handles thrown errors from the lib calls below.
    notFound();
  }

  const data = await loadAccountContext(account);

  const primarySVOpp = data.openOpportunities.find((o) =>
    SV_HEALTH_STAGES.includes(o.stage),
  );

  // Owner of the most-advanced opp (already sorted in loadAccountContext).
  const headlineOpp = data.openOpportunities[0];
  const headlineOwner = headlineOpp
    ? reps.find((r) => r.id === headlineOpp.ownerId)
    : undefined;

  // External-context strip: lift external-source signals out of the unified
  // timeline. The same rows still appear in the timeline below (which is
  // the complete chronological view); the strip is a curated highlight.
  const externalContextSignals = data.signals.filter((s) =>
    EXTERNAL_SOURCE_TOOLS.has(s.sourceTool),
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-8">
      {/* ─── Breadcrumb ────────────────────────────────────────────── */}
      <nav className="text-xs text-muted flex items-center gap-1.5">
        <Link href="/console" className="hover:text-foreground">
          Console
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground font-medium">{account.name}</span>
      </nav>

      {/* ─── Account header (brand-color band) ─────────────────────── */}
      <AccountHeader
        account={account}
        headlineOpp={headlineOpp}
        headlineOwnerName={headlineOwner?.name}
      />

      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-severity-action/20 bg-severity-action-bg/40 px-3 py-2 text-[11px] text-severity-action space-y-0.5">
          {data.warnings.map((w, i) => (
            <div key={i}>· {w}</div>
          ))}
        </div>
      )}

      {/* ─── SV Health Score Hero (U2) ─────────────────────────────── */}
      <SVHealthSection
        opportunity={primarySVOpp ?? null}
        score={data.svHealthScore}
      />

      {/* ─── Open opportunities table ──────────────────────────────── */}
      <OpenOpportunitiesSection
        opportunities={data.openOpportunities}
        contacts={data.contactsByRole}
      />

      {/* ─── Buying committee panel ────────────────────────────────── */}
      <BuyingCommitteeSection
        contactsByRole={data.contactsByRole}
        signals={data.signals}
        primaryOpp={headlineOpp ?? null}
      />

      {/* ─── Selected Vendor Procurement Tracker (U3) ──────────────── */}
      {primarySVOpp && (
        <section className="space-y-2">
          <SectionHeader
            label="Procurement tracker"
            sub={`${primarySVOpp.name} · ${primarySVOpp.stage}`}
          />
          <ProcurementTracker
            opportunity={primarySVOpp}
            contactsByRole={byRoleToFlatRecord(data.contactsByRole)}
            signals={data.signals}
            activities={data.activities.filter(
              (a) => a.oppId === primarySVOpp.id,
            )}
          />
        </section>
      )}

      {/* ─── External-context strip ────────────────────────────────── */}
      <ExternalContextStrip signals={externalContextSignals} />

      {/* ─── Unified signal timeline ───────────────────────────────── */}
      <UnifiedTimelineSection signals={data.signals} />

      {/* ─── Footer note: demo data marker ─────────────────────────── */}
      {account.isDemoScenario && (
        <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted leading-relaxed">
          <span className="font-semibold text-foreground">Demo scenario.</span>{" "}
          {account.name} is a real public company; the CRM data shown here
          (opportunities, contacts, transcripts, engineered signals) is
          illustrative. Live external signals (NewsAPI, SEC EDGAR, LinkedIn
          deep-links) run against the real underlying company.
        </div>
      )}
    </div>
  );
}

// ─── Data load (server-side, lib helpers only — principle #7) ───────────

type AccountContext = {
  account: Account;
  openOpportunities: Opportunity[];
  contactsByRole: ContactsByRole;
  signals: UnifiedSignal[];
  // Account-scoped activities, surfaced so per-opportunity surfaces like the
  // ProcurementTracker can light up milestone state (e.g. legal redline
  // received, SSO confirmed) without re-fetching the seed.
  activities: Activity[];
  svHealthScore: SVHealthScore | null;
  warnings: string[];
};

async function loadAccountContext(account: Account): Promise<AccountContext> {
  const warnings: string[] = [];

  const accountOpps = opportunities
    .filter((o) => o.accountId === account.id)
    .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0));

  const accountContacts = seedContacts.filter(
    (c) => c.accountId === account.id,
  );
  const contactsByRole = groupContactsByRole(accountContacts);

  // ── Source #1: signal-engine rules + hand-crafted demo signals ────────
  const workspace = await getWorkspaceConfig();
  const evaluatedSignals = evaluateAll({
    opportunities,
    accounts,
    contacts: seedContacts,
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
  });
  const oppToAccount = new Map(opportunities.map((o) => [o.id, o.accountId]));
  const demoForAccount = demoSignals.filter(
    (s) => oppToAccount.get(s.oppId) === account.id,
  );
  const engineSignals = [...evaluatedSignals, ...demoForAccount];

  // ── Source #2: external_signals (Supabase) — non-fatal ────────────────
  let externalSignals: ExternalSignal[] = [];
  try {
    externalSignals = await getExternalSignalsForAccount(account.id, 100);
  } catch (e) {
    warnings.push(
      `External signals unavailable: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // ── Source #3: meeting_signals (Granola via Supabase) — non-fatal ─────
  let meetingSignals: MeetingSignalRow[] = [];
  try {
    const ctx = await getIntegrationContext();
    meetingSignals = await getMeetingSignalsForAccount(
      account.id,
      ctx.workspaceKey,
      50,
    );
  } catch (e) {
    warnings.push(
      `Meeting signals unavailable: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  // ── Unify into one timeline; newest first. No window-filter here — the
  // full account page should show the long tail by default. Pagination
  // happens in the timeline component.
  const unified: UnifiedSignal[] = [];
  for (const s of engineSignals) {
    const u = unifyEngineSignal(s, oppToAccount, account.id);
    if (u) unified.push(u);
  }
  for (const s of externalSignals) unified.push(unifyExternalSignal(s));
  for (const s of meetingSignals) unified.push(unifyMeetingSignal(s));
  unified.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  // ── SV Health Score for the primary SV+ opp ───────────────────────────
  let svHealthScore: SVHealthScore | null = null;
  const svOpp = accountOpps.find((o) => SV_HEALTH_STAGES.includes(o.stage));
  if (svOpp) {
    const svContacts = accountContacts.filter((c) =>
      svOpp.contactRoleIds.includes(c.id),
    );
    const svEngineSignals = engineSignals.filter((s) => s.oppId === svOpp.id);
    try {
      svHealthScore = computeSVHealthScore({
        account,
        opportunity: svOpp,
        contacts: svContacts,
        signals: svEngineSignals,
        externalSignals,
      });
    } catch (e) {
      warnings.push(
        `SV Health unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Correlations computed but unused on the page today — the SV Hero (U2)
  // and the procurement tracker (U3) cite specific correlation patterns
  // (e.g. champion_disengagement across 3 sources). Left in scope for a
  // future "Patterns" section if the call for it lands.
  void computeCorrelations(unified);

  // Account-scoped activities — used by per-opp surfaces that need to
  // observe the raw activity log (e.g. ProcurementTracker milestone state).
  const accountOppIds = new Set(accountOpps.map((o) => o.id));
  const accountActivities = activities.filter((a) => accountOppIds.has(a.oppId));

  return {
    account,
    openOpportunities: accountOpps,
    contactsByRole,
    signals: unified,
    activities: accountActivities,
    svHealthScore,
    warnings,
  };
}

// ─── Header (brand band) ────────────────────────────────────────────────

function AccountHeader({
  account,
  headlineOpp,
  headlineOwnerName,
}: {
  account: Account;
  headlineOpp: Opportunity | undefined;
  headlineOwnerName: string | undefined;
}) {
  return (
    <header className="rounded-2xl bg-brand text-white px-6 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5 min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">
            Account
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {account.name}
          </h1>
          <div className="text-sm text-white/85 flex items-center gap-2 flex-wrap">
            {account.domain && <span>{account.domain}</span>}
            {account.domain && <span aria-hidden>·</span>}
            <span>{account.industry}</span>
            <span aria-hidden>·</span>
            <span>{account.segment}</span>
            <span aria-hidden>·</span>
            <span>{account.hqLocation}</span>
          </div>
        </div>
        <div className="text-right text-xs text-white/85 space-y-0.5 shrink-0">
          {headlineOpp ? (
            <>
              <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">
                Lead opportunity
              </div>
              <div className="text-sm font-medium text-white">
                {headlineOpp.name}
              </div>
              <div>
                {headlineOpp.stage} · {formatCurrency(headlineOpp.amount)}
              </div>
              {headlineOwnerName && <div>Owner · {headlineOwnerName}</div>}
            </>
          ) : (
            <div className="text-white/70 italic">No open opportunities</div>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── SV Health Section (U2 component or empty-state note) ───────────────

function SVHealthSection({
  opportunity,
  score,
}: {
  opportunity: Opportunity | null;
  score: SVHealthScore | null;
}) {
  if (!opportunity || !score) {
    return (
      <section className="space-y-2">
        <SectionHeader label="SV Health Score" />
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted italic">
          No active Selected-Vendor deal — health score not applicable.
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <SectionHeader label="SV Health Score" />
      <SVHealthHero opportunity={opportunity} score={score} />
    </section>
  );
}

// ─── Open opportunities table ───────────────────────────────────────────

function OpenOpportunitiesSection({
  opportunities,
  contacts,
}: {
  opportunities: Opportunity[];
  contacts: ContactsByRole;
}) {
  if (opportunities.length === 0) {
    return (
      <section className="space-y-2">
        <SectionHeader label="Open opportunities" />
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted italic">
          No open opportunities on this account.
        </div>
      </section>
    );
  }
  // Pull champion name as the "next next-step" proxy — the seed Opportunity
  // shape doesn't carry an explicit next_step field, so we surface the
  // champion's name as a stand-in. Schema proposal: add `nextStep` +
  // `nextStepDate` to Opportunity for v1.5.
  const champ = contacts.champion[0];
  return (
    <section className="space-y-2">
      <SectionHeader
        label="Open opportunities"
        sub={`${opportunities.length} active`}
      />
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted font-semibold">
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 font-semibold">
                Opportunity
              </th>
              <th className="text-left px-3 py-2 font-semibold">Stage</th>
              <th className="text-right px-3 py-2 font-semibold">Amount</th>
              <th className="text-right px-3 py-2 font-semibold">Days in stage</th>
              <th className="text-left px-3 py-2 font-semibold">Owner</th>
              <th className="text-left px-3 py-2 font-semibold">Champion</th>
              <th className="text-right px-3 py-2 font-semibold">Close</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((opp) => {
              const owner = reps.find((r) => r.id === opp.ownerId);
              const ageDays = daysBetween(opp.enteredStageAt);
              return (
                <tr
                  key={opp.id}
                  id={`opp-${opp.id}`}
                  className="border-b border-border last:border-0 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium">
                    <a
                      href={`#opp-${opp.id}`}
                      className="hover:text-brand"
                    >
                      {opp.name}
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge stage={opp.stage} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {formatCurrency(opp.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted">
                    {ageDays}d
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {owner?.name ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {champ?.name ?? (
                      <span className="text-severity-blocking">no champion</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted font-mono">
                    {formatDate(opp.closeDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Buying committee ───────────────────────────────────────────────────

// Engagement proxy: a contact is "engaged" if at least one signal in the
// last 14 days mentions them in its derived JSONB. v1 doesn't yet have
// per-contact attribution in the unified pipeline, so we fall back to a
// simpler heuristic — a contact counts as engaged if a signal of type
// `committee_expansion` or `momentum_change`+positive references their opp
// recently, AND silent if a `champion_disengagement` or `committee_gap`
// signal references their opp recently. When neither, status is shown as
// "no signal".
//
// This is a deliberate v1 proxy. Real per-contact engagement requires
// matching against meeting attendee lists + email recipient lists, which
// is out of scope for this page.
type EngagementStatus = "engaged" | "silent" | "no_signal";

function classifyContactEngagement(
  _contact: Contact,
  signals: UnifiedSignal[],
): EngagementStatus {
  const recent = signals.filter(
    (s) =>
      daysBetween(s.occurredAt) <= 14 &&
      (s.signalType === "champion_disengagement" ||
        s.signalType === "committee_gap" ||
        s.signalType === "committee_expansion" ||
        s.signalType === "momentum_change"),
  );
  if (recent.length === 0) return "no_signal";
  const negative = recent.some(
    (s) =>
      s.signalType === "champion_disengagement" ||
      s.signalType === "committee_gap" ||
      (s.signalType === "momentum_change" && s.direction === "negative"),
  );
  const positive = recent.some(
    (s) =>
      s.signalType === "committee_expansion" ||
      (s.signalType === "momentum_change" && s.direction === "positive"),
  );
  if (negative && !positive) return "silent";
  if (positive) return "engaged";
  return "no_signal";
}

const ROLE_LABEL: Record<keyof ContactsByRole, string> = {
  champion: "Champion",
  economic_buyer: "Executive Sponsor",
  finance: "Finance / CFO",
  it_security: "IT / Security",
  legal: "Legal",
  procurement: "Procurement",
  detractor: "Detractor",
  influencer: "Influencer",
  unknown: "Other",
};

// Required slots per SV Health spec. Missing one of these on an SV+ deal is
// what the "committee_gap" rule fires against.
const REQUIRED_ROLE_SLOTS: (keyof ContactsByRole)[] = [
  "champion",
  "economic_buyer",
  "finance",
  "it_security",
  "legal",
];

function BuyingCommitteeSection({
  contactsByRole,
  signals,
  primaryOpp,
}: {
  contactsByRole: ContactsByRole;
  signals: UnifiedSignal[];
  primaryOpp: Opportunity | null;
}) {
  const showMissingBadge =
    primaryOpp !== null &&
    (primaryOpp.stage === "Evaluating" ||
      primaryOpp.stage === "Selected Vendor" ||
      primaryOpp.stage === "Contracting");

  const orderedSlots: (keyof ContactsByRole)[] = [
    "champion",
    "economic_buyer",
    "finance",
    "it_security",
    "legal",
    "procurement",
    "influencer",
    "detractor",
    "unknown",
  ];

  return (
    <section className="space-y-2">
      <SectionHeader
        label="Buying committee"
        sub={
          showMissingBadge
            ? `Required at ${primaryOpp.stage} stage: Champion · Executive Sponsor · Finance · IT · Legal`
            : undefined
        }
      />
      <div className="rounded-xl border border-border bg-background divide-y divide-border">
        {orderedSlots.map((slot) => {
          const list = contactsByRole[slot];
          const isRequired = REQUIRED_ROLE_SLOTS.includes(slot);
          if (list.length === 0 && !isRequired) return null;
          return (
            <div key={slot} className="px-4 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-muted">
                  {ROLE_LABEL[slot]}
                </h3>
                {list.length === 0 && isRequired && showMissingBadge && (
                  <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-severity-blocking-bg text-severity-blocking border border-severity-blocking/20">
                    Missing
                  </span>
                )}
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-muted italic">
                  No contact on file for this role.
                </div>
              ) : (
                <ul className="space-y-1">
                  {list.map((c) => {
                    const status = classifyContactEngagement(c, signals);
                    return (
                      <li
                        key={c.id}
                        className="flex items-baseline gap-2 text-sm"
                      >
                        <EngagementDot status={status} />
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted">{c.title}</span>
                        {c.status === "departed" && (
                          <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-severity-blocking-bg text-severity-blocking border border-severity-blocking/20">
                            Departed
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EngagementDot({ status }: { status: EngagementStatus }) {
  const cls =
    status === "engaged"
      ? "bg-severity-green"
      : status === "silent"
        ? "bg-slate-400"
        : "bg-slate-200";
  const title =
    status === "engaged"
      ? "Engaged in the last 14 days"
      : status === "silent"
        ? "No recent activity"
        : "No signal in the last 14 days";
  return (
    <span
      className={cn("w-2 h-2 rounded-full shrink-0", cls)}
      title={title}
      aria-label={title}
    />
  );
}

// ─── External-context strip ─────────────────────────────────────────────

function ExternalContextStrip({ signals }: { signals: UnifiedSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <section className="space-y-2">
      <SectionHeader
        label="External context"
        sub={`${signals.length} event${signals.length === 1 ? "" : "s"} from news, SEC filings, and verticals`}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {signals.slice(0, 6).map((s) => (
          <article
            key={s.id}
            className="rounded-xl border border-border bg-background p-3 space-y-1.5"
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <SeverityBadge severity={s.severity} />
                <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border">
                  {sourceToolLabel(s.sourceTool)}
                </span>
              </div>
              <time className="text-[11px] text-muted font-mono">
                {formatDate(s.occurredAt)}
              </time>
            </div>
            <p className="text-sm leading-relaxed">{s.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─── Unified timeline ───────────────────────────────────────────────────

function UnifiedTimelineSection({ signals }: { signals: UnifiedSignal[] }) {
  if (signals.length === 0) {
    return (
      <section className="space-y-2">
        <SectionHeader label="Signal timeline" />
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted italic">
          No signals on this account in the lookback window.
        </div>
      </section>
    );
  }
  // First page only on the server — 30 rows per the brief. Future iteration:
  // wire URL-driven pagination (?page=2). The full row count is in the
  // section sub so the user knows how much is below the fold.
  const PAGE = 30;
  const firstPage = signals.slice(0, PAGE);
  return (
    <section className="space-y-2">
      <SectionHeader
        label="Signal timeline"
        sub={`${signals.length} signal${signals.length === 1 ? "" : "s"} · newest first${signals.length > PAGE ? ` · showing ${PAGE}` : ""}`}
      />
      <ol className="space-y-2">
        {firstPage.map((s) => (
          <TimelineRow key={s.id} signal={s} />
        ))}
      </ol>
      {signals.length > PAGE && (
        <div className="text-xs text-muted italic px-1">
          {signals.length - PAGE} earlier signal
          {signals.length - PAGE === 1 ? "" : "s"} not shown. Pagination ships
          in v1.1.
        </div>
      )}
    </section>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────

function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted font-mono">
        {label}
      </h2>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}

// Pretty-print the sourceTool string from the unified signal. Keep this in
// sync with the small set of known sources so unknown tools don't render as
// raw snake_case strings to the user.
function sourceToolLabel(tool: string): string {
  switch (tool) {
    case "signal_engine":
      return "Engine";
    case "newsapi":
      return "NewsAPI";
    case "sec_edgar":
      return "SEC EDGAR";
    case "newsletter":
      return "Newsletter";
    case "claude_web_search":
      return "Web search";
    case "granola":
      return "Granola";
    case "demo":
      return "Demo";
    case "manual":
      return "Manual";
    default:
      return tool;
  }
}

// ProcurementTracker expects contactsByRole as Record<string, Contact[]>;
// our internal ContactsByRole is a struct with the same shape. This
// adapter avoids re-typing on the U3 side.
function byRoleToFlatRecord(
  byRole: ContactsByRole,
): Record<string, Contact[]> {
  return {
    champion: byRole.champion,
    economic_buyer: byRole.economic_buyer,
    finance: byRole.finance,
    it_security: byRole.it_security,
    legal: byRole.legal,
    procurement: byRole.procurement,
    detractor: byRole.detractor,
    influencer: byRole.influencer,
    unknown: byRole.unknown,
  };
}
