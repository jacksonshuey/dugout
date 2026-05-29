import { NextResponse } from "next/server";
import {
  accounts,
  activities,
  calls,
  contacts,
  opportunities,
} from "@/data/seed";
import {
  evaluateEngagementForPipeline,
  enrollInReEngagement,
} from "@/lib/champion-engagement-sync";
import {
  appendHistory,
  getEnrollmentStates,
  upsertEngagement,
} from "@/lib/champion-engagement-store";
import { slugifyWorkspaceKey } from "@/lib/integration-context";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { DEFAULT_CONFIG } from "@/lib/workspace";

// Daily champion engagement sweep. Scores every opportunity's champion, applies
// the re-engagement hysteresis against the persisted prior state, writes the
// current-state + history rows, and fires enrollment intents only on the
// transition below threshold.
//
// Pipeline source: today the opportunities/contacts/activities/calls come from
// the seed fixtures (same as how the ask + account-context routes build the
// EvaluationContext). When opps live in Supabase, swap the seed imports for a
// DB read here — the sync orchestrator is source-agnostic.
//
// Auth: CRON_SECRET via Authorization: Bearer (Vercel-injected). Fail-closed
// when the env var isn't set, matching the granola + external-signals crons.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Constant-time compare — same approach as the granola cron and ui-auth.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  const header = req.headers.get("authorization") ?? "";
  return timingSafeEqual(header, `Bearer ${required}`);
}

async function resolveWorkspaceKey(): Promise<string> {
  // No request cookie in a cron context, so getWorkspaceConfig falls back to
  // DEFAULT_CONFIG. Wrapped to be safe — same try/catch pattern as ask-tools.
  try {
    const cfg = await getWorkspaceConfig();
    return slugifyWorkspaceKey(cfg.companyName);
  } catch {
    return slugifyWorkspaceKey(DEFAULT_CONFIG.companyName);
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const workspaceKey = await resolveWorkspaceKey();

    // Load prior enrollment state so the hysteresis dead-band can hold.
    const priorStates = await getEnrollmentStates(workspaceKey);

    const { rows, history, intents } = evaluateEngagementForPipeline({
      workspaceKey,
      opportunities: [...opportunities],
      contacts: [...contacts],
      activities: [...activities],
      calls: [...calls],
      priorStates,
    });

    // Persist current state + trend before executing side effects, so a
    // failure in the executor never loses the scores we just computed.
    const [{ written: stateWritten }, { written: historyWritten }] =
      await Promise.all([upsertEngagement(rows), appendHistory(history)]);

    // Fire enrollment intents (transitions into enrollment only). Each is
    // independent — one failure must not abort the rest.
    const enrollments = await Promise.all(
      intents.map(async (intent) => {
        try {
          return await enrollInReEngagement(intent);
        } catch (e) {
          return {
            intent,
            status: "error" as const,
            detail: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    const belowThreshold = rows.filter((r) => r.below_threshold).length;

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startedAt,
      workspaceKey,
      accountsConsidered: accounts.length,
      oppsScored: rows.length,
      belowThreshold,
      stateWritten,
      historyWritten,
      enrollmentsTriggered: enrollments.length,
      enrollments,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
