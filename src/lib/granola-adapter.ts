import type { Account } from "./types";
import {
  createGranolaClient,
  type GranolaClient,
  type GranolaNote,
  type GranolaUser,
} from "./granola-client";
import {
  classifyMeeting,
  type ClassifiedMeetingSignal,
} from "./granola-classifier";
import {
  getAccountOverrides,
  upsertMeetingSignals,
  type NewMeetingSignal,
  type UnassignedMeeting,
} from "./meeting-signals";
import { recordSyncResult } from "./workspace-integrations";

// Granola adapter — orchestrates one sync run for one workspace.
//
// Pipeline:
//   1. List notes created in the lookback window.
//   2. For each note: skip internal-only meetings (free filter, no LLM cost).
//   3. Apply user overrides first (manual mappings always win).
//   4. Else auto-match: attendee-domain → title-keyword → unassigned.
//   5. For matched meetings, fetch full note (summary), classify via Haiku,
//      upsert signals.
//   6. Return per-meeting summary so the UI can show matches/unmatched
//      counts + signal counts.
//
// Failure model: per-note errors are caught and reported in `errors`; the
// run still completes for the other notes. recordSyncResult is called at
// the end with status="success" / "partial" / "error" so the settings UI
// shows the truth.

const DEFAULT_LOOKBACK_DAYS = 14;

export interface SyncResult {
  workspaceKey: string;
  ranAt: string;
  durationMs: number;
  totalNotes: number;
  internalSkipped: number; // all attendees on rep's domain
  ignoredByOverride: number;
  matched: number;
  unassigned: UnassignedMeeting[];
  signalsWritten: number;
  errors: { noteId: string; message: string }[];
  status: "success" | "partial" | "error";
}

export interface SyncOptions {
  apiKey: string;
  workspaceKey: string;
  accounts: Account[];
  lookbackDays?: number;
  // When set, only sync this single note. Used by /api/integrations/granola/test
  // to verify a freshly-pasted key.
  singleNoteId?: string;
}

// ---------------------------------------------------------------------------
// Helpers — pure so they're testable without the network.
// ---------------------------------------------------------------------------

export function extractDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

// All attendee + organiser emails, deduped. The Granola attendee list and the
// calendar_event.invitees can overlap — collapse both.
export function collectAllEmails(note: GranolaNote): string[] {
  const set = new Set<string>();
  for (const a of note.attendees) {
    if (a.email) set.add(a.email.toLowerCase());
  }
  if (note.calendar_event) {
    if (note.calendar_event.organiser) {
      set.add(note.calendar_event.organiser.toLowerCase());
    }
    for (const inv of note.calendar_event.invitees) {
      if (inv.email) set.add(inv.email.toLowerCase());
    }
  }
  return [...set];
}

// Domains we treat as "internal" — the organiser's domain plus the note
// owner's. Used to filter internal-only meetings AND to strip the
// vendor side out of attendee-matching.
export function internalDomains(note: GranolaNote): string[] {
  const set = new Set<string>();
  const ownerDomain = extractDomain(note.owner.email);
  if (ownerDomain) set.add(ownerDomain);
  const orgDomain =
    note.calendar_event?.organiser &&
    extractDomain(note.calendar_event.organiser);
  if (orgDomain) set.add(orgDomain);
  return [...set];
}

// True when every attendee+invitee shares an internal domain. Cheap free
// filter — saves the LLM call for vendor 1:1s / team standups.
export function isInternalOnly(note: GranolaNote): boolean {
  const emails = collectAllEmails(note);
  if (emails.length === 0) return true; // No attendees → nothing to extract.
  const internal = new Set(internalDomains(note));
  if (internal.size === 0) return false;
  return emails.every((e) => {
    const d = extractDomain(e);
    return d !== null && internal.has(d);
  });
}

interface AccountMatchIndex {
  byDomain: Map<string, Account>;
  // For title-keyword fallback: account name → account.
  byNameLower: { name: string; account: Account }[];
}

export function buildMatchIndex(accounts: Account[]): AccountMatchIndex {
  const byDomain = new Map<string, Account>();
  const byNameLower: { name: string; account: Account }[] = [];
  for (const a of accounts) {
    if (a.domain) byDomain.set(a.domain.toLowerCase(), a);
    if (a.name) {
      byNameLower.push({ name: a.name.toLowerCase(), account: a });
    }
  }
  // Sort title-name candidates longest-first so "KKR & Co." wins over "KK"
  // if both were ever in the seed. Avoids partial-keyword false positives.
  byNameLower.sort((a, b) => b.name.length - a.name.length);
  return { byDomain, byNameLower };
}

export type MatchResult =
  | { kind: "matched"; account: Account; via: "domain" | "title" }
  | { kind: "unmatched"; reason: UnassignedMeeting["reason"] };

export function matchNoteToAccount(
  note: GranolaNote,
  index: AccountMatchIndex,
): MatchResult {
  // 1. Attendee-domain match. Strip internal domains; first external domain
  //    that maps to a known account wins.
  const internal = new Set(internalDomains(note));
  const emails = collectAllEmails(note);
  const externalDomains = new Set<string>();
  for (const e of emails) {
    const d = extractDomain(e);
    if (!d) continue;
    if (internal.has(d)) continue;
    externalDomains.add(d);
  }
  for (const d of externalDomains) {
    const acc = index.byDomain.get(d);
    if (acc) return { kind: "matched", account: acc, via: "domain" };
  }

  // 2. Title-keyword match against account name (longest-first).
  const title = (note.title ?? note.calendar_event?.event_title ?? "")
    .toLowerCase()
    .trim();
  if (title.length > 0) {
    for (const candidate of index.byNameLower) {
      // Word-boundary-ish match: pad with spaces so "ups" doesn't match
      // "ups-ide" inside another word. Cheap heuristic; good enough.
      const haystack = ` ${title} `;
      const needle = ` ${candidate.name} `;
      if (haystack.includes(needle)) {
        return { kind: "matched", account: candidate.account, via: "title" };
      }
    }
  }

  // 3. Unmatched. Tag the reason for the UI/debug.
  if (externalDomains.size === 0) {
    return { kind: "unmatched", reason: "no_external_domain" };
  }
  return { kind: "unmatched", reason: "domain_unknown" };
}

// ---------------------------------------------------------------------------
// Per-note processor. Pulls full note (already in hand for v1 since List
// returns the full shape minus transcript), runs the classifier, builds
// rows.
// ---------------------------------------------------------------------------

interface ProcessedNote {
  signals: NewMeetingSignal[];
  classified: ClassifiedMeetingSignal[];
}

async function processMatchedNote(
  client: GranolaClient,
  note: GranolaNote,
  accountId: string,
  workspaceKey: string,
): Promise<ProcessedNote> {
  // List notes already include summary_text / summary_markdown / attendees.
  // Re-fetching only buys us transcript, which we deliberately skip for cost
  // reasons (see granola-classifier header). If the listing somehow lacks a
  // summary, refetch once with the Get Note endpoint.
  let summary = note.summary_markdown ?? note.summary_text ?? "";
  if (!summary || summary.trim().length < 40) {
    try {
      const fetched = await client.getNote(note.id);
      summary = fetched.summary_markdown ?? fetched.summary_text ?? "";
    } catch {
      // Couldn't refetch — treat as no-summary, classifier will short-circuit.
    }
  }

  const classified = await classifyMeeting({
    meetingTitle: note.title ?? note.calendar_event?.event_title ?? null,
    meetingDate:
      note.calendar_event?.scheduled_start_time ?? note.created_at,
    attendees: note.attendees.map((a: GranolaUser) => ({
      name: a.name,
      email: a.email,
    })),
    organiserEmail: note.calendar_event?.organiser ?? null,
    internalDomains: internalDomains(note),
    summary,
  });

  const signals: NewMeetingSignal[] = classified.map((c) => ({
    workspace_key: workspaceKey,
    account_id: accountId,
    note_id: note.id,
    meeting_title: note.title ?? note.calendar_event?.event_title ?? null,
    meeting_date:
      note.calendar_event?.scheduled_start_time ?? note.created_at ?? null,
    granola_url: note.web_url ?? null,
    signal_type: c.type,
    severity: c.severity,
    summary: c.summary,
    raw_excerpt: c.rawExcerpt,
    classifier: "haiku",
    meta: {},
  }));

  return { signals, classified };
}

// ---------------------------------------------------------------------------
// Public sync entry point.
// ---------------------------------------------------------------------------

export async function syncGranola(opts: SyncOptions): Promise<SyncResult> {
  const startedAt = Date.now();
  const workspaceKey = opts.workspaceKey;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const client = createGranolaClient(opts.apiKey);
  const matchIndex = buildMatchIndex(opts.accounts);

  // Load user overrides up-front. Map<note_id, account_id | null>.
  // account_id === null → user said "ignore this note."
  let overrides = new Map<string, string | null>();
  try {
    overrides = await getAccountOverrides(workspaceKey);
  } catch (e) {
    // Non-fatal — proceed without overrides if Supabase is grumpy.
    console.warn(
      "[granola-adapter] Override fetch failed; proceeding without overrides",
      e instanceof Error ? e.message : String(e),
    );
  }

  // Pull notes. singleNoteId path skips listing for the "test connection" flow.
  let notes: GranolaNote[];
  try {
    if (opts.singleNoteId) {
      const note = await client.getNote(opts.singleNoteId);
      notes = [note];
    } else {
      notes = await client.listAllNotes({ created_after: since });
    }
  } catch (e) {
    // Top-level list failure → record as a sync error and bail. Most likely
    // cause: invalid API key, in which case the user needs to re-paste.
    const msg = e instanceof Error ? e.message : String(e);
    await recordSyncResult(workspaceKey, "granola", {
      status: "error",
      error: msg,
      summary: { phase: "list_notes" },
    });
    return {
      workspaceKey,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      totalNotes: 0,
      internalSkipped: 0,
      ignoredByOverride: 0,
      matched: 0,
      unassigned: [],
      signalsWritten: 0,
      errors: [{ noteId: "(list)", message: msg }],
      status: "error",
    };
  }

  let internalSkipped = 0;
  let ignoredByOverride = 0;
  let matchedCount = 0;
  let signalsWritten = 0;
  const unassigned: UnassignedMeeting[] = [];
  const errors: SyncResult["errors"] = [];
  const allSignals: NewMeetingSignal[] = [];

  for (const note of notes) {
    try {
      // 1. Honor user override first. account_id === null means "ignore"; a
      //    real account_id means "use this account regardless of heuristic."
      if (overrides.has(note.id)) {
        const overrideAcc = overrides.get(note.id);
        if (overrideAcc === null) {
          ignoredByOverride++;
          continue;
        }
        if (overrideAcc) {
          const { signals } = await processMatchedNote(
            client,
            note,
            overrideAcc,
            workspaceKey,
          );
          allSignals.push(...signals);
          matchedCount++;
          continue;
        }
      }

      // 2. Internal-only filter (no LLM cost).
      if (isInternalOnly(note)) {
        internalSkipped++;
        continue;
      }

      // 3. Auto-match.
      const match = matchNoteToAccount(note, matchIndex);
      if (match.kind === "unmatched") {
        unassigned.push({
          noteId: note.id,
          title: note.title ?? note.calendar_event?.event_title ?? null,
          meetingDate:
            note.calendar_event?.scheduled_start_time ?? note.created_at,
          granolaUrl: note.web_url ?? null,
          attendees: note.attendees.map((a) => ({
            name: a.name,
            email: a.email,
          })),
          organiserEmail: note.calendar_event?.organiser ?? null,
          reason: match.reason,
        });
        continue;
      }

      const { signals } = await processMatchedNote(
        client,
        note,
        match.account.id,
        workspaceKey,
      );
      allSignals.push(...signals);
      matchedCount++;
    } catch (e) {
      errors.push({
        noteId: note.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (allSignals.length > 0) {
    try {
      const { written } = await upsertMeetingSignals(allSignals);
      signalsWritten = written;
    } catch (e) {
      errors.push({
        noteId: "(upsert)",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const status: SyncResult["status"] =
    errors.length === 0
      ? "success"
      : matchedCount > 0
        ? "partial"
        : "error";

  // Bookkeeping write — store enough to show "last sync" in settings.
  try {
    await recordSyncResult(workspaceKey, "granola", {
      status,
      error: errors[0]?.message ?? null,
      summary: {
        totalNotes: notes.length,
        internalSkipped,
        ignoredByOverride,
        matched: matchedCount,
        unassignedCount: unassigned.length,
        signalsWritten,
        errorCount: errors.length,
      },
      meta: {
        // Persist the unassigned list so the /integrations/granola page can
        // show it without re-querying Granola. Replaced wholesale per sync.
        unassigned,
        lastSyncLookbackDays: lookbackDays,
      },
    });
  } catch (e) {
    // Non-fatal: the sync itself succeeded even if bookkeeping failed.
    console.warn(
      "[granola-adapter] recordSyncResult failed",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    workspaceKey,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    totalNotes: notes.length,
    internalSkipped,
    ignoredByOverride,
    matched: matchedCount,
    unassigned,
    signalsWritten,
    errors,
    status,
  };
}
