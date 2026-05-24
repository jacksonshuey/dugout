"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UnassignedMeeting } from "@/lib/meeting-signals";
import { assignUnassignedMeeting } from "@/app/actions/granola";

// One-click assignment of unassigned meetings → accounts. Pure client
// component; takes an account list as a prop so it works the same on dev
// (seed accounts) as it would on a real CRM-backed deployment.

export function UnassignedMeetingsList({
  items,
  accounts,
}: {
  items: UnassignedMeeting[];
  accounts: { id: string; name: string }[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-background divide-y divide-border">
      {items.map((m) => (
        <UnassignedRow key={m.noteId} meeting={m} accounts={accounts} />
      ))}
    </div>
  );
}

function UnassignedRow({
  meeting,
  accounts,
}: {
  meeting: UnassignedMeeting;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  function assign() {
    if (!selected) {
      setError("Pick an account.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await assignUnassignedMeeting(meeting.noteId, selected);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function ignore() {
    setError(null);
    startTransition(async () => {
      try {
        await assignUnassignedMeeting(meeting.noteId, null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const externalAttendees = meeting.attendees.filter((a) => {
    if (!meeting.organiserEmail) return true;
    const orgDomain = meeting.organiserEmail.split("@")[1]?.toLowerCase();
    const aDomain = a.email.split("@")[1]?.toLowerCase();
    return aDomain !== orgDomain;
  });

  return (
    <div className="p-4 flex flex-col sm:flex-row gap-4 items-start">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium text-sm">
            {meeting.title ?? "(untitled meeting)"}
          </span>
          {meeting.meetingDate && (
            <span className="text-xs text-muted font-mono">
              {new Date(meeting.meetingDate).toLocaleDateString()}
            </span>
          )}
          <ReasonChip reason={meeting.reason} />
        </div>
        {externalAttendees.length > 0 && (
          <div className="text-xs text-muted">
            External attendees:{" "}
            {externalAttendees
              .map((a) => a.email)
              .slice(0, 5)
              .join(", ")}
            {externalAttendees.length > 5 &&
              ` (+${externalAttendees.length - 5} more)`}
          </div>
        )}
        {meeting.granolaUrl && (
          <a
            href={meeting.granolaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-muted hover:text-brand inline-block"
          >
            Open in Granola ↗
          </a>
        )}
        {error && (
          <div className="text-xs text-severity-blocking">{error}</div>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 shrink-0 items-stretch sm:items-center">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={`Assign account for ${meeting.title ?? meeting.noteId}`}
          className="rounded-md border border-border bg-background px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        >
          <option value="">Pick account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={assign}
          disabled={pending || !selected}
          className="inline-flex items-center justify-center px-3 h-9 rounded-lg text-sm font-medium bg-brand text-white hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : "Assign"}
        </button>
        <button
          onClick={ignore}
          disabled={pending}
          className="inline-flex items-center justify-center px-3 h-9 rounded-lg text-sm font-medium text-muted hover:text-foreground hover:bg-black/[0.04] disabled:opacity-50"
          title="Don't show this meeting again"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}

function ReasonChip({ reason }: { reason: UnassignedMeeting["reason"] }) {
  const label =
    reason === "no_external_domain" ? "internal-looking" : "unknown domain";
  return (
    <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border">
      {label}
    </span>
  );
}
