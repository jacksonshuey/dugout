import type { BrandKey } from "@/components/landing/logos";

// "Are we configured to talk to this thing?" - answered without actually
// hitting the provider. Two reasons not to ping:
//   1. The landing page renders these checks server-side on every visit;
//      calling NewsAPI / Anthropic on each page load would burn quota and
//      add latency without telling us anything we don't already know.
//   2. "Reachable right now" is a poll-the-network question with a
//      different shape (transient failures, retries, regional outages).
//      Configuration health is the precondition. Reachability is later work.
//
// So: env-var presence for env-keyed adapters, structural "config-only" for
// OAuth display rows, and "no credential required" for the public sources
// (SEC) and per-workspace Vault rows (Granola - handled in the Granola
// route, not here).

export type HealthMode =
  | "live"     // adapter ready: credential present (or no credential needed)
  | "missing"  // adapter exists but the env var(s) it needs aren't set
  | "config";  // OAuth display row - connected per-workspace at install time

export interface IntegrationHealth {
  mode: HealthMode;
  note: string;
}

interface HealthCheck {
  // If set, all listed env vars must be present (non-empty) for "live".
  envVars?: string[];
  // OAuth display row - no credential check possible from this code path.
  configOnly?: boolean;
  // Adapter that runs without server-side credentials (SEC EDGAR, public).
  noCredentialRequired?: boolean;
  // Adapter that uses a per-workspace Vault key (not a global env var).
  vaultKey?: boolean;
}

// Per-brand check definitions. Adding a new constellation integration =
// one entry here. Keep the BrandKey index narrow so a typo at the call
// site doesn't silently fall through to a "Not tracked" result.
const CHECKS: Partial<Record<BrandKey, HealthCheck>> = {
  anthropic: { envVars: ["ANTHROPIC_API_KEY"] },
  supabase: { envVars: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
  newsapi: { envVars: ["NEWSAPI_KEY"] },
  sec: { noCredentialRequired: true },
  firecrawl: { envVars: ["FIRECRAWL_API_KEY"] },
  slack: { envVars: ["SLACK_WEBHOOK_URL"] },
  // Granola uses per-workspace Vault rows. There's no global env var that
  // tells us "the integration is on." The adapter is shipped; per-workspace
  // key setup happens at onboarding time (paste → Vault).
  granola: { vaultKey: true },
  // OAuth display rows - workspace-config integrations. The adapter is
  // a planned integration shape, not a running connection.
  salesforce: { configOnly: true },
  gong: { configOnly: true },
  outreach: { configOnly: true },
  dock: { configOnly: true },
  chilipiper: { configOnly: true },
};

export function checkHealth(brand: BrandKey): IntegrationHealth {
  const check = CHECKS[brand];
  if (!check) {
    return { mode: "config", note: "Not tracked" };
  }
  if (check.configOnly) {
    return { mode: "config", note: "OAuth · connected per workspace" };
  }
  if (check.vaultKey) {
    return { mode: "live", note: "API key (Vault)" };
  }
  if (check.noCredentialRequired) {
    return { mode: "live", note: "No credential required" };
  }
  const envVars = check.envVars ?? [];
  const missing = envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    return {
      mode: "missing",
      note: `Missing env: ${missing.join(", ")}`,
    };
  }
  return { mode: "live", note: "Credential configured" };
}

// Snapshot of all tracked brands. Returned by the server component on the
// landing page so the constellation and the matrix render real state in one
// pass rather than re-checking per-chip.
export function checkAllHealth(): Record<string, IntegrationHealth> {
  const out: Record<string, IntegrationHealth> = {};
  for (const brand of Object.keys(CHECKS) as BrandKey[]) {
    out[brand] = checkHealth(brand);
  }
  return out;
}

// Brand-key narrowing for the route handler. Routes get strings from the
// URL - we don't trust them to be valid BrandKeys.
export function isTrackedBrand(s: string): s is BrandKey {
  return s in CHECKS;
}
