// Unit tests for the per-email agent chain. Agents (LLM) and DB (Supabase) are
// injected/mocked — these cover the gate-first control flow: the gate runs
// first, a reject short-circuits summarize/categorize/append (no summary
// tokens spent), the pass path runs all four steps, and runAgentChainForEmail
// persists exactly one run (recording an 'error' run on failure).

import { afterEach, describe, expect, test, vi } from "vitest";

import type { ChainEmail } from "./news-batches";

vi.mock("./news-batches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./news-batches")>();
  return { ...actual, insertAgentRun: vi.fn() };
});

import {
  processEmail,
  runAgentChainForEmail,
  type ChainAgents,
} from "./news-batch-pipeline";
import { insertAgentRun } from "./news-batches";

function email(): ChainEmail {
  return {
    id: "e1",
    subject: "Acme raises a Series C",
    text_body: "Acme raised $200M led by …",
    publisher_canonical_name: "TechCrunch",
    from_domain: "techcrunch.com",
  };
}

// Agents that record their calls and return canned payloads. Gate verdict is
// configurable per test.
function fakeAgents(opts: { isNews: boolean }) {
  const calls = {
    gate: vi.fn(),
    summarize: vi.fn(),
    categorize: vi.fn(),
  };
  const agents: ChainAgents = {
    gate: async (e) => {
      calls.gate(e);
      return { isNews: opts.isNews, reasoning: "because" };
    },
    summarize: async (e) => {
      calls.summarize(e);
      return "Acme raised a $200M Series C.";
    },
    categorize: async (s) => {
      calls.categorize(s);
      return { category: "funding_round", workspaceRelevance: "high" };
    },
  };
  return { agents, calls };
}

afterEach(() => vi.clearAllMocks());

describe("processEmail · gate-first pass path", () => {
  test("gate passes → summarize + categorize run, status 'appended'", async () => {
    const { agents, calls } = fakeAgents({ isNews: true });
    const record = await processEmail(email(), agents);

    expect(calls.gate).toHaveBeenCalledOnce();
    expect(calls.summarize).toHaveBeenCalledOnce();
    expect(calls.categorize).toHaveBeenCalledOnce();

    expect(record.status).toBe("appended");
    expect(record.is_news).toBe(true);
    expect(record.category).toBe("funding_round");
    expect(record.batch_summary).toBe("Acme raised a $200M Series C.");
    expect(record.email_ids).toEqual(["e1"]);
    expect(record.news_sources).toEqual(["TechCrunch"]);
    // All four agent steps present, in order.
    expect(record.steps.map((s) => s.agent)).toEqual([
      "gate",
      "summarize",
      "categorize",
      "append",
    ]);
  });

  test("the gate sees the raw email; categorize sees the summary (handoff)", async () => {
    const { agents, calls } = fakeAgents({ isNews: true });
    await processEmail(email(), agents);
    expect(calls.gate).toHaveBeenCalledWith(email());
    expect(calls.summarize).toHaveBeenCalledWith(email());
    expect(calls.categorize).toHaveBeenCalledWith("Acme raised a $200M Series C.");
  });
});

describe("processEmail · gate reject short-circuit", () => {
  test("gate fails → summarize + categorize are NOT called, status 'rejected'", async () => {
    const { agents, calls } = fakeAgents({ isNews: false });
    const record = await processEmail(email(), agents);

    expect(calls.gate).toHaveBeenCalledOnce();
    expect(calls.summarize).not.toHaveBeenCalled();
    expect(calls.categorize).not.toHaveBeenCalled();

    expect(record.status).toBe("rejected");
    expect(record.is_news).toBe(false);
    expect(record.category).toBeNull();
    expect(record.batch_summary).toBe("");
    // gate ran; the rest are recorded as skipped.
    const byAgent = Object.fromEntries(record.steps.map((s) => [s.agent, s.status]));
    expect(byAgent.gate).toBe("ok");
    expect(byAgent.summarize).toBe("skipped");
    expect(byAgent.categorize).toBe("skipped");
    expect(byAgent.append).toBe("skipped");
  });
});

describe("runAgentChainForEmail", () => {
  const mockInsert = vi.mocked(insertAgentRun);

  test("persists exactly one run and returns it", async () => {
    mockInsert.mockResolvedValue(undefined);
    const { agents } = fakeAgents({ isNews: true });

    const record = await runAgentChainForEmail(email(), agents);

    expect(record.status).toBe("appended");
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledWith(record);
  });

  test("a chain error is recorded as an 'error' run, not thrown", async () => {
    mockInsert.mockResolvedValue(undefined);
    const throwing: ChainAgents = {
      gate: async () => {
        throw new Error("LLM down");
      },
      summarize: async () => "",
      categorize: async () => ({ category: "other", workspaceRelevance: "none" }),
    };

    const record = await runAgentChainForEmail(email(), throwing);

    expect(record.status).toBe("error");
    expect(record.gate_reasoning).toContain("LLM down");
    expect(record.email_ids).toEqual(["e1"]);
    expect(mockInsert).toHaveBeenCalledWith(record);
  });
});
