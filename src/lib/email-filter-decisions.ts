// Supabase CRUD for `email_filter_decisions`.
//
// Fail-soft: any write failure is logged + swallowed so the filter never
// blocks the classifier on an audit blip. Reads also fail-soft (return
// empty on error).
//
// Design doc: /docs/filter-design.md §6 + §8.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";
import type { FilterDecision } from "./email-filter-types";

const TABLE = "email_filter_decisions";

// Test seam: callers pass nothing in prod; tests inject a fake SupabaseClient.
export type EmailFilterDecisionsDeps = {
  supabase?: SupabaseClient;
};

function resolveClient(
  deps: EmailFilterDecisionsDeps,
): SupabaseClient | null {
  if (deps.supabase) return deps.supabase;
  try {
    return supabaseAdmin();
  } catch (e) {
    console.warn(
      `[email-filter] supabase unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// Stored row shape. id + decided_at are server-defaults; manually_overridden
// has a not-null default of false.
export interface StoredFilterDecision extends FilterDecision {
  id: string;
  decided_at: string;
}

// Write a single decision row. Returns the inserted row's id, or null on
// failure (which the caller logs but does not propagate).
export async function writeDecision(
  decision: FilterDecision,
  deps: EmailFilterDecisionsDeps = {},
): Promise<string | null> {
  const sb = resolveClient(deps);
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from(TABLE)
      .insert({
        inbound_email_id: decision.inbound_email_id,
        stage: decision.stage,
        verdict: decision.verdict,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        model: decision.model,
        prompt_version: decision.prompt_version,
        manually_overridden: decision.manually_overridden ?? false,
        override_reason: decision.override_reason ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn(
        `[email-filter] audit_write_failed: ${error.message} id=${decision.inbound_email_id} - continuing`,
      );
      return null;
    }
    return (data as { id: string }).id;
  } catch (e) {
    console.warn(
      `[email-filter] audit_write_failed: ${e instanceof Error ? e.message : String(e)} id=${decision.inbound_email_id} - continuing`,
    );
    return null;
  }
}

// Append an override audit row when an operator marks a signal as bad.
// Distinct from writeDecision so the call site reads cleanly. Both writes
// land in the same table; the audit history preserves every gate event.
export async function markOverridden(
  inbound_email_id: string,
  override_reason: string,
  prompt_version: string,
  deps: EmailFilterDecisionsDeps = {},
): Promise<string | null> {
  return writeDecision(
    {
      inbound_email_id,
      stage: 2,
      verdict: "other",
      confidence: null,
      reasoning: `manual_override: ${override_reason.slice(0, 180)}`,
      model: null,
      prompt_version,
      manually_overridden: true,
      override_reason,
    },
    deps,
  );
}

// Read all decisions for an inbound email, newest first. Fails soft: any
// error returns []. Used by the (future) audit drawer.
export async function getDecisionsFor(
  inbound_email_id: string,
  deps: EmailFilterDecisionsDeps = {},
): Promise<StoredFilterDecision[]> {
  const sb = resolveClient(deps);
  if (!sb) return [];

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .eq("inbound_email_id", inbound_email_id)
      .order("decided_at", { ascending: false });

    if (error) {
      console.warn(
        `[email-filter] audit_read_failed: ${error.message} id=${inbound_email_id}`,
      );
      return [];
    }
    return (data ?? []) as StoredFilterDecision[];
  } catch (e) {
    console.warn(
      `[email-filter] audit_read_failed: ${e instanceof Error ? e.message : String(e)} id=${inbound_email_id}`,
    );
    return [];
  }
}
