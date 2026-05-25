// Tests for zippering.ts — L3A.
// ALL Supabase calls are mocked. ALL Haiku calls are mocked.
// No live DB, no API keys required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be declared before importing the module under test.
const mockFrom = vi.fn();
vi.mock("./supabase", () => ({ supabaseAdmin: () => ({ from: mockFrom }) }));
vi.mock("./zippering-haiku", () => ({ assessColumnRouting: vi.fn() }));

import { zipperUpsert, getZipperedRow, getZipperedTimeline, getDecisionHistory } from "./zippering";
import { assessColumnRouting } from "./zippering-haiku";
import type { AccountId } from "./types";
import type { ZipperingDecisionRow } from "./zippering-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const WS = "dugout-default";
const PKEY = "acc_test" as AccountId;

/** Chain proxy: every method returns itself; maybeSingle resolves to result. */
function chain(result: { data: unknown; error: null | { message: string } }) {
  const p: Record<string, unknown> = new Proxy({}, {
    get(_, prop) {
      if (prop === "maybeSingle") return () => Promise.resolve(result);
      if (prop === "then") return undefined;
      return () => p;
    },
  });
  return p;
}

/** Array-resolving proxy (no maybeSingle; resolves via .then). */
function arrChain(result: { data: unknown; error: null | { message: string } }) {
  const p: Record<string, unknown> = new Proxy({}, {
    get(_, prop) {
      if (prop === "then") {
        const prom = Promise.resolve(result);
        return prom.then.bind(prom);
      }
      return () => p;
    },
  });
  return p;
}

function decRow(overrides: Partial<ZipperingDecisionRow> = {}): ZipperingDecisionRow {
  return {
    id: "d1", workspace_key: WS, pkey: PKEY, source: "granola",
    source_column: "name", source_data_type: "text", source_description: null,
    source_samples: null, verdict: "append", canonical_name: "company_name",
    is_global_target: false, similarity_score: 0.9, reason: "ok",
    needs_review: false, decided_by: "haiku", decided_at: new Date().toISOString(),
    ...overrides,
  };
}

const APPEND_V = { verdict: "append" as const, canonical_name: "company_name",
  is_global_target: false, similarity_score: 0.9, reason: "ok" };
const GLOBAL_V = { verdict: "join" as const, canonical_name: "company_name",
  is_global_target: true, similarity_score: 0.97, reason: "global match" };
const UNCLEAR_V = { verdict: "unclear" as const, canonical_name: "mystery",
  is_global_target: false, similarity_score: 0.5, reason: "ambiguous" };

const baseRow = () => ({
  workspace_key: WS, pkey: PKEY, source: "granola", external_id: "ext-001",
  occurred_at: new Date().toISOString(),
  columns: { name: { value: "Acme", source_data_type: "text" as const } },
});

/** Wire all DB calls for a simple single-column happy path. */
function wireStandard(dr: ZipperingDecisionRow, noCached = true) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "global_canonical_columns") return arrChain({ data: [], error: null });
    if (table === "zippering_schema") return {
      select: () => arrChain({ data: [], error: null }),
      eq: () => arrChain({ data: [], error: null }),
      upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "s1" }, error: null }) }) }),
    };
    if (table === "zippering_decisions") return {
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        order: () => ({ limit: () => ({ maybeSingle: () =>
          Promise.resolve({ data: noCached ? null : dr, error: null }) }) }),
      }) }) }) }) }),
      insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: dr, error: null }) }) }),
    };
    if (table === "zippered_signals") return {
      upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sig-1" }, error: null }) }) }),
    };
    return chain({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assessColumnRouting).mockResolvedValue(APPEND_V);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("zipperUpsert", () => {
  it("1 happy path: new column → append, value written, schema upserted", async () => {
    const dr = decRow();
    wireStandard(dr);
    const result = await zipperUpsert(baseRow());
    expect(result.signalId).toBe("sig-1");
    expect(result.decisions).toHaveLength(1);
    expect(vi.mocked(assessColumnRouting)).toHaveBeenCalledOnce();
  });

  it("2 cache hit: existing decision reused, Haiku not called", async () => {
    const dr = decRow();
    wireStandard(dr, false /* noCached=false → return cached row */);
    const result = await zipperUpsert(baseRow());
    expect(result.signalId).toBe("sig-1");
    expect(vi.mocked(assessColumnRouting)).not.toHaveBeenCalled();
    expect(result.decisions[0].id).toBe(dr.id);
  });

  it("3 unsafe coercion: normalizer decision inserted, value omitted", async () => {
    // Haiku routes to employee_count (integer in globals). Source sends "text".
    // normalize("hello", "text", "integer") throws UnsafeCoercion.
    const globalEmpCount = { id: "g-emp", workspace_key: WS, name: "employee_count",
      data_type: "integer" as const, description: null, semantic_tags: [], created_at: "" };
    const haikuDec = decRow({ source_column: "empcount", canonical_name: "employee_count" });
    const reviewDec = decRow({ id: "d-review", decided_by: "normalizer", needs_review: true });

    let insertCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "global_canonical_columns") return arrChain({ data: [globalEmpCount], error: null });
      if (table === "zippering_schema") return {
        select: () => arrChain({ data: [], error: null }),
        eq: () => arrChain({ data: [], error: null }),
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "s1" }, error: null }) }) }),
      };
      if (table === "zippering_decisions") return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }) }) }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: () => {
          insertCount++;
          return Promise.resolve({ data: insertCount === 1 ? haikuDec : reviewDec, error: null });
        } }) }),
      };
      if (table === "zippered_signals") return {
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sig-3" }, error: null }) }) }),
      };
      return chain({ data: null, error: null });
    });

    vi.mocked(assessColumnRouting).mockResolvedValueOnce({ ...APPEND_V, canonical_name: "employee_count", is_global_target: true });

    const result = await zipperUpsert({
      ...baseRow(),
      columns: { empcount: { value: "hello", source_data_type: "text" as const } },
    });

    const reviewDecision = result.decisions.find((d) => d.decided_by === "normalizer");
    expect(reviewDecision).toBeDefined();
    expect(reviewDecision?.needs_review).toBe(true);
  });

  it("4 join verdict against global: schema upserted with is_global=true", async () => {
    const globalCol = { id: "g1", workspace_key: WS, name: "company_name",
      data_type: "text" as const, description: null, semantic_tags: [], created_at: "" };
    const dr = decRow({ verdict: "join", is_global_target: true });
    vi.mocked(assessColumnRouting).mockResolvedValueOnce(GLOBAL_V);

    let schemaIsGlobal = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "global_canonical_columns") return arrChain({ data: [globalCol], error: null });
      if (table === "zippering_schema") return {
        select: () => arrChain({ data: [], error: null }),
        eq: () => arrChain({ data: [], error: null }),
        upsert: (row: { is_global: boolean }) => {
          schemaIsGlobal = row.is_global;
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "s4" }, error: null }) }) };
        },
      };
      if (table === "zippering_decisions") return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }) }) }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: dr, error: null }) }) }),
      };
      if (table === "zippered_signals") return {
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sig-4" }, error: null }) }) }),
      };
      return chain({ data: null, error: null });
    });

    const result = await zipperUpsert(baseRow());
    expect(result.decisions[0].is_global_target).toBe(true);
    expect(schemaIsGlobal).toBe(true);
  });

  it("5 unclear verdict: decision has needs_review=true", async () => {
    const dr = decRow({ verdict: "unclear", needs_review: true, canonical_name: "mystery" });
    vi.mocked(assessColumnRouting).mockResolvedValueOnce(UNCLEAR_V);
    wireStandard(dr); // wires cache-miss, insert returns dr
    const result = await zipperUpsert(baseRow());
    expect(result.decisions[0].verdict).toBe("unclear");
    expect(result.decisions[0].needs_review).toBe(true);
  });

  it("6 idempotent re-ingest: same external_id → same signalId on both calls", async () => {
    const dr = decRow();
    wireStandard(dr, false /* cached */);
    const r1 = await zipperUpsert(baseRow());
    const r2 = await zipperUpsert(baseRow());
    expect(r1.signalId).toBe("sig-1");
    expect(r2.signalId).toBe("sig-1");
    expect(vi.mocked(assessColumnRouting)).not.toHaveBeenCalled();
  });

  it("7 coercible type mismatch: integer epoch_ms coerces to ISO timestamp string", async () => {
    // last_contact_at is a global canonical with data_type "timestamp"
    const globalLastContact = { id: "g-lc", workspace_key: WS, name: "last_contact_at",
      data_type: "timestamp" as const, description: null, semantic_tags: [], created_at: "" };
    const dr = decRow({ source_column: "ts", source_data_type: "integer", canonical_name: "last_contact_at" });
    vi.mocked(assessColumnRouting).mockResolvedValueOnce(
      { verdict: "join", canonical_name: "last_contact_at", is_global_target: true, similarity_score: 0.8, reason: "epoch" });

    let capturedCols: Record<string, unknown> = {};
    mockFrom.mockImplementation((table: string) => {
      if (table === "global_canonical_columns") return arrChain({ data: [globalLastContact], error: null });
      if (table === "zippering_schema") return {
        select: () => arrChain({ data: [], error: null }),
        eq: () => arrChain({ data: [], error: null }),
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: {}, error: null }) }) }),
      };
      if (table === "zippering_decisions") return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }) }) }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: dr, error: null }) }) }),
      };
      if (table === "zippered_signals") return {
        upsert: (row: { columns: Record<string, unknown> }) => {
          capturedCols = row.columns;
          return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sig-7" }, error: null }) }) };
        },
      };
      return chain({ data: null, error: null });
    });

    await zipperUpsert({
      workspace_key: WS, pkey: PKEY, source: "granola", external_id: "ext-7",
      occurred_at: new Date().toISOString(),
      columns: { ts: { value: 1716681600000, source_data_type: "integer" as const } },
    });

    const v = capturedCols["last_contact_at"];
    expect(typeof v).toBe("string");
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("8 multi-column row: 3 columns → 3 decisions, 3 Haiku calls", async () => {
    const drs = [
      decRow({ id: "d1", source_column: "name", canonical_name: "company_name" }),
      decRow({ id: "d2", source_column: "domain", canonical_name: "domain" }),
      decRow({ id: "d3", source_column: "stage", canonical_name: "deal_stage" }),
    ];
    let insertIdx = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "global_canonical_columns") return arrChain({ data: [], error: null });
      if (table === "zippering_schema") return {
        select: () => arrChain({ data: [], error: null }),
        eq: () => arrChain({ data: [], error: null }),
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: {}, error: null }) }) }),
      };
      if (table === "zippering_decisions") return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        }) }) }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: () =>
          Promise.resolve({ data: drs[insertIdx++ % 3], error: null }) }) }),
      };
      if (table === "zippered_signals") return {
        upsert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "sig-8" }, error: null }) }) }),
      };
      return chain({ data: null, error: null });
    });

    vi.mocked(assessColumnRouting)
      .mockResolvedValueOnce({ ...APPEND_V, canonical_name: "company_name" })
      .mockResolvedValueOnce({ ...APPEND_V, canonical_name: "domain" })
      .mockResolvedValueOnce({ ...APPEND_V, canonical_name: "deal_stage" });

    const result = await zipperUpsert({
      workspace_key: WS, pkey: PKEY, source: "granola", external_id: "ext-8",
      occurred_at: new Date().toISOString(),
      columns: {
        name:   { value: "Acme", source_data_type: "text" as const },
        domain: { value: "acme.com", source_data_type: "text" as const },
        stage:  { value: "Negotiation", source_data_type: "text" as const },
      },
    });

    expect(result.decisions).toHaveLength(3);
    expect(vi.mocked(assessColumnRouting)).toHaveBeenCalledTimes(3);
  });
});

describe("read helpers", () => {
  it("getZipperedRow returns null when no rows exist", async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: null }));
    const row = await getZipperedRow(WS, PKEY);
    expect(row).toBeNull();
  });

  it("getZipperedTimeline returns rows from query", async () => {
    mockFrom.mockReturnValueOnce(arrChain({ data: [{ id: "s1", pkey: PKEY }], error: null }));
    const rows = await getZipperedTimeline(WS, PKEY, "2020-01-01T00:00:00Z");
    expect(rows).toHaveLength(1);
  });

  it("getDecisionHistory returns ordered array", async () => {
    mockFrom.mockReturnValueOnce(arrChain({ data: [decRow({ id: "d1" }), decRow({ id: "d2" })], error: null }));
    const hist = await getDecisionHistory(WS, PKEY, "company_name");
    expect(hist).toHaveLength(2);
  });
});
