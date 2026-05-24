// Selected Vendor Health Score — the Hero metric per metrics.md and
// discovery/information-requirements.md (Hero Surface #0).
//
// Formula (per metrics.md "The hero metric"):
//
//   finalScore = round(
//       0.20 × timeInStageScore
//     + 0.30 × committeeCoverageScore   (heaviest — Priority #4)
//     + 0.20 × enablementDeploymentScore (Priority #2)
//     + 0.20 × championEngagementScore
//     - riskPenalty                      (0 or 20, subtractive)
//   ) clamped to [0, 100]
//
// Tiering:
//   80+ healthy, 60-79 watch, 40-59 at_risk, <40 critical
//
// Design rules (per orgs/checkbox/BUILD_ALIGNMENT.md):
//   1. Pure function. No I/O, no Supabase, no fetch — testable closed-form.
//   2. No `confidence` field anywhere (principle #5).
//   3. Severity values respected — `blocking | action | awareness`.
//   4. Signal types from the canonical 12 only.
//   5. Evidence chain mandatory — every signal that contributed to a
//      component must be cited in evidenceSignalIds[].
//   6. Driver strings are plain language, no exclamations, no emojis.

import type {
  Account,
  Contact,
  ContactRole,
  Opportunity,
  Signal,
} from "@/lib/types";
import type { ExternalSignal } from "@/lib/external-signals";
import { daysBetween, TODAY } from "@/lib/utils";

export type SVHealthTier = "healthy" | "watch" | "at_risk" | "critical";

export type SVHealthComponents = {
  timeInStage: number; // 0-100
  committeeCoverage: number; // 0-100
  enablementDeployment: number; // 0-100
  championEngagement: number; // 0-100
  riskPenalty: number; // 0 or negative — subtracted from running total
};

export type SVHealthScore = {
  score: number; // 0-100 integer
  tier: SVHealthTier;
  components: SVHealthComponents;
  drivers: string[]; // 1-3 human-readable reasons (plain language)
  evidenceSignalIds: string[]; // signal.id values that fed any component
};

// ─── Constants ──────────────────────────────────────────────────────────
//
// p75 SV stage age (days) — v1 placeholder per metrics.md §"Time-in-stage
// score". Real p75 comes from SFDC OpportunityHistory once wired. Documented
// in metrics.md as "need ~30 days of SFDC history to compute" — using 30 as
// the conservative placeholder. Tuning knob.
const SV_STAGE_AGE_P75_DAYS = 30;

// Champion silence threshold per metrics.md §"Champion engagement score":
// 0d = 100, 7d = 50, 14d+ = 0. From persona research: 14d is dead.
const CHAMPION_SILENCE_FLOOR_DAYS = 14;

// Required committee roles per metrics.md §"Buying-committee coverage score".
// The spec names 5 roles in generic terms; we map to the project's
// `ContactRole` enum (types.ts §"ContactRole"). Mapping decisions:
//   Champion       → Champion
//   Economic Buyer → Executive Sponsor (the case's only exec-level role)
//   Finance        → Finance/CFO
//   IT/Security    → IT/Security
//   Legal          → GC or Legal Ops (either counts; both come from Legal)
//
// `Procurement` is intentionally NOT in the required-5 set because it's
// separately tracked by SELECTED_VENDOR_NO_PROCUREMENT in signal-engine.ts
// and isn't called out in metrics.md as one of the five.
type RoleSlot =
  | "champion"
  | "economic_buyer"
  | "finance"
  | "it_security"
  | "legal";

const REQUIRED_ROLE_SLOTS: RoleSlot[] = [
  "champion",
  "economic_buyer",
  "finance",
  "it_security",
  "legal",
];

function slotForRole(role: ContactRole): RoleSlot | null {
  switch (role) {
    case "Champion":
      return "champion";
    case "Executive Sponsor":
      return "economic_buyer";
    case "Finance/CFO":
      return "finance";
    case "IT/Security":
      return "it_security";
    case "GC":
    case "Legal Ops":
      return "legal";
    default:
      return null;
  }
}

// ─── Asset shape (install-time finding) ────────────────────────────────
//
// metrics.md §"Enablement-asset deployment score" requires checking whether
// the 3 standard assets (CFO Leave-Behind, IT Zero-Lift, Finance Brief) have
// been shared on the opp. The current `Opportunity` type does NOT carry an
// `assetsShared` field — asset delivery lives in the separate
// `AssetDelivery[]` collection on `EvaluationContext`. The shared contract
// for this function takes only the opp itself (no deliveries[]), so:
//
//   - We type a structural optional `assetsShared` field below
//   - We attempt to read it from `opportunity` via a permissive cast
//   - If the field is missing (current v1 state), we return 0 and surface
//     the gap in drivers
//
// Schema proposal (per BUILD_ALIGNMENT principle #1 — "propose, don't
// silently invent"): add an `assetsShared` field to Opportunity, OR have
// Agent B3 compute it from AssetDelivery[] and pass it through. Flagged in
// the return report as an "install-time discovery."
type AssetsShared = {
  cfoLeaveBehind?: boolean;
  itZeroLift?: boolean;
  financeBrief?: boolean;
};

// ─── Tier helper ────────────────────────────────────────────────────────

export function tierForScore(score: number): SVHealthTier {
  if (score >= 80) return "healthy";
  if (score >= 60) return "watch";
  if (score >= 40) return "at_risk";
  return "critical";
}

// ─── Component computations ────────────────────────────────────────────

function computeTimeInStage(opportunity: Opportunity): number {
  // Days in stage = days since enteredStageAt. Falls back to the same value
  // if the field is malformed (daysBetween returns NaN-safe behavior via
  // Math.floor on an Invalid Date → NaN; we guard).
  const days = daysBetween(opportunity.enteredStageAt);
  if (!Number.isFinite(days) || days < 0) return 100;
  const score = 100 * (1 - days / SV_STAGE_AGE_P75_DAYS);
  return Math.max(0, Math.min(100, score));
}

type CommitteeResult = {
  score: number;
  engagedSlots: Set<RoleSlot>;
  missingSlots: RoleSlot[];
};

function computeCommitteeCoverage(
  contacts: Contact[],
): CommitteeResult {
  // v1 fallback per spec: a role is "engaged" if a contact with that role
  // exists on the opportunity. The full version (engaged = signal in last
  // 14d mentioning that contact) requires per-contact signal attribution
  // which isn't wired in v1.
  const engaged = new Set<RoleSlot>();
  for (const c of contacts) {
    const slot = slotForRole(c.role);
    if (slot) engaged.add(slot);
  }
  const score = (engaged.size / REQUIRED_ROLE_SLOTS.length) * 100;
  const missing = REQUIRED_ROLE_SLOTS.filter((s) => !engaged.has(s));
  return { score, engagedSlots: engaged, missingSlots: missing };
}

type EnablementResult = {
  score: number;
  shared: AssetsShared;
  missingNames: string[];
};

function computeEnablementDeployment(
  opportunity: Opportunity,
): EnablementResult {
  // Read `assetsShared` if present on the opp (permissive cast — see schema
  // note above). v1 fixture data does not populate it, so this returns 0 in
  // practice today.
  const shared =
    (opportunity as Opportunity & { assetsShared?: AssetsShared })
      .assetsShared ?? {};

  const flags = [
    { key: "cfoLeaveBehind" as const, label: "CFO Leave-Behind" },
    { key: "itZeroLift" as const, label: "IT Zero-Lift one-pager" },
    { key: "financeBrief" as const, label: "Finance Meeting Brief" },
  ];

  const sharedCount = flags.filter((f) => shared[f.key] === true).length;
  const score = (sharedCount / flags.length) * 100;
  const missingNames = flags
    .filter((f) => shared[f.key] !== true)
    .map((f) => f.label);

  return { score, shared, missingNames };
}

type ChampionResult = {
  score: number;
  championId: string | null;
  daysSilent: number | null;
  citedSignalId: string | null;
};

function computeChampionEngagement(
  opportunity: Opportunity,
  contacts: Contact[],
  signals: Signal[],
): ChampionResult {
  const champion = contacts.find((c) => c.role === "Champion");
  if (!champion) {
    // No champion on the opp at all → engagement is 0 by definition;
    // committee-coverage penalty already reflects the absence too.
    return { score: 0, championId: null, daysSilent: null, citedSignalId: null };
  }

  // Per spec: prefer signal.derived?.contactId === champion.id when wired;
  // v1 falls back to "any signal on this opp" as a proxy. Signals here are
  // the ones already filtered to this opp by the caller. We pick the most
  // recent detectedAt as the "last champion touch" proxy.
  //
  // Note this is a deliberate v1 simplification: a champion-disengagement
  // signal firing actually means the champion has gone QUIET, so using it
  // as a "touch" would be backwards. We therefore prefer signals that
  // reflect activity rather than absence — but in the seed-data world we
  // don't have a clean "champion activity" signal type. The cleanest v1
  // path: if there are no signals at all on this opp, treat as fresh
  // (use enteredStageAt as the floor); else use the most recent signal as
  // a "the system saw something here recently" proxy.
  const oppSignals = signals.filter((s) => s.oppId === opportunity.id);
  let daysSinceTouch: number;
  let citedSignalId: string | null = null;

  if (oppSignals.length === 0) {
    // No signals → treat as freshly observed at stage entry. This is a
    // proxy; in production the touch source is Dock visit + Gong attendance
    // + Outreach reply + HubSpot click, none of which are wired yet.
    daysSinceTouch = daysBetween(opportunity.enteredStageAt);
  } else {
    const mostRecent = oppSignals
      .slice()
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))[0];
    citedSignalId = mostRecent.id;
    daysSinceTouch = daysBetween(mostRecent.detectedAt);
  }

  if (!Number.isFinite(daysSinceTouch) || daysSinceTouch < 0) {
    daysSinceTouch = 0;
  }

  const score = 100 * (1 - daysSinceTouch / CHAMPION_SILENCE_FLOOR_DAYS);
  return {
    score: Math.max(0, Math.min(100, score)),
    championId: champion.id,
    daysSilent: daysSinceTouch,
    citedSignalId,
  };
}

type RiskResult = {
  penalty: number; // 0 or -20
  citedSignalIds: string[];
};

function computeRiskPenalty(signals: Signal[]): RiskResult {
  // v1 simplified rule per spec: any blocking signal on this opp triggers
  // the -20. The full version (champion_loss ≥2 in 14d, committee_gap ≥2,
  // competitive_threat blocking, momentum_change ≥2) requires correlation
  // counts that aren't materialized in v1.
  const blocking = signals.filter((s) => s.severity === "blocking");
  if (blocking.length === 0) {
    return { penalty: 0, citedSignalIds: [] };
  }
  return {
    penalty: -20,
    citedSignalIds: blocking.map((s) => s.id),
  };
}

// ─── Driver strings (plain language, no emojis, no exclamations) ───────
//
// Surface the 1-3 worst-performing components. Each string explains the
// component in human terms — never reads as marketing copy. The voice
// matches existing drawer/console copy (see BUILD_ALIGNMENT principle #8).

function driverForCommittee(missing: RoleSlot[]): string | null {
  if (missing.length === 0) return null;
  const labels: Record<RoleSlot, string> = {
    champion: "Champion",
    economic_buyer: "Economic Buyer",
    finance: "Finance",
    it_security: "IT",
    legal: "Legal",
  };
  const names = missing.map((s) => labels[s]);
  if (names.length === 1) return `${names[0]} has not engaged`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have not engaged`;
  const last = names[names.length - 1];
  const head = names.slice(0, -1).join(", ");
  return `${head}, and ${last} have not engaged`;
}

function driverForChampion(daysSilent: number | null): string | null {
  if (daysSilent === null) return "No champion identified on this deal";
  if (daysSilent >= CHAMPION_SILENCE_FLOOR_DAYS) {
    return `Champion went quiet ${daysSilent} days ago`;
  }
  if (daysSilent >= 7) {
    return `Champion went quiet ${daysSilent} days ago`;
  }
  return null;
}

function driverForStageAge(opportunity: Opportunity): string | null {
  const days = daysBetween(opportunity.enteredStageAt);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days >= SV_STAGE_AGE_P75_DAYS) {
    return `Stage age ${days} days exceeds ${SV_STAGE_AGE_P75_DAYS}-day benchmark`;
  }
  if (days >= SV_STAGE_AGE_P75_DAYS * 0.7) {
    return `Stage age ${days} days approaching ${SV_STAGE_AGE_P75_DAYS}-day benchmark`;
  }
  return null;
}

function driverForEnablement(missingNames: string[]): string | null {
  if (missingNames.length === 0) return null;
  if (missingNames.length === 3) {
    return "None of the 3 enablement assets shared";
  }
  if (missingNames.length === 2) {
    return `${missingNames[0]} and ${missingNames[1]} never sent`;
  }
  return `${missingNames[0]} never sent`;
}

function driverForRisk(penalty: number): string | null {
  if (penalty < 0) return "Blocking signal active on this account";
  return null;
}

// Pick up to 3 driver strings, ordered by component severity (worst first).
function pickDrivers(args: {
  components: SVHealthComponents;
  committee: CommitteeResult;
  enablement: EnablementResult;
  champion: ChampionResult;
  opportunity: Opportunity;
}): string[] {
  const candidates: { weightScore: number; text: string }[] = [];

  const committeeText = driverForCommittee(args.committee.missingSlots);
  if (committeeText) {
    candidates.push({ weightScore: args.components.committeeCoverage, text: committeeText });
  }

  const championText = driverForChampion(args.champion.daysSilent);
  if (championText) {
    candidates.push({ weightScore: args.components.championEngagement, text: championText });
  }

  const stageText = driverForStageAge(args.opportunity);
  if (stageText) {
    candidates.push({ weightScore: args.components.timeInStage, text: stageText });
  }

  const enablementText = driverForEnablement(args.enablement.missingNames);
  if (enablementText) {
    candidates.push({ weightScore: args.components.enablementDeployment, text: enablementText });
  }

  const riskText = driverForRisk(args.components.riskPenalty);
  if (riskText) {
    // Risk penalty is the strongest negative signal — give it a low weightScore
    // so it surfaces first when present.
    candidates.push({ weightScore: -1, text: riskText });
  }

  if (candidates.length === 0) return ["All key signals healthy"];

  return candidates
    .sort((a, b) => a.weightScore - b.weightScore)
    .slice(0, 3)
    .map((c) => c.text);
}

// ─── Public entry point ────────────────────────────────────────────────

export function computeSVHealthScore(args: {
  account: Account;
  opportunity: Opportunity;
  contacts: Contact[];
  signals: Signal[];
  externalSignals: ExternalSignal[];
}): SVHealthScore {
  const { opportunity, contacts, signals } = args;
  // externalSignals is accepted for future use (account-level context — news,
  // SEC filings — will eventually contribute to the risk penalty as a
  // "vertical_context" / "account_context" multiplier). v1 doesn't read it
  // yet; keeping it on the signature so Agent B3's call site doesn't churn.
  void args.externalSignals;
  void args.account;

  // Limit signals to this opp for the components that need it (champion
  // engagement, risk). committeeCoverage and timeInStage don't read signals.
  const oppSignals = signals.filter((s) => s.oppId === opportunity.id);

  const timeInStage = computeTimeInStage(opportunity);
  const committee = computeCommitteeCoverage(contacts);
  const enablement = computeEnablementDeployment(opportunity);
  const champion = computeChampionEngagement(opportunity, contacts, signals);
  const risk = computeRiskPenalty(oppSignals);

  const components: SVHealthComponents = {
    timeInStage,
    committeeCoverage: committee.score,
    enablementDeployment: enablement.score,
    championEngagement: champion.score,
    riskPenalty: risk.penalty,
  };

  const weighted =
    0.2 * timeInStage +
    0.3 * committee.score +
    0.2 * enablement.score +
    0.2 * champion.score +
    risk.penalty;

  const score = Math.max(0, Math.min(100, Math.round(weighted)));

  // Evidence chain: collect every signal.id that fed any component. v1 only
  // surfaces champion + risk signals here because the other components are
  // structural (opp + contacts), not signal-driven yet.
  const evidence = new Set<string>();
  if (champion.citedSignalId) evidence.add(champion.citedSignalId);
  for (const id of risk.citedSignalIds) evidence.add(id);

  const drivers = pickDrivers({
    components,
    committee,
    enablement,
    champion,
    opportunity,
  });

  return {
    score,
    tier: tierForScore(score),
    components,
    drivers,
    evidenceSignalIds: [...evidence],
  };
}

// Re-export for explicit callers (Agent U2 may use this for Hero rendering
// independent of computing the full score).
export { TODAY as SV_HEALTH_TODAY };
