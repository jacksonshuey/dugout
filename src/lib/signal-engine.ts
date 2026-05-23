import {
  STAGE_AGE_BENCHMARK_DAYS,
  type DealHealth,
  type EvaluationContext,
  type Opportunity,
  type Signal,
  type SignalRule,
} from "./types";
import { daysBetween, TODAY } from "./utils";

// ---------------------------------------------------------------------------
// Signal Engine — deterministic rules
//
// Design notes worth defending in an interview:
//
// 1. SEVERITY IS THE PRODUCT. Every signal has a tier — blocking, action,
//    awareness — and the tier dictates routing (Slack DM, morning digest,
//    weekly roundup). This is the answer to "how do you avoid noise."
//    No tier = no signal ships.
//
// 2. EVERY RULE MAPS TO A STRATEGIC PRIORITY. We don't invent new GTM
//    objectives. Each rule's `strategicPriority` field traces back to one
//    of the 6 priorities in the case context. Anything that doesn't map
//    doesn't ship.
//
// 3. RULES ARE PURE FUNCTIONS. Each rule reads the EvaluationContext and
//    returns 0..N signals. This makes them trivial to test, A/B, and tune
//    thresholds for. The Signal Studio (NL → rule) emits code into this
//    shape — no special runtime needed.
//
// 4. DETERMINISTIC FIRST, LLM SECOND. ~90% of useful signals are deterministic
//    rules over structured CRM data. We use the LLM where it earns its keep:
//    (a) synthesizing the morning digest narrative, (b) sentiment over call
//    transcripts, (c) NL → rule authoring. Not for things rules handle better.
// ---------------------------------------------------------------------------

function ageInStage(opp: Opportunity): number {
  return daysBetween(opp.enteredStageAt);
}

function hasContactRole(
  opp: Opportunity,
  ctx: EvaluationContext,
  role: string,
): boolean {
  return opp.contactRoleIds.some(
    (cid) => ctx.contacts.find((c) => c.id === cid)?.role === role,
  );
}

function hasAsset(
  opp: Opportunity,
  ctx: EvaluationContext,
  asset: string,
): boolean {
  return ctx.deliveries.some(
    (d) => d.oppId === opp.id && d.asset === asset && d.deliveredAt,
  );
}

function lastChampionActivityDays(
  opp: Opportunity,
  ctx: EvaluationContext,
): number | null {
  const champion = opp.contactRoleIds
    .map((cid) => ctx.contacts.find((c) => c.id === cid))
    .find((c) => c?.role === "Champion");
  if (!champion) return null;
  const champActs = ctx.activities
    .filter((a) => a.oppId === opp.id && a.contactId === champion.id)
    .filter(
      (a) =>
        a.type === "email_received" ||
        a.type === "dock_visit" ||
        a.type === "call" ||
        a.type === "meeting",
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  if (champActs.length === 0) return null;
  return daysBetween(champActs[0].occurredAt);
}

function ruleId(prefix: string, oppId: string): string {
  return `${prefix}:${oppId}`;
}

// Look up an asset's display name from workspace config; fall back to a
// readable default so signals always have a sane message even with no config.
function assetName(
  ctx: EvaluationContext,
  id: string,
  fallback: string,
): string {
  const found = ctx.config?.assets.find((a) => a.id === id);
  return found?.name ?? fallback;
}

// Wrap an asset name with the configured deal-room name in parens.
function assetLink(
  ctx: EvaluationContext,
  id: string,
  fallback: string,
): string {
  const room = ctx.config?.stack.dealRooms ?? "Dock";
  return `${assetName(ctx, id, fallback)} (${room})`;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ruleSelectedVendorNoFinance: SignalRule = {
  id: "SELECTED_VENDOR_NO_FINANCE",
  name: "Selected Vendor without Finance contact",
  description:
    "Deal is at the budget-approval gate without a Finance/CFO contact on the OCR. Per case data, this is the stage where deals die.",
  severity: "blocking",
  strategicPriority: "P4",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Selected Vendor" &&
          !hasContactRole(o, ctx, "Finance/CFO"),
      )
      .map((o) => ({
        id: ruleId("SELECTED_VENDOR_NO_FINANCE", o.id),
        ruleId: "SELECTED_VENDOR_NO_FINANCE",
        oppId: o.id,
        severity: "blocking",
        // Finance persona absent from a buying committee — canonical committee_gap.
        signalType: "committee_gap",
        title: "Finance gate unmanned",
        body: "Deal is at Selected Vendor without a Finance contact identified. Budget approval is the most common kill point at this stage.",
        suggestedAction: `Send the ${assetName(ctx, "cfo_leave_behind", "CFO Leave-Behind")} to your champion today and ask for a Finance intro by EOW.`,
        assetLink: assetLink(ctx, "cfo_leave_behind", "CFO Leave-Behind"),
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleSelectedVendorNoProcurement: SignalRule = {
  id: "SELECTED_VENDOR_NO_PROCUREMENT",
  name: "Selected Vendor without Procurement contact",
  description:
    "Selected Vendor stage without a Procurement contact on the OCR. Contracting will stall when paperwork hits an unprepared procurement team.",
  severity: "blocking",
  strategicPriority: "P4",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Selected Vendor" &&
          !hasContactRole(o, ctx, "Procurement"),
      )
      .map((o) => ({
        id: ruleId("SELECTED_VENDOR_NO_PROCUREMENT", o.id),
        ruleId: "SELECTED_VENDOR_NO_PROCUREMENT",
        oppId: o.id,
        severity: "blocking",
        // Procurement persona absent — canonical committee_gap.
        signalType: "committee_gap",
        title: "Procurement not engaged",
        body: "No Procurement contact on this deal. Once paperwork starts, you need a named procurement lead or you'll wait weeks for triage.",
        suggestedAction:
          "Ask your champion for the procurement contact this week — frame as 'making the contracting phase fast for both sides.'",
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleNoFinanceAtEvaluating: SignalRule = {
  id: "NO_FINANCE_AT_EVALUATING",
  name: "Evaluating without Finance contact",
  description:
    "Strategic priority #4: surface bottom-of-funnel blockers at the top of the funnel. Get Finance involved BEFORE Selected Vendor, not after.",
  severity: "action",
  strategicPriority: "P4",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Evaluating" &&
          !hasContactRole(o, ctx, "Finance/CFO"),
      )
      .map((o) => ({
        id: ruleId("NO_FINANCE_AT_EVALUATING", o.id),
        ruleId: "NO_FINANCE_AT_EVALUATING",
        oppId: o.id,
        severity: "action",
        // Finance persona absent earlier in the funnel — same canonical type
        // as the Selected Vendor variant; severity is the difference.
        signalType: "committee_gap",
        title: "No Finance contact on Evaluating deal",
        body: "You're at Evaluating with no Finance contact. We know deals die at Selected Vendor budget approval — this is when to fix it.",
        suggestedAction: `Send the ${assetName(ctx, "finance_meeting_brief", "Finance Meeting Brief")} to your champion today and request a 30-min intro to Finance this week.`,
        assetLink: assetLink(ctx, "finance_meeting_brief", "Finance Meeting Brief"),
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleNoITAtEvaluating: SignalRule = {
  id: "NO_IT_AT_EVALUATING",
  name: "Evaluating without IT/Security contact",
  description:
    "Strategic priority #4. IT/Security reviews are a known multi-week unlock; getting them started during Evaluating de-risks Contracting timing.",
  severity: "action",
  strategicPriority: "P4",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Evaluating" &&
          !hasContactRole(o, ctx, "IT/Security"),
      )
      .map((o) => ({
        id: ruleId("NO_IT_AT_EVALUATING", o.id),
        ruleId: "NO_IT_AT_EVALUATING",
        oppId: o.id,
        severity: "action",
        // IT/Security persona absent — canonical committee_gap.
        signalType: "committee_gap",
        title: "No IT/Security contact on Evaluating deal",
        body: "IT review averages 2–4 weeks. If it hasn't started yet, you'll lose that time at Contracting.",
        suggestedAction: `Send the ${assetName(ctx, "it_zero_lift_one_pager", "IT Zero-Lift One-Pager")} to your champion and ask them to forward to their IT/Security lead.`,
        assetLink: assetLink(ctx, "it_zero_lift_one_pager", "IT Zero-Lift One-Pager"),
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleNoTrialBriefAtDemoSat: SignalRule = {
  id: "NO_TRIAL_BRIEF_AT_DEMO_SAT",
  name: "Demo Sat without outcome-first trial brief",
  description:
    "Strategic priority #1 (the case's 'highest-leverage change available in H1'). Every Evaluating+ deal should have a trial brief delivered before the next meeting.",
  severity: "action",
  strategicPriority: "P1",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Demo Sat" &&
          !hasAsset(o, ctx, "outcome_first_trial_brief"),
      )
      .map((o) => ({
        id: ruleId("NO_TRIAL_BRIEF_AT_DEMO_SAT", o.id),
        ruleId: "NO_TRIAL_BRIEF_AT_DEMO_SAT",
        oppId: o.id,
        severity: "action",
        // Awkward fit: this is a playbook-step gap, not a clean fit for any of
        // the 12 types. Closest is momentum_change (negative direction) —
        // missing the trial brief stalls the deal's forward motion. Not
        // data_hygiene_gap, which is specifically about structured deal
        // metadata (MEDDPICC fields), not playbook execution.
        signalType: "momentum_change",
        title: "No outcome-first trial brief delivered",
        body: `Per company playbook, every Demo Sat deal should have an ${assetName(ctx, "outcome_first_trial_brief", "outcome-first trial brief")} in place before the next meeting. This one doesn't.`,
        suggestedAction: `Request intake from your champion today. SE will return ${assetName(ctx, "kpi_assessment", "KPI Assessment")} + ${assetName(ctx, "pre_seeded_demo", "pre-seeded demo")} in 48 hours.`,
        assetLink: "Trigger SE Intake",
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleSingleThreadRisk: SignalRule = {
  id: "SINGLE_THREAD_RISK",
  name: "Single-thread risk on Evaluating+ deal",
  description:
    "Strategic priority #5 (sales motion maturity — multithreading is the focus area). Only one contact role attached to a meaningful-stage deal.",
  severity: "action",
  strategicPriority: "P5",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          (o.stage === "Evaluating" ||
            o.stage === "Selected Vendor" ||
            o.stage === "Contracting") &&
          o.contactRoleIds.length === 1,
      )
      .map((o) => ({
        id: ruleId("SINGLE_THREAD_RISK", o.id),
        ruleId: "SINGLE_THREAD_RISK",
        oppId: o.id,
        severity: "action",
        // Only one contact role on a buying-stage deal — the broader buying
        // committee is missing. Canonical committee_gap.
        signalType: "committee_gap",
        title: "Single-thread risk",
        body: "Only one contact on this deal. If your champion leaves or goes quiet, the deal goes with them.",
        suggestedAction:
          "Identify a second stakeholder this week — Legal Ops or GC are the highest-leverage adds.",
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleStageAgeExceeded: SignalRule = {
  id: "STAGE_AGE_EXCEEDED",
  name: "Deal aged past stage benchmark",
  description:
    "Standard pipeline hygiene. Stage age > benchmark suggests either an unaddressed blocker or a forecast accuracy gap.",
  severity: "action",
  strategicPriority: "P5",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter((o) => ageInStage(o) > STAGE_AGE_BENCHMARK_DAYS[o.stage])
      .map((o) => {
        const age = ageInStage(o);
        const bench = STAGE_AGE_BENCHMARK_DAYS[o.stage];
        return {
          id: ruleId("STAGE_AGE_EXCEEDED", o.id),
          ruleId: "STAGE_AGE_EXCEEDED",
          oppId: o.id,
          severity: "action" as const,
          // Stage slipping past benchmark = canonical momentum_change
          // (negative direction in the persistent schema).
          signalType: "momentum_change" as const,
          title: `${age} days in ${o.stage} (benchmark: ${bench})`,
          body: `This deal has been in ${o.stage} for ${age} days — ${age - bench} days past benchmark. Either there's a blocker we haven't named, or the stage is wrong.`,
          suggestedAction:
            "Get on a 15-min call with your champion to name the specific blocker. If you can't name it, update the stage to reflect reality.",
          detectedAt: TODAY.toISOString(),
        };
      }),
};

const ruleDemoNotBooked: SignalRule = {
  id: "DEMO_NOT_BOOKED",
  name: "Qualified champion without demo booked",
  description:
    "Champion identified at Qualified but no Demo Sat activity in the last 7 days. Conversion at this hop is 37% — slippage is expensive.",
  severity: "action",
  strategicPriority: "P5",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          o.stage === "Qualified" && hasContactRole(o, ctx, "Champion"),
      )
      .filter((o) => {
        const recentMeeting = ctx.activities.find(
          (a) =>
            a.oppId === o.id &&
            a.type === "meeting" &&
            daysBetween(a.occurredAt) <= 7,
        );
        return !recentMeeting;
      })
      .map((o) => ({
        id: ruleId("DEMO_NOT_BOOKED", o.id),
        ruleId: "DEMO_NOT_BOOKED",
        oppId: o.id,
        severity: "action" as const,
        // No next-step meeting committed at a stage that needs one = canonical
        // momentum_change (negative direction).
        signalType: "momentum_change" as const,
        title: "Champion identified but no demo booked",
        body: "You have a champion but no demo on the calendar in the next 7 days. The Intro → Qualified hop is already a 37% step — don't let momentum die here.",
        suggestedAction:
          "Send Chili Piper link directly to champion today. Offer 3 specific time windows.",
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleAssetGapFinance: SignalRule = {
  id: "ASSET_GAP_FINANCE",
  name: "Finance contact exists but Finance brief not sent",
  description:
    "Strategic priority #2 — the assets exist; the work is adoption. If a Finance contact is on the OCR but no Finance Meeting Brief has been delivered, we have a usage gap.",
  severity: "action",
  strategicPriority: "P2",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter(
        (o) =>
          hasContactRole(o, ctx, "Finance/CFO") &&
          !hasAsset(o, ctx, "finance_meeting_brief"),
      )
      .map((o) => ({
        id: ruleId("ASSET_GAP_FINANCE", o.id),
        ruleId: "ASSET_GAP_FINANCE",
        oppId: o.id,
        severity: "action" as const,
        // Finance is on the OCR but not engaged with finance materials — this
        // is the explicit `finance_mentioned_not_engaged` Granola subtype that
        // synthesis.md §1 maps to committee_gap.
        signalType: "committee_gap" as const,
        title: `Finance contact engaged but no ${assetName(ctx, "finance_meeting_brief", "Finance Meeting Brief")} sent`,
        body: "Finance is in the conversation but you haven't sent them the standard brief. We built it for exactly this moment.",
        suggestedAction: `Forward the ${assetName(ctx, "finance_meeting_brief", "Finance Meeting Brief")} from ${ctx.config?.stack.dealRooms ?? "Dock"} today.`,
        assetLink: assetLink(ctx, "finance_meeting_brief", "Finance Meeting Brief"),
        detectedAt: TODAY.toISOString(),
      })),
};

const ruleAssetGapIT: SignalRule = {
  id: "ASSET_GAP_IT",
  name: "Security questions raised but IT one-pager not sent",
  description:
    "Strategic priority #2. Champion has signaled IT scrutiny ('security team has questions') but the IT Zero-Lift one-pager hasn't been delivered.",
  severity: "action",
  strategicPriority: "P2",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter((o) => {
        const hadITSignal = ctx.activities.some(
          (a) =>
            a.oppId === o.id &&
            /security|sso|it team|infosec/i.test(a.summary),
        );
        return hadITSignal && !hasAsset(o, ctx, "it_zero_lift_one_pager");
      })
      .map((o) => ({
        id: ruleId("ASSET_GAP_IT", o.id),
        ruleId: "ASSET_GAP_IT",
        oppId: o.id,
        severity: "action" as const,
        // IT was mentioned on a call but no IT-targeted asset has gone out —
        // the `it_mentioned_not_engaged` Granola subtype that synthesis.md §1
        // maps to committee_gap.
        signalType: "committee_gap" as const,
        title: `IT signal detected, but ${assetName(ctx, "it_zero_lift_one_pager", "IT one-pager")} not sent`,
        body: `There's been talk of security/SSO on this deal and the ${assetName(ctx, "it_zero_lift_one_pager", "IT one-pager")} hasn't gone out. That's the asset that pre-empts most of the back-and-forth.`,
        suggestedAction: `Send the ${assetName(ctx, "it_zero_lift_one_pager", "IT Zero-Lift One-Pager")} today and offer a 20-min walkthrough with our SE.`,
        assetLink: assetLink(ctx, "it_zero_lift_one_pager", "IT Zero-Lift One-Pager"),
        detectedAt: TODAY.toISOString(),
      })),
};

// Helper: is the opportunity's champion marked as departed? CHAMPION_GHOST
// suppresses itself in this case — we have a more specific signal that fires.
function championDeparted(opp: Opportunity, ctx: EvaluationContext): boolean {
  const champion = opp.contactRoleIds
    .map((cid) => ctx.contacts.find((c) => c.id === cid))
    .find((c) => c?.role === "Champion");
  return champion?.status === "departed";
}

const ruleChampionGhost: SignalRule = {
  id: "CHAMPION_GHOST",
  name: "Champion silent for 7+ days",
  description:
    "Champion hasn't replied, joined a meeting, or visited the deal room in 7+ days. Either the deal is in trouble or the champion has lost internal ground. Suppressed when CHAMPION_DEPARTED fires — that's a more specific signal.",
  severity: "blocking",
  strategicPriority: "P5",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter((o) => !championDeparted(o, ctx))
      .filter((o) => {
        const days = lastChampionActivityDays(o, ctx);
        return days !== null && days >= 7;
      })
      .map((o) => {
        const days = lastChampionActivityDays(o, ctx)!;
        return {
          id: ruleId("CHAMPION_GHOST", o.id),
          ruleId: "CHAMPION_GHOST",
          oppId: o.id,
          severity: "blocking" as const,
          // Champion still present but going dark — textbook champion_disengagement.
          signalType: "champion_disengagement" as const,
          title: `Champion silent for ${days} days`,
          body: "Champion hasn't responded, joined a meeting, or visited the deal room in over a week. We need to know why before this fades to closed-lost.",
          suggestedAction:
            "Send a low-pressure check-in today: 'Want to make sure I haven't missed anything — should I pause our outreach or keep going?'",
          detectedAt: TODAY.toISOString(),
        };
      }),
};

// Champion Departed — a more specific (and worse) version of CHAMPION_GHOST.
// In production this is driven by LinkedIn Sales Navigator alerts on saved
// leads, cross-referenced with per-user CRM activity. In the demo, it's
// triggered by the `status: 'departed'` flag on a contact.
//
// This is the most-blocking signal in the system: champion departure is a top
// predictor of deal loss, and it requires a different playbook (rebuild vs
// save vs follow) than a ghosted champion. Carries a playbookId so the AE can
// open the full 3-phase playbook inline.
const ruleChampionDeparted: SignalRule = {
  id: "CHAMPION_DEPARTED",
  name: "Champion has left the company",
  description:
    "LinkedIn signal detected the champion has changed jobs. This is the highest-leverage moment for intervention — the next 14 days determine whether the deal survives.",
  severity: "blocking",
  strategicPriority: "P5",
  evaluate: (ctx) =>
    ctx.opportunities
      .filter((o) => championDeparted(o, ctx))
      .map((o) => {
        const champion = o.contactRoleIds
          .map((cid) => ctx.contacts.find((c) => c.id === cid))
          .find((c) => c?.role === "Champion")!;
        return {
          id: ruleId("CHAMPION_DEPARTED", o.id),
          ruleId: "CHAMPION_DEPARTED",
          oppId: o.id,
          severity: "blocking" as const,
          // Champion left the company — canonical champion_loss.
          signalType: "champion_loss" as const,
          title: `Champion ${champion.name} has left the company`,
          body:
            champion.departureNote ??
            `${champion.name} has departed. This is the top predictor of deal loss at this stage.`,
          suggestedAction:
            "Open the Champion Departure playbook now. First decision is risk classification — multi-threaded deals follow Rebuild; single-threaded deals follow Save Play.",
          playbookId: "champion-departure",
          detectedAt: TODAY.toISOString(),
        };
      }),
};

// Sentiment signal — uses precomputed riskFlags from the call transcript.
// In production, riskFlags would be populated by an LLM analyzing the full
// Gong transcript (architecturally noted on the rollout page).
const ruleCallNegativeSentiment: SignalRule = {
  id: "CALL_NEGATIVE_SENTIMENT",
  name: "Last call surfaced risk markers",
  description:
    "Most recent call transcript contains explicit risk markers (competitor mentioned, pricing pushback, no firm next step, etc.).",
  severity: "action",
  strategicPriority: "P3",
  evaluate: (ctx) => {
    const out: Signal[] = [];
    for (const opp of ctx.opportunities) {
      const oppCalls = ctx.calls
        .filter((c) => c.oppId === opp.id)
        .sort((a, b) => (a.callDate < b.callDate ? 1 : -1));
      const latest = oppCalls[0];
      if (!latest || latest.riskFlags.length === 0) continue;
      out.push({
        id: ruleId("CALL_NEGATIVE_SENTIMENT", opp.id),
        ruleId: "CALL_NEGATIVE_SENTIMENT",
        oppId: opp.id,
        severity: "action",
        // Objections/pricing pushback/no-next-step surfaced on a call — these
        // are the `objection_raised` and "no next step" Granola/Gong subtypes
        // that synthesis.md §1 maps to momentum_change (negative direction).
        // Note: a competitor mention in riskFlags would more cleanly be a
        // competitive_threat signal. Current rule emits one signal per call
        // regardless of which flags fired; splitting by flag type is a
        // follow-up — see open questions.
        signalType: "momentum_change",
        title: `${latest.riskFlags.length} risk marker${latest.riskFlags.length > 1 ? "s" : ""} on last call`,
        body: `Last call (${latest.callDate}) surfaced: ${latest.riskFlags.join(", ")}.`,
        suggestedAction: `Watch the 30s clip flagged in ${ctx.config?.stack.conversationIntelligence ?? "Gong"} and address the specific objection in your next outreach.`,
        detectedAt: TODAY.toISOString(),
      });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------
// The rule registry. Order = priority order when displayed in same severity.
// ---------------------------------------------------------------------------
export const RULES: SignalRule[] = [
  ruleChampionDeparted,
  ruleChampionGhost,
  ruleSelectedVendorNoFinance,
  ruleSelectedVendorNoProcurement,
  ruleNoFinanceAtEvaluating,
  ruleNoITAtEvaluating,
  ruleNoTrialBriefAtDemoSat,
  ruleAssetGapFinance,
  ruleAssetGapIT,
  ruleSingleThreadRisk,
  ruleStageAgeExceeded,
  ruleDemoNotBooked,
  ruleCallNegativeSentiment,
];

export function evaluateAll(ctx: EvaluationContext): Signal[] {
  return RULES.flatMap((r) => r.evaluate(ctx));
}

export function signalsForRep(
  ctx: EvaluationContext,
  repId: string,
): Signal[] {
  const repOppIds = new Set(
    ctx.opportunities.filter((o) => o.ownerId === repId).map((o) => o.id),
  );
  return evaluateAll(ctx).filter((s) => repOppIds.has(s.oppId));
}

const SEVERITY_RANK: Record<string, number> = {
  blocking: 0,
  action: 1,
  awareness: 2,
};

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

// ---------------------------------------------------------------------------
// Deal Health — compound state derived from all signals on a deal, weighted
// by close-date proximity.
//
// Rationale (worth defending in interview): no single signal determines this
// state. The Arphie CS scorecard framework — same author — established that
// "signals compound; the read comes from the compound pattern." Close-date
// weighting reflects that the same signal carries different urgency at 9
// months out vs 30 days out.
// ---------------------------------------------------------------------------
// Accepts any object with the three fields computeDealHealth actually reads.
// This lets callers pass either real Signal[] (from evaluateAll) or the
// Task-derived signal-snapshots the UI constructs from localStorage tasks.
// Tasks don't carry `signalType` — keeping this parameter as full Signal[]
// would force every UI call site to fabricate a canonical signalType just to
// satisfy the type checker. Pick the fields actually used instead.
type DealHealthSignal = Pick<Signal, "oppId" | "severity" | "ruleId">;

export function computeDealHealth(
  opp: Opportunity,
  signals: DealHealthSignal[],
): DealHealth {
  const ownSignals = signals.filter((s) => s.oppId === opp.id);
  const blocking = ownSignals.filter((s) => s.severity === "blocking");
  const action = ownSignals.filter((s) => s.severity === "action");

  // Days from today to forecast close — positive = future, negative = overdue
  // (overdue trips both < 60 and < 30 checks below, escalating health, which
  // is intentional — past-close deals are by definition imminent).
  // Invalid / missing closeDate defaults to 0 so a blocking signal still
  // escalates to Critical rather than silently demoting through NaN compares.
  const closeMs = new Date(opp.closeDate).getTime();
  const daysToClose = Number.isFinite(closeMs)
    ? Math.floor((closeMs - TODAY.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Special case: champion departure is always Critical — losing your champion
  // on a deal in flight is a category-different problem.
  if (blocking.some((s) => s.ruleId === "CHAMPION_DEPARTED")) return "Critical";

  // Two+ blocking, or any blocking with imminent close (< 60 days)
  if (blocking.length >= 2 || (blocking.length >= 1 && daysToClose < 60)) {
    return "Critical";
  }

  // One blocking signal, or 2+ action signals, or any action with very
  // imminent close (< 30 days)
  if (
    blocking.length >= 1 ||
    action.length >= 2 ||
    (action.length >= 1 && daysToClose < 30)
  ) {
    return "At Risk";
  }

  if (action.length >= 1) return "Monitor";
  return "Healthy";
}
