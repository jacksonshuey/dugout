import { supabaseAdmin } from "./supabase";

// Workspace integrations — Supabase-backed config for per-workspace API
// keys. Plaintext keys NEVER live in this code path; they're stored in
// Supabase Vault and only resolved on demand via the
// `get_workspace_integration_key` RPC.
//
// Sensitive surface: the returned key from `getIntegrationKey` is a real
// secret. Do not log it. Do not return it from API routes. The only legit
// use is to pass it directly into the Granola HTTP client.

export type IntegrationName = "granola";

export interface WorkspaceIntegrationStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: "success" | "error" | "partial" | null;
  lastSyncError: string | null;
  lastSyncSummary: Record<string, unknown> | null;
  meta: Record<string, unknown>;
  updatedAt: string | null;
}

const NOT_CONNECTED: WorkspaceIntegrationStatus = {
  connected: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncSummary: null,
  meta: {},
  updatedAt: null,
};

// ---------------------------------------------------------------------------
// Status read — never returns the secret. Used by the settings page to show
// "Connected · last synced 5m ago" without exposing the key.
// ---------------------------------------------------------------------------

export async function getIntegrationStatus(
  workspaceKey: string,
  integration: IntegrationName,
): Promise<WorkspaceIntegrationStatus> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("workspace_integrations")
    .select(
      "last_synced_at, last_sync_status, last_sync_error, last_sync_summary, meta, updated_at",
    )
    .eq("workspace_key", workspaceKey)
    .eq("integration", integration)
    .maybeSingle();
  if (error) {
    throw new Error(`Supabase read failed: ${error.message}`);
  }
  if (!data) return NOT_CONNECTED;
  return {
    connected: true,
    lastSyncedAt: data.last_synced_at,
    lastSyncStatus: data.last_sync_status,
    lastSyncError: data.last_sync_error,
    lastSyncSummary: data.last_sync_summary,
    meta: data.meta ?? {},
    updatedAt: data.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Secret resolution — returns the plaintext key. Treat as sensitive.
// ---------------------------------------------------------------------------

export async function getIntegrationKey(
  workspaceKey: string,
  integration: IntegrationName,
): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("get_workspace_integration_key", {
    p_workspace_key: workspaceKey,
    p_integration: integration,
  });
  if (error) {
    throw new Error(`Vault read failed: ${error.message}`);
  }
  if (typeof data !== "string" || data.length === 0) return null;
  return data;
}

// ---------------------------------------------------------------------------
// Set / rotate the key. New connections create a fresh Vault secret;
// existing ones rotate the secret in place. Plaintext crosses the wire to
// Postgres but is never stored in our public tables.
// ---------------------------------------------------------------------------

export async function setIntegrationKey(
  workspaceKey: string,
  integration: IntegrationName,
  apiKey: string,
): Promise<void> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("API key must not be empty");
  }
  const sb = supabaseAdmin();
  const { error } = await sb.rpc("set_workspace_integration_key", {
    p_workspace_key: workspaceKey,
    p_integration: integration,
    p_api_key: apiKey.trim(),
  });
  if (error) {
    throw new Error(`Vault write failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Disconnect — removes the Vault secret AND the row so a revoked key can
// never be decrypted again.
// ---------------------------------------------------------------------------

export async function deleteIntegration(
  workspaceKey: string,
  integration: IntegrationName,
): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("delete_workspace_integration", {
    p_workspace_key: workspaceKey,
    p_integration: integration,
  });
  if (error) {
    throw new Error(`Vault delete failed: ${error.message}`);
  }
  return data === true;
}

// ---------------------------------------------------------------------------
// Sync bookkeeping — called by the adapter after a run finishes. Updates
// the status fields without touching the secret.
// ---------------------------------------------------------------------------

export interface SyncBookkeeping {
  status: "success" | "error" | "partial";
  error?: string | null;
  summary?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}

export async function recordSyncResult(
  workspaceKey: string,
  integration: IntegrationName,
  bookkeeping: SyncBookkeeping,
): Promise<void> {
  const sb = supabaseAdmin();
  const update: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
    last_sync_status: bookkeeping.status,
    last_sync_error: bookkeeping.error ?? null,
    last_sync_summary: bookkeeping.summary ?? null,
    updated_at: new Date().toISOString(),
  };
  if (bookkeeping.meta) {
    update.meta = bookkeeping.meta;
  }
  const { error } = await sb
    .from("workspace_integrations")
    .update(update)
    .eq("workspace_key", workspaceKey)
    .eq("integration", integration);
  if (error) {
    throw new Error(`Sync bookkeeping update failed: ${error.message}`);
  }
}
