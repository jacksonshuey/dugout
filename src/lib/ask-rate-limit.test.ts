// Tests for /ask rate limiting (D1).
//
// We don't touch a real Supabase here. Instead, build a minimal fake
// SupabaseClient that implements just the chain calls
// checkAndRecordAskRequest actually uses:
//   - from("ask_request_log")
//     .select("*", { count: "exact", head: true })
//     .eq(...)       (optional, for session-scoped queries)
//     .gte(...)      (mandatory, for the time window)
//   - from("ask_request_log")
//     .insert(...)
//
// The fake's `select(...)` returns an object with `.eq()`/`.gte()` that
// resolve to a queued response. Each test seeds the queue with the
// counts it wants the SUT to see, in the order the SUT will query
// (global → daily → hourly).

import { describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASK_RATE_LIMITS,
  checkAndRecordAskRequest,
} from "./ask-rate-limit";

type CountResponse = { count: number | null; error: { message: string } | null };

function buildFakeSupabase(opts: {
  // Counts returned by SELECT...HEAD calls, in order:
  //   [0] global daily, [1] per-session daily, [2] per-session hourly
  counts: number[];
  // Set true to fail the insert (does not block allow).
  failInsert?: boolean;
}): { client: SupabaseClient; insertCalls: Record<string, unknown>[] } {
  const responses = [...opts.counts];
  const insertCalls: Record<string, unknown>[] = [];

  // Each `from(...).select(...)` chain has its own counter so we can hand
  // out the right queued count when the chain finally resolves via .gte().
  const fake = {
    from(table: string) {
      if (table !== "ask_request_log") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select(_cols: string, _options?: unknown) {
          void _cols;
          void _options;
          const chain = {
            async gte(_col: string, _val: string): Promise<CountResponse> {
              void _col;
              void _val;
              const count = responses.shift() ?? 0;
              return { count, error: null };
            },
            eq(_col: string, _val: string) {
              void _col;
              void _val;
              return {
                async gte(_col2: string, _val2: string): Promise<CountResponse> {
                  void _col2;
                  void _val2;
                  const count = responses.shift() ?? 0;
                  return { count, error: null };
                },
              };
            },
          };
          return chain;
        },
        async insert(row: Record<string, unknown>) {
          insertCalls.push(row);
          if (opts.failInsert) {
            return { error: { message: "insert failed" } };
          }
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client: fake, insertCalls };
}

describe("checkAndRecordAskRequest · allow under cap", () => {
  test("returns { allowed: true } and inserts a log row when all caps clear", async () => {
    const { client, insertCalls } = buildFakeSupabase({
      counts: [0, 0, 0], // global, daily, hourly
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_test",
        provider: "openai",
        model: "gpt-4o",
        questionChars: 42,
      },
      { supabase: client },
    );

    expect(result).toEqual({ allowed: true });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].session_id).toBe("sess_test");
    expect(insertCalls[0].provider).toBe("openai");
    expect(insertCalls[0].model).toBe("gpt-4o");
    expect(insertCalls[0].question_chars).toBe(42);
  });

  test("succeeds even when the insert itself fails (degrades open)", async () => {
    const { client } = buildFakeSupabase({
      counts: [0, 0, 0],
      failInsert: true,
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_test",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        questionChars: 10,
      },
      { supabase: client },
    );

    expect(result).toEqual({ allowed: true });
  });

  test("returns allowed: true (no insert attempted) when Supabase throws", async () => {
    const throwingClient = {
      from() {
        throw new Error("supabase down");
      },
    } as unknown as SupabaseClient;

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_x",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        questionChars: 5,
      },
      { supabase: throwingClient },
    );
    expect(result).toEqual({ allowed: true });
  });
});

describe("checkAndRecordAskRequest · cap denials", () => {
  test("denies with reason='global' + 24h retry hint at global cap", async () => {
    const { client, insertCalls } = buildFakeSupabase({
      counts: [ASK_RATE_LIMITS.dailyGlobal, 0, 0],
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_a",
        provider: "openai",
        model: "gpt-4o",
        questionChars: 1,
      },
      { supabase: client },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("global");
    // Conservative full-day hint per the implementation note.
    expect(result.retryAfterSeconds).toBe(24 * 60 * 60);
    // Hard stop → no insert (the request didn't run).
    expect(insertCalls).toHaveLength(0);
  });

  test("denies with reason='daily' + 24h retry hint at per-session daily cap", async () => {
    const { client, insertCalls } = buildFakeSupabase({
      counts: [0, ASK_RATE_LIMITS.dailyPerSession, 0],
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_b",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        questionChars: 1,
      },
      { supabase: client },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("daily");
    expect(result.retryAfterSeconds).toBe(24 * 60 * 60);
    expect(insertCalls).toHaveLength(0);
  });

  test("denies with reason='hourly' + 1h retry hint at per-session hourly cap", async () => {
    const { client, insertCalls } = buildFakeSupabase({
      counts: [0, 0, ASK_RATE_LIMITS.hourlyPerSession],
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_c",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        questionChars: 1,
      },
      { supabase: client },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("hourly");
    expect(result.retryAfterSeconds).toBe(60 * 60);
    expect(insertCalls).toHaveLength(0);
  });

  test("global cap is checked first (priority order)", async () => {
    // Seed all three at-cap; global should win.
    const { client } = buildFakeSupabase({
      counts: [
        ASK_RATE_LIMITS.dailyGlobal,
        ASK_RATE_LIMITS.dailyPerSession,
        ASK_RATE_LIMITS.hourlyPerSession,
      ],
    });

    const result = await checkAndRecordAskRequest(
      {
        sessionId: "sess_d",
        provider: "openai",
        model: "gpt-4o",
        questionChars: 1,
      },
      { supabase: client },
    );

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reason).toBe("global");
  });

  test("just-under-cap is allowed (cap-1 → allowed, cap → denied)", async () => {
    const { client: justUnder } = buildFakeSupabase({
      counts: [0, 0, ASK_RATE_LIMITS.hourlyPerSession - 1],
    });
    const okResult = await checkAndRecordAskRequest(
      {
        sessionId: "sess_e",
        provider: "openai",
        model: "gpt-4o",
        questionChars: 1,
      },
      { supabase: justUnder },
    );
    expect(okResult).toEqual({ allowed: true });

    const { client: atCap } = buildFakeSupabase({
      counts: [0, 0, ASK_RATE_LIMITS.hourlyPerSession],
    });
    const denied = await checkAndRecordAskRequest(
      {
        sessionId: "sess_e",
        provider: "openai",
        model: "gpt-4o",
        questionChars: 1,
      },
      { supabase: atCap },
    );
    expect(denied.allowed).toBe(false);
  });
});
