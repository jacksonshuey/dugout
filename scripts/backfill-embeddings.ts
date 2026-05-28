// Backfill the vector retrieval tier from existing external_signals rows.
// Idempotent — upserts on (source_table, source_id), so re-running only
// refreshes. Safe to run repeatedly as new signals accumulate.
//
// Requires: 20260528_doc_embeddings.sql applied, OPENAI_API_KEY +
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in env (or .env.local).
//
// Run with: npx tsx scripts/backfill-embeddings.ts [--limit N]

import { supabaseAdmin } from "../src/lib/supabase";
import { embedBatch } from "../src/lib/embeddings";
import { upsertEmbeddings, type DocEmbeddingInput } from "../src/lib/doc-embeddings";

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

    // Build (row, content) pairs, dropping rows with no embeddable text.
    const rows = data
      .map((r) => ({ row: r, content: contentFor(r) }))
      .filter((x) => x.content.length > 0);
    skipped += data.length - rows.length;

    // Embed in sub-batches to stay within request limits.
    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      const chunk = rows.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(chunk.map((c) => c.content));
      const docs: DocEmbeddingInput[] = [];
      chunk.forEach((c, j) => {
        const v = vectors[j];
        if (!v) return; // no key or empty — skip
        docs.push({
          source_table: "external_signals",
          source_id: c.row.id as string,
          account_id: (c.row.account_id ?? null) as string | null,
          kind: (c.row.type ?? null) as string | null,
          content: c.content,
          embedding: v,
        });
      });
      await upsertEmbeddings(docs);
      embedded += docs.length;
      console.log(`embedded ${embedded} (skipped ${skipped})…`);
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
