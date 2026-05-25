import {
  accounts,
  opportunities,
  reps,
  seedTrialIntakes,
} from "@/data/seed";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { TrialIntakeNewForm } from "../_components/trial-intake-new-form";

// New-intake form. Server shell hands the dropdown source data + workspace
// scope key to the client form. Submitting writes a TrialIntake to
// localStorage and auto-resolves the linked NO_TRIAL_BRIEF_AT_DEMO_SAT task.

export default async function TrialIntakeNewPage() {
  const workspace = await getWorkspaceConfig();
  return (
    <TrialIntakeNewForm
      seedIntakes={seedTrialIntakes}
      opportunities={opportunities}
      accounts={accounts}
      reps={reps}
      workspaceCompanyName={workspace.companyName}
      workspacePresetName={workspace.presetName}
    />
  );
}
