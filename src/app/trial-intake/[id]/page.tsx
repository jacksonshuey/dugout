import {
  accounts,
  opportunities,
  reps,
  seedTrialIntakes,
} from "@/data/seed";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { TrialIntakeDetailView } from "../_components/trial-intake-detail-view";

// Detail view for a single trial intake. Server shell hands the seed data +
// workspace scope key to the client. The client component merges seed +
// localStorage, looks up the intake by id, and renders the SLA timer +
// action buttons. If the id isn't in the seed it must be a locally-created
// intake - the client handles the lookup, so this route stays valid at
// build time without a generateStaticParams call.

export default async function TrialIntakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getWorkspaceConfig();
  return (
    <TrialIntakeDetailView
      intakeId={id}
      seedIntakes={seedTrialIntakes}
      opportunities={opportunities}
      accounts={accounts}
      reps={reps}
      workspaceCompanyName={workspace.companyName}
      workspacePresetName={workspace.presetName}
    />
  );
}
