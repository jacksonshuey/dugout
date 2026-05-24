// Verify the 3 demo SV Health Scenarios render the expected tiers.
// Run with: npx tsx scripts/verify-demo-scores.ts

import {
  accounts,
  contacts,
  opportunities,
  activities,
  calls,
  assetDeliveries,
  reps,
  demoSignals,
  DEMO_SCENARIO_ACCOUNTS,
} from "../src/data/seed";
import { computeSVHealthScore } from "../src/lib/sv-health";
import { evaluateAll } from "../src/lib/signal-engine";
import type { EvaluationContext } from "../src/lib/types";

const ctx: EvaluationContext = {
  opportunities,
  accounts,
  contacts,
  activities,
  calls,
  deliveries: assetDeliveries,
  reps,
};

// Combine engine-emitted signals with the hand-authored demoSignals (the same
// way the routes/pages do).
const engineSignals = evaluateAll(ctx);
const allSignals = [...engineSignals, ...demoSignals];

console.log("Total engine signals:", engineSignals.length);
console.log("Total demo signals:", demoSignals.length);
console.log("");

for (const [tier, accountId] of Object.entries(DEMO_SCENARIO_ACCOUNTS)) {
  const account = accounts.find((a) => a.id === accountId)!;
  const opp = opportunities.find((o) => o.accountId === accountId)!;
  const oppContacts = contacts.filter((c) =>
    opp.contactRoleIds.includes(c.id),
  );

  const score = computeSVHealthScore({
    account,
    opportunity: opp,
    contacts: oppContacts,
    signals: allSignals,
    externalSignals: [],
  });

  const oppSignals = allSignals.filter((s) => s.oppId === opp.id);
  const bySource: Record<string, number> = {};
  for (const s of oppSignals) {
    const tool = s.sourceTool ?? "signal_engine";
    bySource[tool] = (bySource[tool] ?? 0) + 1;
  }
  const byType: Record<string, string[]> = {};
  for (const s of oppSignals) {
    const tool = s.sourceTool ?? "signal_engine";
    byType[s.signalType] = byType[s.signalType] ?? [];
    byType[s.signalType].push(tool);
  }

  console.log(`══ ${tier.toUpperCase()} — ${account.name} (${accountId}) ══`);
  console.log(`  Opp: ${opp.name}`);
  console.log(`  Amount: $${opp.amount.toLocaleString()}`);
  console.log(`  Score: ${score.score} / 100  →  TIER: ${score.tier.toUpperCase()}`);
  console.log(`  Components:`, score.components);
  console.log(`  Drivers:`);
  for (const d of score.drivers) {
    console.log(`    - ${d}`);
  }
  console.log(`  Signals on this opp: ${oppSignals.length}`);
  console.log(`    By source:`, bySource);
  console.log(`    By type (with sources):`);
  for (const [type, sources] of Object.entries(byType)) {
    const distinct = [...new Set(sources)];
    console.log(`      ${type}: ${distinct.length} source(s) — ${distinct.join(", ")}`);
  }
  console.log("");
}
