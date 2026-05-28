-- Per-email agent chain (the four-agent showcase pipeline).
--
-- Runs on EACH inbound newsletter email, alongside the existing
-- classifyNewsletter flow (inbound-pipeline.ts). Four agents, gate-first so
-- junk never reaches the summarizer:
--   1. gate:       is this email material news? (cheap, runs first)
--   2. summarize:  distill the email to one summary (only if it passed)
--   3. categorize: which news category does it fall under?
--   4. append:     record the run as a display-dataset entry (date, source
--      email, category, source). The chain does NOT write external_signals —
--      classifyNewsletter owns the live feed; writing here too would duplicate.
--
-- `news_batches` is the display dataset + audit record (one row per email — the
-- table name is historical). The "Inside the agent" landing visual reads the
-- most recent row and replays its per-agent `steps` trace.
--
-- Run manually in Supabase Studio (Database → SQL Editor → New query).
-- A migrations runner isn't wired up in this project (same posture as
-- 20260522_inbound_emails.sql et al).

create extension if not exists pgcrypto;

create table if not exists news_batches (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- The source email (data location). Single-element arrays — kept as arrays
  -- for forward-compatibility and so the display row is self-contained.
  email_ids       uuid[]      not null,
  email_subjects  text[]      not null default '{}',
  news_sources    text[]      not null default '{}',
  -- Agent 2: the email summary (empty when the gate rejected it).
  batch_summary   text        not null,
  -- Agent 1: news gate verdict + why.
  is_news         boolean     not null,
  gate_reasoning  text,
  -- Agent 3: category (mirrors external_signals.type values; null when rejected).
  category        text,
  -- Reserved: an external_signals row id, if a future version writes one.
  -- The chain currently does not (classifyNewsletter owns the feed).
  signal_id       uuid        references external_signals(id) on delete set null,
  -- Terminal state of the run.
  status          text        not null check (status in ('appended', 'rejected', 'error')),
  -- Per-agent action trace for the "watch the agent work" visual. Array of
  -- { agent, label, status, started_at, duration_ms, input_preview,
  --   output_preview } — one entry per stage, including stages skipped when
  -- the gate rejects the email.
  steps           jsonb       not null default '[]'::jsonb
);

create index if not exists news_batches_created_idx
  on news_batches (created_at desc);
