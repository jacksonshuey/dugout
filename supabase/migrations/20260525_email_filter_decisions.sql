-- Email content filter audit log. One row per gate decision — including
-- Stage 1 rejects, Stage 2 verdicts, low-confidence routings, and
-- fail-closed Haiku failures.
--
-- Lets us answer:
--   "How many emails were rejected at Stage 1 this week, by reason?"
--   "What's the confidence distribution from Stage 2 over the last month?"
--   "Which prompt_version was running when this signal was let through?"
--   "Which signals were manually flagged as bad?"
--
-- inbound_email_id is the FK. We carry our own UUID `id` PK so multiple
-- decision rows can coexist per inbound email (a future re-classify under a
-- new prompt_version adds a row instead of updating one, preserving full
-- history).
--
-- Run manually in Supabase Studio (SQL Editor → New query) or via
-- supabase CLI migrate. Same posture as ask_request_log + ranker_cache.

create table if not exists email_filter_decisions (
  id                    uuid         primary key default gen_random_uuid(),
  inbound_email_id      uuid         not null references inbound_emails(id) on delete cascade,
  stage                 smallint     not null check (stage in (1, 2)),
  verdict               text         not null check (verdict in (
                          'newsworthy', 'logistics', 'promotional', 'other',
                          'stage1_rejected'
                        )),
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reasoning             text         not null,
  model                 text,
  prompt_version        text         not null,
  decided_at            timestamptz  not null default now(),
  manually_overridden   boolean      not null default false,
  override_reason       text
);

-- Hot path: lookup by inbound_email for the "view audit history" drawer.
create index if not exists efd_inbound on email_filter_decisions (inbound_email_id, decided_at desc);

-- Reporting path: count by reason/version over a time window.
create index if not exists efd_reason_window on email_filter_decisions (prompt_version, verdict, decided_at desc);

-- RLS deny-all. Service role bypasses; anon/authenticated cannot read.
-- Matches the session-7 RLS posture used by every other public.* table.
alter table email_filter_decisions enable row level security;
