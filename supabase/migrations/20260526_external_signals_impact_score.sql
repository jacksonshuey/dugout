-- Impact score (0-100) on external_signals: AI-judged "how big a deal is
-- this story to a B2B AE." Distinct from workspace_relevance (which is a
-- categorical tier of "should we surface this to the AE at all"); impact
-- is a continuous magnitude used by the workspace feed's "Magnitude" sort
-- to surface the past-week's biggest stories.
--
-- Nullable so old rows (and adapters not yet migrated) keep working. The
-- sort path treats NULL as "fall back to type + workspace_relevance
-- heuristic."
--
-- Run manually in Supabase Studio or via `supabase db push`. Idempotent.

alter table external_signals
  add column if not exists impact_score smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'external_signals_impact_score_check'
  ) then
    alter table external_signals
      add constraint external_signals_impact_score_check
      check (impact_score is null or (impact_score >= 0 and impact_score <= 100));
  end if;
end$$;

-- Index supports the workspace feed "Magnitude" sort path:
--   "all workspace-scoped signals in the last 7 days, ordered by
--    impact_score desc"
create index if not exists es_impact_score on external_signals (impact_score desc, occurred_at desc)
  where impact_score is not null;
