// Tool definitions for the /ask agent (U4).
//
// Source of truth: orgs/checkbox/synthesis.md "The AI query layer" — defines
// 8 typed query tools the agent can call to fetch grounded data. The agent
// never writes; every tool is read-only (BUILD_ALIGNMENT principle #9).
//
// Each tool has two parts:
//   1. An OpenAI function-calling JSON schema (consumed by openai.chat.completions)
//   2. A typed TypeScript implementation that returns citable data
//
// The implementations call directly into the same data builders the
// /api/account-context route uses. We do NOT go back out over HTTP — both
// surfaces are server-side, an HTTP hop would just add auth ceremony and
// latency. The trade-off: when the data shape changes, both consumers update.
// Worth it for correctness + speed.
//
// Every signal returned carries `id` + `sourceTool` + `sourceEventId` so the
// agent's `[citation:signal_id]` markers map back to specific evidence
// (BUILD_ALIGNMENT principle #6).

import OpenAI from "openai";
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
import { DEFAULT_CONFIG, type WorkspaceConfig } from "@/lib/workspace";
import type { Account, Opportunity, SignalType, Stage } from "@/lib/types";
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

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const SIGNAL_CAP = 200;

const SV_HEALTH_STAGES: Stage[] = ["Selected Vendor", "Contracting"];

const STAGE_RANK: Record<Stage, number> = {
  Intro: 0,
  Qualified: 1,
  "Demo Sat": 2,
  Evaluating: 3,
  "Selected Vendor": 4,
  Contracting: 5,
};

// Canonical 12 signal types (synthesis.md §1). Enumerated for the JSON schema
// `enum` constraint — keeps OpenAI from inventing a 13th type.
const CANONICAL_SIGNAL_TYPES: SignalType[] = [
  "champion_loss",
  "champion_disengagement",
  "committee_gap",
  "committee_expansion",
  "momentum_change",
  "competitive_threat",
  "shadow_research",
  "account_health_decline",
  "lifecycle_milestone",
  "account_context",
  "vertical_context",
  "data_hygiene_gap",
];

function withinWindow(iso: string, sinceMs: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= sinceMs;
}

function clampDays(d: unknown, fallback = DEFAULT_DAYS): number {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_DAYS, Math.floor(n));
}

// ─── Result types ───────────────────────────────────────────────────────
//
// Every tool returns a `notFound` discriminant when the account_slug doesn't
// resolve. We don't throw — the agent should see the failure as data and
// adapt (e.g. ask the user to clarify the slug).

export type AccountContextResult = {
  account: Account;
  openOpportunities: Opportunity[];
  contactsByRole: ContactsByRole;
  signals: UnifiedSignal[];
  svHealthScore: SVHealthScore | null;
  correlations: Correlation[];
  warnings: string[];
};

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ─── Internal: full account-context build ───────────────────────────────
//
// Mirrors /api/account-context/route.ts. Kept private to this module so the
// route stays the single owner of the public HTTP contract while the agent
// gets the same numbers without an HTTP hop.

async function buildAccountContext(
  accountId: string,
  days: number,
): Promise<ToolResult<AccountContextResult>> {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, error: `Unknown account: ${accountId}` };

  const warnings: string[] = [];

  const accountOpps = opportunities
    .filter((o) => o.accountId === accountId)
    .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0));

  const accountContacts = seedContacts.filter((c) => c.accountId === accountId);
  const contactsByRole = groupContactsByRole(accountContacts);

  // getWorkspaceConfig reads from next/headers cookies(), which throws when
  // called outside a request scope (unit tests, build-time prerender). Fall
  // back to DEFAULT_CONFIG so the agent's tools stay callable in those
  // contexts — only the workspace-specific copy in evaluated signals
  // differs, and the signal set itself is unchanged.
  let workspace: WorkspaceConfig = DEFAULT_CONFIG;
  try {
    workspace = await getWorkspaceConfig();
  } catch {
    workspace = DEFAULT_CONFIG;
  }
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
    },
  });
  const oppToAccount = new Map(opportunities.map((o) => [o.id, o.accountId]));

  const demoForAccount = demoSignals.filter(
    (s) => oppToAccount.get(s.oppId) === accountId,
  );
  const engineSignals = [...evaluatedSignals, ...demoForAccount];

  let externalSignals: ExternalSignal[] = [];
  try {
    externalSignals = await getExternalSignalsForAccount(accountId, 100);
  } catch (e) {
    warnings.push(
      `external_signals unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

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

  unified.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  const cappedSignals = unified.slice(0, SIGNAL_CAP);

  const correlations = computeCorrelations(unified);

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
        `sv_health unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    ok: true,
    data: {
      account,
      openOpportunities: accountOpps,
      contactsByRole,
      signals: cappedSignals,
      svHealthScore,
      correlations,
      warnings,
    },
  };
}

// ─── Public tool implementations ────────────────────────────────────────

// Tool 1: get_account_context — the full picture for an account
export async function getAccountContext(args: {
  account_slug: string;
  days?: number;
}): Promise<ToolResult<AccountContextResult>> {
  return buildAccountContext(args.account_slug, clampDays(args.days));
}

// Tool 2: get_account_timeline — just the signals, time-ordered
export async function getAccountTimeline(args: {
  account_slug: string;
  days?: number;
}): Promise<ToolResult<{ signals: UnifiedSignal[] }>> {
  const ctx = await buildAccountContext(
    args.account_slug,
    clampDays(args.days, 30),
  );
  if (!ctx.ok) return ctx;
  return { ok: true, data: { signals: ctx.data.signals } };
}

// Tool 3: find_signals — filter timeline by signal_type
export async function findSignals(args: {
  signal_type: SignalType;
  account_slug: string;
  days?: number;
}): Promise<ToolResult<{ signals: UnifiedSignal[] }>> {
  if (!CANONICAL_SIGNAL_TYPES.includes(args.signal_type)) {
    return {
      ok: false,
      error: `Unknown signal_type: ${args.signal_type}. Must be one of the 12 canonical types.`,
    };
  }
  const ctx = await buildAccountContext(args.account_slug, clampDays(args.days));
  if (!ctx.ok) return ctx;
  const filtered = ctx.data.signals.filter(
    (s) => s.signalType === args.signal_type,
  );
  return { ok: true, data: { signals: filtered } };
}

// Tool 4: get_correlations — multi-source agreement patterns
export async function getCorrelations(args: {
  account_slug: string;
  types?: SignalType[];
  days?: number;
}): Promise<ToolResult<{ correlations: Correlation[] }>> {
  const ctx = await buildAccountContext(args.account_slug, clampDays(args.days));
  if (!ctx.ok) return ctx;
  const wanted = args.types?.filter((t) => CANONICAL_SIGNAL_TYPES.includes(t));
  const out = wanted && wanted.length > 0
    ? ctx.data.correlations.filter((c) => wanted.includes(c.correlationType))
    : ctx.data.correlations;
  return { ok: true, data: { correlations: out } };
}

// Tool 5: get_calls — Granola pipeline deferred per session 5 handoff
export async function getCalls(args: {
  opportunity_id: string;
  limit?: number;
}): Promise<ToolResult<{ calls: never[]; note: string }>> {
  void args; // intentional — stub honors the schema but does no work yet
  return {
    ok: true,
    data: {
      calls: [],
      note: "Granola call-transcript pipeline deferred. No call transcripts available in v1.",
    },
  };
}

// Tool 6: get_emails — Outreach/email pipeline deferred
export async function getEmails(args: {
  account_slug: string;
  days?: number;
}): Promise<ToolResult<{ emails: never[]; note: string }>> {
  void args;
  return {
    ok: true,
    data: {
      emails: [],
      note: "Email-thread retrieval deferred. No email data available in v1.",
    },
  };
}

// Tool 7: get_committee_engagement — derive present/missing roles from
// contactsByRole on the SV+ opportunity.
export type CommitteeEngagement = {
  opportunityId: string;
  presentRoles: string[];
  missingRoles: string[];
  contactsByRole: ContactsByRole;
};

export async function getCommitteeEngagement(args: {
  opportunity_id: string;
}): Promise<ToolResult<CommitteeEngagement>> {
  const opp = opportunities.find((o) => o.id === args.opportunity_id);
  if (!opp) {
    return { ok: false, error: `Unknown opportunity: ${args.opportunity_id}` };
  }
  const accountContacts = seedContacts.filter(
    (c) => c.accountId === opp.accountId,
  );
  const oppContacts = accountContacts.filter((c) =>
    opp.contactRoleIds.includes(c.id),
  );
  const grouped = groupContactsByRole(oppContacts);

  // SV Health treats these 5 role slots as the canonical buying committee.
  const REQUIRED_ROLES: (keyof ContactsByRole)[] = [
    "champion",
    "economic_buyer",
    "finance",
    "it_security",
    "legal",
  ];
  const present: string[] = [];
  const missing: string[] = [];
  for (const r of REQUIRED_ROLES) {
    if (grouped[r].length > 0) present.push(r);
    else missing.push(r);
  }

  return {
    ok: true,
    data: {
      opportunityId: opp.id,
      presentRoles: present,
      missingRoles: missing,
      contactsByRole: grouped,
    },
  };
}

// Tool 8: rollup — manager-level aggregations, deferred for v1
export async function rollup(args: {
  metric: string;
  dimension: string;
  window?: string;
}): Promise<ToolResult<{ rows: never[]; note: string }>> {
  void args;
  return {
    ok: true,
    data: {
      rows: [],
      note: "Rollup aggregations deferred. Manager-level rollups not available in v1.",
    },
  };
}

// ─── OpenAI function-calling schemas ────────────────────────────────────
//
// Shape matches the `tools` parameter of openai.chat.completions.create.
// Descriptions are written FOR the model — they should tell it when to pick
// this tool over another. Account slug examples are intentionally the
// DEMO_SCENARIO_ACCOUNTS keys so the model has working defaults.

export const ASK_TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_account_context",
      description:
        "Get the full picture for a single account: account row, open opportunities, contacts grouped by role, recent signals across all sources, SV Health Score, and correlations. Start here for any account-specific question.",
      parameters: {
        type: "object",
        properties: {
          account_slug: {
            type: "string",
            description: "Account ID like 'acc_sentinel', 'acc_atlas', 'acc_meridian'.",
          },
          days: {
            type: "number",
            description: "Lookback window in days. Defaults to 90.",
          },
        },
        required: ["account_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_timeline",
      description:
        "Time-ordered signal stream for an account across all sources. Use when the question is about WHEN things happened or the sequence of events.",
      parameters: {
        type: "object",
        properties: {
          account_slug: { type: "string" },
          days: {
            type: "number",
            description: "Lookback window in days. Defaults to 30.",
          },
        },
        required: ["account_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_signals",
      description:
        "Filter an account's signals by one of the 12 canonical signal_types. Use when you already know the kind of signal you're looking for (e.g. 'show me committee_gap signals on this account').",
      parameters: {
        type: "object",
        properties: {
          signal_type: {
            type: "string",
            enum: CANONICAL_SIGNAL_TYPES,
            description: "One of the 12 canonical signal types.",
          },
          account_slug: { type: "string" },
          days: { type: "number" },
        },
        required: ["signal_type", "account_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_correlations",
      description:
        "Cross-source correlation patterns for an account — signals where 2+ independent tools agreed on the same signal_type. Strongest evidence available.",
      parameters: {
        type: "object",
        properties: {
          account_slug: { type: "string" },
          types: {
            type: "array",
            items: { type: "string", enum: CANONICAL_SIGNAL_TYPES },
            description: "Optional filter to specific signal types.",
          },
          days: { type: "number" },
        },
        required: ["account_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calls",
      description:
        "Retrieve recent call transcripts for an opportunity. (Granola call pipeline is deferred in v1 — this returns an empty list with a note.)",
      parameters: {
        type: "object",
        properties: {
          opportunity_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["opportunity_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_emails",
      description:
        "Retrieve recent email threads for an account. (Outreach/email pipeline deferred in v1 — returns empty with a note.)",
      parameters: {
        type: "object",
        properties: {
          account_slug: { type: "string" },
          days: { type: "number" },
        },
        required: ["account_slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_committee_engagement",
      description:
        "For an opportunity, return which canonical buying-committee roles are present (Champion, Economic Buyer, Finance, IT/Security, Legal) vs missing. Use when the question is about who's on or off the deal.",
      parameters: {
        type: "object",
        properties: {
          opportunity_id: { type: "string" },
        },
        required: ["opportunity_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollup",
      description:
        "Cross-account aggregations for manager-level questions ('which deals lost momentum this week'). Deferred in v1 — returns an empty result with a note.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string" },
          dimension: { type: "string" },
          window: { type: "string" },
        },
        required: ["metric", "dimension"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Tool dispatcher ────────────────────────────────────────────────────
//
// The route's tool-use loop calls `dispatchTool(name, args)` for each
// tool_call the model emits. Centralizing dispatch here keeps the route
// thin and gives tests a single seam to mock.

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult<unknown>> {
  switch (name) {
    case "get_account_context":
      return getAccountContext(args as Parameters<typeof getAccountContext>[0]);
    case "get_account_timeline":
      return getAccountTimeline(
        args as Parameters<typeof getAccountTimeline>[0],
      );
    case "find_signals":
      return findSignals(args as Parameters<typeof findSignals>[0]);
    case "get_correlations":
      return getCorrelations(args as Parameters<typeof getCorrelations>[0]);
    case "get_calls":
      return getCalls(args as Parameters<typeof getCalls>[0]);
    case "get_emails":
      return getEmails(args as Parameters<typeof getEmails>[0]);
    case "get_committee_engagement":
      return getCommitteeEngagement(
        args as Parameters<typeof getCommitteeEngagement>[0],
      );
    case "rollup":
      return rollup(args as Parameters<typeof rollup>[0]);
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

// ─── Citation collector ─────────────────────────────────────────────────
//
// Walks the result returned by any tool and pulls out the citable signals
// the agent might reference. The route uses this to (a) build the response
// `citations[]` payload, and (b) verify the model's [citation:id] markers
// map to real signal IDs.

export type Citation = {
  id: string;
  sourceTool: string;
  sourceEventId: string | null;
  summary: string;
};

export function collectCitations(result: unknown): Citation[] {
  const out: Citation[] = [];
  function visit(v: unknown) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    // A UnifiedSignal has id + sourceTool + signalType + summary. That's the
    // shape we cite. Anything else, recurse.
    if (
      typeof obj.id === "string" &&
      typeof obj.sourceTool === "string" &&
      typeof obj.summary === "string"
    ) {
      out.push({
        id: obj.id,
        sourceTool: obj.sourceTool,
        sourceEventId: (obj.sourceEventId as string | null) ?? null,
        summary: obj.summary,
      });
    }
    for (const val of Object.values(obj)) visit(val);
  }
  visit(result);
  // Dedup by id; first occurrence wins.
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
