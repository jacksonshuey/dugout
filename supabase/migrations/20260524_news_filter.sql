-- News content filter: workspace_relevance column on external_signals +
-- news_filter_decisions audit table.
--
-- Run manually in Supabase Studio (SQL Editor → New query) or via supabase
-- CLI migrate. Idempotent — re-running is safe. Same posture as
-- email_filter_decisions and external_signals_source_attribution.
--
-- `workspace_relevance` is the dual-tag column: account-tagged NewsAPI
-- signals also expose their workspace-wide relevance tier ('high'|'medium'|
-- 'low'|'none'). The AE Brief query at /market-intel pulls
-- account-tagged signals where workspace_relevance IN ('high','medium')
-- and merges them with __workspace__-tagged signals. Old rows are nullable;
-- the AE Brief filter treats NULL as 'none' for backward compatibility.

alter table external_signals
  add column if not exists workspace_relevance text;

-- Constraint added separately (idempotent — drop+add if needed in future)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_signals_workspace_relevance_check'
  ) then
    alter table external_signals
      add constraint external_signals_workspace_relevance_check
      check (workspace_relevance is null or workspace_relevance in ('high','medium','low','none'));
  end if;
end$$;

-- Index supports the AE Brief query path:
--   "all signals where workspace_relevance in ('high','medium') ordered by occurred_at desc"
create index if not exists es_workspace_relevance on external_signals (workspace_relevance, occurred_at desc)
  where workspace_relevance is not null;

create table if not exists news_filter_decisions (
  id                    uuid         primary key default gen_random_uuid(),
  -- News articles don't have an inbound_emails FK; we key off the article URL
  -- so we can audit even if no signal row was written (e.g. rejected articles).
  article_url           text         not null,
  -- Optional FK to the signal row when one was created (i.e. verdict was
  -- 'newsworthy' or 'low_signal'). NULL for rejected articles.
  external_signal_id    uuid         references external_signals(id) on delete set null,
  -- Account context the decision was made for.
  account_id            text         not null,
  stage                 smallint     not null check (stage in (1, 2)),
  verdict               text         not null check (verdict in (
                          'newsworthy', 'low_signal', 'rejected'
                        )),
  workspace_relevance   text         not null check (workspace_relevance in (
                          'high', 'medium', 'low', 'none'
                        )),
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  rule                  text,        -- stage 1's rule id; NULL for stage 2
  reasoning             text         not null,
  model                 text,        -- 'claude-haiku-4-5' or NULL for stage 1
  prompt_version        text         not null,
  decided_at            timestamptz  not null default now()
);

-- Hot path: reporting ("how many articles did we reject by rule this week?")
create index if not exists nfd_rule_window on news_filter_decisions (rule, decided_at desc)
  where rule is not null;

-- Hot path: drill-down ("what did the filter decide for this signal?")
create index if not exists nfd_signal on news_filter_decisions (external_signal_id)
  where external_signal_id is not null;

-- RLS deny-all per session-7 posture. Service role (used by supabaseAdmin)
-- bypasses RLS, so the app keeps working; anon/authenticated cannot read.
alter table news_filter_decisions enable row level security;
