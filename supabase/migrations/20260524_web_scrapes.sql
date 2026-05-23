-- Raw web-scrape store for the Firecrawl adapter.
--
-- The daily firecrawl cron (src/app/api/cron/firecrawl/route.ts) hits a
-- fixed set of content pages per tracked account (homepage + /about +
-- /news + /leadership) and dumps the returned markdown here verbatim.
-- The classify-pending sweeper picks up rows with classified_at IS NULL,
-- runs Haiku to extract material signals, and emits them into
-- external_signals.
--
-- Mirrors the inbound_emails table shape so the same sweeper handles
-- both queues (newsletter inbox + web scrapes). Keeping the raw markdown
-- lets us re-classify later as the prompt evolves without burning
-- Firecrawl credits to re-scrape.
--
-- Dedup: (account_id, url, scraped_date) unique — re-scraping the same
-- page on the same day is a no-op. Across days we keep separate rows so
-- the diff between two snapshots stays inspectable.
--
-- Run manually in Supabase Studio (Database → SQL Editor → New query).

create extension if not exists pgcrypto;

create table if not exists web_scrapes (
  id              uuid primary key default gen_random_uuid(),
  account_id      text not null,
  url             text not null,
  scraped_at      timestamptz not null default now(),
  scraped_date    date not null default current_date,
  status_code     int,
  markdown        text,
  raw_size_bytes  int not null default 0,
  classified_at   timestamptz,
  signals_emitted int not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  unique (account_id, url, scraped_date)
);

create index if not exists web_scrapes_scraped_idx
  on web_scrapes (scraped_at desc);

create index if not exists web_scrapes_account_idx
  on web_scrapes (account_id);

-- Sweeper query path: classified_at IS NULL ordered by scraped_at asc.
-- Partial index keeps it cheap as the table grows.
create index if not exists web_scrapes_unclassified_idx
  on web_scrapes (scraped_at asc)
  where classified_at is null;
