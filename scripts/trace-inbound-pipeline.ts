// Diagnostic for the inbound email -> signals pipeline.
//
// Reads the three audit/data tables and reports where mail is getting stuck:
//   - inbound_emails: did the row land at all? did it get classified?
//   - email_filter_decisions: what verdict did the filter return?
//   - external_signals: did signals materialize? high vs medium relevance?
//
// Run with: npx tsx scripts/trace-inbound-pipeline.ts [hours]
// Default lookback = 48h.

import { supabaseAdmin } from "../src/lib/supabase";

const lookbackHours = parseInt(process.argv[2] ?? "48", 10);
const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString();

async function main() {
  const sb = supabaseAdmin();

  console.log(`\n=== Inbound pipeline trace · last ${lookbackHours}h ===`);
  console.log(`since: ${since}\n`);

  // ── inbound_emails ──────────────────────────────────────────────
  const { data: inbound, error: e1 } = await sb
    .from("inbound_emails")
    .select("id, from_domain, subject, received_at, classified_at, signals_emitted")
    .gte("received_at", since)
    .order("received_at", { ascending: false });
  if (e1) throw new Error(`inbound_emails read: ${e1.message}`);

  const classified = (inbound ?? []).filter((r) => r.classified_at !== null);
  const unclassified = (inbound ?? []).filter((r) => r.classified_at === null);
  const withSignals = (inbound ?? []).filter(
    (r) => (r.signals_emitted ?? 0) > 0,
  );

  console.log("inbound_emails");
  console.log(`  total received    : ${inbound?.length ?? 0}`);
  console.log(`  classified        : ${classified.length}`);
  console.log(`  unclassified      : ${unclassified.length}`);
  console.log(`  produced signals  : ${withSignals.length}`);
  if (unclassified.length > 0) {
    console.log("  recent unclassified:");
    for (const r of unclassified.slice(0, 5)) {
      console.log(
        `    [${r.received_at}] ${r.from_domain} — ${(r.subject ?? "").slice(0, 70)}`,
      );
    }
  }

  // ── email_filter_decisions ──────────────────────────────────────
  const { data: decisions, error: e2 } = await sb
    .from("email_filter_decisions")
    .select("verdict, reasoning, model, stage, decided_at")
    .gte("decided_at", since)
    .order("decided_at", { ascending: false });
  if (e2) throw new Error(`email_filter_decisions read: ${e2.message}`);

  console.log("\nemail_filter_decisions");
  console.log(`  total: ${decisions?.length ?? 0}`);
  const verdictCounts = new Map<string, number>();
  for (const d of decisions ?? []) {
    const key = `stage${d.stage} · ${d.verdict} · ${(d.reasoning ?? "").slice(0, 80)}`;
    verdictCounts.set(key, (verdictCounts.get(key) ?? 0) + 1);
  }
  const sortedCounts = [...verdictCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedCounts.slice(0, 15)) {
    console.log(`  ${count.toString().padStart(4)} × ${key}`);
  }

  // Flag the smoking gun explicitly.
  const noApiKey = (decisions ?? []).filter((d) =>
    (d.reasoning ?? "").includes("no_api_key"),
  );
  if (noApiKey.length > 0) {
    console.log(
      `\n  ⚠️  ${noApiKey.length} decisions hit the "no_api_key" branch — ANTHROPIC_API_KEY is missing on the server.`,
    );
  }

  // ── external_signals ────────────────────────────────────────────
  const { data: signals, error: e3 } = await sb
    .from("external_signals")
    .select("id, account_id, type, workspace_relevance, occurred_at, meta")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false });
  if (e3) throw new Error(`external_signals read: ${e3.message}`);

  console.log("\nexternal_signals");
  console.log(`  total written     : ${signals?.length ?? 0}`);
  const high = (signals ?? []).filter((s) => s.workspace_relevance === "high");
  const med = (signals ?? []).filter((s) => s.workspace_relevance === "medium");
  console.log(`  high relevance    : ${high.length}`);
  console.log(`  medium relevance  : ${med.length}`);
  if (high.length > 0) {
    console.log(`  most recent high  : ${high[0]!.occurred_at} (${high[0]!.account_id})`);
  }

  // Break down by account-tagged vs workspace-only. The ticker on the landing
  // page renders ONLY account-tagged signals; workspace signals go to the
  // "Top stories" list. If the ticker is stale but workspace signals are
  // fresh, the gap is account-mention extraction.
  const accountTagged = (signals ?? []).filter(
    (s) => s.account_id && s.account_id !== "__workspace__",
  );
  const workspaceOnly = (signals ?? []).filter(
    (s) => s.account_id === "__workspace__",
  );
  console.log(`  account-tagged    : ${accountTagged.length}`);
  console.log(`  workspace-only    : ${workspaceOnly.length}`);
  if (accountTagged.length > 0) {
    console.log(
      `  most recent acct  : ${accountTagged[0]!.occurred_at} (${accountTagged[0]!.account_id}, ${accountTagged[0]!.workspace_relevance})`,
    );
  }
  if (workspaceOnly.length > 0) {
    console.log(
      `  most recent ws    : ${workspaceOnly[0]!.occurred_at} (${workspaceOnly[0]!.workspace_relevance})`,
    );
  }

  // Top extracted mentions among workspace-only signals — these are the
  // entities Haiku found but matchAccount() couldn't map to a trackable
  // account. High-frequency unmatched mentions are the prompt/keyword gaps.
  const mentionCounts = new Map<string, number>();
  for (const s of workspaceOnly) {
    const meta = (s as unknown as { meta?: { mention?: string } }).meta;
    const m = meta?.mention?.trim();
    if (!m) continue;
    mentionCounts.set(m, (mentionCounts.get(m) ?? 0) + 1);
  }
  const topMentions = [...mentionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (topMentions.length > 0) {
    console.log("\n  top unmatched mentions (entities Haiku saw but matchAccount missed):");
    for (const [mention, count] of topMentions) {
      console.log(`    ${count.toString().padStart(3)} × ${mention}`);
    }
  }

  // ── verdict ─────────────────────────────────────────────────────
  console.log("\n=== verdict ===");
  if ((inbound?.length ?? 0) === 0) {
    console.log("No inbound mail in window. AgentMail or webhook config.");
  } else if (noApiKey.length > 0) {
    console.log("ANTHROPIC_API_KEY missing on server. Filter skips Stage 2, classifier never runs.");
  } else if (unclassified.length > inbound!.length / 2) {
    console.log("Most inbound rows are unclassified. Filter or classifier throwing.");
  } else if ((signals?.length ?? 0) === 0) {
    console.log("Classifier ran but produced 0 signals. Check prompt or trackable accounts.");
  } else if (high.length === 0) {
    console.log("Signals are landing but none are 'high' relevance. Ticker filters them out.");
  } else {
    console.log("Pipeline appears healthy. Check ticker poll cadence / CDN cache.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
