// Integration health checks — env-var presence per adapter, no network
// calls. The point of these tests is to lock the wiring between the
// constellation's brand keys and the env vars the adapters actually read.
// If someone renames an env var without updating CHECKS, the chip on the
// landing page silently goes from "live" to "missing" forever — these
// tests catch that.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checkAllHealth,
  checkHealth,
  isTrackedBrand,
} from "./integration-health";

const ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEWSAPI_KEY",
  "FIRECRAWL_API_KEY",
  "SLACK_WEBHOOK_URL",
] as const;

// Each test mutates process.env. Snapshot and restore around every case so
// runs don't leak state into each other or into the dev server's env.
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
  for (const k of ENV_VARS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("checkHealth — env-keyed adapters", () => {
  test("anthropic: live when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(checkHealth("anthropic")).toEqual({
      mode: "live",
      note: "Credential configured",
    });
  });

  test("anthropic: missing when ANTHROPIC_API_KEY is absent", () => {
    const h = checkHealth("anthropic");
    expect(h.mode).toBe("missing");
    expect(h.note).toContain("ANTHROPIC_API_KEY");
  });

  test("supabase: live only when BOTH url and service role are set", () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    expect(checkHealth("supabase").mode).toBe("missing");

    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(checkHealth("supabase").mode).toBe("live");
  });

  test("supabase: missing note lists every absent var", () => {
    const h = checkHealth("supabase");
    expect(h.mode).toBe("missing");
    expect(h.note).toContain("SUPABASE_URL");
    expect(h.note).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  test("newsapi: env var is NEWSAPI_KEY (not NEWSAPI_API_KEY)", () => {
    // Adapter reads getEnvOrFile("NEWSAPI_KEY") in src/lib/news-adapter.ts.
    // If anyone "fixes" this to NEWSAPI_API_KEY, prod silently breaks.
    process.env.NEWSAPI_KEY = "real-key";
    expect(checkHealth("newsapi").mode).toBe("live");
  });

  test("firecrawl: env-based (FIRECRAWL_API_KEY), not vault-stored", () => {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    expect(checkHealth("firecrawl").mode).toBe("live");
  });

  test("slack: keyed off webhook URL, not an API key", () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T/B/X";
    expect(checkHealth("slack").mode).toBe("live");
  });
});

describe("checkHealth — credential-free adapters", () => {
  test("sec: always live (public API)", () => {
    expect(checkHealth("sec")).toEqual({
      mode: "live",
      note: "No credential required",
    });
  });

  test("granola: live at constellation level (per-workspace Vault rows live elsewhere)", () => {
    expect(checkHealth("granola").mode).toBe("live");
  });
});

describe("checkHealth — OAuth display rows", () => {
  test.each(["salesforce", "gong", "outreach", "dock", "chilipiper"] as const)(
    "%s: returns config mode without consulting env",
    (brand) => {
      const h = checkHealth(brand);
      expect(h.mode).toBe("config");
      expect(h.note).toMatch(/OAuth/);
    },
  );
});

describe("checkHealth — untracked brand", () => {
  test("returns config mode with 'Not tracked' note", () => {
    // hubspot exists in logos.tsx but isn't on the constellation
    const h = checkHealth("hubspot");
    expect(h.mode).toBe("config");
    expect(h.note).toBe("Not tracked");
  });
});

describe("checkAllHealth", () => {
  test("returns one entry per tracked brand", () => {
    const all = checkAllHealth();
    const brands = Object.keys(all).sort();
    expect(brands).toEqual(
      [
        "anthropic",
        "chilipiper",
        "dock",
        "firecrawl",
        "gong",
        "granola",
        "newsapi",
        "outreach",
        "salesforce",
        "sec",
        "slack",
        "supabase",
      ].sort(),
    );
  });

  test("env mutations reflected in the snapshot", () => {
    expect(checkAllHealth().anthropic.mode).toBe("missing");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(checkAllHealth().anthropic.mode).toBe("live");
  });
});

describe("isTrackedBrand", () => {
  test("true for constellation brands, false for others", () => {
    expect(isTrackedBrand("anthropic")).toBe(true);
    expect(isTrackedBrand("hubspot")).toBe(false);
    expect(isTrackedBrand("not-a-brand")).toBe(false);
  });
});
