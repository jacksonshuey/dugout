// Tests for src/lib/accounts.ts — DB-backed account helpers.
//
// Pattern: stub supabaseAdmin() via vi.spyOn so the helpers run their
// real query-builder code against an in-memory fake. Same shape as
// email-filter.test.ts §"sender allowlist > allowlist match" block.

import { afterEach, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { insertAccount, listTrackableAccounts } from "./accounts";

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: build a fake Supabase chain that captures inserts + returns
// a fixed row on .single(), or returns a list on .order(). Each test
// passes whatever shape it needs.
function mkFakeSb(handlers: {
  insertReturn?: Record<string, unknown>;
  insertError?: { message: string };
  selectRows?: Array<Record<string, unknown>>;
  selectError?: { message: string };
  capture?: (op: string, args: unknown) => void;
}): SupabaseClient {
  return {
    from(_table: string) {
      void _table;
      return {
        insert(row: Record<string, unknown>) {
          handlers.capture?.("insert", row);
          return {
            select() {
              return {
                async single() {
                  if (handlers.insertError) {
                    return { data: null, error: handlers.insertError };
                  }
                  return {
                    data: handlers.insertReturn ?? {
                      id: "uuid-1",
                      ...row,
                      is_demo_scenario: false,
                      created_at: "2026-05-24T00:00:00.000Z",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        select(_cols: string) {
          void _cols;
          return {
            eq(_col: string, _val: unknown) {
              void _col;
              void _val;
              return {
                async order(_orderCol: string, _opts: unknown) {
                  void _orderCol;
                  void _opts;
                  if (handlers.selectError) {
                    return { data: null, error: handlers.selectError };
                  }
                  return { data: handlers.selectRows ?? [], error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

// ─── insertAccount ──────────────────────────────────────────────────────

describe("insertAccount", () => {
  test("rejects empty name before touching DB", async () => {
    await expect(
      insertAccount({ name: "", website: "stripe.com" }),
    ).rejects.toThrow(/name required/i);
  });

  test("rejects empty website before touching DB", async () => {
    await expect(
      insertAccount({ name: "Stripe", website: "" }),
    ).rejects.toThrow(/website required/i);
  });

  test("inserts trimmed values + returns the Account shape", async () => {
    const captured: Array<{ op: string; args: unknown }> = [];
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({
        insertReturn: {
          id: "uuid-stripe",
          name: "Stripe",
          website: "stripe.com",
          domain: "stripe.com",
          industry: "SaaS",
          segment: "Enterprise",
          ticker: null,
          trackable: true,
          paths: null,
          is_demo_scenario: false,
          created_at: "2026-05-24T00:00:00.000Z",
        },
        capture: (op, args) => captured.push({ op, args }),
      }),
    );

    const account = await insertAccount({
      name: "  Stripe  ",
      website: "  stripe.com ",
      industry: "SaaS",
      segment: "Enterprise",
    });

    expect(account.id).toBe("uuid-stripe");
    expect(account.name).toBe("Stripe");
    expect(account.website).toBe("stripe.com");
    expect(account.trackable).toBe(true);

    const inserted = captured.find((c) => c.op === "insert")?.args as Record<
      string,
      unknown
    >;
    expect(inserted.name).toBe("Stripe");
    expect(inserted.website).toBe("stripe.com");
    // paths empty/undefined → stored as null (not [])
    expect(inserted.paths).toBe(null);
    expect(inserted.trackable).toBe(true);
  });

  test("persists paths when supplied", async () => {
    const captured: Array<{ op: string; args: unknown }> = [];
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({
        insertReturn: {
          id: "uuid-1",
          name: "X",
          website: "x.com",
          domain: null,
          industry: null,
          segment: null,
          ticker: null,
          trackable: true,
          paths: ["/", "/about"],
          is_demo_scenario: false,
          created_at: "2026-05-24T00:00:00.000Z",
        },
        capture: (op, args) => captured.push({ op, args }),
      }),
    );

    const account = await insertAccount({
      name: "X",
      website: "x.com",
      paths: ["/", "/about"],
    });

    expect(account.paths).toEqual(["/", "/about"]);
    const inserted = captured.find((c) => c.op === "insert")?.args as Record<
      string,
      unknown
    >;
    expect(inserted.paths).toEqual(["/", "/about"]);
  });

  test("throws with the DB error message on insert failure", async () => {
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({ insertError: { message: "duplicate key" } }),
    );
    await expect(
      insertAccount({ name: "Stripe", website: "stripe.com" }),
    ).rejects.toThrow(/duplicate key/);
  });
});

// ─── listTrackableAccounts ──────────────────────────────────────────────

describe("listTrackableAccounts", () => {
  test("returns empty array when no rows", async () => {
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({ selectRows: [] }),
    );
    const rows = await listTrackableAccounts();
    expect(rows).toEqual([]);
  });

  test("maps DB rows to Account shape", async () => {
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({
        selectRows: [
          {
            id: "uuid-1",
            name: "Stripe",
            website: "stripe.com",
            domain: "stripe.com",
            industry: "SaaS",
            segment: "Enterprise",
            ticker: null,
            trackable: true,
            paths: ["/", "/blog"],
            is_demo_scenario: false,
            created_at: "2026-05-24T00:00:00.000Z",
          },
        ],
      }),
    );
    const rows = await listTrackableAccounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Stripe");
    expect(rows[0]!.paths).toEqual(["/", "/blog"]);
    expect(rows[0]!.trackable).toBe(true);
  });

  test("throws on DB error", async () => {
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      mkFakeSb({ selectError: { message: "permission denied" } }),
    );
    await expect(listTrackableAccounts()).rejects.toThrow(/permission denied/);
  });
});
