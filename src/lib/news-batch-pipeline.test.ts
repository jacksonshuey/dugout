// Unit tests for the batch-of-3 orchestration logic. The agents (LLM calls)
// and DB (Supabase) are injected/mocked — these tests cover the chain control
// flow: handoffs, the gate's reject short-circuit, the append path, the
// per-batch error fallback, and the claim → process → record loop.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { BatchEmail } from "./news-batches";

// runPendingBatches reaches into the DB layer; mock it so we can drive the
// claim loop deterministically without Supabase.
vi.mock("./news-batches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./news-batches")>();
  return {
    ...actual,
    claimNextBatch: vi.fn(),
    insertBatchRecord: vi.fn(),
  };
});

import {
  processBatch,
  runPendingBatches,
  type BatchAgents,
  type BatchSummary,
} from "./news-batch-pipeline";
import { claimNextBatch, insertBatchRecord } from "./news-batches";

function emails(): BatchEmail[] {
  return [
    {
      id: "e1",
      subject: "Acme raises Series C",
      text_body: "Acme raised $200M…",
      publisher_canonical_name: "TechCrunch",
      from_domain: "techcrunch.com",
    },
    {
      id: "e2",
      subject: "Beta launches product",
      text_body: "Beta shipped…",
      publisher_canonical_name: null,
      from_domain: "beta.example.com",
    },
    {
      id: "e3",
      subject: "Gamma layoffs",
      text_body: "Gamma cut 10%…",
      publisher_canonical_name: "Reuters",
      from_domain: "reuters.com",
    },
  ];
}

// Build a set of agents where each stage records that it ran and returns a
// canned payload. `gate` verdict is configurable per test.
function fakeAgents(opts: { isNews: boolean }) {
  const calls = {
    summarize: vi.fn(),
    gate: vi.fn(),
    categorize: vi.fn(),
    append: vi.fn(),
  };
  const summary: BatchSummary = {
    emailIds: ["e1", "e2", "e3"],
    emailSubjects: ["Acme raises Series C", "Beta launches product", "Gamma layoffs"],
    sources: ["TechCrunch", "beta.example.com", "Reuters"],
    summary: "Acme raised a $200M Series C.",
  };
  const agents: BatchAgents = {
    summarize: async (e) => {
      calls.summarize(e);
      return summary;
    },
    gate: async (s) => {
      calls.gate(s);
      return { isNews: opts.isNews, reasoning: "because" };
    },
    categorize: async (s) => {
      calls.categorize(s);
      return { category: "funding_round", workspaceRelevance: "high" };
    },
    append: async (s, c) => {
      calls.append(s, c);
      return { signalId: "sig-123" };
    },
  };
  return { agents, calls, summary };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("processBatch · append path", () => {
  test("gate passes → categorize + append run, record is 'appended'", async () => {
    const { agents, calls } = fakeAgents({ isNews: true });
    const record = await processBatch(emails(), agents);

    expect(calls.summarize).toHaveBeenCalledOnce();
    expect(calls.gate).toHaveBeenCalledOnce();
    expect(calls.categorize).toHaveBeenCalledOnce();
    expect(calls.append).toHaveBeenCalledOnce();

    expect(record.status).toBe("appended");
    expect(record.is_news).toBe(true);
    expect(record.category).toBe("funding_round");
    expect(record.signal_id).toBe("sig-123");
    expect(record.gate_reasoning).toBe("because");
  });

  test("summary handoff fields flow into the display record", async () => {
    const { agents } = fakeAgents({ isNews: true });
    const record = await processBatch(emails(), agents);

    expect(record.email_ids).toEqual(["e1", "e2", "e3"]);
    expect(record.news_sources).toEqual([
      "TechCrunch",
      "beta.example.com",
      "Reuters",
    ]);
    expect(record.batch_summary).toBe("Acme raised a $200M Series C.");
  });

  test("the gate receives the summarizer's output (chain handoff)", async () => {
    const { agents, calls, summary } = fakeAgents({ isNews: true });
    await processBatch(emails(), agents);
    expect(calls.gate).toHaveBeenCalledWith(summary);
  });
});

describe("processBatch · reject path", () => {
  test("gate fails → categorize + append are skipped, record is 'rejected'", async () => {
    const { agents, calls } = fakeAgents({ isNews: false });
    const record = await processBatch(emails(), agents);

    expect(calls.summarize).toHaveBeenCalledOnce();
    expect(calls.gate).toHaveBeenCalledOnce();
    expect(calls.categorize).not.toHaveBeenCalled();
    expect(calls.append).not.toHaveBeenCalled();

    expect(record.status).toBe("rejected");
    expect(record.is_news).toBe(false);
    expect(record.category).toBeNull();
    expect(record.signal_id).toBeNull();
  });
});

describe("runPendingBatches · claim loop", () => {
  const mockClaim = vi.mocked(claimNextBatch);
  const mockInsert = vi.mocked(insertBatchRecord);

  beforeEach(() => {
    mockInsert.mockResolvedValue(undefined);
  });

  test("no full batch available → produces nothing, records nothing", async () => {
    mockClaim.mockResolvedValueOnce(null);
    const { agents } = fakeAgents({ isNews: true });

    const produced = await runPendingBatches({ agents });

    expect(produced).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test("one batch ready → processed once and persisted, then loop stops", async () => {
    mockClaim.mockResolvedValueOnce(emails()).mockResolvedValueOnce(null);
    const { agents } = fakeAgents({ isNews: true });

    const produced = await runPendingBatches({ agents });

    expect(produced).toHaveLength(1);
    expect(produced[0].status).toBe("appended");
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledWith(produced[0]);
  });

  test("maxBatches caps how many batches one pass drains", async () => {
    mockClaim.mockResolvedValue(emails()); // always a full batch available
    const { agents } = fakeAgents({ isNews: true });

    const produced = await runPendingBatches({ agents, maxBatches: 2 });

    expect(produced).toHaveLength(2);
    expect(mockClaim).toHaveBeenCalledTimes(2);
  });

  test("a chain error is recorded as an 'error' batch, not thrown", async () => {
    mockClaim.mockResolvedValueOnce(emails()).mockResolvedValueOnce(null);
    const throwingAgents: BatchAgents = {
      summarize: async () => {
        throw new Error("LLM down");
      },
      gate: async () => ({ isNews: true, reasoning: "" }),
      categorize: async () => ({
        category: "other",
        workspaceRelevance: "none",
      }),
      append: async () => ({ signalId: null }),
    };

    const produced = await runPendingBatches({ agents: throwingAgents });

    expect(produced).toHaveLength(1);
    expect(produced[0].status).toBe("error");
    expect(produced[0].gate_reasoning).toContain("LLM down");
    expect(produced[0].email_ids).toEqual(["e1", "e2", "e3"]);
    expect(mockInsert).toHaveBeenCalledWith(produced[0]);
  });
});
