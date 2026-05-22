"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  CHECKBOX_PRESET,
  PRESETS,
  type WorkspaceConfig,
} from "@/lib/workspace";
import { WORKSPACE_COOKIE_NAME } from "@/lib/workspace-server";

// Server actions for workspace config. Writing here triggers revalidation
// so every page reading the cookie picks up the new value.

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function saveWorkspaceConfig(config: WorkspaceConfig) {
  const c = await cookies();
  c.set(WORKSPACE_COOKIE_NAME, JSON.stringify(config), {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

export async function loadPreset(presetName: string) {
  const preset = PRESETS[presetName] ?? CHECKBOX_PRESET;
  await saveWorkspaceConfig(preset);
}

export async function resetWorkspace() {
  const c = await cookies();
  c.delete(WORKSPACE_COOKIE_NAME);
  revalidatePath("/", "layout");
}
