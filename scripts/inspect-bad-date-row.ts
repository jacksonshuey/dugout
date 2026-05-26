// One-off diagnostic — pull the future-dated acc_quantum row and any siblings
// to figure out which write path produced the bad occurred_at.
// Run with: npx tsx scripts/inspect-bad-date-row.ts

import { supabaseAdmin } from "../src/lib/supabase";

async function main() {
  const sb = supabaseAdmin();

  // 1. Any external_signals row with occurred_at in the future
  const nowIso = new Date().toISOString();
  const { data: future, error: e1 } = await sb
    .from("external_signals")
    .select(
      "id, account_id, source, type, summary, occurred_at, url, meta, inbound_email_id",
    )
    .gt("occurred_at", nowIso)
    .order("occurred_at", { ascending: false });
  if (e1) throw new Error(`future query: ${e1.message}`);

  console.log(`\n=== external_signals with future occurred_at (now = ${nowIso}) ===`);
  console.log(`count: ${future?.length ?? 0}`);
  for (const r of future ?? []) {
    console.log(JSON.stringify(r, null, 2));
  }

  // 2. If any of those have an inbound_email_id, fetch the parent row
  for (const r of future ?? []) {
    const inboundId = (r as { inbound_email_id?: string }).inbound_email_id;
    if (!inboundId) continue;
    const { data: parent, error: e2 } = await sb
      .from("inbound_emails")
      .select(
        "id, from_domain, subject, received_at, classified_at, signals_emitted, publisher_canonical_name",
      )
      .eq("id", inboundId)
      .maybeSingle();
    if (e2) {
      console.warn(`parent fetch failed for ${inboundId}: ${e2.message}`);
      continue;
    }
    console.log(`\n=== parent inbound_email for signal ${r.id} ===`);
    console.log(JSON.stringify(parent, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
