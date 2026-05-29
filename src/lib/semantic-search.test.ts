// Unit tests for the semantic-search lib. embed() and matchDocuments() are
// mocked so we cover the null-safe paths and the hit mapping (incl. the
// citation triple {id, sourceTool, summary}) without OpenAI or Supabase.

import { afterEach, describe, expect, test, vi } from "vitest";

const embedMock = vi.fn();
const matchMock = vi.fn();

vi.mock("./embeddings", () => ({ embed: (...a: unknown[]) => embedMock(...a) }));
vi.mock("./doc-embeddings", () => ({
  matchDocuments: (...a: unknown[]) => matchMock(...a),
}));

import { semanticSearch } from "./semantic-search";

afterEach(() => vi.clearAllMocks());

describe("semanticSearch", () => {
  test("blank query returns [] without embedding", async () => {
    expect(await semanticSearch("   ")).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  test("no embedding (no key) returns []", async () => {
    embedMock.mockResolvedValueOnce(null);
    expect(await semanticSearch("pricing pressure")).toEqual([]);
    expect(matchMock).not.toHaveBeenCalled();
  });

  test("maps matched docs to citable hits", async () => {
    embedMock.mockResolvedValueOnce([0.1, 0.2]);
    matchMock.mockResolvedValueOnce([
      {
        id: "doc1",
        sourceTable: "external_signals",
        sourceId: "sig_1",
        chunkIndex: 0,
        accountId: "acc_moderna",
        kind: "regulatory_action",
        content: "Long matched chunk about GenAI risk factors…",
        similarity: 0.88,
      },
    ]);

    const hits = await semanticSearch("genai risk", {
      accountId: "acc_moderna",
      limit: 5,
      sourceTables: ["external_signals"],
    });

    expect(matchMock).toHaveBeenCalledWith([0.1, 0.2], {
      matchCount: 5,
      accountId: "acc_moderna",
      sourceTables: ["external_signals"],
    });
    expect(hits).toHaveLength(1);
    // Citation triple present for the /ask agent's collectCitations().
    expect(hits[0].id).toBe("doc1");
    expect(hits[0].sourceTool).toBe("semantic_search");
    expect(hits[0].summary.length).toBeGreaterThan(0);
    expect(hits[0].sourceId).toBe("sig_1");
    expect(hits[0].similarity).toBe(0.88);
  });
});
