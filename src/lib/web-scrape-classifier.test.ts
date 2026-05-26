// Tests for the web-scrape classifier (web-scrape-classifier.ts).
//
// Mocks: Haiku call is injectable via `deps.haikuCall` on
// classifyWebScrape — we never hit Anthropic.
//
// Focus areas (Phase 3 unification):
//   1. Forced tool-use schema lists items[] + brief_fields with correct
//      required fields + enum lists
//   2. workspace_relevance per-extraction is on every signal
//   3. AE-brief fields extracted from sample markdown and persisted on
//      every signal's meta.brief_fields
//   4. Determinism: same Haiku output → identical signals
//   5. Defensive coercion: missing/malformed brief_fields → empty-but-typed

import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  classifyWebScrape,
  _internal as WS_INTERNALS,
} from "./web-scrape-classifier";
import type { WebScrape } from "./web-scrapes";
import type { Account } from "./types";

// ─── Fixtures ───────────────────────────────────────────────────────────

function mkScrape(overrides: Partial<WebScrape> = {}): WebScrape {
  return {
    id: overrides.id ?? "scrape_1",
    account_id: overrides.account_id ?? "acc_unitedhealth",
    url: overrides.url ?? "https://helios.com/news",
    scraped_at: overrides.scraped_at ?? "2026-05-23T12:00:00.000Z",
    scraped_date: overrides.scraped_date ?? "2026-05-23",
    status_code: overrides.status_code ?? 200,
    markdown:
      overrides.markdown ??
      // Long enough to clear the 100-char minimum gate.
      "# Helios Manufacturing News\n\n" +
        "We are a leading provider of industrial automation systems.\n\n" +
        "Today we announced a $80M Series C led by Sequoia Capital.\n\n" +
        "Our new CFO Jane Smith joined us last week from Acme Corp.\n\n" +
        "We continue to face supply chain risks from the recent tariff regime.",
    raw_size_bytes: overrides.raw_size_bytes ?? 1024,
    classified_at: overrides.classified_at ?? null,
    signals_emitted: overrides.signals_emitted ?? 0,
    error: overrides.error ?? null,
    created_at: overrides.created_at ?? "2026-05-23T12:00:00.000Z",
  };
}

const HELIOS: Account = {
  id: "acc_unitedhealth",
  name: "Helios Manufacturing",
  industry: "Manufacturing",
  segment: "Enterprise",
  hqLocation: "Houston",
  legalTeamSize: 12,
  ticker: "HLOS",
  website: "helios.com",
};

// A realistic-shaped tool response the classifier expects when Haiku
// understood the markdown. Used across most tests.
const SAMPLE_TOOL_OUTPUT = {
  items: [
    {
      type: "funding_round",
      summary: "Helios Manufacturing announced a $80M Series C led by Sequoia.",
      workspace_relevance: "high",
      occurred_at: "2026-05-22",
    },
    {
      type: "leadership_change",
      summary: "Helios Manufacturing named Jane Smith as CFO.",
      workspace_relevance: "medium",
    },
  ],
  brief_fields: {
    company_one_liner:
      "Leading provider of industrial automation systems for manufacturers.",
    exec_change: {
      name: "Jane Smith",
      role: "CFO",
      change: "joined",
      date: "2026-05-15",
    },
    recent_funding: {
      amount: "$80M Series C",
      lead_investor: "Sequoia Capital",
      date: "2026-05-22",
    },
    key_risks: [
      "Supply chain exposure to recent tariff regime",
      "Customer concentration in oil & gas",
    ],
    strategic_focus: "AI-native predictive maintenance platform",
  },
};

// ─── 1. tool schema shape ───────────────────────────────────────────────

describe("web-scrape-classifier · tool schema (Phase 3)", () => {
  test("forced tool-use schema is named submit_extraction with required items + brief_fields", () => {
    const { TOOL_NAME, TOOL_SCHEMA } = WS_INTERNALS;
    expect(TOOL_NAME).toBe("submit_extraction");
    expect(TOOL_SCHEMA.input_schema.required).toEqual([
      "items",
      "brief_fields",
    ]);
  });

  test("items[] requires type + summary + workspace_relevance, items capped at 5", () => {
    const { TOOL_SCHEMA } = WS_INTERNALS;
    const items = TOOL_SCHEMA.input_schema.properties.items;
    expect(items.maxItems).toBe(5);
    expect(items.items.required).toEqual([
      "type",
      "summary",
      "workspace_relevance",
    ]);
  });

  test("brief_fields lists all 5 structured AE-brief properties as required", () => {
    const { TOOL_SCHEMA } = WS_INTERNALS;
    const brief = TOOL_SCHEMA.input_schema.properties.brief_fields;
    expect(brief.required).toEqual([
      "company_one_liner",
      "exec_change",
      "recent_funding",
      "key_risks",
      "strategic_focus",
    ]);
  });

  test("exec_change.change enum is exactly joined|left|promoted", () => {
    const { TOOL_SCHEMA, VALID_EXEC_CHANGES } = WS_INTERNALS;
    const ec = TOOL_SCHEMA.input_schema.properties.brief_fields.properties
      .exec_change;
    expect(ec.required).toEqual(["name", "role", "change", "date"]);
    expect(ec.properties.change.enum).toEqual(VALID_EXEC_CHANGES);
    expect(ec.properties.change.enum).toEqual(["joined", "left", "promoted"]);
  });
});

// ─── 2. AE-brief fields extracted from sample markdown ──────────────────

describe("web-scrape-classifier · AE-brief fields", () => {
  test("brief_fields parsed from Haiku output land on result.brief_fields", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => SAMPLE_TOOL_OUTPUT,
    });
    expect(r.brief_fields.company_one_liner).toBe(
      "Leading provider of industrial automation systems for manufacturers.",
    );
    expect(r.brief_fields.exec_change).toEqual({
      name: "Jane Smith",
      role: "CFO",
      change: "joined",
      date: "2026-05-15",
    });
    expect(r.brief_fields.recent_funding).toEqual({
      amount: "$80M Series C",
      lead_investor: "Sequoia Capital",
      date: "2026-05-22",
    });
    expect(r.brief_fields.key_risks.length).toBe(2);
    expect(r.brief_fields.strategic_focus).toBe(
      "AI-native predictive maintenance platform",
    );
  });

  test("brief_fields persisted on every signal's meta.brief_fields", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => SAMPLE_TOOL_OUTPUT,
    });
    expect(r.signals.length).toBe(2);
    for (const sig of r.signals) {
      const meta = sig.meta as { brief_fields: typeof r.brief_fields };
      expect(meta.brief_fields).toEqual(r.brief_fields);
    }
  });

  test("missing brief_fields from Haiku → empty-but-typed defaults", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => ({
        items: [],
        // brief_fields omitted entirely
      }),
    });
    expect(r.brief_fields).toEqual({
      company_one_liner: null,
      exec_change: null,
      recent_funding: null,
      key_risks: [],
      strategic_focus: null,
    });
  });

  test("invalid exec_change.change enum → exec_change coerced to null", () => {
    const { validateBriefFields } = WS_INTERNALS;
    const v = validateBriefFields({
      company_one_liner: "x",
      exec_change: {
        name: "Jane",
        role: "CFO",
        change: "fired", // not in enum
        date: null,
      },
      recent_funding: null,
      key_risks: [],
      strategic_focus: null,
    });
    expect(v.exec_change).toBeNull();
  });

  test("key_risks capped at 3 items", () => {
    const { validateBriefFields } = WS_INTERNALS;
    const v = validateBriefFields({
      company_one_liner: null,
      exec_change: null,
      recent_funding: null,
      key_risks: ["r1", "r2", "r3", "r4", "r5"],
      strategic_focus: null,
    });
    expect(v.key_risks.length).toBe(3);
    expect(v.key_risks).toEqual(["r1", "r2", "r3"]);
  });
});

// ─── 3. workspace_relevance per-extraction is on every signal ───────────

describe("web-scrape-classifier · workspace_relevance per signal", () => {
  test("each extracted signal carries the Haiku-emitted workspace_relevance", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => SAMPLE_TOOL_OUTPUT,
    });
    expect(r.signals[0].workspace_relevance).toBe("high");
    expect(r.signals[1].workspace_relevance).toBe("medium");
  });

  test("missing workspace_relevance from Haiku → coerced to 'low'", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => ({
        items: [
          {
            type: "product_launch",
            summary: "Helios shipped a new SKU.",
            // workspace_relevance intentionally absent
          },
        ],
        brief_fields: SAMPLE_TOOL_OUTPUT.brief_fields,
      }),
    });
    expect(r.signals[0].workspace_relevance).toBe("low");
  });
});

// ─── 4. determinism ─────────────────────────────────────────────────────

describe("web-scrape-classifier · determinism", () => {
  test("same Haiku output → identical signal list across 10 runs", async () => {
    const first = JSON.stringify(
      (
        await classifyWebScrape(mkScrape(), HELIOS, {
          haikuCall: async () => SAMPLE_TOOL_OUTPUT,
        })
      ).signals,
    );
    for (let i = 0; i < 10; i++) {
      const next = JSON.stringify(
        (
          await classifyWebScrape(mkScrape(), HELIOS, {
            haikuCall: async () => SAMPLE_TOOL_OUTPUT,
          })
        ).signals,
      );
      expect(next).toBe(first);
    }
  });
});

// ─── 5. source attribution + dedup keys ─────────────────────────────────

describe("web-scrape-classifier · source attribution", () => {
  test("signals pin to scrape.account_id and carry firecrawl_md source kind", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => SAMPLE_TOOL_OUTPUT,
    });
    for (const sig of r.signals) {
      expect(sig.account_id).toBe("acc_unitedhealth");
      expect(sig.source).toBe("web_scrape");
      expect(sig.source_content_kind).toBe("firecrawl_md");
      expect(sig.source_url).toBe("https://helios.com/news");
    }
  });

  test("signals without an explicit url get a deterministic synthetic url", async () => {
    const r = await classifyWebScrape(mkScrape(), HELIOS, {
      haikuCall: async () => ({
        items: [
          {
            type: "product_launch",
            summary: "Helios Manufacturing launched something cool.",
            workspace_relevance: "medium",
          },
        ],
        brief_fields: SAMPLE_TOOL_OUTPUT.brief_fields,
      }),
    });
    // Synthetic url is `${scrape.url}#${slug}` — deterministic, so same
    // markdown re-scrape next day won't insert duplicate rows.
    expect(r.signals[0].url).toMatch(/^https:\/\/helios\.com\/news#/);
  });
});

// ─── 6. fail-soft on short markdown ─────────────────────────────────────

describe("web-scrape-classifier · fail-soft", () => {
  test("markdown shorter than 100 chars → no Haiku call, empty signals + empty brief", async () => {
    const haikuMock = vi.fn();
    const r = await classifyWebScrape(
      mkScrape({ markdown: "tiny" }),
      HELIOS,
      { haikuCall: haikuMock },
    );
    expect(r.signals).toEqual([]);
    expect(r.brief_fields.company_one_liner).toBeNull();
    expect(haikuMock).not.toHaveBeenCalled();
  });
});

// Suppress noisy console.warn from expected fail-soft paths.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
