import { NextResponse } from "next/server";
import { accounts } from "@/data/seed";
import {
  getIntegrationKey,
} from "@/lib/workspace-integrations";
import { syncGranola } from "@/lib/granola-adapter";
import { supabaseAdmin } from "@/lib/supabase";

// Daily Granola sync. Runs across every workspace_integrations row that has
// a granola key. For the demo / single-tenant build this will typically be
// one workspace, but the iteration is workspace-scoped so multi-tenant
// "just works" when Google auth lands.
//
// Auth: CRON_SECRET via Authorization: Bearer (Vercel-injected). Fail-closed
// when the env var isn't set, matching the external-signals cron.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface WorkspaceRow {
  workspace_key: string;
}

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${required}`;
}

async function listConnectedWorkspaces(): Promise<string[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("workspace_integrations")
    .select("workspace_key")
    .eq("integration", "granola");
  if (error) {
    throw new Error(`Supabase read failed: ${error.message}`);
  }
  return (data ?? []).map((r) => (r as WorkspaceRow).workspace_key);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const workspaces = await listConnectedWorkspaces();
    // Per-workspace try/catch so a Vault read failure (or any other thrown
    // error) on one workspace doesn't reject Promise.all and abort the
    // entire run — every workspace records its own outcome.
    const results = await Promise.all(
      workspaces.map(async (workspaceKey) => {
        try {
          const apiKey = await getIntegrationKey(workspaceKey, "granola");
          if (!apiKey) {
            return {
              workspaceKey,
              status: "error" as const,
              error: "Vault returned no key for this workspace_integrations row",
            };
          }
          const result = await syncGranola({
            apiKey,
            workspaceKey,
            accounts: [...accounts],
          });
          return {
            workspaceKey,
            status: result.status,
            totalNotes: result.totalNotes,
            matched: result.matched,
            signalsWritten: result.signalsWritten,
            unassigned: result.unassigned.length,
            internalSkipped: result.internalSkipped,
            errorCount: result.errors.length,
            durationMs: result.durationMs,
          };
        } catch (e) {
          return {
            workspaceKey,
            status: "error" as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    return NextResponse.json({
      ranAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startedAt,
      workspaceCount: workspaces.length,
      results,
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
