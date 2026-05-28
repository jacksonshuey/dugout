// Guarantees the "every integration comes prebuilt" promise: every row in the
// INTEGRATIONS registry has a registered adapter scaffold, the scaffolds are
// callable today (verify/fetch fail soft, never throw), and read-direction
// adapters declare the raw object types they'd emit to the zipper.

import { describe, expect, test } from "vitest";

import { INTEGRATIONS } from "@/data/integrations";
import {
  createScaffold,
  getIntegrationAdapter,
  listIntegrationAdapters,
} from "./adapter";
import type { Account } from "../types";

const fakeAccount = { id: "acc_test", name: "Test Co" } as Account;

describe("adapter registry coverage", () => {
  test("every INTEGRATIONS brand has a registered adapter", () => {
    for (const spec of INTEGRATIONS) {
      const adapter = getIntegrationAdapter(spec.brand);
      expect(adapter, `missing adapter for ${spec.brand}`).not.toBeNull();
      expect(adapter?.brand).toBe(spec.brand);
      expect(adapter?.auth).toBe(spec.auth);
      expect(adapter?.direction).toBe(spec.direction);
    }
  });

  test("registry size matches the integration count", () => {
    expect(listIntegrationAdapters()).toHaveLength(INTEGRATIONS.length);
  });

  test("read-direction adapters declare raw object types", () => {
    for (const a of listIntegrationAdapters()) {
      if (a.direction === "read") {
        expect(
          a.sync.objectTypes.length,
          `${a.brand} should declare object types`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("scaffold defaults are fail-soft", () => {
  test("verify() reports not-connected without throwing", async () => {
    const a = getIntegrationAdapter("salesforce")!;
    const r = await a.verify({ apiKey: "x" });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/scaffold|connect/i);
  });

  test("fetch() returns not_implemented for a read source", async () => {
    const a = getIntegrationAdapter("salesforce")!;
    const r = await a.fetch({ account: fakeAccount });
    expect(r.status).toBe("not_implemented");
    if (r.status === "not_implemented") {
      expect(r.brand).toBe("salesforce");
      expect(r.note).toContain("Opportunity");
    }
  });

  test("an outbound/delivery brand pulls nothing", async () => {
    const a = getIntegrationAdapter("slack")!;
    expect(a.direction).toBe("outbound");
    expect(a.sync.objectTypes).toEqual([]);
    const r = await a.fetch({ account: fakeAccount });
    expect(r.status).toBe("not_implemented");
    if (r.status === "not_implemented") {
      expect(r.note).toMatch(/delivery destination/i);
    }
  });

  test("createScaffold falls back cleanly for an unspecced brand", () => {
    const a = createScaffold({
      brand: "salesforce",
      role: "x",
      status: "config",
      auth: "oauth",
      deployment: "your-stack",
      direction: "read",
      limits: "",
    });
    expect(a.sync.frequency).toBeDefined();
  });
});
