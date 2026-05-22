import { cookies } from "next/headers";
import {
  DEFAULT_CONFIG,
  type WorkspaceConfig,
} from "./workspace";

// Server-side workspace config loader. Reads the workspace-config cookie set
// by the settings page server actions; falls back to DEFAULT_CONFIG when
// no cookie or invalid JSON.
//
// Next 16 makes cookies() async — must be awaited.

const COOKIE_NAME = "dugout-workspace";

export async function getWorkspaceConfig(): Promise<WorkspaceConfig> {
  const c = await cookies();
  const stored = c.get(COOKIE_NAME)?.value;
  if (!stored) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(stored) as WorkspaceConfig;
    // Light validation — if the shape is corrupted, fall back to default.
    if (!parsed.companyName || !Array.isArray(parsed.priorities)) {
      return DEFAULT_CONFIG;
    }
    return parsed;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export const WORKSPACE_COOKIE_NAME = COOKIE_NAME;
