"use client";

import {
  getUpcomingMeetings,
  type UpcomingMeeting,
} from "@/data/upcoming-meetings-seed";
import {
  getSeedSignalsForAccount,
  getVerticalForAccount,
} from "@/data/external-signals-seed";
import type { ExternalSignal } from "@/lib/external-signals";
import type { Account } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers to normalise real Supabase rows into the same shape the bullet
// renderer expects. Publisher name falls back to the source enum value so
// the attribution line is never blank.
// ---------------------------------------------------------------------------
function publisherLabel(s: ExternalSignal): string {
  if (s.publisher_canonical_name) return s.publisher_canonical_name;
  if (s.source === "sec_edgar") return "SEC EDGAR";
  if (s.source === "newsapi") return "NewsAPI";
  if (s.source === "newsletter") return "Newsletter";
  if (s.source === "web_scrape") return "Web";
  return s.source;
}

// Right-rail companion to the Pipeline table. Surfaces the 3 soonest
// upcoming meetings, each with 3 news bullets pulled from the
// external-signals seed for that account. The point: walk into the next
// meeting already knowing the latest from that account and its vertical.
//
// Data flow: seed → component. When the real meeting integrations
// (Chili Piper, Granola, calendar) are wired, swap this for a live read.

interface Props {
  accounts: Account[];
  // Real signals pre-fetched server-side, keyed by account_id.
  // When provided and non-empty for an account, used instead of the seed.
  briefSignals?: Record<string, ExternalSignal[]>;
}

export function UpcomingMeetingsPanel({ accounts, briefSignals }: Props) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const meetings = getUpcomingMeetings(3);
  return (
    <aside className="rounded-lg border border-border bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-foreground/[0.02]">
        <h2 className="text-sm font-semibold tracking-tight">
          Pre-meeting brief
        </h2>
        <p className="text-[11px] text-muted leading-snug mt-0.5">
          The 3 soonest meetings on the team&apos;s calendar, with the
          latest news on each account.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {meetings.map((m) => {
          const account = accountById.get(m.account_id);
          const vertical = getVerticalForAccount(m.account_id);

          // Use real Supabase signals when available; fall back to seed only
          // if the live fetch returned nothing for this account.
          const liveSignals = briefSignals?.[m.account_id] ?? [];
          const signals: ExternalSignal[] =
            liveSignals.length > 0
              ? liveSignals.slice(0, 2)
              : getSeedSignalsForAccount(m.account_id)
                  .filter((s) => !isVerticalMatch(s))
                  .slice(0, 2);

          return (
            <li key={m.id} className="p-4 space-y-2.5">
              <MeetingHeader meeting={m} accountName={account?.name ?? m.account_id} />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
                  Latest on {account?.name ?? "account"}
                </span>
                {vertical && (
                  <span className="text-[10px] text-muted">·</span>
                )}
                {vertical && (
                  <span className="text-[10px] text-muted">{vertical}</span>
                )}
              </div>
              {signals.length === 0 ? (
                <div className="text-[11px] text-muted italic">
                  No signals in the lookback window.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {signals.map((s) => (
                    <NewsBullet key={s.id} signal={s} publisherOverride={liveSignals.length > 0 ? publisherLabel(s) : undefined} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function MeetingHeader({
  meeting,
  accountName,
}: {
  meeting: UpcomingMeeting;
  accountName: string;
}) {
  const when = formatMeetingTime(meeting.scheduled_at);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-brand">
          {when}
        </span>
        <span className="text-[10px] font-mono text-muted">
          {meeting.account_id}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold tracking-tight">
        <span className="text-foreground/65 font-normal">Jackson </span>
        <span className="text-foreground/45 font-normal">{"<> "}</span>
        {meeting.attendee_name}
        <span className="text-foreground/55 font-normal">
          {" · "}
          {meeting.attendee_title}
        </span>
      </div>
      <div className="text-[11px] text-foreground/65 leading-snug">
        {accountName}
        <span className="text-muted">{" · "}</span>
        {meeting.meeting_type}
      </div>
    </div>
  );
}

function NewsBullet({
  signal,
  publisherOverride,
}: {
  signal: ExternalSignal;
  publisherOverride?: string;
}) {
  const isVertical = isVerticalMatch(signal);
  const publisher = publisherOverride ?? signal.publisher_canonical_name ?? "source";
  return (
    <li className="flex gap-2 text-[12px] leading-snug">
      <span aria-hidden className="text-muted shrink-0 mt-1 text-[6px]">
        ●
      </span>
      <div className="min-w-0">
        <div className="text-foreground/85">{signal.summary}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
          <span className="font-mono">{publisher}</span>
          <span>·</span>
          <span>{formatRelative(signal.occurred_at)}</span>
          {isVertical && (
            <>
              <span>·</span>
              <span className="text-brand uppercase tracking-[0.1em] font-mono">
                vertical
              </span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function isVerticalMatch(s: ExternalSignal): boolean {
  if (!s.meta || typeof s.meta !== "object") return false;
  return (s.meta as { vertical_match?: boolean }).vertical_match === true;
}

// "Tomorrow 10:00 EST" / "Thu 06:30 EST" / "May 27 11:00 EST"
// Times are converted from the stored UTC timestamp to US Eastern so the
// rendered hour matches what a US-based AE would see on their calendar.
function formatMeetingTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date("2026-05-25T12:00:00Z");
  const tz = "America/New_York";
  const dayDiff = Math.floor(
    (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
  if (dayDiff <= 0) return `Today ${time} EST`;
  if (dayDiff === 1) return `Tomorrow ${time} EST`;
  if (dayDiff < 7) {
    const dow = d.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: tz,
    });
    return `${dow} ${time} EST`;
  }
  const md = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
  return `${md} ${time} EST`;
}

function formatRelative(iso: string): string {
  const now = new Date("2026-05-25T12:00:00Z");
  const then = new Date(iso);
  const days = Math.floor(
    (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}
