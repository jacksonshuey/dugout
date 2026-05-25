-- Zippering — Phase 0 schema.
--
-- See docs/zippering-plan.md for the full design. In short, zippering is
-- Haiku-driven schema reconciliation at ingest: when a new column from any
-- integration arrives for a given account (primary key), Haiku decides
-- whether it semantically matches an existing canonical column (JOIN) or
-- is a new field (APPEND). The decision is cached; subsequent rows from
-- the same source for the same pkey skip the Haiku call.
--
-- This migration creates the foundation — five tables, zero application
-- logic. The zipperer lib + Haiku prompt + explainability endpoint ship
-- next in Phase 1.
--
-- Architecture (per §2 of the plan):
--   global_canonical_columns  → cross-pkey shared fields (company_name, etc.)
--   zippering_schema          → per-pkey current canonical inventory (mutable)
--   zippering_decisions       → append-only audit of Haiku verdicts + overrides
--   zippered_signals          → the wide rows themselves (JSONB-backed)
--   zippering_conflicts       → value-disagreement audit
--
-- All tables carry workspace_key text not null default 'dugout-default'
-- so multi-workspace rollout costs zero retrofit. Pattern matches
-- meeting_signals + web_scrapes already in the codebase.
--
-- RLS: deny-all (no policies). Server-side service-role only — same
-- posture as accounts, web_scrapes, inbound_emails, etc.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. global_canonical_columns — cross-pkey shared field registry
--
-- Hand-seeded below with the foundational fields every account benefits
-- from having. Grows when Haiku surfaces a field that appears across
-- enough pkeys to graduate from per-pkey to global (graduation rule is a
-- future enhancement; for Phase 0, only the seed list lives here).
-- ---------------------------------------------------------------------------

create table if not exists global_canonical_columns (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null default 'dugout-default',
  name            text not null,
  data_type       text not null check (data_type in (
    'text', 'integer', 'numeric', 'boolean', 'timestamp', 'jsonb', 'string[]'
  )),
  description     text,
  semantic_tags   text[] not null default '{}',
  created_at      timestamptz not null default now(),
  unique (workspace_key, name)
);

create index if not exists global_canonical_columns_workspace_idx
  on global_canonical_columns (workspace_key);

alter table global_canonical_columns enable row level security;

-- ---------------------------------------------------------------------------
-- 2. zippering_schema — per-pkey canonical inventory (CURRENT state)
--
-- Mutable. When an operator overrides a Haiku decision or renames a
-- canonical column, the relevant row updates here; the audit trail of
-- the change stays intact in zippering_decisions below.
--
-- For globally-shared fields, is_global=true and canonical_name matches a
-- row in global_canonical_columns. For pkey-local extensions,
-- is_global=false and canonical_name is whatever Haiku/operator chose.
-- ---------------------------------------------------------------------------

create table if not exists zippering_schema (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null default 'dugout-default',
  pkey            text not null,                  -- AccountId (acc_xxx or UUID)
  canonical_name  text not null,                  -- mirrors global name OR pkey-local
  data_type       text not null check (data_type in (
    'text', 'integer', 'numeric', 'boolean', 'timestamp', 'jsonb', 'string[]'
  )),
  description     text,
  is_global       boolean not null default false,
  source_origin   text,                           -- integration that first introduced this column on this pkey
  first_seen_at   timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_key, pkey, canonical_name)
);

create index if not exists zippering_schema_workspace_pkey_idx
  on zippering_schema (workspace_key, pkey);

create index if not exists zippering_schema_canonical_idx
  on zippering_schema (workspace_key, canonical_name);

alter table zippering_schema enable row level security;

-- ---------------------------------------------------------------------------
-- 3. zippering_decisions — append-only Haiku + operator audit
--
-- Every Haiku verdict appends a row. Every operator override appends a
-- new row (NEVER updates an existing one). Latest row by decided_at desc
-- for a given (workspace_key, pkey, source, source_column) triple is the
-- active routing.
--
-- This table is the WHY behind every column in zippered_signals.
-- ---------------------------------------------------------------------------

create table if not exists zippering_decisions (
  id                       uuid primary key default gen_random_uuid(),
  workspace_key            text not null default 'dugout-default',
  pkey                     text not null,
  source                   text not null,
  source_column            text not null,
  source_data_type         text,
  source_description       text,
  source_samples           jsonb,                       -- 3-5 sample values Haiku evaluated
  verdict                  text not null check (verdict in ('join', 'append', 'unclear')),
  canonical_name           text not null,
  is_global_target         boolean not null default false,
  similarity_score         numeric,                      -- Haiku-reported 0..1
  reason                   text,
  needs_review             boolean not null default false,
  decided_by               text not null default 'haiku', -- 'haiku' | 'normalizer' | rep_id
  decided_at               timestamptz not null default now()
);

create index if not exists zippering_decisions_lookup_idx
  on zippering_decisions (workspace_key, pkey, source, source_column, decided_at desc);

create index if not exists zippering_decisions_needs_review_idx
  on zippering_decisions (workspace_key, needs_review)
  where needs_review;

create index if not exists zippering_decisions_canonical_idx
  on zippering_decisions (workspace_key, pkey, canonical_name);

alter table zippering_decisions enable row level security;

-- ---------------------------------------------------------------------------
-- 4. zippered_signals — the wide rows
--
-- One row per ingested signal. occurred_at is pulled out of the JSONB
-- because every signal has a time and we want a real time-series index.
-- Every other canonical column flattens into the `columns` JSONB so the
-- schema can grow without migrations.
--
-- external_id is the integration's native row id, used to make
-- re-ingestion idempotent — same external_id from the same source means
-- update-not-insert.
-- ---------------------------------------------------------------------------

create table if not exists zippered_signals (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null default 'dugout-default',
  pkey            text not null,
  source          text not null,
  external_id     text,
  occurred_at     timestamptz not null,
  columns         jsonb not null default '{}'::jsonb,
  ingested_at     timestamptz not null default now(),
  unique (source, external_id)                          -- idempotent re-ingest
);

create index if not exists zippered_signals_pkey_time_idx
  on zippered_signals (workspace_key, pkey, occurred_at desc);

create index if not exists zippered_signals_source_idx
  on zippered_signals (workspace_key, source, occurred_at desc);

alter table zippered_signals enable row level security;

-- ---------------------------------------------------------------------------
-- 5. zippering_conflicts — value-disagreement audit
--
-- When two integrations write to the same canonical column for the same
-- pkey within a window and the values disagree, the conflict gets logged
-- here. Pure write-only audit; not in the read path. Latest value wins
-- by occurred_at; this table records what was overwritten.
-- ---------------------------------------------------------------------------

create table if not exists zippering_conflicts (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null default 'dugout-default',
  pkey            text not null,
  canonical_name  text not null,
  source_a        text not null,
  value_a         jsonb,
  source_b        text not null,
  value_b         jsonb,
  occurred_at     timestamptz not null,
  resolution      text,                                 -- 'latest_wins' | 'source_priority' | 'manual'
  detected_at     timestamptz not null default now()
);

create index if not exists zippering_conflicts_lookup_idx
  on zippering_conflicts (workspace_key, pkey, canonical_name, detected_at desc);

alter table zippering_conflicts enable row level security;

-- ---------------------------------------------------------------------------
-- Seed: global_canonical_columns with the foundational cross-pkey fields.
--
-- These are the columns Haiku should prefer when routing — they enable
-- cross-account queries like "all companies with employee_count > 500"
-- without joining six diverging per-pkey schemas.
--
-- Idempotent via ON CONFLICT — re-running this migration is safe.
-- ---------------------------------------------------------------------------

insert into global_canonical_columns (workspace_key, name, data_type, description, semantic_tags) values
  ('dugout-default', 'company_name',           'text',      'Display name of the account.',                               array['identity']),
  ('dugout-default', 'domain',                 'text',      'Primary web domain for the account.',                        array['identity']),
  ('dugout-default', 'ticker',                 'text',      'Public-company ticker symbol.',                              array['identity', 'public_co']),
  ('dugout-default', 'industry',               'text',      'Industry classification.',                                   array['taxonomy']),
  ('dugout-default', 'hq_location',            'text',      'Headquarters city / region.',                                array['geography']),
  ('dugout-default', 'employee_count',         'integer',   'Approximate headcount.',                                     array['size', 'people']),
  ('dugout-default', 'account_owner',          'text',      'Internal owner (rep_id or display name).',                   array['ownership']),
  ('dugout-default', 'deal_stage',             'text',      'Current pipeline stage.',                                    array['deal_state']),
  ('dugout-default', 'deal_amount',            'integer',   'Open deal ACV in whole USD.',                                array['deal_state', 'money']),
  ('dugout-default', 'close_date',             'timestamp', 'Expected close date for the open deal.',                     array['deal_state', 'timing']),
  ('dugout-default', 'latest_signal_at',       'timestamp', 'Timestamp of the most recent signal of any kind.',           array['freshness']),
  ('dugout-default', 'latest_signal_summary',  'text',      'One-line summary of the most recent signal.',                array['freshness', 'narrative']),
  ('dugout-default', 'funding_signal',         'jsonb',     'Most recent funding event (round, amount, lead).',           array['intel', 'money']),
  ('dugout-default', 'hiring_signal',          'jsonb',     'Most recent hiring / leadership change event.',              array['intel', 'people']),
  ('dugout-default', 'risk_flags',             'jsonb',     'Active risk signals (champion change, kill point hit, etc.)', array['intel', 'risk']),
  ('dugout-default', 'last_contact_at',        'timestamp', 'Timestamp of last two-way contact (email / call / meeting).', array['engagement', 'freshness']),
  ('dugout-default', 'last_meeting_summary',   'text',      'Summary of the most recent meeting / call.',                 array['engagement', 'narrative'])
on conflict (workspace_key, name) do nothing;
