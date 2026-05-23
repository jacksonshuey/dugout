import { SettingsForm } from "@/components/settings-form";
import { ConnectorsSection } from "@/components/connectors-section";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { getInboundStats, type InboundStats } from "@/lib/inbound-email";
import { getIntegrationContext } from "@/lib/integration-context";
import {
  getIntegrationStatus,
  type WorkspaceIntegrationStatus,
} from "@/lib/workspace-integrations";

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

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted font-medium">
          Workspace settings
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">
          Configure your GTM engine
        </h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          Edits here flow through the system in real time: the home page, AE
          Console, Manager Console, architecture catalog, digest synthesis, and
          Signal Studio all read from this config.
        </p>
      </div>

      <ConnectorsSection granolaStatus={granolaStatus} />
      <SettingsForm initial={config} inboundStats={inboundStats} />
    </div>
  );
}
