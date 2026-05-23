import { Console } from "@/components/console";
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

// Server-rendered shell. Fetches workspace config + computes all signals
// from seed data, then hands the whole dataset to the client console.
//
// The console (client) handles task reconciliation, filters, drawer state,
// and all interactivity. Keeping the data fetch on the server means the
// signal evaluation runs once (not on every interaction) and the client
// re-renders are pure UI state changes.

export default async function HomePage() {
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
    },
  };
  const signals = evaluateAll(ctx);

  return (
    <Console
      signals={signals}
      opportunities={opportunities}
      accounts={accounts}
      contacts={contacts}
      activities={activities}
      calls={calls}
      deliveries={assetDeliveries}
      reps={reps}
      workspace={workspace}
    />
  );
}
