import { supabaseAdmin } from "./supabase";
import { chunkText, embedBatch } from "./embeddings";
import { upsertEmbeddings, type DocEmbeddingInput } from "./doc-embeddings";

// Batched, fail-soft embedding sweep. Finds recent external_signals that don't
// yet have embeddings and embeds them into the vector tier. Runs on its own
// cron (off the inbound webhook + per-email chain hot paths, which must stay
// fast). Idempotent: only embeds signals missing from doc_embeddings, so
// re-running is cheap.

const SCAN_LIMIT = 200;
const EMBED_BATCH = 100;

interface SignalRow {
  id: string;
  account_id: string | null;
  type: string | null;
  summary: string | null;
  source_content_md: string | null;
}

function contentFor(row: SignalRow): string {
  const summary = (row.summary ?? "").trim();
  const src = (row.source_content_md ?? "").trim();
  return src ? `${summary}\n\n${src}` : summary;
}

export interface SweepResult {
  scanned: number;
  embedded: number; // chunks written
  skipped: number; // signals already embedded or with no text
}

export async function embedSignalsSweep(
  opts: { limit?: number } = {},
): Promise<SweepResult> {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return { scanned: 0, embedded: 0, skipped: 0 };
  }

  const limit = opts.limit ?? SCAN_LIMIT;
  const { data: sigs, error } = await sb
    .from("external_signals")
    .select("id, account_id, type, summary, source_content_md")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !sigs || sigs.length === 0) {
    return { scanned: 0, embedded: 0, skipped: 0 };
  }

  const rows = sigs as SignalRow[];
  const ids = rows.map((r) => r.id);

  // Which of these already have embeddings? Only embed the rest.
  const { data: existing } = await sb
    .from("doc_embeddings")
    .select("source_id")
    .eq("source_table", "external_signals")
    .in("source_id", ids);
  const have = new Set((existing ?? []).map((e) => e.source_id as string));

  const todo = rows.filter((r) => !have.has(r.id) && contentFor(r).length > 0);
  if (todo.length === 0) {
    return { scanned: rows.length, embedded: 0, skipped: rows.length };
  }

  // Chunk each signal, flatten to (row, chunkIndex, text) units.
  const units: { row: SignalRow; chunkIndex: number; text: string }[] = [];
  for (const row of todo) {
    chunkText(contentFor(row)).forEach((text, chunkIndex) =>
      units.push({ row, chunkIndex, text }),
    );
  }

  let embedded = 0;
  for (let i = 0; i < units.length; i += EMBED_BATCH) {
    const batch = units.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((u) => u.text));
    const docs: DocEmbeddingInput[] = [];
    batch.forEach((u, j) => {
      const v = vectors[j];
      if (!v) return; // no key or empty — skip
      docs.push({
        source_table: "external_signals",
        source_id: u.row.id,
        chunk_index: u.chunkIndex,
        account_id: u.row.account_id ?? null,
        kind: u.row.type ?? null,
        content: u.text,
        embedding: v,
      });
    });
    await upsertEmbeddings(docs);
    embedded += docs.length;
  }

  return {
    scanned: rows.length,
    embedded,
    skipped: rows.length - todo.length,
  };
}
