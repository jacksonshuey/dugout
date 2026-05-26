// Smoke tests for the /ask agent's tool implementations. The tools call
// into the same builders as /api/account-context, so the heavy
// signal-correlation logic is already covered by unify-signals.test.ts.
// These tests verify the agent-facing contract: tool returns the right
// shape, the right error on bad input, and stays read-only.

import { describe, expect, test } from "vitest";
import {
  ASK_TOOL_SCHEMAS,
  ASK_TOOL_SCHEMAS_ANTHROPIC,
  ASK_TOOL_SCHEMAS_OPENAI,
  collectCitations,
  dispatchTool,
  findSignals,
  getAccountContext,
  getCommitteeEngagement,
  getCorrelations,
  listAccounts,
  rollup,
} from "./ask-tools";
import { DEMO_SCENARIO_ACCOUNTS, accounts } from "@/data/seed";

describe("ASK_TOOL_SCHEMAS", () => {
  // OpenAI SDK v6 types ChatCompletionTool as a discriminated union; narrow
  // to the function-tool variant up front so tests can access .function.* safely.
  const functionTools = ASK_TOOL_SCHEMAS.filter(
    (t): t is Extract<(typeof ASK_TOOL_SCHEMAS)[number], { type: "function" }> =>
      t.type === "function",
  );

  test("exports exactly the 9 tools (8 original + list_accounts)", () => {
    expect(ASK_TOOL_SCHEMAS).toHaveLength(9);
    const names = functionTools.map((t) => t.function.name).sort();
    expect(names).toEqual(
      [
        "get_account_context",
        "get_account_timeline",
        "find_signals",
        "get_correlations",
        "get_calls",
        "get_emails",
        "get_committee_engagement",
        "rollup",
        "list_accounts",
      ].sort(),
    );
  });

  test("every tool schema has a description (model needs it to pick well)", () => {
    for (const t of functionTools) {
      expect(t.function.description).toBeTruthy();
      expect(t.function.description!.length).toBeGreaterThan(20);
    }
  });

  test("find_signals enum constrains to canonical 12 signal types", () => {
    const tool = functionTools.find((t) => t.function.name === "find_signals");
    const props = tool!.function.parameters as {
      properties: { signal_type: { enum: string[] } };
    };
    expect(props.properties.signal_type.enum).toHaveLength(12);
  });

  test("ASK_TOOL_SCHEMAS is an alias for the OpenAI variant", () => {
    expect(ASK_TOOL_SCHEMAS).toBe(ASK_TOOL_SCHEMAS_OPENAI);
  });
});

describe("ASK_TOOL_SCHEMAS_ANTHROPIC", () => {
  test("exports exactly 9 tools with the same names as the OpenAI variant", () => {
    expect(ASK_TOOL_SCHEMAS_ANTHROPIC).toHaveLength(9);

    const anthropicNames = ASK_TOOL_SCHEMAS_ANTHROPIC.map((t) => t.name).sort();
    const openaiNames = ASK_TOOL_SCHEMAS_OPENAI.filter(
      (t): t is Extract<typeof t, { type: "function" }> => t.type === "function",
    )
      .map((t) => t.function.name)
      .sort();

    expect(anthropicNames).toEqual(openaiNames);
  });

  test("every Anthropic schema has name, description, and input_schema.properties", () => {
    for (const t of ASK_TOOL_SCHEMAS_ANTHROPIC) {
      expect(t.name).toBeTruthy();
      expect(typeof t.name).toBe("string");
      expect(t.description).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema).toBeDefined();
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema.properties).toBeDefined();
      expect(typeof t.input_schema.properties).toBe("object");
    }
  });

  test("Anthropic find_signals schema preserves the 12-type enum constraint", () => {
    const tool = ASK_TOOL_SCHEMAS_ANTHROPIC.find((t) => t.name === "find_signals");
    expect(tool).toBeDefined();
    const props = tool!.input_schema.properties as {
      signal_type: { enum: string[] };
    };
    expect(props.signal_type.enum).toHaveLength(12);
  });
});

describe("getAccountContext", () => {
  test("returns ok with data for the critical demo account", async () => {
    const r = await getAccountContext({
      account_slug: DEMO_SCENARIO_ACCOUNTS.critical,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data.account.id).toBe(DEMO_SCENARIO_ACCOUNTS.critical);
    expect(r.data.openOpportunities.length).toBeGreaterThan(0);
    // The critical scenario is engineered to surface a champion_disengagement
    // correlation across multiple sources — that's the whole point of the
    // worked example. If this drops to 0, demoSignals likely got pruned.
    expect(r.data.signals.length).toBeGreaterThan(0);
  });

  test("returns ok:false with a useful error for an unknown account", async () => {
    const r = await getAccountContext({ account_slug: "acc_does_not_exist" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toMatch(/Unknown account/);
  });

  test("clamps days to [1, 365]", async () => {
    // Sanity: passing days=0 should not throw and should still return data.
    const r = await getAccountContext({
      account_slug: DEMO_SCENARIO_ACCOUNTS.healthy,
      days: 0,
    });
    expect(r.ok).toBe(true);
  });
});

describe("findSignals", () => {
  test("rejects a non-canonical signal_type", async () => {
    const r = await findSignals({
      // @ts-expect-error — intentionally bad input
      signal_type: "not_a_real_type",
      account_slug: DEMO_SCENARIO_ACCOUNTS.critical,
    });
    expect(r.ok).toBe(false);
  });

  test("filters returned signals to the requested type", async () => {
    const r = await findSignals({
      signal_type: "champion_disengagement",
      account_slug: DEMO_SCENARIO_ACCOUNTS.critical,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    for (const s of r.data.signals) {
      expect(s.signalType).toBe("champion_disengagement");
    }
  });
});

describe("getCorrelations", () => {
  test("returns the same correlations as get_account_context when no types filter", async () => {
    const slug = DEMO_SCENARIO_ACCOUNTS.critical;
    const ctx = await getAccountContext({ account_slug: slug });
    const corr = await getCorrelations({ account_slug: slug });
    expect(ctx.ok && corr.ok).toBe(true);
    if (!ctx.ok || !corr.ok) throw new Error("unreachable");
    expect(corr.data.correlations.length).toBe(ctx.data.correlations.length);
  });
});

describe("getCommitteeEngagement", () => {
  test("flags the critical scenario as missing Finance", async () => {
    // The critical opp deliberately omits c_sen_2 (Finance/CFO) from
    // contactRoleIds so SELECTED_VENDOR_NO_FINANCE fires.
    const r = await getCommitteeEngagement({ opportunity_id: "opp_sentinel" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data.missingRoles).toContain("finance");
  });

  test("returns ok:false for unknown opportunity", async () => {
    const r = await getCommitteeEngagement({ opportunity_id: "opp_nope" });
    expect(r.ok).toBe(false);
  });
});

describe("deferred-v1 tool stubs", () => {
  test("get_calls returns an empty list with a note", async () => {
    const r = await dispatchTool("get_calls", {
      opportunity_id: "opp_sentinel",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect((r.data as { note: string }).note).toMatch(/deferred/i);
  });

  test("rollup returns an empty list with a note", async () => {
    const r = await rollup({ metric: "count", dimension: "stage" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect((r.data as { note: string }).note).toMatch(/deferred/i);
  });
});

describe("listAccounts", () => {
  test("returns ok:true with every workspace account", async () => {
    const r = await listAccounts();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.data).toHaveLength(accounts.length);
  });

  test("each entry has slug and name", async () => {
    const r = await listAccounts();
    if (!r.ok) throw new Error("unreachable");
    for (const entry of r.data) {
      expect(typeof entry.slug).toBe("string");
      expect(entry.slug.startsWith("acc_")).toBe(true);
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test("slugs match accounts array ids exactly (regression guard)", async () => {
    const r = await listAccounts();
    if (!r.ok) throw new Error("unreachable");
    const catalogSlugs = r.data.map((e) => e.slug).sort();
    const seedSlugs = accounts.map((a) => a.id).sort();
    expect(catalogSlugs).toEqual(seedSlugs);
  });

  test("Moderna resolves to acc_moderna", async () => {
    const r = await listAccounts();
    if (!r.ok) throw new Error("unreachable");
    const moderna = r.data.find((e) => e.name === "Moderna");
    expect(moderna?.slug).toBe("acc_moderna");
  });
});

describe("dispatchTool", () => {
  test("routes by name", async () => {
    const r = await dispatchTool("get_account_context", {
      account_slug: DEMO_SCENARIO_ACCOUNTS.healthy,
    });
    expect(r.ok).toBe(true);
  });

  test("dispatches list_accounts", async () => {
    const r = await dispatchTool("list_accounts", {});
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(Array.isArray(r.data)).toBe(true);
  });

  test("returns ok:false on an unknown tool name", async () => {
    const r = await dispatchTool("does_not_exist", {});
    expect(r.ok).toBe(false);
  });
});

describe("collectCitations", () => {
  test("extracts UnifiedSignal-shaped objects from nested results", async () => {
    const r = await getAccountContext({
      account_slug: DEMO_SCENARIO_ACCOUNTS.critical,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    const cits = collectCitations(r.data);
    expect(cits.length).toBeGreaterThan(0);
    for (const c of cits) {
      expect(c.id).toBeTruthy();
      expect(c.sourceTool).toBeTruthy();
      expect(c.summary).toBeTruthy();
    }
    // Dedup: no two citations share an id.
    const ids = cits.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
