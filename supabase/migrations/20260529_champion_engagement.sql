-- Champion engagement scoring: persisted score + re-engagement enrollment
-- state per opportunity, plus an append-only history table for trend.
--
-- Why two tables:
--   - `champion_engagement` is the current-state row, upserted once per
--     evaluation run on (workspace_key, opp_id). It holds the latest score,
--     its component breakdown + drivers, and the re-engagement enrollment
--     state. The enrollment columns are what give the hysteresis logic in
--     lib/champion-engagement.ts (`reEngagementDecision`) a prior state to
--     read — without persistence the dead-band can't hold and the champion
--     would flap in and out of the sequence on every run.
--   - `champion_engagement_history` is append-only, one row per (opp, run).
--     It exists for trend: "responsiveness has been sliding for three weeks"
--     is more actionable than a single snapshot. Kept deliberately thin
--     (score + evaluated_at) so it stays cheap to write daily.
--
-- workspace_key matches the existing cookie-derived identifier (see
-- lib/integration-context.ts) — same forward-compat note as the granola
-- migration: it becomes user_id/workspace_id when auth lands, no schema change.
--
-- Run manually in Supabase Studio (SQL Editor → New query), same as the other
-- migrations in this folder.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- champion_engagement — current-state, one row per (workspace, opportunity).
-- ---------------------------------------------------------------------------
create table if not exists champion_engagement (
  id                      uuid primary key default gen_random_uuid(),
  workspace_key           text not null,
  opp_id                  text not null,
  account_id              text not null,
  champion_contact_id     text,            -- null when no champion mapped
  -- Score is 0-1. numeric(4,3) holds 0.000-1.000 exactly so equality/threshold
  -- comparisons in SQL don't suffer float drift.
  score                   numeric(4,3) not null check (score >= 0 and score <= 1),
  components              jsonb not null default '{}'::jsonb,
  drivers                 jsonb not null default '[]'::jsonb,
  below_threshold         boolean not null default false,
  -- Re-engagement enrollment state. `enrolled` is the persisted flag the
  -- hysteresis logic reads on the next run; `enrolled_at` records when the
  -- champion was last enrolled (cleared to null on un-enroll).
  enrolled                boolean not null default false,
  enrolled_at             timestamptz,
  last_evaluated_at       timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_key, opp_id)
);

create index if not exists champion_engagement_workspace_idx
  on champion_engagement (workspace_key, score);
create index if not exists champion_engagement_account_idx
  on champion_engagement (account_id);
-- Partial index so "who is enrolled right now" stays fast as the table grows.
create index if not exists champion_engagement_enrolled_idx
  on champion_engagement (workspace_key) where enrolled;

-- ---------------------------------------------------------------------------
-- champion_engagement_history — append-only trend log.
-- ---------------------------------------------------------------------------
create table if not exists champion_engagement_history (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null,
  opp_id          text not null,
  score           numeric(4,3) not null check (score >= 0 and score <= 1),
  evaluated_at    timestamptz not null default now()
);

create index if not exists champion_engagement_history_opp_idx
  on champion_engagement_history (workspace_key, opp_id, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- RLS: service-role-only, matching every other table in this project. Enable
-- RLS with no policies so anon/authenticated can't read or write; the
-- service-role client used by cron + API routes bypasses RLS.
-- ---------------------------------------------------------------------------
alter table champion_engagement          enable row level security;
alter table champion_engagement_history  enable row level security;
