// Seed 4 workspace-wide demo signals so the AE Brief renders during demos.
// Run with:  set -a && source .env.local && set +a && npx tsx scripts/seed-ae-brief-demo.ts
//
// All rows use deterministic UUIDs with an "aebr0001-" recognizable prefix
// (external_signals.id is a uuid column). Re-running is idempotent —
// rows are upserted on id conflict, no duplicates.
//
// To remove: in Supabase Studio (or psql) run —
//   delete from external_signals
//   where id in (
//     'a3b71ef0-0000-0000-0000-000000000001',
//     'a3b71ef0-0000-0000-0000-000000000002',
//     'a3b71ef0-0000-0000-0000-000000000003',
//     'a3b71ef0-0000-0000-0000-000000000004'
//   );
//
// Each signal lives within the last 30h so they all fall inside the 48h
// ranker window, and each is tagged to a tech/AI publisher canonical that
// `newsletter-verticals.ts` maps to "enterprise-tech" or "ai-cross-cutting".
// That combo (workspace account + tech/AI vertical + recent) is exactly
// what the AE Brief filter consumes.

import { supabaseAdmin } from "../src/lib/supabase";
import { WORKSPACE_ACCOUNT_ID } from "../src/lib/external-signals";

const HOUR_MS = 60 * 60 * 1000;
const now = Date.now();

const DEMO_ROWS = [
  {
    id: "a3b71ef0-0000-0000-0000-000000000001",
    publisher_canonical_name: "import_ai",
    type: "product_launch",
    summary:
      "Anthropic publishes interpretability research on circuits in Claude 3.7, identifying 14 mechanistic features tied to deceptive behavior.",
    source_url: "https://importai.substack.com/p/anthropic-circuits-claude-37",
    occurred_at: new Date(now - 8 * HOUR_MS).toISOString(),
  },
  {
    id: "a3b71ef0-0000-0000-0000-000000000002",
    publisher_canonical_name: "latent_space",
    type: "product_launch",
    summary:
      "OpenAI releases o3-mini-pro to API customers with 70% lower latency than o1-pro for agentic workloads.",
    source_url: "https://www.latent.space/p/o3-mini-pro-release",
    occurred_at: new Date(now - 14 * HOUR_MS).toISOString(),
  },
  {
    id: "a3b71ef0-0000-0000-0000-000000000003",
    publisher_canonical_name: "stratechery",
    type: "competitor_mention",
    summary:
      "Ben Thompson argues Databricks-Snowflake convergence is accelerating as both pivot from warehouse to AI platform.",
    source_url: "https://stratechery.com/2026/databricks-snowflake-convergence",
    occurred_at: new Date(now - 22 * HOUR_MS).toISOString(),
  },
  {
    id: "a3b71ef0-0000-0000-0000-000000000004",
    publisher_canonical_name: "the_information",
    type: "layoff",
    summary:
      "Microsoft cuts 4,000 Azure roles as it reorganizes cloud sales around AI agents, per internal memo seen by The Information.",
    source_url: "https://www.theinformation.com/articles/microsoft-azure-cuts-2026",
    occurred_at: new Date(now - 30 * HOUR_MS).toISOString(),
  },
] as const;

async function main() {
  const sb = supabaseAdmin();
  const rows = DEMO_ROWS.map((r) => ({
    id: r.id,
    account_id: WORKSPACE_ACCOUNT_ID,
    source: "newsletter" as const,
    type: r.type,
    summary: r.summary,
    occurred_at: r.occurred_at,
    url: r.source_url,
    is_demo: true,
    publisher_canonical_name: r.publisher_canonical_name,
    source_url: r.source_url,
  }));

  const { error } = await sb
    .from("external_signals")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  }
  console.log(`Seeded ${rows.length} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
