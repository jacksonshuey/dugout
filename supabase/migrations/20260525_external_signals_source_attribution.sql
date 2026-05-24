-- Source-attribution columns on external_signals + the publisher/list-id
-- prerequisites on inbound_emails. Subsumes MASTER.md §2.1 (List-ID
-- classifier) and §2.2 (publisher canonical name) since both are required
-- for the new source-attribution UI to work.
--
-- All columns are nullable so the migration is backward-compatible. The
-- newsletter-adapter writes the new columns on every new signal; older
-- rows degrade gracefully to the meta JSONB fallback already in place.
--
-- Run manually in Supabase Studio. No data backfill is performed — the
-- next inbound webhook + the next sweeper run start populating
-- automatically as new emails arrive.
--
-- `suppressed_at` is the Q0-resolution column: when an operator clicks
-- "Mark as bad signal" on /market-intel, /api/admin/signal-feedback writes
-- BOTH an email_filter_decisions audit row AND sets this timestamp. The
-- page query filters `where suppressed_at is null`. Suppression mutates
-- only Dugout's own table — no external-system writes — so it stays
-- inside the read-only-v1 boundary (BUILD_ALIGNMENT #9).

alter table external_signals
  add column if not exists publisher_canonical_name  text,
  add column if not exists source_url                text,
  add column if not exists inbound_email_id          uuid references inbound_emails(id) on delete set null,
  add column if not exists email_subject             text,
  add column if not exists suppressed_at             timestamptz;

-- Index supports the raw-email drawer ("show me the source email for this
-- signal") and the audit drawer ("show me every signal that came from
-- this email").
create index if not exists es_inbound_email on external_signals (inbound_email_id)
  where inbound_email_id is not null;

alter table inbound_emails
  add column if not exists list_id                  text,
  add column if not exists publisher_canonical_name text;

-- Optional: index on list_id for future analytics ("how many emails came
-- from this publication?"). Cheap to add now since the column is sparse.
create index if not exists ie_list_id on inbound_emails (list_id)
  where list_id is not null;

-- No RLS change needed here — both tables already have RLS enabled
-- deny-all per the session-7 posture.
