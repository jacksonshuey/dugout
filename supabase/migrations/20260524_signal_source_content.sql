-- Universal source-content persistence for external_signals. Honors the
-- "every signal must verify against the exact message we derived it from"
-- principle: the popup on /market-intel and the AE Brief renders source_content_md
-- for any signal that doesn't have an inbound_email_id, so NewsAPI / Firecrawl /
-- SEC signals all open in the same SourcePreviewModal as newsletter rows.
--
-- Columns:
--   source_content_md   the body the analyzer used to derive the signal,
--                       normalized to markdown (or plain text for SEC filings)
--   source_content_kind email_html | email_text | news_article_md |
--                       firecrawl_md | sec_filing_md — drives popup render
--                       (HTML iframe vs MarkdownBody)
--
-- Both nullable so the migration is backward-compatible. The market-intel page
-- query is updated separately to filter out signals without either an
-- inbound_email_id or a populated source_content_md — rows without a
-- verifiable source are hidden until backfill catches them up.
--
-- Run manually in Supabase Studio. No data backfill performed here — a
-- separate one-shot script (scripts/backfill-signal-sources.ts) re-runs the
-- appropriate adapter against existing rows after this lands.

alter table external_signals
  add column if not exists source_content_md   text,
  add column if not exists source_content_kind text;

-- Partial index supports the page-query filter ("only show signals with a
-- verifiable source"). Cheap to add — most rows will populate
-- source_content_md going forward.
create index if not exists es_has_source_content
  on external_signals ((source_content_md is not null))
  where source_content_md is not null;

-- No RLS change needed — external_signals already has RLS enabled deny-all
-- per the session-7 posture.
