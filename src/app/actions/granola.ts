"use server";

import { revalidatePath } from "next/cache";
import { accounts } from "@/data/seed";
import { requireUiSessionAction } from "@/lib/ui-auth-server";
import { getIntegrationContext } from "@/lib/integration-context";
import {
  deleteIntegration,
  getIntegrationKey,
  getIntegrationStatus,
  setIntegrationKey,
  type WorkspaceIntegrationStatus,
} from "@/lib/workspace-integrations";
import { createGranolaClient } from "@/lib/granola-client";
import { syncGranola, type SyncResult } from "@/lib/granola-adapter";
import { setAccountOverride } from "@/lib/meeting-signals";

// Server actions for the Granola integration. All are session-gated. Plain-
// text API keys cross the wire (action call → server) but are never logged
// and are persisted only into Vault via the workspace-integrations module.

// Status — never returns the key itself.
export async function getGranolaStatus(): Promise<WorkspaceIntegrationStatus> {
  await requireUiSessionAction();
  const ctx = await getIntegrationContext();
  return getIntegrationStatus(ctx.workspaceKey, "granola");
}

// Save + verify in one shot. We test the key against /v1/notes (1 request,
// page-size irrelevant) before persisting — that way a typo doesn't get
// stored and immediately fail the next cron. The list endpoint is the
// cheapest authenticated call.
export interface ConnectResult {
  ok: boolean;
  error?: string;
  // Light verification info shown in the UI on success.
  sampleNoteCount?: number;
}

export async function connectGranola(apiKey: string): Promise<ConnectResult> {
  await requireUiSessionAction();
  const trimmed = (apiKey ?? "").trim();
  if (!trimmed.startsWith("grn_") || trimmed.length < 20) {
    return {
      ok: false,
      error: 'Granola API keys start with "grn_" and are at least 20 chars. Paste the key from Granola → Settings → Connectors → API keys.',
    };
  }

  // Verify before we persist.
  try {
    const client = createGranolaClient(trimmed);
    const page = await client.listNotes();
    const ctx = await getIntegrationContext();
    await setIntegrationKey(ctx.workspaceKey, "granola", trimmed);
    revalidatePath("/settings");
    revalidatePath("/integrations/granola");
    return { ok: true, sampleNoteCount: page.notes.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Don't echo the key. Don't echo full response bodies (might contain
    // workspace-identifying info).
    return { ok: false, error: msg.slice(0, 240) };
  }
}

export async function disconnectGranola(): Promise<{ ok: boolean }> {
  await requireUiSessionAction();
  const ctx = await getIntegrationContext();
  const removed = await deleteIntegration(ctx.workspaceKey, "granola");
  revalidatePath("/settings");
  revalidatePath("/integrations/granola");
  return { ok: removed };
}

// Trigger a sync run from the settings page. Same code path as the cron
// route; differs only in how the key is resolved (Vault) vs (env).
export async function syncGranolaNow(): Promise<SyncResult> {
  await requireUiSessionAction();
  const ctx = await getIntegrationContext();
  const apiKey = await getIntegrationKey(ctx.workspaceKey, "granola");
  if (!apiKey) {
    return {
      workspaceKey: ctx.workspaceKey,
      ranAt: new Date().toISOString(),
      durationMs: 0,
      totalNotes: 0,
      internalSkipped: 0,
      ignoredByOverride: 0,
      matched: 0,
      unassigned: [],
      signalsWritten: 0,
      errors: [
        {
          noteId: "(precheck)",
          message: "Granola is not connected. Paste an API key in Settings first.",
        },
      ],
      status: "error",
    };
  }
  const result = await syncGranola({
    apiKey,
    workspaceKey: ctx.workspaceKey,
    accounts: [...accounts],
  });
  revalidatePath("/settings");
  revalidatePath("/integrations/granola");
  return result;
}

// Manual mapping of an unassigned note → account. accountId === null means
// "ignore this note from now on" (the unassigned bucket's dismiss button).
export async function assignUnassignedMeeting(
  noteId: string,
  accountId: string | null,
): Promise<{ ok: boolean }> {
  await requireUiSessionAction();
  const ctx = await getIntegrationContext();
  if (
    accountId !== null &&
    !accounts.some((a) => a.id === accountId)
  ) {
    throw new Error(`Unknown account id: ${accountId}`);
  }
  await setAccountOverride(ctx.workspaceKey, noteId, accountId);
  revalidatePath("/integrations/granola");
  return { ok: true };
}
