// Zippering ingest engine — L3A.
//
// Hot path:  zipperUpsert(row)  →  writes zippered_signals + zippering_decisions
// Read path: getZipperedRow / getZipperedTimeline / getDecisionHistory
//
// Design: docs/zippering-plan.md §5 + swarm-spec §5 L3A

import type { AccountId } from "./types";
import { supabaseAdmin } from "./supabase";
import { assessColumnRouting } from "./zippering-haiku";
import { normalize, UnsafeCoercion } from "./zippering-coercions";
import type {
  GlobalCanonicalColumn,
  IngestRow,
  ZipperingDataType,
  ZipperingDecisionRow,
  ZipperingSchemaRow,
  ZipperedSignalRow,
} from "./zippering-types";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Ingest one integration row into the zippering pipeline.
 *
 * Algorithm (per spec §5 L3A):
 *  1. Default workspace_key to 'dugout-default'
 *  2. Load global_canonical_columns + zippering_schema in parallel
 *  3. For each column: find or create a routing decision (Haiku if new)
 *  4. Normalize value; on UnsafeCoercion → flag for review, skip value
 *  5. Upsert zippered_signals keyed on (source, external_id)
 *  6. Return { signalId, decisions }
 */
export async function zipperUpsert(row: IngestRow): Promise<{
  signalId: string;
  decisions: ZipperingDecisionRow[];
}> {
  const workspace_key = row.workspace_key ?? "dugout-default";
  const db = supabaseAdmin();

  // Step 2: parallel load
  const [globalsResult, schemaResult] = await Promise.all([
    db
      .from("global_canonical_columns")
      .select("*")
      .eq("workspace_key", workspace_key),
    db
      .from("zippering_schema")
      .select("*")
      .eq("workspace_key", workspace_key)
      .eq("pkey", row.pkey as string),
  ]);

  if (globalsResult.error) {
    throw new Error(`Failed to load global_canonical_columns: ${globalsResult.error.message}`);
  }
  if (schemaResult.error) {
    throw new Error(`Failed to load zippering_schema: ${schemaResult.error.message}`);
  }

  const globals: GlobalCanonicalColumn[] = (globalsResult.data as GlobalCanonicalColumn[]) ?? [];
  const existingSchema: ZipperingSchemaRow[] = (schemaResult.data as ZipperingSchemaRow[]) ?? [];

  const allDecisions: ZipperingDecisionRow[] = [];
  const canonicalColumns: Record<string, unknown> = {};

  // Step 3 + 4: per-column routing
  for (const [sourceCol, ingestVal] of Object.entries(row.columns)) {
    // 3a. Find latest cached decision
    const cachedResult = await db
      .from("zippering_decisions")
      .select("*")
      .eq("workspace_key", workspace_key)
      .eq("pkey", row.pkey as string)
      .eq("source", row.source)
      .eq("source_column", sourceCol)
      .order("decided_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedResult.error) {
      throw new Error(`Failed to query zippering_decisions: ${cachedResult.error.message}`);
    }

    let decision: ZipperingDecisionRow;

    if (cachedResult.data) {
      // Cache hit — reuse existing routing
      decision = cachedResult.data as ZipperingDecisionRow;
    } else {
      // 3b. No cached decision — call Haiku
      const samples = ingestVal.value != null ? [ingestVal.value] : [];
      const verdict = await assessColumnRouting({
        pkey: row.pkey as string,
        source: row.source,
        source_column: sourceCol,
        source_data_type: ingestVal.source_data_type,
        source_description: ingestVal.source_description,
        source_samples: samples,
        candidates_global: globals,
        candidates_pkey: existingSchema,
      });

      // Insert new decision row
      const decisionInsert = {
        workspace_key,
        pkey: row.pkey as string,
        source: row.source,
        source_column: sourceCol,
        source_data_type: ingestVal.source_data_type,
        source_description: ingestVal.source_description ?? null,
        source_samples: samples.length > 0 ? samples : null,
        verdict: verdict.verdict,
        canonical_name: verdict.canonical_name,
        is_global_target: verdict.is_global_target,
        similarity_score: verdict.similarity_score,
        reason: verdict.reason,
        needs_review: verdict.verdict === "unclear",
        decided_by: "haiku",
      };

      const insertResult = await db
        .from("zippering_decisions")
        .insert(decisionInsert)
        .select("*")
        .maybeSingle();

      if (insertResult.error) {
        throw new Error(`Failed to insert zippering_decisions: ${insertResult.error.message}`);
      }

      decision = insertResult.data as ZipperingDecisionRow;

      // 3c. Upsert zippering_schema for append / unclear / join-global
      if (verdict.verdict === "append" || verdict.verdict === "unclear" || verdict.verdict === "join") {
        const schemaRow = {
          workspace_key,
          pkey: row.pkey as string,
          canonical_name: verdict.canonical_name,
          data_type: verdict.is_global_target
            ? (globals.find((g) => g.name === verdict.canonical_name)?.data_type ?? ingestVal.source_data_type)
            : ingestVal.source_data_type,
          description: ingestVal.source_description ?? null,
          is_global: verdict.is_global_target,
          source_origin: row.source,
        };

        const schemaUpsertResult = await db
          .from("zippering_schema")
          .upsert(schemaRow, { onConflict: "workspace_key,pkey,canonical_name" })
          .select("*")
          .maybeSingle();

        if (schemaUpsertResult.error) {
          throw new Error(`Failed to upsert zippering_schema: ${schemaUpsertResult.error.message}`);
        }
      }
    }

    allDecisions.push(decision);

    // Step 4: normalize value — look up canonical data_type from schema or globals
    const schemaRow = existingSchema.find((s) => s.canonical_name === decision.canonical_name);
    const globalRow = globals.find((g) => g.name === decision.canonical_name);
    const targetDataType: ZipperingDataType =
      (schemaRow?.data_type ?? globalRow?.data_type ?? ingestVal.source_data_type) as ZipperingDataType;
    let normalizedValue: unknown;
    let coercionFailed = false;

    try {
      normalizedValue = normalize(ingestVal.value, ingestVal.source_data_type, targetDataType);
    } catch (err) {
      if (err instanceof UnsafeCoercion) {
        coercionFailed = true;
        // Insert needs_review decision row
        const reviewDecision = {
          workspace_key,
          pkey: row.pkey as string,
          source: row.source,
          source_column: sourceCol,
          source_data_type: ingestVal.source_data_type,
          source_description: ingestVal.source_description ?? null,
          source_samples: ingestVal.value != null ? [ingestVal.value] : null,
          verdict: decision.verdict,
          canonical_name: decision.canonical_name,
          is_global_target: decision.is_global_target,
          similarity_score: decision.similarity_score ?? null,
          reason: err.message,
          needs_review: true,
          decided_by: "normalizer",
        };

        const reviewResult = await db
          .from("zippering_decisions")
          .insert(reviewDecision)
          .select("*")
          .maybeSingle();

        if (reviewResult.error) {
          throw new Error(`Failed to insert normalizer decision: ${reviewResult.error.message}`);
        }

        allDecisions.push(reviewResult.data as ZipperingDecisionRow);
      } else {
        throw err;
      }
    }

    if (!coercionFailed) {
      canonicalColumns[decision.canonical_name] = normalizedValue;
    }
  }

  // Step 5: upsert zippered_signals
  const signalRow = {
    workspace_key,
    pkey: row.pkey as string,
    source: row.source,
    external_id: row.external_id ?? null,
    occurred_at: row.occurred_at,
    columns: canonicalColumns,
  };

  const signalResult = await db
    .from("zippered_signals")
    .upsert(signalRow, { onConflict: "source,external_id" })
    .select("id")
    .maybeSingle();

  if (signalResult.error) {
    throw new Error(`Failed to upsert zippered_signals: ${signalResult.error.message}`);
  }

  const signalId = (signalResult.data as { id: string } | null)?.id ?? "";

  return { signalId, decisions: allDecisions };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Get the most recent zippered signal row for a (workspace, pkey) pair.
 * Returns null if no rows exist.
 */
export async function getZipperedRow(
  workspace_key: string,
  pkey: AccountId,
): Promise<ZipperedSignalRow | null> {
  const db = supabaseAdmin();

  const result = await db
    .from("zippered_signals")
    .select("*")
    .eq("workspace_key", workspace_key)
    .eq("pkey", pkey as string)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new Error(`getZipperedRow failed: ${result.error.message}`);
  }

  return (result.data as ZipperedSignalRow | null) ?? null;
}

/**
 * Get all zippered signal rows for (workspace, pkey) since a given ISO timestamp.
 * Ordered occurred_at DESC.
 */
export async function getZipperedTimeline(
  workspace_key: string,
  pkey: AccountId,
  sinceIso: string,
): Promise<ZipperedSignalRow[]> {
  const db = supabaseAdmin();

  const result = await db
    .from("zippered_signals")
    .select("*")
    .eq("workspace_key", workspace_key)
    .eq("pkey", pkey as string)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false });

  if (result.error) {
    throw new Error(`getZipperedTimeline failed: ${result.error.message}`);
  }

  return (result.data as ZipperedSignalRow[]) ?? [];
}

/**
 * Get full decision history for a (workspace, pkey, canonical_name) slice.
 * Ordered decided_at DESC — latest entry is the active routing.
 */
export async function getDecisionHistory(
  workspace_key: string,
  pkey: AccountId,
  canonical_name: string,
): Promise<ZipperingDecisionRow[]> {
  const db = supabaseAdmin();

  const result = await db
    .from("zippering_decisions")
    .select("*")
    .eq("workspace_key", workspace_key)
    .eq("pkey", pkey as string)
    .eq("canonical_name", canonical_name)
    .order("decided_at", { ascending: false });

  if (result.error) {
    throw new Error(`getDecisionHistory failed: ${result.error.message}`);
  }

  return (result.data as ZipperingDecisionRow[]) ?? [];
}
