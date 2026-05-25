// Integration context - the single swap point between "cookie-derived
// workspace identity" (today) and "authed user/workspace identity" (future).
//
// Why this file exists: when Google sign-in lands, every adapter, route, and
// server action that touches integrations needs to scope by the authed user
// instead of a cookie-derived workspace_key. Rather than rewriting every
// call site, we route every integration scoping decision through this
// module. The adapter code takes `IntegrationContext` as a parameter and
// never reads cookies or auth state directly.
//
// Today: returns a workspace_key derived from the workspace cookie's
// companyName (slugified). Stable across the cookie's lifetime, matches the
// existing scoping for tasks (M-3 audit fix). One operator → one workspace_key.
//
// Tomorrow (with auth): replace getIntegrationContext()'s implementation to
// read from the authed session. The Context shape stays identical. No
// downstream code changes.

import { getWorkspaceConfig } from "./workspace-server";

export interface IntegrationContext {
  // Stable identifier for the integration scope. Used as the partition key
  // in workspace_integrations, meeting_signals, meeting_account_overrides.
  workspaceKey: string;
  // Human-readable label for logs + UI. Not used for lookups.
  label: string;
}

// Slugify a company name into a workspace_key. Lowercase, alphanumeric +
// hyphen, capped to 64 chars. Stable for the same input.
export function slugifyWorkspaceKey(companyName: string): string {
  const cleaned = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "default";
}

// Server-only: derive an IntegrationContext from the current request's
// workspace cookie. Imports `next/headers` transitively via
// getWorkspaceConfig() - never call this from a client component.
export async function getIntegrationContext(): Promise<IntegrationContext> {
  const cfg = await getWorkspaceConfig();
  return {
    workspaceKey: slugifyWorkspaceKey(cfg.companyName),
    label: cfg.companyName,
  };
}

// Synchronous variant for places that already have a WorkspaceConfig in
// hand (avoids a second cookie read). Use the async variant from API routes
// and server actions.
export function integrationContextFromConfig(
  companyName: string,
): IntegrationContext {
  return {
    workspaceKey: slugifyWorkspaceKey(companyName),
    label: companyName,
  };
}
