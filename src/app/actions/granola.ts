"use server";

import { revalidatePath } from "next/cache";
import { accounts } from "@/data/seed";
import { requireUiSessionAction } from "@/lib/ui-auth-server";
import { getIntegrationContext } from "@/lib/integration-context";
import { setAccountOverride } from "@/lib/meeting-signals";

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
