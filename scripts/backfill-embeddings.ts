// Backfill the vector retrieval tier from existing external_signals rows.
// Idempotent — upserts on (source_table, source_id), so re-running only
// refreshes. Safe to run repeatedly as new signals accumulate.
//
// Requires: 20260528_doc_embeddings.sql applied, OPENAI_API_KEY +
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in env (or .env.local).
//
// Run with: npx tsx scripts/backfill-embeddings.ts [--limit N]

import { supabaseAdmin } from "../src/lib/supabase";
import { chunkText, embedBatch } from "../src/lib/embeddings";
import {
  deleteEmbeddingsForSources,
  upsertEmbeddings,
  type DocEmbeddingInput,
} from "../src/lib/doc-embeddings";

const PAGE = 200;
const EMBED_BATCH = 100;

function contentFor(row: {
  summary: string | null;
  source_content_md: string | null;
}): string {
  const summary = (row.summary ?? "").trim();
  const src = (row.source_content_md ?? "").trim();
  return src ? `${summary}\n\n${src}` : summary;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const sb = supabaseAdmin();
  let from = 0;
  let embedded = 0;
  let skipped = 0;

  for (;;) {
    if (embedded >= limit) break;
    const { data, error } = await sb
      .from("external_signals")
      .select("id, account_id, type, summary, source_content_md")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;

    // Chunk each row, flattening into (row, chunkIndex, text) units so one
    // embedBatch call covers many chunks across many rows.
    const units: {
      sourceId: string;
      accountId: string | null;
      kind: string | null;
      chunkIndex: number;
      text: string;
    }[] = [];
    const sourceIds: string[] = [];
    for (const row of data) {
      const chunks = chunkText(contentFor(row));
      if (chunks.length === 0) {
        skipped += 1;
        continue;
      }
      sourceIds.push(row.id as string);
      chunks.forEach((text, chunkIndex) =>
        units.push({
          sourceId: row.id as string,
          accountId: (row.account_id ?? null) as string | null,
          kind: (row.type ?? null) as string | null,
          chunkIndex,
          text,
        }),
      );
    }

    // Clear any prior chunks for these sources first, so a source that now
    // chunks into fewer pieces doesn't leave stale rows behind.
    await deleteEmbeddingsForSources("external_signals", sourceIds);

    for (let i = 0; i < units.length; i += EMBED_BATCH) {
      const batch = units.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(batch.map((u) => u.text));
      const docs: DocEmbeddingInput[] = [];
      batch.forEach((u, j) => {
        const v = vectors[j];
        if (!v) return; // no key or empty — skip
        docs.push({
          source_table: "external_signals",
          source_id: u.sourceId,
          chunk_index: u.chunkIndex,
          account_id: u.accountId,
          kind: u.kind,
          content: u.text,
          embedding: v,
        });
      });
      await upsertEmbeddings(docs);
      embedded += docs.length;
      console.log(`embedded ${embedded} chunks (skipped ${skipped} rows)…`);
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`done — embedded ${embedded}, skipped ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
