-- Market-intel ranker cache. One row per (workspace, hour bucket). The
-- ranker rebuilds the bucket key on every request; reads with age >1h are
-- treated as miss and overwritten. No background invalidation job needed.
--
-- workspace_key is the slugified workspace name (cookie-backed today; will
-- become a real workspaces.id later). date_bucket is YYYY-MM-DD-HH (UTC).
--
-- Run manually in Supabase Studio (SQL Editor → New query) or via
-- supabase CLI migrate. Same posture as ask_request_log + web_scrapes.

create table if not exists ranker_cache (
  workspace_key  text         not null,
  date_bucket    text         not null,
  result_json    jsonb        not null,
  created_at     timestamptz  not null default now(),
  primary key (workspace_key, date_bucket)
);

-- Hot path: lookup by exact key. The primary key index serves this; no
-- secondary index needed. Add one only if a future use case queries by
-- created_at independently.

-- Optional housekeeping: a daily cron can prune buckets older than 7 days
-- to keep the table small. NOT scheduled in v1 — the table is tiny.

-- RLS deny-all. Matches the session-7 RLS posture and the ask_request_log
-- migration. Service role (used by supabaseAdmin) bypasses RLS, so the app
-- keeps working; the anon key cannot read/write directly.
alter table ranker_cache enable row level security;
