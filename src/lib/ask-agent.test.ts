// Tests for the provider-agnostic /ask agent loop.
//
// We don't hit real OpenAI or Anthropic endpoints here. The stub path is
// fully exercised; the real-provider paths are covered through the env-key
// gating logic (no key → degrade to stub WITH stubReason set, which is
// the user-visible contract).
//
// Citation chain preservation is tested via the stub path because it uses
// the same dedup+collect helpers the real loops use.

import { describe, expect, test } from "vitest";
import { isValidProviderModel, runAskAgent } from "./ask-agent";
import { DEMO_SCENARIO_ACCOUNTS } from "@/data/seed";
import { HAS_OPENAI_KEY } from "@/lib/openai";
import { HAS_ANTHROPIC_KEY } from "@/lib/anthropic-ask";

describe("isValidProviderModel", () => {
  test("accepts the documented matrix", () => {
    expect(isValidProviderModel("openai", "gpt-4o")).toBe(true);
    expect(isValidProviderModel("anthropic", "claude-sonnet-4-6")).toBe(true);
    expect(isValidProviderModel("anthropic", "claude-haiku-4-5")).toBe(true);
    expect(isValidProviderModel("stub", "stub-deterministic")).toBe(true);
  });

  test("rejects cross-pollinated combinations", () => {
    expect(isValidProviderModel("openai", "claude-sonnet-4-6")).toBe(false);
    expect(isValidProviderModel("anthropic", "gpt-4o")).toBe(false);
    expect(isValidProviderModel("stub", "gpt-4o")).toBe(false);
  });
});

describe("runAskAgent · stub routing", () => {
  test("provider=stub returns deterministic stub regardless of question", async () => {
    const r = await runAskAgent({
      question: "Why is acc_sentinel stalling?",
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.provider).toBe("stub");
    expect(r.model).toBe("stub-deterministic");
    expect(r.answer.length).toBeGreaterThan(50);
    expect(r.stubReason).toBeUndefined();
  });

  test("stub picks the right account from the question text", async () => {
    const r = await runAskAgent({
      question: `Why is ${DEMO_SCENARIO_ACCOUNTS.critical} stalling?`,
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.accountSlug).toBe(DEMO_SCENARIO_ACCOUNTS.critical);
  });

  test("stub honors explicit accountSlug over question text", async () => {
    // Use a "brief" question so the stub takes the narration path (which
    // populates accountSlug); the generic-fallback branch intentionally
    // returns accountSlug: null because no tool was called.
    const r = await runAskAgent({
      question: "Brief me on this account",
      accountSlug: DEMO_SCENARIO_ACCOUNTS.healthy,
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.accountSlug).toBe(DEMO_SCENARIO_ACCOUNTS.healthy);
  });

  test("stub returns a citation chain (collectCitations integration)", async () => {
    const r = await runAskAgent({
      question: "Why is acc_sentinel stalling?",
      provider: "stub",
      model: "stub-deterministic",
    });
    // Stub mode calls get_account_context against the critical scenario,
    // which surfaces correlations + signals. citations[] must be populated
    // and every id must be unique (dedup contract).
    expect(r.citations.length).toBeGreaterThan(0);
    const ids = r.citations.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of r.citations) {
      expect(c.id).toBeTruthy();
      expect(c.sourceTool).toBeTruthy();
      expect(c.summary).toBeTruthy();
    }
  });

  test("stub records a tool_call for traceability", async () => {
    const r = await runAskAgent({
      question: "Brief me on acc_sentinel",
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.toolCalls.length).toBeGreaterThan(0);
    expect(r.toolCalls[0].tool).toBe("get_account_context");
  });

  test("stub returns generic answer for non-canonical questions", async () => {
    const r = await runAskAgent({
      question: "What's the weather like?",
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.answer).toMatch(/stub|credentials/i);
    expect(r.toolCalls).toHaveLength(0);
  });
});

describe("runAskAgent · stub fallback when env key missing", () => {
  // These assertions hold conditionally: when the key is missing in the
  // test env (the common case in CI), the agent degrades to stub with a
  // stubReason. When a key IS present we skip the assertion — the real
  // path would otherwise need network.

  test("provider=openai with no OPENAI_API_KEY → stub with stubReason", async () => {
    if (HAS_OPENAI_KEY) {
      // Real key available — exercising the real path requires network +
      // billable tokens; skip rather than burn through Jackson's quota.
      return;
    }
    const r = await runAskAgent({
      question: "Brief me on acc_sentinel",
      provider: "openai",
      model: "gpt-4o",
    });
    expect(r.provider).toBe("stub");
    expect(r.model).toBe("stub-deterministic");
    expect(r.stubReason).toMatch(/OPENAI_API_KEY/);
  });

  test("provider=anthropic with no ANTHROPIC_API_KEY → stub with stubReason", async () => {
    if (HAS_ANTHROPIC_KEY) {
      return;
    }
    const r = await runAskAgent({
      question: "Brief me on acc_sentinel",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(r.provider).toBe("stub");
    expect(r.model).toBe("stub-deterministic");
    expect(r.stubReason).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("runAskAgent · provider/model validation", () => {
  test("invalid combo degrades to stub with explanatory reason", async () => {
    // The combo is structurally valid for the TS types (both are members
    // of their respective unions), but invalid against the matrix. SUT
    // should reject without calling out to the provider.
    const r = await runAskAgent({
      question: "Brief me on acc_sentinel",
      provider: "openai",
      model: "claude-sonnet-4-6",
    });
    expect(r.provider).toBe("stub");
    expect(r.stubReason).toMatch(/Invalid provider\/model/);
  });
});

describe("runAskAgent · tool-call cap constants are exposed in stub flow", () => {
  // We can't directly trigger the 8-call cap without driving a real
  // provider that re-emits tool_calls. But we CAN assert the stub path
  // calls at most 1 tool (the deterministic builder calls
  // get_account_context once), which is the floor sanity check that
  // confirms the dispatcher isn't accidentally fanning out.

  test("stub never emits more than 1 tool call (deterministic, single fetch)", async () => {
    const r = await runAskAgent({
      question: "Why is acc_sentinel stalling?",
      provider: "stub",
      model: "stub-deterministic",
    });
    expect(r.toolCalls.length).toBeLessThanOrEqual(1);
  });
});
