import { supabaseAdmin } from "./supabase";

// Persistence for the batch-of-3 news orchestrator. See
// supabase/migrations/20260528_news_batches.sql for the schema and the
// pipeline overview. The orchestration logic + agents live in
// news-batch-pipeline.ts; this file is the DB boundary only.

export const BATCH_SIZE = 3;

// A single inbound email, trimmed to the columns the agent chain needs.
export interface BatchEmail {
  id: string;
  subject: string | null;
  text_body: string | null;
  publisher_canonical_name: string | null;
  from_domain: string;
}

// One row of the display dataset (and audit record) the chain produces.
export interface NewsBatchRecord {
  email_ids: string[];
  email_subjects: string[];
  news_sources: string[];
  batch_summary: string;
  is_news: boolean;
  gate_reasoning: string | null;
  category: string | null;
  signal_id: string | null;
  status: "appended" | "rejected" | "error";
}

// Claim the oldest `size` un-batched emails as a unit. Marks them
// `batched_at = now()` so concurrent triggers don't re-batch the same rows,
// and returns the claimed emails — or null when fewer than `size` are
// available (or a race stole some, in which case anything we claimed is
// released so a later trigger can batch it cleanly).
export async function claimNextBatch(
  size = BATCH_SIZE,
): Promise<BatchEmail[] | null> {
  const sb = supabaseAdmin();

  const { data: candidates, error: selErr } = await sb
    .from("inbound_emails")
    .select("id")
    .is("batched_at", null)
    .order("received_at", { ascending: true })
    .limit(size);
  if (selErr) throw new Error(`claimNextBatch select failed: ${selErr.message}`);
  if (!candidates || candidates.length < size) return null;

  const ids = candidates.map((r) => r.id as string);
  const { data: claimed, error: updErr } = await sb
    .from("inbound_emails")
    .update({ batched_at: new Date().toISOString() })
    .in("id", ids)
    .is("batched_at", null)
    .select("id, subject, text_body, publisher_canonical_name, from_domain");
  if (updErr) throw new Error(`claimNextBatch claim failed: ${updErr.message}`);

  const rows = (claimed ?? []) as BatchEmail[];
  if (rows.length < size) {
    // Lost a race for one or more rows. Release what we did claim so it isn't
    // orphaned (marked batched but never in a batch), then bail.
    if (rows.length > 0) {
      await sb
        .from("inbound_emails")
        .update({ batched_at: null })
        .in(
          "id",
          rows.map((r) => r.id),
        );
    }
    return null;
  }
  return rows;
}

export async function insertBatchRecord(rec: NewsBatchRecord): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("news_batches").insert(rec);
  if (error) throw new Error(`insertBatchRecord failed: ${error.message}`);
}
