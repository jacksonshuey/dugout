import { supabaseAdmin } from "./supabase";
import type { EngagementComponents } from "./champion-engagement";

// Persistence for champion engagement scores. Schema lives in
// supabase/migrations/20260529_champion_engagement.sql.
//
// Two surfaces:
//   - `champion_engagement` current-state, upserted on (workspace_key, opp_id).
//     Reads here feed the hysteresis decision (prior enrollment state) and the
//     UI (latest score + drivers).
//   - `champion_engagement_history` append-only, one row per evaluation run,
//     for trend.
//
// Mirrors the read/write shape of meeting-signals.ts so the two stores read
// consistently.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngagementRow {
  workspace_key: string;
  opp_id: string;
  account_id: string;
  champion_contact_id: string | null;
  score: number;
  components: EngagementComponents;
  drivers: string[];
  below_threshold: boolean;
  enrolled: boolean;
  enrolled_at: string | null;
  last_evaluated_at: string;
}

// The minimal prior-state slice the hysteresis decision needs on the next run.
export interface PriorEnrollmentState {
  enrolled: boolean;
  enrolledAt: string | null;
}

export interface HistoryRow {
  workspace_key: string;
  opp_id: string;
  score: number;
  evaluated_at: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Prior enrollment state for every opp in a workspace, keyed by opp_id. The
// sync orchestrator loads this once per run so each opp's hysteresis decision
// can see whether it was already enrolled. Opps with no row default to
// "not enrolled" at the call site.
export async function getEnrollmentStates(
  workspaceKey: string,
): Promise<Map<string, PriorEnrollmentState>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("champion_engagement")
    .select("opp_id, enrolled, enrolled_at")
    .eq("workspace_key", workspaceKey);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  const out = new Map<string, PriorEnrollmentState>();
  for (const row of data ?? []) {
    const r = row as { opp_id: string; enrolled: boolean; enrolled_at: string | null };
    out.set(r.opp_id, { enrolled: r.enrolled, enrolledAt: r.enrolled_at });
  }
  return out;
}

export async function getEngagementForAccount(
  accountId: string,
  workspaceKey: string,
): Promise<EngagementRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("champion_engagement")
    .select("*")
    .eq("account_id", accountId)
    .eq("workspace_key", workspaceKey)
    .order("score", { ascending: true });
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as EngagementRow[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Upsert current-state rows on (workspace_key, opp_id). Returns the count
// written so the cron can report progress.
export async function upsertEngagement(
  rows: EngagementRow[],
): Promise<{ written: number }> {
  if (rows.length === 0) return { written: 0 };
  const sb = supabaseAdmin();
  const payload = rows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error, count } = await sb
    .from("champion_engagement")
    .upsert(payload, { onConflict: "workspace_key,opp_id", count: "exact" });
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  return { written: count ?? payload.length };
}

// Append one history row per opp for trend. Pure insert (no conflict target) —
// each run is a new observation.
export async function appendHistory(
  rows: HistoryRow[],
): Promise<{ written: number }> {
  if (rows.length === 0) return { written: 0 };
  const sb = supabaseAdmin();
  const { error, count } = await sb
    .from("champion_engagement_history")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return { written: count ?? rows.length };
}
