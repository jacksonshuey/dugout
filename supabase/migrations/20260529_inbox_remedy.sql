-- Inbox remedy migration.
--
-- Adds the columns the news-inbox remedy needs:
--   * inbound_emails.classifier_error  - last Haiku failure for visibility +
--     so the sweeper can pick up rows that classified with zero signals due
--     to a transient model error.
--   * inbound_emails.body_markdown     - normalized markdown view of the
--     email body, used for /inbox display + the recall full-text index.
--   * inbound_emails.body_tsv          - tsvector generated column over
--     body_markdown, with a GIN index so search is instant.
--   * external_signals.inbox_only      - bullets that are interesting enough
--     to keep in the inbox but not material enough to surface in the headline
--     feed. Default false preserves current feed behavior.
--
-- All columns are NULL/false-defaulted so the migration is forward-compat with
-- existing rows.

BEGIN;

ALTER TABLE inbound_emails
  ADD COLUMN IF NOT EXISTS classifier_error text NULL,
  ADD COLUMN IF NOT EXISTS body_markdown text NULL;

-- Generated tsvector column over body_markdown for /api/inbox/recall. Falls
-- back to subject + from_address when body_markdown is null so legacy rows
-- still match. STORED so the GIN index reads from the column directly.
ALTER TABLE inbound_emails
  ADD COLUMN IF NOT EXISTS body_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(body_markdown, '') || ' ' ||
      coalesce(subject, '') || ' ' ||
      coalesce(from_address, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS inbound_emails_body_tsv_idx
  ON inbound_emails USING GIN (body_tsv);

ALTER TABLE external_signals
  ADD COLUMN IF NOT EXISTS inbox_only boolean NOT NULL DEFAULT false;

COMMIT;
