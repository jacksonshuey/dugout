import { accounts } from "@/data/seed";
import { getIntegrationContext } from "@/lib/integration-context";
import {
  getIntegrationStatus,
  type WorkspaceIntegrationStatus,
} from "@/lib/workspace-integrations";
import {
  getRecentMeetingsByWorkspace,
  type MeetingSignalRow,
  type UnassignedMeeting,
} from "@/lib/meeting-signals";
import { UnassignedMeetingsList } from "@/components/unassigned-meetings-list";

// /integrations/granola — manual-mapping UI for meetings the auto-matcher
// couldn't place + a roll-up of recently classified meetings per account.
// Renders disconnected-state if Granola isn't configured yet.

export default async function GranolaIntegrationPage() {
  const ctx = await getIntegrationContext();

  let status: WorkspaceIntegrationStatus = {
    connected: false,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncSummary: null,
    meta: {},
    updatedAt: null,
  };
  try {
    status = await getIntegrationStatus(ctx.workspaceKey, "granola");
  } catch {
    // table missing → disconnected
  }

  // Unassigned bucket is persisted on the integration row's meta so it
  // survives page reloads without re-querying Granola. Replaced wholesale
  // per sync.
  const unassigned = readUnassignedFromMeta(status.meta);
  let recentMeetings: MeetingSignalRow[] = [];
  if (status.connected) {
    try {
      recentMeetings = await getRecentMeetingsByWorkspace(ctx.workspaceKey, 50);
    } catch {
      recentMeetings = [];
    }
  }

  // Group signals by note so the same meeting doesn't show 3 rows when it
  // emitted 3 signal types.
  const meetingsByNote = new Map<string, MeetingSignalRow[]>();
  for (const row of recentMeetings) {
    const list = meetingsByNote.get(row.note_id) ?? [];
    list.push(row);
    meetingsByNote.set(row.note_id, list);
  }

  const accountChoices = accounts
    .map((a) => ({ id: a.id, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Granola — meeting intelligence
        </h1>
        <p className="text-sm text-muted max-w-2xl">
          Auto-matches Granola meetings to your accounts via attendee email
          domain, with a title-keyword fallback. Anything we can&apos;t place
          shows up here for one-click assignment.
        </p>
      </header>

      {!status.connected ? (
        <DisconnectedNotice />
      ) : (
        <>
          <SyncSummary status={status} />

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Unassigned meetings</h2>
              <span className="text-xs text-muted">
                {unassigned.length} pending
              </span>
            </div>
            {unassigned.length === 0 ? (
              <div className="text-sm text-muted italic">
                Nothing pending. The auto-matcher caught everything from the
                last sync.
              </div>
            ) : (
              <UnassignedMeetingsList
                items={unassigned}
                accounts={accountChoices}
              />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Recently classified</h2>
              <span className="text-xs text-muted">
                {meetingsByNote.size} meeting
                {meetingsByNote.size === 1 ? "" : "s"} ·{" "}
                {recentMeetings.length} signal
                {recentMeetings.length === 1 ? "" : "s"}
              </span>
            </div>
            {meetingsByNote.size === 0 ? (
              <div className="text-sm text-muted italic">
                No classified meetings yet. The next Granola cron sync will
                backfill this view.
              </div>
            ) : (
              <RecentMeetingsTable
                meetingsByNote={meetingsByNote}
                accounts={accountChoices}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function DisconnectedNotice() {
  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-2">
      <div className="text-sm text-muted">Granola isn&apos;t connected yet.</div>
      <div className="text-xs text-muted">
        Configure the workspace API key to enable meeting intelligence.
      </div>
    </div>
  );
}

function SyncSummary({ status }: { status: WorkspaceIntegrationStatus }) {
  const summary = (status.lastSyncSummary ?? {}) as Record<string, unknown>;
  const item = (key: string): string => {
    const v = summary[key];
    return typeof v === "number" ? String(v) : "—";
  };
  return (
    <section className="rounded-2xl border border-border bg-background p-5 space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted font-medium">
        Last sync
      </div>
      <div className="text-sm">
        {status.lastSyncedAt ? (
          <>
            <span className="text-foreground font-medium">
              {new Date(status.lastSyncedAt).toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            {status.lastSyncStatus && (
              <span
                className={
                  status.lastSyncStatus === "success"
                    ? "ml-2 text-severity-green"
                    : status.lastSyncStatus === "partial"
                      ? "ml-2 text-severity-action"
                      : "ml-2 text-severity-blocking"
                }
              >
                · {status.lastSyncStatus}
              </span>
            )}
          </>
        ) : (
          <span className="italic text-muted">never run</span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-2 border-t border-border">
        <Stat label="Notes pulled" value={item("totalNotes")} />
        <Stat label="Matched" value={item("matched")} />
        <Stat label="Unassigned" value={item("unassignedCount")} />
        <Stat label="Internal skipped" value={item("internalSkipped")} />
        <Stat label="Signals written" value={item("signalsWritten")} />
      </div>
      {status.lastSyncError && (
        <div className="text-xs text-severity-blocking font-mono pt-2 border-t border-border opacity-80">
          {status.lastSyncError.slice(0, 240)}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="uppercase tracking-wider text-muted font-medium text-[10px]">
        {label}
      </div>
      <div className="text-foreground text-sm font-medium">{value}</div>
    </div>
  );
}

function RecentMeetingsTable({
  meetingsByNote,
  accounts,
}: {
  meetingsByNote: Map<string, MeetingSignalRow[]>;
  accounts: { id: string; name: string }[];
}) {
  // Sort by most recent meeting_date across signal rows.
  const entries = [...meetingsByNote.entries()]
    .map(([noteId, rows]) => {
      const date = rows[0]?.meeting_date ?? null;
      return { noteId, rows, date };
    })
    .sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : -1;
    });
  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Meeting</th>
            <th className="text-left px-4 py-2 font-medium">Account</th>
            <th className="text-left px-4 py-2 font-medium">Signals</th>
            <th className="text-left px-4 py-2 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(({ noteId, rows }) => {
            const first = rows[0];
            return (
              <tr key={noteId} className="border-t border-border">
                <td className="px-4 py-3 align-top">
                  <div className="font-medium">
                    {first.meeting_title ?? "(untitled meeting)"}
                  </div>
                  {first.granola_url && (
                    <a
                      href={first.granola_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-muted hover:text-brand"
                    >
                      Open in Granola ↗
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-muted">
                  {accountName(first.account_id)}
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap gap-1">
                    {rows.map((r) => (
                      <SignalChip key={r.id} row={r} />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-muted text-xs font-mono">
                  {first.meeting_date
                    ? new Date(first.meeting_date).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SignalChip({ row }: { row: MeetingSignalRow }) {
  const severityClass =
    row.severity === "blocking"
      ? "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20"
      : row.severity === "action"
        ? "bg-severity-action-bg text-severity-action border-severity-action/20"
        : "bg-severity-awareness-bg text-severity-awareness border-severity-awareness/20";
  return (
    <span
      className={`text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded border ${severityClass}`}
      title={row.summary}
    >
      {row.signal_type.replace(/_/g, " ")}
    </span>
  );
}

function readUnassignedFromMeta(
  meta: Record<string, unknown>,
): UnassignedMeeting[] {
  const raw = meta.unassigned;
  if (!Array.isArray(raw)) return [];
  const out: UnassignedMeeting[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.noteId !== "string") continue;
    out.push({
      noteId: r.noteId,
      title: typeof r.title === "string" ? r.title : null,
      meetingDate:
        typeof r.meetingDate === "string" ? r.meetingDate : null,
      granolaUrl:
        typeof r.granolaUrl === "string" ? r.granolaUrl : null,
      attendees: Array.isArray(r.attendees)
        ? (r.attendees as { name: string | null; email: string }[]).filter(
            (a) => a && typeof a.email === "string",
          )
        : [],
      organiserEmail:
        typeof r.organiserEmail === "string" ? r.organiserEmail : null,
      reason:
        r.reason === "no_external_domain" || r.reason === "domain_unknown"
          ? r.reason
          : "domain_unknown",
    });
  }
  return out;
}
