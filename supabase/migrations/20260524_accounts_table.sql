-- DB-backed accounts table.
--
-- Until Phase 4, accounts lived ONLY in src/data/seed.ts — the 11 seeded
-- demo accounts (Moderna, Stripe, Boeing, etc.). Adding this table doesn't
-- replace seed.ts; the existing UI + signal engine still read seed.ts for
-- demo scenarios. This table is the destination for *production* additions
-- via POST /api/accounts (Phase 4 onboarding flow) — the AE adds a new
-- account and Firecrawl runs immediately rather than waiting for the
-- 6am cron.
--
-- Going forward, the listTrackableAccounts() helper in src/lib/accounts.ts
-- returns seed.ts entries + this table's rows merged. Demo scenarios stay
-- pinned to seed.ts so the metrics.md SV Health Score assertions remain
-- deterministic.
--
-- RLS: deny-all (no policies). Server-side service-role only — same
-- posture as web_scrapes, inbound_emails, etc.

create extension if not exists pgcrypto;

create table if not exists accounts (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  website           text not null,
  domain            text,
  industry          text,
  segment           text,
  ticker            text,
  trackable         boolean not null default true,
  -- Firecrawl scrape-path override. NULL → adapter uses dynamic /map
  -- discovery (see firecrawl-adapter.ts §resolveAccountUrls). Set this
  -- when /map output is unreliable for the site (JS-only landing pages,
  -- missing sitemap.xml) or to force a specific scope.
  paths             text[],
  is_demo_scenario  boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Index for the cron + listing queries (filter trackable, order recent).
create index if not exists accounts_trackable_created_idx
  on accounts (trackable, created_at desc);

-- Deny-all RLS. Service-role bypasses; no policies for anon/auth.
alter table accounts enable row level security;
