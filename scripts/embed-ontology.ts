// Embed the ontology schema (every canonical field) into the vector tier so
// the ontology section's "Schema" search can find fields by meaning
// (e.g. "when did it happen" → Meeting.occurred_at). Each canonical field
// becomes one embedded row: its type, description, reconciliation note, and
// the raw sources that map into it.
//
// Idempotent — clears prior ontology rows for these source_ids before
// re-inserting. Run once (and after schema changes):
//   npx tsx scripts/embed-ontology.ts
//
// Requires: 20260528_doc_embeddings.sql applied, OPENAI_API_KEY +
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in env.

import { CANONICAL_OBJECTS } from "../src/data/canonical-objects";
import { FIELD_MAPPINGS } from "../src/data/object-mappings";
import { embedBatch } from "../src/lib/embeddings";
import {
  deleteEmbeddingsForSources,
  upsertEmbeddings,
  type DocEmbeddingInput,
} from "../src/lib/doc-embeddings";

const EMBED_BATCH = 100;

function sourcesFor(objKey: string, fieldKey: string): string[] {
  return FIELD_MAPPINGS.filter((m) => m[3] === objKey && m[4] === fieldKey).map(
    (m) => `${m[0]}.${m[1]}.${m[2]}`,
  );
}

function contentFor(
  objKey: string,
  objDescription: string,
  field: {
    key: string;
    type: string;
    description: string;
    unit?: string;
    joinNote?: string;
  },
): string {
  const unit = field.unit ? ` ${field.unit}` : "";
  const join = field.joinNote ? ` Reconciliation: ${field.joinNote}.` : "";
  const srcs = sourcesFor(objKey, field.key);
  const srcLine = srcs.length
    ? ` Mapped from: ${srcs.join(", ")}.`
    : " No source mapping yet (orphan canonical field).";
  return `${objKey}.${field.key} (${field.type}${unit}) — ${field.description}.${join}${srcLine} Part of the ${objKey} canonical object: ${objDescription}`;
}

async function main() {
  const units: { sourceId: string; content: string }[] = [];
  for (const obj of CANONICAL_OBJECTS) {
    for (const field of obj.fields) {
      units.push({
        sourceId: `${obj.key}.${field.key}`,
        content: contentFor(obj.key, obj.description, field),
      });
    }
  }

  // Idempotent re-run: drop existing ontology rows for these fields first.
  await deleteEmbeddingsForSources(
    "ontology_field",
    units.map((u) => u.sourceId),
  );

  let embedded = 0;
  for (let i = 0; i < units.length; i += EMBED_BATCH) {
    const batch = units.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(batch.map((u) => u.content));
    const docs: DocEmbeddingInput[] = [];
    batch.forEach((u, j) => {
      const v = vectors[j];
      if (!v) return;
      docs.push({
        source_table: "ontology_field",
        source_id: u.sourceId,
        chunk_index: 0,
        account_id: null,
        kind: "canonical_field",
        content: u.content,
        embedding: v,
      });
    });
    await upsertEmbeddings(docs);
    embedded += docs.length;
    console.log(`embedded ${embedded}/${units.length} canonical fields…`);
  }

  console.log(`done — ${embedded} canonical fields embedded`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
