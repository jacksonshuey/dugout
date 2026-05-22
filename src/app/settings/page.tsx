import { SettingsForm } from "@/components/settings-form";
import { getWorkspaceConfig } from "@/lib/workspace-server";

export default async function SettingsPage() {
  const config = await getWorkspaceConfig();

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

      <SettingsForm initial={config} />
    </div>
  );
}
