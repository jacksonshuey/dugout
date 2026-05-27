import {
  accounts,
  activities,
  assetDeliveries,
  calls,
  contacts,
  opportunities,
  reps,
} from "@/data/seed";
import { evaluateAll } from "@/lib/signal-engine";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { INTEGRATIONS } from "@/data/integrations";
import { checkAllHealth } from "@/lib/integration-health";
import { ToolShell } from "@/components/tool/tool-shell";

// Operator tool surface. Same building blocks as the landing page
// demonstrations, organized into tabs so a real user can move between
// dashboard, integrations, rule authoring, the decisions queue, and the
// ontology reference without scrolling a long marketing page.
//
// Intentionally not linked from the landing nav. Routable directly at
// /tool; discovery is by URL handoff.

export const revalidate = 60;

export default async function ToolPage() {
  const workspace = await getWorkspaceConfig();
  const ctx = {
    opportunities,
    accounts,
    contacts,
    activities,
    calls,
    deliveries: assetDeliveries,
    reps,
    config: {
      companyName: workspace.companyName,
      assets: workspace.assets,
      stack: workspace.stack,
      contractIdleAmountFloor: workspace.contractIdleAmountFloor,
    },
  };
  const signals = evaluateAll(ctx);
  const integrationHealth = checkAllHealth();

  return (
    <ToolShell
      signals={signals}
      opportunities={opportunities}
      accounts={accounts}
      contacts={contacts}
      activities={activities}
      calls={calls}
      deliveries={assetDeliveries}
      reps={reps}
      workspace={workspace}
      integrations={INTEGRATIONS}
      integrationHealth={integrationHealth}
    />
  );
}
