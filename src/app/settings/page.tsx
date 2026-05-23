import { SettingsForm } from "@/components/settings-form";
import {
  ConnectorsSection,
  type SystemConnectorStatus,
} from "@/components/connectors-section";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { getInboundStats, type InboundStats } from "@/lib/inbound-email";
import { getIntegrationContext } from "@/lib/integration-context";
import {
  getIntegrationStatus,
  type WorkspaceIntegrationStatus,
} from "@/lib/workspace-integrations";

// Helper: a key is considered "set" when the env var is present and non-empty.
// Trim before checking so whitespace-only values count as missing.
function isEnvSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function getSystemConnectorStatus(): SystemConnectorStatus {
  return {
    anthropic: isEnvSet("ANTHROPIC_API_KEY"),
    newsapi: isEnvSet("NEWSAPI_KEY"),
    slack: isEnvSet("SLACK_WEBHOOK_URL"),
    // Inbox accepts either the SendGrid Inbound Parse path-secret OR the
    // Mailgun webhook signing key. Either env var enables a working inbox.
    inbox:
      isEnvSet("INBOUND_WEBHOOK_SECRET") || isEnvSet("MAILGUN_SIGNING_KEY"),
  };
}

export default async function SettingsPage() {
  const config = await getWorkspaceConfig();

  // Stats query touches Supabase; fail soft so the settings page still
  // renders if the inbound_emails migration hasn't been run yet or
  // Supabase env vars aren't set locally.
  let inboundStats: InboundStats | null = null;
  try {
    inboundStats = await getInboundStats();
  } catch {
    inboundStats = null;
  }

  // Granola integration status — same fail-soft pattern so a missing
  // migration doesn't break the page. Default: "not connected."
  const ctx = await getIntegrationContext();
  let granolaStatus: WorkspaceIntegrationStatus = {
    connected: false,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncSummary: null,
    meta: {},
    updatedAt: null,
  };
  try {
    granolaStatus = await getIntegrationStatus(ctx.workspaceKey, "granola");
  } catch {
    // table missing or supabase unreachable → render the disconnected state
  }

  const systemStatus = getSystemConnectorStatus();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted font-medium">
          Workspace settings
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          Configure your intelligence layer
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Edits here flow through every surface in real time: the landing,
          the AE console, the manager view, the morning digest, the per-deal
          drawer, and Signal Studio. One config; every consumer reads from it.
        </p>
      </div>

      <ConnectorsSection
        granolaStatus={granolaStatus}
        systemStatus={systemStatus}
      />
      <SettingsForm initial={config} inboundStats={inboundStats} />
    </div>
  );
}
