import { supabaseAdmin } from "./supabase";
import type {
  MeetingSignalSeverity,
  MeetingSignalType,
} from "./granola-classifier";

// Meeting signals — Granola-sourced signals stored per (account, note_id,
// signal_type) so a single meeting can fire multiple types and re-syncs stay
// idempotent. Schema lives in
// supabase/migrations/20260523_granola_integration.sql.
//
// Distinct from `external_signals` because:
//   - These are tied to a specific meeting (note_id), not just a date.
//   - They carry a `raw_excerpt` so the drawer can show "this is the
//     quote that triggered the signal."
//   - Sync model is "list-then-classify" rather than the news/SEC
//     fetch-and-dedup-by-url pattern.

export interface MeetingSignalRow {
  id: string;
  workspace_key: string;
  account_id: string;
  note_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  granola_url: string | null;
  signal_type: MeetingSignalType;
  severity: MeetingSignalSeverity;
  summary: string;
  raw_excerpt: string | null;
  classifier: "haiku" | "heuristic" | "none";
  meta: Record<string, unknown>;
  created_at: string;
}

export interface NewMeetingSignal {
  workspace_key: string;
  account_id: string;
  note_id: string;
  meeting_title: string | null;
  meeting_date: string | null;
  granola_url: string | null;
  signal_type: MeetingSignalType;
  severity: MeetingSignalSeverity;
  summary: string;
  raw_excerpt: string | null;
  classifier?: "haiku" | "heuristic" | "none";
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMeetingSignalsForAccount(
  accountId: string,
  workspaceKey: string,
  limit = 25,
): Promise<MeetingSignalRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("meeting_signals")
    .select("*")
    .eq("account_id", accountId)
    .eq("workspace_key", workspaceKey)
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as MeetingSignalRow[];
}

// All meetings the workspace has seen, grouped by note. Used by the
// /integrations/granola page to show recent matched meetings + their signals.
export async function getRecentMeetingsByWorkspace(
  workspaceKey: string,
  limit = 100,
): Promise<MeetingSignalRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("meeting_signals")
    .select("*")
    .eq("workspace_key", workspaceKey)
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  return (data ?? []) as MeetingSignalRow[];
}

// ---------------------------------------------------------------------------
// Writes — upsert on (account_id, note_id, signal_type) so re-classifying
// the same note updates rather than duplicates. Returns insert/update
// counts so the sync UI can report meaningful progress.
// ---------------------------------------------------------------------------

export async function upsertMeetingSignals(
  signals: NewMeetingSignal[],
): Promise<{ written: number }> {
  if (signals.length === 0) return { written: 0 };
  const sb = supabaseAdmin();
  const payload = signals.map((s) => ({
    ...s,
    classifier: s.classifier ?? "haiku",
    meta: s.meta ?? {},
  }));
  const { error, count } = await sb
    .from("meeting_signals")
    .upsert(payload, {
      onConflict: "workspace_key,account_id,note_id,signal_type",
      count: "exact",
    });
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
  return { written: count ?? payload.length };
}

// ---------------------------------------------------------------------------
// Account overrides — manual user mappings of note → account.
// ---------------------------------------------------------------------------

export interface AccountOverrideRow {
  workspace_key: string;
  note_id: string;
  account_id: string | null; // null means "explicitly ignore this note"
  created_at: string;
}

export async function getAccountOverrides(
  workspaceKey: string,
): Promise<Map<string, string | null>> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("meeting_account_overrides")
    .select("note_id, account_id")
    .eq("workspace_key", workspaceKey);
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  const out = new Map<string, string | null>();
  for (const row of data ?? []) {
    out.set(
      (row as { note_id: string }).note_id,
      (row as { account_id: string | null }).account_id,
    );
  }
  return out;
}

export async function setAccountOverride(
  workspaceKey: string,
  noteId: string,
  accountId: string | null, // null = "ignore"
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("meeting_account_overrides")
    .upsert(
      { workspace_key: workspaceKey, note_id: noteId, account_id: accountId },
      { onConflict: "workspace_key,note_id" },
    );
  if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Unassigned bucket — meetings we saw but couldn't auto-match. Stored
// inline in workspace_integrations.meta so we don't need a third table for
// transient notes (we only keep the last sync's unassigned list).
// ---------------------------------------------------------------------------

export interface UnassignedMeeting {
  noteId: string;
  title: string | null;
  meetingDate: string | null;
  granolaUrl: string | null;
  attendees: { name: string | null; email: string }[];
  organiserEmail: string | null;
  // Why we couldn't match (debug + UI hint).
  reason: "no_external_domain" | "domain_unknown";
}
