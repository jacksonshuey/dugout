// Embed every connected integration into the vector tier so the unified
// semantic search can surface the integration itself — e.g. "salesforce"
// returns the Salesforce integration, what it is, and the canonical objects /
// fields it feeds into the ontology.
//
// Idempotent — clears prior integration rows before re-inserting. Run once
// (and after the integration catalog or field mappings change):
//   npx tsx --env-file=.env.local scripts/embed-integrations.ts
//
// Requires: 20260528_doc_embeddings.sql applied, OPENAI_API_KEY +
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in env.

import { INTEGRATIONS } from "../src/data/integrations";
import { FIELD_MAPPINGS } from "../src/data/object-mappings";
import { embedBatch } from "../src/lib/embeddings";
import {
  deleteEmbeddingsForSources,
  upsertEmbeddings,
  type DocEmbeddingInput,
} from "../src/lib/doc-embeddings";

// Integration brand key → display name. Matches the source name used in
// FIELD_MAPPINGS (m[0]) so the "connects to" join resolves.
const BRAND_NAME: Record<string, string> = {
  slack: "Slack",
  granola: "Granola",
  salesforce: "Salesforce",
  gong: "Gong",
  outreach: "Outreach",
  dock: "Dock",
  chilipiper: "Chili Piper",
  hubspot: "HubSpot",
  zoominfo: "ZoomInfo",
  nooks: "Nooks",
  swyftai: "Swyft AI",
  xero: "Xero",
  zendesk: "Zendesk",
  webflow: "Webflow",
};

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

// What this integration feeds into the ontology, derived from the zipper.
function connectsTo(sourceName: string): string {
  const mine = FIELD_MAPPINGS.filter((m) => m[0] === sourceName);
  if (mine.length === 0) {
    return "Does not feed canonical fields directly (delivery / action channel).";
  }
  const rawObjects = uniq(mine.map((m) => m[1]));
  const canonicalObjects = uniq(mine.map((m) => m[3]));
  const sampleFields = uniq(mine.map((m) => `${m[3]}.${m[4]}`)).slice(0, 6);
  return (
    `Exposes source objects: ${rawObjects.join(", ")}. ` +
    `Zippers into ${mine.length} canonical fields across objects: ${canonicalObjects.join(", ")}. ` +
    `Example fields: ${sampleFields.join(", ")}.`
  );
}

function contentFor(spec: (typeof INTEGRATIONS)[number]): string {
  const name = BRAND_NAME[spec.brand] ?? spec.brand;
  const limits = spec.limits ? ` ${spec.limits}.` : "";
  return (
    `${name} — ${spec.role}. ` +
    `Integration to ${name}, status: ${spec.status}, auth: ${spec.auth}, ` +
    `deployment: ${spec.deployment}, data direction: ${spec.direction}.${limits} ` +
    `${connectsTo(name)}`
  );
}

async function main() {
  const units = INTEGRATIONS.map((spec) => ({
    // source_id is the display name so the search result reads cleanly
    // (e.g. "Salesforce") and stays stable across re-runs.
    sourceId: BRAND_NAME[spec.brand] ?? spec.brand,
    content: contentFor(spec),
  }));

  await deleteEmbeddingsForSources(
    "integration",
    units.map((u) => u.sourceId),
  );

  const vectors = await embedBatch(units.map((u) => u.content));
  const docs: DocEmbeddingInput[] = [];
  units.forEach((u, i) => {
    const v = vectors[i];
    if (!v) return;
    docs.push({
      source_table: "integration",
      source_id: u.sourceId,
      chunk_index: 0,
      account_id: null,
      kind: "integration",
      content: u.content,
      embedding: v,
    });
  });
  await upsertEmbeddings(docs);

  console.log(`done — ${docs.length}/${units.length} integrations embedded`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
