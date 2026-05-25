// Supabase CRUD for the market-intel ranker cache.
//
// Fail-soft: any Supabase error returns null on reads (treated as miss by
// the caller) and is swallowed on writes (the in-memory result is still
// returned to the user). This keeps /market-intel renderable even when
// Supabase is unreachable.
//
// Design doc: /docs/ranker-design.md §6.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";
import type {
  CacheEntry,
  CacheKey,
  RankerResult,
} from "./ranker-types";
import { workspaceKey } from "./workspace";

const TABLE = "ranker_cache";
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Key composition (pure, exported for tests) ─────────────────────────

// Format a Date into a UTC hour bucket string: "YYYY-MM-DD-HH". Pure;
// truncates minutes/seconds. Always uses UTC so the cache key is
// reproducible across server regions.
export function formatHourBucketUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${da}-${hh}`;
}

export function buildCacheKey(workspaceName: string, now: Date): CacheKey {
  return {
    workspace_key: workspaceKey(workspaceName),
    date_bucket: formatHourBucketUTC(now),
  };
}

// ─── Supabase CRUD (fail-soft) ───────────────────────────────────────────

// Test seam: callers pass nothing in prod (we use the singleton);
// tests inject a fake SupabaseClient.
export type RankerCacheDeps = {
  supabase?: SupabaseClient;
};

function resolveClient(deps: RankerCacheDeps): SupabaseClient | null {
  if (deps.supabase) return deps.supabase;
  try {
    return supabaseAdmin();
  } catch (e) {
    console.warn(
      `[ranker] supabase unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// Return the cached RankerResult for this key, or null when no usable row
// exists. "Usable" means: row present, age ≤ CACHE_TTL_MS, and the stored
// JSON parses as a RankerResult-shaped object.
//
// All failure modes return null (treat as miss). The caller logs and
// recomputes; we don't surface cache errors to the UI.
export async function getCachedRanking(
  key: CacheKey,
  deps: RankerCacheDeps = {},
): Promise<RankerResult | null> {
  const sb = resolveClient(deps);
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from(TABLE)
      .select("workspace_key, date_bucket, result_json, created_at")
      .eq("workspace_key", key.workspace_key)
      .eq("date_bucket", key.date_bucket)
      .maybeSingle();

    if (error) {
      console.warn(`[ranker] cache_read_failed: ${error.message}`);
      return null;
    }
    if (!data) return null;

    const row = data as CacheEntry;
    const createdAtMs = Date.parse(row.created_at);
    if (!Number.isFinite(createdAtMs)) return null;
    const ageMs = Date.now() - createdAtMs;
    if (ageMs > CACHE_TTL_MS) {
      const ageMin = Math.round(ageMs / 60_000);
      console.warn(`[ranker] cache_stale age=${ageMin}m - recompute`);
      return null;
    }

    // Light shape validation. We don't validate every nested field - the
    // writer (us) controls the shape, and a malformed row should be rare.
    const result = row.result_json;
    if (
      !result ||
      typeof result !== "object" ||
      !Array.isArray((result as RankerResult).items)
    ) {
      console.warn(`[ranker] cache_read_failed: malformed result_json`);
      return null;
    }
    return result;
  } catch (e) {
    console.warn(
      `[ranker] cache_read_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// Write (upsert) the given RankerResult under the given key. Best-effort;
// errors are logged and swallowed so the calling page still renders.
export async function writeCachedRanking(
  key: CacheKey,
  result: RankerResult,
  deps: RankerCacheDeps = {},
): Promise<void> {
  const sb = resolveClient(deps);
  if (!sb) return;

  try {
    const { error } = await sb.from(TABLE).upsert(
      {
        workspace_key: key.workspace_key,
        date_bucket: key.date_bucket,
        result_json: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: "workspace_key,date_bucket" },
    );
    if (error) {
      console.warn(`[ranker] cache_write_failed: ${error.message}`);
    }
  } catch (e) {
    console.warn(
      `[ranker] cache_write_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
