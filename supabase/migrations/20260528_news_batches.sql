-- Batch-of-3 news orchestrator (the chained-agent pipeline).
--
-- Inbound newsletter emails are processed per-email by the existing flow
-- (inbound-pipeline.ts). This adds a SECOND, parallel path: every time three
-- emails have accumulated, a four-agent chain fires —
--   1. summarize the three emails together
--   2. gate: does the combined summary pass as news?
--   3. categorize: which news category does it fall under?
--   4. append: write a display-dataset entry (date, source emails, category,
--      sources) and, when it passed the gate, an external_signals row that
--      renders in the live feed.
--
-- `news_batches` is the canonical display dataset + audit record for that
-- chain. `inbound_emails.batched_at` marks which emails a batch has already
-- consumed so the trigger never re-batches the same email.
--
-- Run manually in Supabase Studio (Database → SQL Editor → New query).
-- A migrations runner isn't wired up in this project (same posture as
-- 20260522_inbound_emails.sql et al).

create extension if not exists pgcrypto;

-- Marks an inbound email as consumed by a batch. NULL = not yet batched; the
-- trigger claims the three oldest NULL rows atomically before running the
-- chain. Independent of `classified_at` (the per-email flow) by design — the
-- two pipelines run alongside each other.
alter table inbound_emails
  add column if not exists batched_at timestamptz;

create index if not exists inbound_emails_batched_idx
  on inbound_emails (batched_at, received_at)
  where batched_at is null;

create table if not exists news_batches (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- The three source emails this batch consumed (data location). Denormalized
  -- subjects/sources alongside so the display dataset is self-contained.
  email_ids       uuid[]      not null,
  email_subjects  text[]      not null default '{}',
  news_sources    text[]      not null default '{}',
  -- Agent 1: combined summary of the three emails.
  batch_summary   text        not null,
  -- Agent 2: news gate verdict + why.
  is_news         boolean     not null,
  gate_reasoning  text,
  -- Agent 3: category (mirrors external_signals.type values; nullable because
  -- a rejected batch is never categorized).
  category        text,
  -- Agent 4: the external_signals row appended when the batch passed the gate.
  signal_id       uuid        references external_signals(id) on delete set null,
  -- Terminal state of the chain for this batch.
  status          text        not null check (status in ('appended', 'rejected', 'error')),
  -- Per-agent action trace for the "watch the agent work" visual. Array of
  -- { agent, label, status, started_at, duration_ms, input_preview,
  --   output_preview } — one entry per stage, including stages skipped when
  -- the gate rejects the batch.
  steps           jsonb       not null default '[]'::jsonb
);

create index if not exists news_batches_created_idx
  on news_batches (created_at desc);
