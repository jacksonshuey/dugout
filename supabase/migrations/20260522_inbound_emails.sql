-- Raw inbox for newsletter ingestion (Phase 1).
--
-- Newsletters POST'd by SendGrid Inbound Parse land here verbatim. A
-- downstream classifier (added in Phase 2) reads from this table to
-- produce signals into `external_signals`. Keeping raw HTML + plaintext
-- lets us re-classify later as the prompt evolves without re-fetching.
--
-- message_id is the email's RFC822 Message-ID header. Unique so SendGrid
-- webhook retries are idempotent.
--
-- Run manually in Supabase Studio (Database → SQL Editor → New query).
-- A migrations runner isn't wired up in this project yet.

create extension if not exists pgcrypto;

create table if not exists inbound_emails (
  id              uuid primary key default gen_random_uuid(),
  from_address    text not null,
  from_domain     text not null,
  subject         text,
  received_at     timestamptz not null default now(),
  text_body       text,
  html_body       text,
  raw_size_bytes  int  not null,
  classified_at   timestamptz,
  signals_emitted int  not null default 0,
  message_id      text unique,
  created_at      timestamptz not null default now()
);

create index if not exists inbound_emails_received_idx on inbound_emails (received_at desc);
create index if not exists inbound_emails_domain_idx   on inbound_emails (from_domain);
