// Unify the 3 signal sources (signal-engine, external_signals, meeting_signals)
// into one shape with canonical signal_type + direction + severity per
// synthesis.md §1. Used by /api/account-context and by the future /ask
// agent's get_account_context tool.
//
// Design rules (per orgs/_default/BUILD_ALIGNMENT.md):
//   - Pure functions only — no I/O, no fetch, no Supabase here.
//   - signal_type ∈ the canonical 12 only (#2).
//   - severity ∈ {blocking, action, awareness} only (#3).
//   - direction ∈ {negative, positive, neutral} only (#4).
//   - Every UnifiedSignal carries source_tool + source_event_id (#6).
//   - No `confidence` field anywhere (#5).

import type {
  Contact,
  Signal,
  SignalSeverity,
  SignalType,
} from "@/lib/types";
import type {
  ExternalSignal,
  ExternalSignalType,
} from "@/lib/external-signals";
import type { MeetingSignalRow } from "@/lib/meeting-signals";

export type SignalDirection = "negative" | "positive" | "neutral";

export type UnifiedSignal = {
  id: string;
  sourceTool: string;
  sourceEventId: string | null;
  signalType: SignalType;
  severity: SignalSeverity;
  direction: SignalDirection;
  occurredAt: string; // ISO timestamp
  summary: string;
  derived?: Record<string, unknown>;
};

export type ContactsByRole = {
  champion: Contact[];
  economic_buyer: Contact[];
  finance: Contact[];
  it_security: Contact[];
  legal: Contact[];
  procurement: Contact[];
  detractor: Contact[];
  influencer: Contact[];
  unknown: Contact[];
};

export type Correlation = {
  correlationType: SignalType;
  sourceTools: string[];
  sourceCount: number;
  derivedSeverity: SignalSeverity;
  signalIds: string[];
  firstObservedAt: string;
  lastReinforcedAt: string;
};

// ─── External signal mapping ────────────────────────────────────────────
//
// Per synthesis.md §1: NewsAPI / SEC items about a specific account land in
// `account_context`. Newsletter items default to `vertical_context` UNLESS
// they were classified to a real account (account_id !== sentinel) — by
// the time we get here the caller has already filtered to a specific
// account, so we always emit `account_context`. Severity floor is
// `awareness` unless the type itself is more urgent.

export function mapExternalSignal(s: ExternalSignal): {
  signalType: SignalType;
  direction: SignalDirection;
  severity: SignalSeverity;
} {
  return {
    signalType: "account_context",
    direction: directionForExternalType(s.type),
    severity: severityForExternalType(s.type),
  };
}

function directionForExternalType(t: ExternalSignalType): SignalDirection {
  switch (t) {
    case "funding_round":
    case "product_launch":
    case "partnership":
      return "positive";
    case "earnings":
    case "press_release":
    case "other":
      return "neutral";
    default:
      // leadership_change, champion_job_change, ma_acquisition, layoff,
      // competitor_mention, regulatory_action — negative for v1 risk lens.
      return "negative";
  }
}

function severityForExternalType(t: ExternalSignalType): SignalSeverity {
  switch (t) {
    case "ma_acquisition":
    case "champion_job_change":
      return "blocking";
    case "layoff":
    case "leadership_change":
    case "regulatory_action":
      return "action";
    default:
      return "awareness";
  }
}

// ─── Meeting signal mapping ─────────────────────────────────────────────
//
// Source of truth: orgs/_default/tools/granola.md "Mapping the 7 Granola
// signals to the 12 canonical types". The classifier ships 3 types in v1
// and adds 4 more in v1.5; we handle all 7 so this module doesn't churn
// when v1.5 flips on.

export function mapMeetingSignal(s: MeetingSignalRow): {
  signalType: SignalType;
  direction: SignalDirection;
} {
  switch (s.signal_type) {
    case "finance_mentioned_not_engaged":
      return { signalType: "committee_gap", direction: "negative" };
    case "new_stakeholder_introduced":
      return { signalType: "committee_expansion", direction: "positive" };
    case "champion_role_change":
      return { signalType: "champion_loss", direction: "negative" };
    case "competitor_mentioned":
      return { signalType: "competitive_threat", direction: "negative" };
    case "legal_review_requested":
      return { signalType: "lifecycle_milestone", direction: "neutral" };
    case "timeline_signal":
      return { signalType: "lifecycle_milestone", direction: "neutral" };
    case "budget_concern":
      return { signalType: "momentum_change", direction: "negative" };
    default:
      // Defensive — schema validates the enum upstream, but keep an honest
      // fallback so a future classifier type doesn't crash the route.
      return { signalType: "account_context", direction: "neutral" };
  }
}

// ─── Engine signal direction ────────────────────────────────────────────
//
// signal-engine doesn't yet emit `direction`. Derive from the polarity of
// each canonical signal_type per synthesis.md §1. All shipped rules are
// negative-polarity today; the only positive type (`committee_expansion`)
// has no rule emitting it yet. Update here if/when polarity-aware rules
// land.

export function directionForEngineType(t: SignalType): SignalDirection {
  switch (t) {
    case "lifecycle_milestone":
    case "account_context":
    case "vertical_context":
      return "neutral";
    case "committee_expansion":
      return "positive";
    default:
      return "negative";
  }
}

// ─── Unification ────────────────────────────────────────────────────────

export function unifyEngineSignal(
  s: Signal,
  oppToAccount: Map<string, string>,
  accountId: string,
): UnifiedSignal | null {
  if (oppToAccount.get(s.oppId) !== accountId) return null;
  return {
    id: s.id,
    sourceTool: "signal_engine",
    sourceEventId: s.ruleId,
    signalType: s.signalType,
    severity: s.severity,
    direction: directionForEngineType(s.signalType),
    occurredAt: s.detectedAt,
    summary: s.title,
    derived: {
      ruleId: s.ruleId,
      oppId: s.oppId,
      body: s.body,
      suggestedAction: s.suggestedAction,
    },
  };
}

export function unifyExternalSignal(s: ExternalSignal): UnifiedSignal {
  const mapped = mapExternalSignal(s);
  return {
    id: s.id,
    sourceTool: s.source, // 'newsapi' | 'sec_edgar' | 'newsletter' | ...
    sourceEventId: s.url ?? s.id, // url is the natural dedup key
    signalType: mapped.signalType,
    severity: mapped.severity,
    direction: mapped.direction,
    occurredAt: s.occurred_at,
    summary: s.summary,
    derived: {
      externalType: s.type,
      url: s.url ?? undefined,
      isDemo: s.is_demo,
      ...(s.meta ?? {}),
    },
  };
}

export function unifyMeetingSignal(s: MeetingSignalRow): UnifiedSignal {
  const mapped = mapMeetingSignal(s);
  return {
    id: s.id,
    sourceTool: "granola",
    sourceEventId: s.note_id,
    signalType: mapped.signalType,
    severity: s.severity,
    direction: mapped.direction,
    // meeting_date is the substantive timestamp; fall back to created_at if
    // the note had no date set.
    occurredAt: (s.meeting_date ?? s.created_at) || s.created_at,
    summary: s.summary,
    derived: {
      meetingTitle: s.meeting_title,
      noteId: s.note_id,
      granolaUrl: s.granola_url,
      rawExcerpt: s.raw_excerpt,
      granolaSubtype: s.signal_type,
      classifier: s.classifier,
    },
  };
}

// ─── Contacts grouping ──────────────────────────────────────────────────

export function emptyContactsByRole(): ContactsByRole {
  return {
    champion: [],
    economic_buyer: [],
    finance: [],
    it_security: [],
    legal: [],
    procurement: [],
    detractor: [],
    influencer: [],
    unknown: [],
  };
}

export function groupContactsByRole(contacts: Contact[]): ContactsByRole {
  const out = emptyContactsByRole();
  for (const c of contacts) {
    switch (c.role) {
      case "Champion":
        out.champion.push(c);
        break;
      case "Executive Sponsor":
        out.economic_buyer.push(c);
        break;
      case "Finance/CFO":
        out.finance.push(c);
        break;
      case "IT/Security":
        out.it_security.push(c);
        break;
      case "GC":
      case "Legal Ops":
        out.legal.push(c);
        break;
      case "Procurement":
        out.procurement.push(c);
        break;
      case "End User":
        // ContactRole has no `detractor` / `influencer` today; the response
        // keys exist for forward-compat with the future role-classifier.
        // Treat End User as influencer for v1.
        out.influencer.push(c);
        break;
      default:
        out.unknown.push(c);
    }
  }
  return out;
}

// ─── Correlations ───────────────────────────────────────────────────────
//
// Group signals by signal_type. Emit a correlation row when ≥2 distinct
// sourceTool values agree. Elevate severity per synthesis.md "Severity
// inheritance":
//   - derivedSeverity = max(severity in group)
//   - elevate one tier if sourceCount ≥ 3
//   - cap at blocking

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  awareness: 0,
  action: 1,
  blocking: 2,
};
const SEVERITY_BY_RANK: SignalSeverity[] = ["awareness", "action", "blocking"];

export function elevatedSeverity(
  groupSeverities: SignalSeverity[],
  sourceCount: number,
): SignalSeverity {
  const maxRank = groupSeverities.reduce(
    (acc, sev) => Math.max(acc, SEVERITY_RANK[sev]),
    0,
  );
  const elevated = sourceCount >= 3 ? Math.min(2, maxRank + 1) : maxRank;
  return SEVERITY_BY_RANK[elevated];
}

export function computeCorrelations(signals: UnifiedSignal[]): Correlation[] {
  const buckets = new Map<SignalType, UnifiedSignal[]>();
  for (const s of signals) {
    const arr = buckets.get(s.signalType) ?? [];
    arr.push(s);
    buckets.set(s.signalType, arr);
  }

  const out: Correlation[] = [];
  for (const [type, group] of buckets) {
    const distinctTools = new Set(group.map((g) => g.sourceTool));
    if (distinctTools.size < 2) continue;
    const sortedByTime = [...group].sort((a, b) =>
      a.occurredAt < b.occurredAt ? -1 : 1,
    );
    const severity = elevatedSeverity(
      group.map((g) => g.severity),
      distinctTools.size,
    );
    out.push({
      correlationType: type,
      sourceTools: [...distinctTools].sort(),
      sourceCount: distinctTools.size,
      derivedSeverity: severity,
      signalIds: group.map((g) => g.id),
      firstObservedAt: sortedByTime[0].occurredAt,
      lastReinforcedAt: sortedByTime[sortedByTime.length - 1].occurredAt,
    });
  }

  // Most-recently-reinforced first — that's what the UI cares about.
  out.sort((a, b) => (a.lastReinforcedAt < b.lastReinforcedAt ? 1 : -1));
  return out;
}
