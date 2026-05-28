// Unit tests for the embedding layer. The OpenAI client is mocked so we cover
// the null-safe degradation paths and the index-alignment logic in embedBatch
// (empty inputs must map to null without shifting the response onto the wrong
// source rows) — both load-bearing for embed-on-ingest and the backfill.

import { afterEach, describe, expect, test, vi } from "vitest";

const createMock = vi.fn();

vi.mock("./openai", () => ({
  getOpenAIClient: () => mockClient,
}));

let mockClient: { embeddings: { create: typeof createMock } } | null = {
  embeddings: { create: createMock },
};

import { embed, embedBatch, EMBEDDING_DIMS } from "./embeddings";

afterEach(() => {
  vi.clearAllMocks();
  mockClient = { embeddings: { create: createMock } };
});

describe("embed", () => {
  test("returns null when no client is configured", async () => {
    mockClient = null;
    expect(await embed("hello")).toBeNull();
  });

  test("returns null for blank input without calling the API", async () => {
    expect(await embed("   ")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("returns the embedding vector on success", async () => {
    const vec = Array(EMBEDDING_DIMS).fill(0.01);
    createMock.mockResolvedValueOnce({ data: [{ embedding: vec }] });
    const out = await embed("Acme raised a Series C");
    expect(out).toEqual(vec);
  });
});

describe("embedBatch", () => {
  test("returns all-null when no client is configured", async () => {
    mockClient = null;
    expect(await embedBatch(["a", "b"])).toEqual([null, null]);
  });

  test("keeps index alignment when some inputs are empty", async () => {
    // Inputs 0 and 2 are real; input 1 is blank. The API is sent only the two
    // real strings, and its responses must land back on indices 0 and 2.
    createMock.mockResolvedValueOnce({
      data: [{ embedding: [1] }, { embedding: [2] }],
    });
    const out = await embedBatch(["first", "   ", "third"]);
    expect(out).toEqual([[1], null, [2]]);
    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock).toHaveBeenCalledWith({
      model: expect.any(String),
      input: ["first", "third"],
    });
  });

  test("returns all-null and skips the API when every input is empty", async () => {
    const out = await embedBatch(["", "  "]);
    expect(out).toEqual([null, null]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
