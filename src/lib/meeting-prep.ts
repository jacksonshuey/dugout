// AE pre-meeting prep synthesizer. Joins web-scrape brief_fields + recent
// signals + SV Health + opportunities into a single MeetingBrief shape that
// renders the /account/[slug]/prep surface and is consumed by the Phase 6
// Claude Code skill.
//
// Design notes:
// - Server-only. Pulls from lib helpers (signal engine, sv-health,
//   external_signals, accounts) and the seed data fallback. Never imports
//   client-only modules.
// - Failsoft on every external dependency — if Supabase is unreachable, the
//   brief still renders with whatever data is available; the scrapeStatus
//   field tells the caller how complete the picture is.
// - brief_fields is the structured AE-context shape persisted on
//   external_signals.meta by the web-scrape-classifier (Phase 3 output). We
//   pick the freshest non-null value per field across all per-account
//   scrape signals so callers don't have to know which page yielded which
//   field.
// - No "confidence" field per BUILD_ALIGNMENT principle #5.

import {
  accounts as seedAccounts,
  activities,
  assetDeliveries,
  calls,
  contacts as seedContacts,
  demoSignals,
  opportunities,
  reps,
} from "@/data/seed";
import { evaluateAll } from "./signal-engine";
import { computeSVHealthScore } from "./sv-health";
import {
  getSignalsForAccount,
  type ExternalSignal,
} from "./external-signals";
import { listTrackableAccounts } from "./accounts";
import { getWorkspaceConfig } from "./workspace-server";
import type {
  Account,
  Contact,
  ContactRole,
  Opportunity,
  Signal,
  Stage,
} from "./types";

// ---------------------------------------------------------------------------
// Public shape (the contract consumed by /account/[slug]/prep AND the
// Phase 6 Claude Code skill via /api/firecrawl/company-scope).
// ---------------------------------------------------------------------------

export type SVHealthTierForBrief = "HEALTHY" | "WATCH" | "CRITICAL";

export type ScrapeStatus = "fresh" | "stale" | "pending" | "missing";

export interface MeetingBrief {
  accountId: string;
  accountName: string;
  generatedAt: string; // ISO

  // From web-scrape brief_fields (Phase 3 output)
  companyOneLiner: string | null;
  strategicFocus: string | null;
  keyRisks: string[];
  recentFunding: {
    amount: string;
    leadInvestor?: string;
    date: string;
  } | null;
  recentExecChanges: Array<{
    name: string;
    role: string;
    change: "joined" | "left" | "promoted";
    date: string;
  }>;

  // From signals (filtered: high/medium workspace_relevance, last 30 days)
  recentMoves: Array<{
    headline: string;
    occurredAt: string;
    source: string;
    url?: string;
  }>;

  // From signal engine + sv-health
  svHealth: {
    score: number;
    tier: SVHealthTierForBrief;
  } | null;

  openOpportunities: Array<{
    id: string;
    name: string;
    stage: Stage;
    amount?: number;
    daysInStage: number;
  }>;

  // From committee model
  buyingCommittee: {
    mapped: number;
    gaps: string[]; // human-readable role labels, e.g. "Finance", "IT/Security"
  };

  // Blocking + action signals with prescribed actions
  blockingSignals: Array<{
    id: string;
    title: string;
    body: string;
    suggestedAction: string;
    assetLink?: string;
  }>;

  // Freshness
  lastCrawledAt: string | null;
  scrapeStatus: ScrapeStatus;

  // Optional helpful context for the UI (industry / hq) — not part of the
  // skill contract proper but cheap to include so /prep doesn't need a
  // second account lookup.
  industry?: string;
  hqLocation?: string;
}

// ---------------------------------------------------------------------------
// brief_fields shape (mirrors web-scrape-classifier.ts BriefFields — kept
// independent here so this module doesn't take a dependency on the
// classifier file ownership boundary).
// ---------------------------------------------------------------------------

interface PersistedBriefFields {
  company_one_liner?: string | null;
  exec_change?: {
    name: string;
    role: string;
    change: "joined" | "left" | "promoted";
    date: string | null;
  } | null;
  recent_funding?: {
    amount: string;
    lead_investor: string | null;
    date: string | null;
  } | null;
  key_risks?: string[];
  strategic_focus?: string | null;
}

function extractBriefFields(meta: unknown): PersistedBriefFields | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const bf = m.brief_fields;
  if (!bf || typeof bf !== "object") return null;
  return bf as PersistedBriefFields;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRESH_HOURS = 24;
const STALE_HOURS = 24 * 7; // 168h
const RECENT_MOVES_LOOKBACK_DAYS = 30;

const STAGE_RANK: Record<Stage, number> = {
  Intro: 0,
  Qualified: 1,
  "Demo Sat": 2,
  Evaluating: 3,
  "Selected Vendor": 4,
  Contracting: 5,
};

const SV_HEALTH_STAGES: Stage[] = ["Selected Vendor", "Contracting"];

const ROLE_GAP_LABEL: Partial<Record<ContactRole, string>> = {
  Champion: "Champion",
  "Executive Sponsor": "Executive Sponsor",
  "Finance/CFO": "Finance",
  "IT/Security": "IT/Security",
  GC: "Legal",
  Procurement: "Procurement",
};

const REQUIRED_ROLES_FOR_GAPS: ContactRole[] = [
  "Champion",
  "Executive Sponsor",
  "Finance/CFO",
  "IT/Security",
  "GC",
  "Procurement",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((now - t) / (24 * 60 * 60 * 1000));
}

function hoursBetween(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((now - t) / (60 * 60 * 1000));
}

function tierLabel(score: number): SVHealthTierForBrief {
  if (score >= 80) return "HEALTHY";
  if (score >= 60) return "WATCH";
  return "CRITICAL";
}

function determineScrapeStatus(
  account: Account,
  lastCrawledAt: string | null,
  now: number,
): ScrapeStatus {
  if (!account.website) return "missing";
  if (!lastCrawledAt) return "pending";
  const hours = hoursBetween(lastCrawledAt, now);
  if (hours < FRESH_HOURS) return "fresh";
  if (hours < STALE_HOURS) return "stale";
  return "stale"; // older than 7d still classified stale (not pending) —
  // pending means "no scrape ever happened"; stale means "we have one but
  // it's old."
}

// Pull the freshest non-null brief_fields value across all per-account
// scrape signals. Signals are pre-sorted newest-first by the caller.
function mergeBriefFields(
  signals: ExternalSignal[],
): PersistedBriefFields {
  const merged: PersistedBriefFields = {
    company_one_liner: null,
    exec_change: null,
    recent_funding: null,
    key_risks: [],
    strategic_focus: null,
  };
  const seenRiskKeys = new Set<string>();
  for (const s of signals) {
    const bf = extractBriefFields(s.meta);
    if (!bf) continue;
    if (!merged.company_one_liner && bf.company_one_liner) {
      merged.company_one_liner = bf.company_one_liner;
    }
    if (!merged.exec_change && bf.exec_change) {
      merged.exec_change = bf.exec_change;
    }
    if (!merged.recent_funding && bf.recent_funding) {
      merged.recent_funding = bf.recent_funding;
    }
    if (!merged.strategic_focus && bf.strategic_focus) {
      merged.strategic_focus = bf.strategic_focus;
    }
    if (Array.isArray(bf.key_risks)) {
      for (const r of bf.key_risks) {
        if (typeof r === "string" && !seenRiskKeys.has(r.toLowerCase())) {
          merged.key_risks!.push(r);
          seenRiskKeys.add(r.toLowerCase());
          if (merged.key_risks!.length >= 3) break;
        }
      }
    }
  }
  return merged;
}

// Collect all exec changes from the scrape signals (not just the most
// recent — the AE wants the whole picture). Dedup by name+role+change.
function collectExecChanges(
  signals: ExternalSignal[],
): MeetingBrief["recentExecChanges"] {
  const seen = new Set<string>();
  const out: MeetingBrief["recentExecChanges"] = [];
  for (const s of signals) {
    const bf = extractBriefFields(s.meta);
    if (!bf?.exec_change) continue;
    const ec = bf.exec_change;
    const key = `${ec.name}::${ec.role}::${ec.change}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: ec.name,
      role: ec.role,
      change: ec.change,
      date: ec.date ?? s.occurred_at,
    });
  }
  return out.slice(0, 5);
}

// Pull recent moves from any signal (web_scrape, newsletter, news, demo)
// that's high/medium relevance OR has no relevance tag (legacy). 30d window.
function buildRecentMoves(
  signals: ExternalSignal[],
  now: number,
): MeetingBrief["recentMoves"] {
  return signals
    .filter((s) => {
      const days = daysBetween(s.occurred_at, now);
      if (days > RECENT_MOVES_LOOKBACK_DAYS) return false;
      // Treat null/undefined workspace_relevance as eligible — most
      // per-account web_scrape signals aren't relevance-tagged. The
      // `getSignalsForAccount` query already strips low-quality
      // NewsAPI rows.
      const rel = s.workspace_relevance;
      if (rel === "low" || rel === "none") return false;
      return true;
    })
    .slice(0, 8)
    .map((s) => ({
      headline: s.summary,
      occurredAt: s.occurred_at,
      source: sourceLabel(s.source),
      url: s.url ?? s.source_url ?? undefined,
    }));
}

function sourceLabel(source: ExternalSignal["source"]): string {
  switch (source) {
    case "newsapi":
      return "News";
    case "sec_edgar":
      return "SEC";
    case "newsletter":
      return "Newsletter";
    case "web_scrape":
      return "Scrape";
    case "claude_web_search":
      return "Web";
    case "manual":
      return "Manual";
    case "demo":
      return "Demo";
    default:
      return source;
  }
}

// Compute committee gaps for the lead opportunity (most-advanced stage).
// Empty list when the opportunity already has every required role.
function buildBuyingCommittee(
  leadOpp: Opportunity | null,
  accountContacts: Contact[],
): MeetingBrief["buyingCommittee"] {
  if (!leadOpp) {
    return { mapped: accountContacts.length, gaps: [] };
  }
  const oppContactIds = new Set(leadOpp.contactRoleIds);
  const oppContacts = accountContacts.filter((c) => oppContactIds.has(c.id));
  const rolesPresent = new Set(oppContacts.map((c) => c.role));
  const gaps: string[] = [];
  for (const role of REQUIRED_ROLES_FOR_GAPS) {
    if (rolesPresent.has(role)) continue;
    const label = ROLE_GAP_LABEL[role];
    if (label) gaps.push(label);
  }
  return { mapped: oppContacts.length, gaps };
}

// ---------------------------------------------------------------------------
// Account resolution (seed first, then DB) — keeps the synthesizer free of
// DB calls when the slug matches a seed account.
// ---------------------------------------------------------------------------

async function resolveAccount(accountId: string): Promise<Account | null> {
  const fromSeed = seedAccounts.find((a) => a.id === accountId);
  if (fromSeed) return fromSeed;
  try {
    const dbAccounts = await listTrackableAccounts();
    return dbAccounts.find((a) => a.id === accountId) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function buildMeetingBrief(
  accountId: string,
): Promise<MeetingBrief> {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();

  const account = await resolveAccount(accountId);
  if (!account) {
    return {
      accountId,
      accountName: accountId,
      generatedAt,
      companyOneLiner: null,
      strategicFocus: null,
      keyRisks: [],
      recentFunding: null,
      recentExecChanges: [],
      recentMoves: [],
      svHealth: null,
      openOpportunities: [],
      buyingCommittee: { mapped: 0, gaps: [] },
      blockingSignals: [],
      lastCrawledAt: null,
      scrapeStatus: "missing",
    };
  }

  // ── Opportunities (seed-only — production CRM not wired) ──────────────
  const accountOpps = opportunities
    .filter((o) => o.accountId === account.id)
    .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0));
  const leadOpp = accountOpps[0] ?? null;

  const accountContacts = seedContacts.filter(
    (c) => c.accountId === account.id,
  );

  // ── Signal engine + demo signals ──────────────────────────────────────
  let engineSignals: Signal[] = [];
  try {
    const workspace = await getWorkspaceConfig();
    const evaluated = evaluateAll({
      opportunities,
      accounts: seedAccounts,
      contacts: seedContacts,
      activities,
      calls,
      deliveries: assetDeliveries,
      reps,
      config: {
        companyName: workspace.companyName,
        assets: workspace.assets,
        stack: workspace.stack,
      },
    });
    const oppToAccount = new Map(opportunities.map((o) => [o.id, o.accountId]));
    const demoForAccount = demoSignals.filter(
      (s) => oppToAccount.get(s.oppId) === account.id,
    );
    const accountOppIds = new Set(accountOpps.map((o) => o.id));
    engineSignals = [
      ...evaluated.filter((s) => accountOppIds.has(s.oppId)),
      ...demoForAccount,
    ];
  } catch {
    // workspace cookie may be unavailable in non-request contexts; the
    // signal engine still runs with no config fallback values.
  }

  // ── External signals — failsoft ───────────────────────────────────────
  let externalSignals: ExternalSignal[] = [];
  try {
    externalSignals = await getSignalsForAccount(account.id, 100);
  } catch {
    // Supabase down or migrations not applied — proceed with empty list.
  }

  // ── SV Health ──────────────────────────────────────────────────────────
  let svHealth: MeetingBrief["svHealth"] = null;
  const svOpp = accountOpps.find((o) => SV_HEALTH_STAGES.includes(o.stage));
  if (svOpp) {
    try {
      const svContacts = accountContacts.filter((c) =>
        svOpp.contactRoleIds.includes(c.id),
      );
      const score = computeSVHealthScore({
        account,
        opportunity: svOpp,
        contacts: svContacts,
        signals: engineSignals,
        externalSignals,
      });
      svHealth = {
        score: score.score,
        tier: tierLabel(score.score),
      };
    } catch {
      // computation failed — leave svHealth null rather than crashing the brief.
    }
  }

  // ── brief_fields synthesis from web_scrape signals only ───────────────
  const scrapeSignals = externalSignals
    .filter((s) => s.source === "web_scrape")
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const mergedBriefFields = mergeBriefFields(scrapeSignals);

  // ── lastCrawledAt + scrape status ─────────────────────────────────────
  const lastCrawledAt =
    scrapeSignals[0]?.occurred_at ?? null;
  const scrapeStatus = determineScrapeStatus(account, lastCrawledAt, now);

  // ── Recent moves (all sources, 30d) ───────────────────────────────────
  const recentMoves = buildRecentMoves(externalSignals, now);

  // ── Blocking signals — surface engine + demo blocking only ────────────
  const blockingSignals = engineSignals
    .filter((s) => s.severity === "blocking")
    .map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      suggestedAction: s.suggestedAction,
      assetLink: s.assetLink,
    }));

  // ── Committee model ───────────────────────────────────────────────────
  const buyingCommittee = buildBuyingCommittee(leadOpp, accountContacts);

  // ── Open opportunities — strip CRM internals, keep what the brief needs ─
  const openOpportunities = accountOpps.map((o) => ({
    id: o.id,
    name: o.name,
    stage: o.stage,
    amount: o.amount,
    daysInStage: daysBetween(o.enteredStageAt, now),
  }));

  return {
    accountId: account.id,
    accountName: account.name,
    generatedAt,
    companyOneLiner: mergedBriefFields.company_one_liner ?? null,
    strategicFocus: mergedBriefFields.strategic_focus ?? null,
    keyRisks: mergedBriefFields.key_risks ?? [],
    recentFunding: mergedBriefFields.recent_funding
      ? {
          amount: mergedBriefFields.recent_funding.amount,
          leadInvestor:
            mergedBriefFields.recent_funding.lead_investor ?? undefined,
          date: mergedBriefFields.recent_funding.date ?? "",
        }
      : null,
    recentExecChanges: collectExecChanges(scrapeSignals),
    recentMoves,
    svHealth,
    openOpportunities,
    buyingCommittee,
    blockingSignals,
    lastCrawledAt,
    scrapeStatus,
    industry: account.industry,
    hqLocation: account.hqLocation,
  };
}

// Re-exported helpers for tests / the API route. Internal use only —
// production callers should always go through buildMeetingBrief.
export const _internal = {
  mergeBriefFields,
  buildBuyingCommittee,
  determineScrapeStatus,
  tierLabel,
};
