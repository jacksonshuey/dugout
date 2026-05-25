import {
  accounts,
  opportunities,
  reps,
  seedTrialIntakes,
} from "@/data/seed";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { TrialIntakeListView } from "./_components/trial-intake-list-view";

// Trial Orchestrator landing — active intakes list. Server shell fetches the
// canonical seed snapshot + workspace config (for the localStorage scope key)
// and hands them to the client view, which merges with any locally-created
// intakes and runs the SLA countdowns.

export default async function TrialIntakeIndexPage() {
  const workspace = await getWorkspaceConfig();
  return (
    <TrialIntakeListView
      seedIntakes={seedTrialIntakes}
      opportunities={opportunities}
      accounts={accounts}
      reps={reps}
      workspaceCompanyName={workspace.companyName}
      workspacePresetName={workspace.presetName}
    />
  );
}
