// Seeded upcoming meetings used by the Pipeline view's right-side news
// panel. Each entry pairs an account with a future-dated meeting; the panel
// fans 3 latest news bullets per meeting from the external-signals seed.
//
// Today is treated as 2026-05-25 for the demo (matches HANDOFF.md cadence).
// Dates are deterministic so the layout doesn't shift across renders.

export interface UpcomingMeeting {
  id: string;
  account_id: string;
  scheduled_at: string; // ISO 8601
  attendee_name: string;
  attendee_title: string;
  meeting_type: string;
}

export const UPCOMING_MEETINGS: UpcomingMeeting[] = [
  {
    id: "um_sap_signoff",
    account_id: "acc_sap",
    scheduled_at: "2026-05-26T14:00:00Z",
    attendee_name: "Jens Becker",
    attendee_title: "Head of Legal Tech, EMEA",
    meeting_type: "Final contracting walkthrough",
  },
  {
    id: "um_moderna_clo",
    account_id: "acc_moderna",
    scheduled_at: "2026-05-27T15:00:00Z",
    attendee_name: "Sarah Iyer",
    attendee_title: "Chief Legal Officer",
    meeting_type: "Discovery deep-dive",
  },
  {
    id: "um_snowflake_cfo",
    account_id: "acc_snowflake",
    scheduled_at: "2026-05-28T16:30:00Z",
    attendee_name: "Jane Chen",
    attendee_title: "Senior Counsel, Commercial",
    meeting_type: "CFO + IT joint review",
  },
  {
    id: "um_atlassian_tco",
    account_id: "acc_atlassian",
    scheduled_at: "2026-05-29T13:00:00Z",
    attendee_name: "Brendan Kelly",
    attendee_title: "Head of Legal Operations",
    meeting_type: "TCO walkthrough with CFO",
  },
  {
    id: "um_kkr_finance",
    account_id: "acc_kkr",
    scheduled_at: "2026-06-01T18:00:00Z",
    attendee_name: "Daniel Cohen",
    attendee_title: "Director, Legal Operations",
    meeting_type: "Finance loop-in",
  },
  {
    id: "um_hitachi_apac",
    account_id: "acc_hitachi",
    scheduled_at: "2026-06-03T09:00:00Z",
    attendee_name: "Kenji Tanaka",
    attendee_title: "Senior Manager, Global Legal Ops",
    meeting_type: "APAC GC briefing",
  },
];

// Returns meetings sorted by scheduled_at ascending, optionally capped.
export function getUpcomingMeetings(limit = 3): UpcomingMeeting[] {
  return [...UPCOMING_MEETINGS]
    .sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1))
    .slice(0, limit);
}
