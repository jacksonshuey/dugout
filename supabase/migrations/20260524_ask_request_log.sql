-- /ask request log — per-session and global rate limiting for the Dugout
-- /ask chatbot (D1). Jackson is funding the OpenAI + Anthropic tokens
-- personally, so we cap spend at the request layer rather than waiting for
-- provider-side bill alerts.
--
-- Caps enforced in src/lib/ask-rate-limit.ts:
--   - 20 requests / hour / session_id   (interactive abuse)
--   - 100 requests / day / session_id   (daily session cap)
--   - 500 requests / day  (global kill switch)
--
-- Schema is intentionally narrow — no per-question text storage. The
-- session_id comes from the UI session cookie (or a fallback header in
-- the future). workspace_id is nullable until per-workspace auth lands.
--
-- Run manually in Supabase Studio (SQL Editor → New query) or apply via
-- supabase CLI migrate.

create table if not exists ask_request_log (
  id                 uuid primary key default gen_random_uuid(),
  session_id         text not null,
  workspace_id       text,
  occurred_at        timestamptz not null default now(),
  provider           text not null,
  model              text not null,
  question_chars     int,
  tool_calls_count   int,
  cost_usd_estimate  numeric(10, 6),
  status             text not null default 'completed'
);

-- Per-session window queries (hourly + daily cap checks).
create index if not exists ask_log_session_window
  on ask_request_log (session_id, occurred_at desc);

-- Global window queries (daily kill-switch).
create index if not exists ask_log_global_window
  on ask_request_log (occurred_at desc);

-- Lock the table to service_role only. Matches the deny-all-without-policy
-- posture used by every other public.* table in Dugout (per the granola
-- integration migration + session 7 Supabase Advisor finding).
alter table ask_request_log enable row level security;
