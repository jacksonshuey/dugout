# Adding a new customer to the demo

Dugout's demo pipeline lives in `src/data/seed.ts` as plain TypeScript
arrays — accounts, opportunities, contacts, activities. The signal engine
runs over those arrays; the Console, Manager, and `/account/[slug]` pages
all read from them.

Adding a new customer means adding one entry to each of the four arrays
and keeping their IDs in sync. The `createAccountSeed` helper in
[`src/lib/account-onboarding.ts`](../src/lib/account-onboarding.ts) does
this in one call.

## The minimal example

```ts
import { createAccountSeed } from "@/lib/account-onboarding";

const acmeBundle = createAccountSeed({
  // --- account ---
  name: "Acme Logistics",
  industry: "Logistics",
  segment: "Enterprise",
  hqLocation: "New York, NY",
  legalTeamSize: 50,
  domain: "acme-logistics.com",
  linkedinSlug: "acme-logistics",
  ticker: "ACME",

  // --- opportunity ---
  oppName: "Acme - Legal Intake Front Door",
  ownerId: "rep_sc",       // Sara Chen
  stage: "Qualified",
  amount: 200000,
  enteredStageAt: "2026-05-19",
  createdAt: "2026-04-30",
  closeDate: "2026-08-15",

  // --- contacts ---
  champion: { name: "Jane Doe", title: "VP Legal" },
  additionalContacts: [
    { name: "Bob Smith", title: "Deputy GC", role: "GC" },
  ],

  // --- recent activity (keeps the pipeline reading as live) ---
  activities: [
    {
      type: "meeting",
      occurredAt: "2026-05-21",
      summary: "Discovery 2 - Jane walked through current intake pain points",
    },
    {
      contactId: "c_acme_logistics_2",
      type: "email_received",
      occurredAt: "2026-05-22",
      summary: "Bob asked for the security one-pager",
    },
  ],
});
```

`acmeBundle` is `{ account, opportunity, contacts, activities }` — all
typed, all linked by IDs derived from the company name slug:

```
account.id           = acc_acme_logistics
opportunity.id       = opp_acme_logistics
contacts[0].id       = c_acme_logistics_1   (the Champion)
contacts[1].id       = c_acme_logistics_2
activities[0].id     = a_acme_logistics_1
activities[1].id     = a_acme_logistics_2
```

## Wiring the bundle into seed.ts

Until seed.ts is refactored to consume bundles directly (see below), append
the parts to the existing arrays:

```ts
// seed.ts
export const accounts: Account[] = [
  ...existingAccounts,
  acmeBundle.account,
];

export const opportunities: Opportunity[] = [
  ...existingOpps,
  acmeBundle.opportunity,
];

export const contacts: Contact[] = [
  ...existingContacts,
  ...acmeBundle.contacts,
];

export const activities: Activity[] = [
  ...existingActivities,
  ...acmeBundle.activities,
];
```

The bundle structure makes it impossible to forget one of the four arrays —
all four are produced together.

## Preserving hand-coded short IDs (existing customers)

Some seed accounts use hand-coded short IDs that don't match what
`generateAccountId(name)` would produce. Example: `acc_ccep` (acronym) vs
`acc_coca_cola_europacific_partners` (slug from name).

For those, pass `idOverride` so the helper preserves the hand-coded form:

```ts
createAccountSeed({
  name: "Coca-Cola Europacific Partners",
  idOverride: "acc_ccep" as AccountId,
  // ... rest of input ...
});
```

All derived IDs (opp_, c_, a_) follow the override slug, so existing
references in tests, scripts, and production data keep working.

## Stage choice and signal-engine implications

Pick `stage` carefully — different stages fire different signal-engine
rules. Quick heuristic:

| Stage             | What fires if you skimp on data                            |
| ----------------- | ---------------------------------------------------------- |
| `Intro`           | Almost nothing. Safest for "quiet new account."            |
| `Qualified`       | Few rules. Safe.                                           |
| `Demo Sat`        | Asset-gap rules (give the opp a couple of activities).     |
| `Evaluating`      | Needs Finance/CFO + IT/Security contacts or wedges fire.   |
| `Selected Vendor` | Procurement contact expected; many rules fire.             |
| `Contracting`     | Asset deliveries expected; legal-redline rules watching.   |

For a clean addition, prefer `Qualified` or `Demo Sat` with at least one
recent activity. If you want a deliberate wedge for a demo scenario, mark
`isDemoScenario: true` so the UI surfaces the rigged-scenario chip.

## When to use the helper vs hand-coding

- **New customer for the demo pipeline**: use the helper.
- **Demo-scenario accounts with specific signal gaps** (Snowflake, KKR,
  CNA — `DEMO_SCENARIO_ACCOUNTS`): keep hand-coded so the deterministic
  SV Health scores in `scripts/verify-demo-scores.ts` stay pinned.
- **Production-onboarded customers** (future): not handled here at all —
  they go to the Supabase `accounts` table via `gen_random_uuid()`, see
  `supabase/migrations/20260524_accounts_table.sql`.

## Verifying after adding a customer

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npx tsx scripts/verify-demo-scores.ts    # confirms scenario scores unchanged
```

All four should exit clean before merging. The demo-scores check is the
canary for accidentally changing one of the three rigged scenarios.
