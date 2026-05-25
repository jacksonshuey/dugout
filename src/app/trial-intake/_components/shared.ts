// Helpers shared by the Trial Orchestrator client components.

import type { TrialIntake } from "@/lib/types";

// Mirrors the scope key used by the Console (presetName::companyName) so the
// trial-intake localStorage bucket stays isolated per workspace.
export function buildWorkspaceKey(
  presetName: string | undefined,
  companyName: string,
): string {
  return `${presetName ?? "custom"}::${companyName}`;
}

// Merge stored + seed intakes. Stored wins on id collision — once an AE
// modifies a seed intake the local copy is authoritative for that browser.
export function mergeIntakes(
  seed: TrialIntake[],
  stored: TrialIntake[],
): TrialIntake[] {
  const byId = new Map<string, TrialIntake>();
  for (const i of seed) byId.set(i.id, i);
  for (const i of stored) byId.set(i.id, i);
  return Array.from(byId.values()).sort(
    (a, b) => b.submittedAt.localeCompare(a.submittedAt),
  );
}
