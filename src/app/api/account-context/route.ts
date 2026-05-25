import { NextResponse } from "next/server";
import {
  accounts,
  accountsById,
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
import { requireUiSession } from "@/lib/ui-auth-server";
import type { Account, Opportunity, Stage } from "@/lib/types";
import {
  computeCorrelations,
  groupContactsByRole,
  unifyEngineSignal,
  unifyExternalSignal,
  unifyMeetingSignal,
  type ContactsByRole,
  type Correlation,
  type UnifiedSignal,
} from "@/lib/unify-signals";

// /api/account-context - the unified per-account read endpoint that powers
// the drawer timeline (U1), Hero #0 SV Health card (U2), and `/ask` agent
// (U4). Mirrors the `get_account_context` tool defined in synthesis.md
// "The AI query layer".
//
// Responsibilities:
//   1. Resolve the account from the seed - fail 404 if unknown.
//   2. Collect open opportunities + contacts grouped by canonical role slot.
//   3. Unify 3 signal sources (signal-engine, external_signals, meeting_signals)
//      into one chronological timeline with canonical signal_type values.
//   4. Compute the SV Health Score for the primary SV+ opportunity (B1 helper).
//   5. Correlate: group unified signals by signal_type, emit a correlation
//      row when ≥2 distinct source_tools agree. Elevate severity per
//      synthesis.md "The wedge, restated".
//
// Hard rules (per BUILD_ALIGNMENT.md):
//   - Auth-gated (#7). Read-only (#9). No POST/PATCH/DELETE.
//   - signal_type values from the canonical 12 only (#2).
//   - severity ∈ {blocking, action, awareness} only (#3).
//   - direction ∈ {negative, positive, neutral} only (#4).
//   - Every signal carries source_tool + source_event_id (#6).
//   - Every correlation carries signalIds[] (#6).
//   - No `confidence` column anywhere (#5).
//   - Failure of any optional source (external_signals, meeting_signals) is
//     non-fatal - the endpoint still returns whatever it could collect and
//     surfaces the error in `warnings[]`.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Response shape ─────────────────────────────────────────────────────

type AccountContextResponse = {
  account: Account;
  openOpportunities: Opportunity[];
  contactsByRole: ContactsByRole;
  signals: UnifiedSignal[];
  svHealthScore: SVHealthScore | null;
  correlations: Correlation[];
  warnings: string[];
};

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const SIGNAL_CAP = 200;

// SV+ stages get an SV Health Score per metrics.md. Earlier stages return
// null - B1's contract leaves the gating decision to the caller.
const SV_HEALTH_STAGES: Stage[] = ["Selected Vendor", "Contracting"];

const STAGE_RANK: Record<Stage, number> = {
  Intro: 0,
  Qualified: 1,
  "Demo Sat": 2,
  Evaluating: 3,
  "Selected Vendor": 4,
  Contracting: 5,
};

function stageRank(s: Stage): number {
  return STAGE_RANK[s] ?? 0;
}

function withinWindow(iso: string, sinceMs: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= sinceMs;
}

// ─── Route ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account");
  if (!accountId) {
    return NextResponse.json({ error: "Missing account" }, { status: 400 });
  }

  const rawDays = searchParams.get("days");
  const parsedDays = rawDays === null ? DEFAULT_DAYS : Number(rawDays);
  const days =
    Number.isFinite(parsedDays) && parsedDays > 0
      ? Math.min(MAX_DAYS, Math.floor(parsedDays))
      : DEFAULT_DAYS;

  const account = accountsById.get(accountId);
  if (!account) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }

  const warnings: string[] = [];

  // Opportunities for this account. The seed has no isOpen flag; every
  // seeded opp is in flight, so we treat them all as open. When SFDC is
  // wired, swap to filter on stage !== Closed Won/Lost. Sorted by stage
  // (later stages first) so SV+ surfaces at the top for the Hero render.
  const accountOpps = opportunities
    .filter((o) => o.accountId === accountId)
    .sort((a, b) => stageRank(b.stage) - stageRank(a.stage));

  // Contacts on this account, grouped by canonical role slot.
  const accountContacts = seedContacts.filter((c) => c.accountId === accountId);
  const contactsByRole = groupContactsByRole(accountContacts);

  // ── Source #1: signal-engine rules ────────────────────────────────────
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

  // Hand-crafted demo signals (orgs/_default/discovery/information-requirements.md
  // demo scenarios) merge into the engine stream so the cross-source
  // correlations B2 authored - e.g., the 3-source champion_disengagement on
  // the critical scenario - actually surface in the API response. Each
  // demoSignal already carries a real sourceTool + sourceEventId for the
  // citation chain; treating them as engine-tier signals keeps the unified
  // payload shape consistent. Remove this merge when real adapter pipelines
  // (Dock + Outreach + Gong) land and produce these signals natively.
  const demoForAccount = demoSignals.filter(
    (s) => oppToAccount.get(s.oppId) === accountId,
  );
  const engineSignals = [...evaluatedSignals, ...demoForAccount];

  // ── Source #2: external_signals (Supabase) ────────────────────────────
  let externalSignals: ExternalSignal[] = [];
  try {
    externalSignals = await getExternalSignalsForAccount(accountId, 100);
  } catch (e) {
    warnings.push(
      `external_signals unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ── Source #3: meeting_signals (Granola via Supabase) ─────────────────
  let meetingSignals: MeetingSignalRow[] = [];
  try {
    const ctx = await getIntegrationContext();
    meetingSignals = await getMeetingSignalsForAccount(
      accountId,
      ctx.workspaceKey,
      50,
    );
  } catch (e) {
    warnings.push(
      `meeting_signals unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ── Unify, window-filter, cap ─────────────────────────────────────────
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const unified: UnifiedSignal[] = [];
  for (const s of engineSignals) {
    const u = unifyEngineSignal(s, oppToAccount, accountId);
    if (u && withinWindow(u.occurredAt, sinceMs)) unified.push(u);
  }
  for (const s of externalSignals) {
    const u = unifyExternalSignal(s);
    if (withinWindow(u.occurredAt, sinceMs)) unified.push(u);
  }
  for (const s of meetingSignals) {
    const u = unifyMeetingSignal(s);
    if (withinWindow(u.occurredAt, sinceMs)) unified.push(u);
  }

  // Newest first; cap to 200 for the UI payload.
  unified.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const cappedSignals = unified.slice(0, SIGNAL_CAP);

  // Correlations run on the full windowed (uncapped) set - multi-source
  // agreements might live in the long tail.
  const correlations = computeCorrelations(unified);

  // ── SV Health Score for the primary SV+ opp ───────────────────────────
  let svHealthScore: SVHealthScore | null = null;
  const svOpp = accountOpps.find((o) => SV_HEALTH_STAGES.includes(o.stage));
  if (svOpp) {
    const svContacts = accountContacts.filter((c) =>
      svOpp.contactRoleIds.includes(c.id),
    );
    // B1's contract takes engine Signal[] only. External + meeting signals
    // are passed through for future risk-penalty multipliers (the v1 helper
    // ignores them).
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
        `sv_health unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const body: AccountContextResponse = {
    account,
    openOpportunities: accountOpps,
    contactsByRole,
    signals: cappedSignals,
    svHealthScore,
    correlations,
    warnings,
  };

  return NextResponse.json(body);
}
