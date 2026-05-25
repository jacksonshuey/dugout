/**
 * scripts/scaffold-customer.ts
 *
 * Edit the INPUT block below and run:
 *
 *   npx tsx scripts/scaffold-customer.ts
 *
 * Output is a copy-pasteable block of seed entries (account + opportunity +
 * contacts + activities) you can drop into src/data/seed.ts. The script
 * exists so onboarding a new customer is "fill one form, paste one block"
 * rather than four hand-synced array additions.
 *
 * If you'd rather wire the bundle directly into the existing
 * `checkboxBundles`-style array in seed.ts, just import `createAccountSeed`
 * and call it inline. This script is for one-off, copy-out scaffolding.
 */

import { createAccountSeed, type NewClientInput } from "@/lib/account-onboarding";

// ---------------------------------------------------------------------------
// EDIT BELOW THIS LINE
// ---------------------------------------------------------------------------

const INPUT: NewClientInput = {
  // --- account facts ---
  name: "Acme Logistics",
  industry: "Logistics",
  segment: "Enterprise",
  hqLocation: "New York, NY",
  legalTeamSize: 50,
  domain: "acme-logistics.com",
  linkedinSlug: "acme-logistics",
  ticker: "ACME",

  // --- opportunity facts ---
  oppName: "Acme - Legal Intake Front Door",
  ownerId: "rep_sc", // Sara Chen
  stage: "Qualified",
  amount: 200000,
  enteredStageAt: "2026-05-21",
  createdAt: "2026-05-01",
  closeDate: "2026-08-15",

  // --- contacts ---
  champion: { name: "Jane Doe", title: "VP Legal" },
  additionalContacts: [
    // { name: "Bob Smith", title: "Deputy GC", role: "GC" },
  ],

  // --- recent activity ---
  activities: [
    {
      type: "meeting",
      occurredAt: "2026-05-22",
      summary: "Discovery 2 - intake pain points",
    },
  ],
};

// ---------------------------------------------------------------------------
// EDIT ABOVE THIS LINE — below here is plain serialization
// ---------------------------------------------------------------------------

const bundle = createAccountSeed(INPUT);

function block(label: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  // Convert JSON to a TS-pasteable form: strip quotes from keys.
  const ts = json.replace(/^(\s*)"([a-zA-Z_][a-zA-Z0-9_]*)":/gm, '$1$2:');
  console.log(`// ${label}`);
  console.log(ts.replace(/^\{/, "").replace(/\}$/, "").trim());
  console.log();
}

console.log("─── Append to `accounts: Account[]` ───────────────────────");
console.log(blockify(bundle.account));
console.log();
console.log("─── Append to `opportunities: Opportunity[]` ──────────────");
console.log(blockify(bundle.opportunity));
console.log();
console.log("─── Append to `contacts: Contact[]` ───────────────────────");
for (const c of bundle.contacts) console.log(blockify(c, /* compact */ true));
console.log();
console.log("─── Append to `activities: Activity[]` ────────────────────");
for (const a of bundle.activities) console.log(blockify(a, /* compact */ true));
console.log();
console.log("─── Done. Bundle: ", bundle.contacts.length, "contacts,", bundle.activities.length, "activities. ───");

// Pretty-print one entity as a TS-pasteable object literal.
function blockify(value: unknown, compact = false): string {
  const json = JSON.stringify(value, null, compact ? 0 : 2);
  return json.replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, "$1:") + ",";
}

// Silence the `block` helper hoist linter without forcing import gymnastics.
void block;
