-- Granola integration: workspace-scoped API key (Vault-encrypted) + per-meeting
-- signals + manual account-mapping overrides.
--
-- Storage choices:
--   - API key in Supabase Vault (libsodium under the hood). The
--     `workspace_integrations` row holds the Vault secret_id only — never
--     the plaintext key. Reads/writes go through SECURITY DEFINER RPCs so
--     the service-role client can interact with Vault from app code without
--     opening a hole.
--   - `meeting_signals` keyed on `note_id` so daily sync is idempotent.
--   - `meeting_account_overrides` records manual user mappings of unmatched
--     Granola notes → accounts so the heuristic can defer to user intent on
--     re-sync.
--
-- Forward-compat: `workspace_key` matches the existing cookie-derived
-- identifier today. When Google auth lands, it becomes `user_id` or
-- `workspace_id` from the authed session — see lib/integration-context.ts
-- for the swap point. Schema does not need to change for that migration.
--
-- Run manually in Supabase Studio (SQL Editor → New query). The Vault
-- extension must already be enabled (it is by default on every Supabase
-- project — verify in Database → Extensions if needed).

create extension if not exists pgcrypto;
-- Vault extension is normally pre-installed on Supabase projects; this is a
-- no-op when it's already there but makes local installs explicit.
create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- workspace_integrations — one row per (workspace, integration).
-- vault_secret_id points at vault.secrets.id; the plaintext is never stored
-- in this table.
-- ---------------------------------------------------------------------------

create table if not exists workspace_integrations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_key      text not null,
  integration        text not null check (integration in ('granola')),
  vault_secret_id    uuid not null,
  meta               jsonb not null default '{}'::jsonb,
  last_synced_at     timestamptz,
  last_sync_status   text check (last_sync_status in ('success', 'error', 'partial') or last_sync_status is null),
  last_sync_error    text,
  last_sync_summary  jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_key, integration)
);

create index if not exists workspace_integrations_workspace_idx
  on workspace_integrations (workspace_key);

-- ---------------------------------------------------------------------------
-- meeting_signals — Granola-sourced signals attached to accounts.
-- One row per (account_id, note_id, signal_type) so a single meeting can fire
-- multiple signal types and still be idempotent across re-syncs.
-- ---------------------------------------------------------------------------

create table if not exists meeting_signals (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null,
  account_id      text not null,
  note_id         text not null,
  meeting_title   text,
  meeting_date    timestamptz,
  granola_url     text,
  signal_type     text not null,
  severity        text not null check (severity in ('blocking', 'action', 'awareness')),
  summary         text not null,
  raw_excerpt     text,
  classifier      text not null default 'haiku', -- 'haiku' | 'heuristic' | 'none'
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  -- workspace_key included so two workspaces processing the same seed
  -- account_id can each carry their own meeting_signals rows. Without it,
  -- the second workspace's upsert would clobber the first.
  unique (workspace_key, account_id, note_id, signal_type)
);

create index if not exists meeting_signals_account_idx
  on meeting_signals (account_id, meeting_date desc);
create index if not exists meeting_signals_workspace_idx
  on meeting_signals (workspace_key, meeting_date desc);

-- ---------------------------------------------------------------------------
-- meeting_account_overrides — manual user mappings for notes that didn't
-- auto-match. Looked up before running the auto-matcher on re-sync so user
-- intent always wins.
--
-- account_id = NULL means "explicitly ignore this meeting" so the user can
-- dismiss a personal note that keeps showing up in the unassigned bucket.
-- ---------------------------------------------------------------------------

create table if not exists meeting_account_overrides (
  id              uuid primary key default gen_random_uuid(),
  workspace_key   text not null,
  note_id         text not null,
  account_id      text, -- nullable: NULL means "ignore"
  created_at      timestamptz not null default now(),
  unique (workspace_key, note_id)
);

create index if not exists meeting_account_overrides_workspace_idx
  on meeting_account_overrides (workspace_key);

-- ---------------------------------------------------------------------------
-- Row-Level Security. These tables are only ever read/written by the
-- service-role client through application code; no policies are granted.
-- Enabling RLS without policies locks the tables to service_role only and
-- guards against accidental SELECT/INSERT grants to anon/authenticated
-- elsewhere in the project.
-- ---------------------------------------------------------------------------

alter table workspace_integrations     enable row level security;
alter table meeting_signals            enable row level security;
alter table meeting_account_overrides  enable row level security;

-- ---------------------------------------------------------------------------
-- Vault helpers. SECURITY DEFINER so the service-role client (which doesn't
-- have direct Vault privileges) can call them. Search path is pinned to
-- prevent search_path injection.
-- ---------------------------------------------------------------------------

-- Set (insert or rotate) the API key for a workspace integration. Returns
-- the workspace_integrations.id.
create or replace function set_workspace_integration_key(
  p_workspace_key text,
  p_integration   text,
  p_api_key       text
) returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row_id          uuid;
  v_secret_id       uuid;
  v_secret_name     text;
begin
  if p_api_key is null or length(trim(p_api_key)) = 0 then
    raise exception 'API key must not be empty';
  end if;

  select id, vault_secret_id into v_row_id, v_secret_id
  from workspace_integrations
  where workspace_key = p_workspace_key and integration = p_integration;

  if v_secret_id is not null then
    -- Rotate the existing Vault secret. Must go through vault.update_secret()
    -- so pgsodium re-encrypts the new value — a raw UPDATE on vault.secrets
    -- would write plaintext into the encrypted column.
    perform vault.update_secret(v_secret_id, p_api_key);
    update workspace_integrations
       set updated_at = now()
     where id = v_row_id;
    return v_row_id;
  end if;

  -- Fresh integration: create a new Vault secret then insert the row.
  v_secret_name := format('dugout_%s_%s_%s', p_integration, p_workspace_key, gen_random_uuid());
  v_secret_id := vault.create_secret(
    p_api_key,
    v_secret_name,
    format('Dugout %s API key for workspace %s', p_integration, p_workspace_key)
  );

  insert into workspace_integrations (workspace_key, integration, vault_secret_id)
  values (p_workspace_key, p_integration, v_secret_id)
  returning id into v_row_id;

  return v_row_id;
end;
$$;

-- Read the plaintext API key for a workspace integration. Returns NULL when
-- the integration isn't connected. Callers are responsible for treating the
-- return value as sensitive — do NOT log it.
create or replace function get_workspace_integration_key(
  p_workspace_key text,
  p_integration   text
) returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_secret    text;
begin
  select vault_secret_id into v_secret_id
  from workspace_integrations
  where workspace_key = p_workspace_key and integration = p_integration;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_secret;
end;
$$;

-- Remove an integration. Deletes the Vault secret as well as the row so a
-- revoked key can never be decrypted again.
create or replace function delete_workspace_integration(
  p_workspace_key text,
  p_integration   text
) returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select vault_secret_id into v_secret_id
  from workspace_integrations
  where workspace_key = p_workspace_key and integration = p_integration;

  if v_secret_id is null then
    return false;
  end if;

  delete from workspace_integrations
   where workspace_key = p_workspace_key and integration = p_integration;
  delete from vault.secrets where id = v_secret_id;
  return true;
end;
$$;

-- Lock the RPCs down to service_role (matches our existing access pattern).
revoke all on function set_workspace_integration_key(text, text, text) from public;
revoke all on function get_workspace_integration_key(text, text)        from public;
revoke all on function delete_workspace_integration(text, text)         from public;
grant execute on function set_workspace_integration_key(text, text, text) to service_role;
grant execute on function get_workspace_integration_key(text, text)        to service_role;
grant execute on function delete_workspace_integration(text, text)         to service_role;
