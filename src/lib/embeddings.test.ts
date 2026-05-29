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

import {
  chunkText,
  embed,
  embedBatch,
  stripHtml,
  EMBEDDING_DIMS,
} from "./embeddings";

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

describe("stripHtml", () => {
  test("strips tags, styles, and entities to readable text", () => {
    const html =
      '<style>.x{color:red}</style><table><td style="padding:0">Acme raised&nbsp;$200M&amp;more</td></table>';
    const out = stripHtml(html);
    expect(out).not.toMatch(/[<>]/);
    expect(out).not.toContain("padding");
    expect(out).toContain("Acme raised $200M&more");
  });

  test("leaves plain text / markdown essentially intact", () => {
    expect(stripHtml("Lilly cuts price.\n\nGilead renews WHO deal.")).toBe(
      "Lilly cuts price.\n\nGilead renews WHO deal.",
    );
  });
});

describe("chunkText", () => {
  test("blank input returns no chunks", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  test("short input returns a single chunk", () => {
    const out = chunkText("a short signal summary");
    expect(out).toEqual(["a short signal summary"]);
  });

  test("long input splits into multiple chunks that cover the whole text", () => {
    const para = "Sentence about the deal. ".repeat(400); // ~10k chars
    const out = chunkText(para, { size: 3000, overlap: 200 });
    expect(out.length).toBeGreaterThan(1);
    // No chunk exceeds the window (allowing the boundary search slack).
    for (const c of out) expect(c.length).toBeLessThanOrEqual(3000);
    // Coverage: the start of the doc is in the first chunk, the end in the last.
    expect(para.startsWith(out[0].slice(0, 20))).toBe(true);
    expect(para.trimEnd().endsWith(out[out.length - 1].slice(-20))).toBe(true);
  });

  test("consecutive chunks overlap so a boundary fact stays retrievable", () => {
    const text = "X".repeat(2000) + ". " + "Y".repeat(2000);
    const out = chunkText(text, { size: 2500, overlap: 300 });
    expect(out.length).toBeGreaterThan(1);
    const tailOfFirst = out[0].slice(-50);
    expect(out[1].includes(tailOfFirst.trim().slice(0, 10))).toBe(true);
  });
});
