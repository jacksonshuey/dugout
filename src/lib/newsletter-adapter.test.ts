// Tests for the newsletter content classifier (newsletter-adapter.ts).
//
// Mocks: the Haiku call is injectable via the `deps.haikuCall` test seam
// on classifyNewsletter — no vi.mock magic needed. We never hit Anthropic.
//
// Focus areas (Phase 3 unification):
//   1. Forced tool-use schema shape — name, required fields, enum lists
//   2. workspace_relevance per-extraction is on every signal
//   3. Determinism: same input → identical signal list across 10 runs
//   4. Defensive coercion when Haiku omits workspace_relevance
//   5. Backward-compat: no Stage 2 verdict field in the schema (per-event
//      classifier emits per-event extractions, not gate verdicts)

import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  classifyNewsletter,
  _internal as NEWSLETTER_INTERNALS,
} from "./newsletter-adapter";
import type { InboundEmail } from "./inbound-email";
import type { Account } from "./types";
import type { PublisherInfo } from "./email-filter-types";

// ─── Fixtures ───────────────────────────────────────────────────────────

function mkEmail(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    id: overrides.id ?? "email_1",
    from_address: overrides.from_address ?? "editor@axios.com",
    from_domain: overrides.from_domain ?? "axios.com",
    subject: overrides.subject ?? "Pro Rata — Wednesday's deals",
    received_at: overrides.received_at ?? "2026-05-23T12:00:00.000Z",
    text_body:
      overrides.text_body ??
      Array.from({ length: 200 }, (_, i) => `body${i}`).join(" "),
    html_body: overrides.html_body ?? null,
    raw_size_bytes: overrides.raw_size_bytes ?? 4096,
    classified_at: overrides.classified_at ?? null,
    signals_emitted: overrides.signals_emitted ?? 0,
    message_id: overrides.message_id ?? "msg-1",
    list_id: overrides.list_id ?? null,
    publisher_canonical_name: overrides.publisher_canonical_name ?? null,
    created_at: overrides.created_at ?? "2026-05-23T12:00:00.000Z",
  };
}

const HELIOS: Account = {
  id: "acc_helios",
  name: "Helios Manufacturing",
  industry: "Manufacturing",
  segment: "Enterprise",
  hqLocation: "Houston",
  legalTeamSize: 12,
  ticker: "HLOS",
  website: "helios.com",
};

const PUBLISHER: PublisherInfo = {
  publisher_canonical_name: "axios_pro_rata",
  display_name: "Axios Pro Rata",
  is_known: true,
};

// ─── 1. tool schema shape ───────────────────────────────────────────────

describe("newsletter-adapter · tool schema (Phase 3)", () => {
  test("forced tool-use schema is named submit_extraction with required fields", () => {
    const { TOOL_NAME, TOOL_SCHEMA } = NEWSLETTER_INTERNALS;
    expect(TOOL_NAME).toBe("submit_extraction");
    expect(TOOL_SCHEMA.input_schema.required).toEqual(["items"]);

    const itemSchema = TOOL_SCHEMA.input_schema.properties.items.items;
    expect(itemSchema.required).toEqual([
      "mention",
      "type",
      "summary",
      "workspace_relevance",
    ]);
  });

  test("workspace_relevance enum lists exactly the four canonical tiers", () => {
    const { TOOL_SCHEMA, WORKSPACE_RELEVANCE_VALUES } = NEWSLETTER_INTERNALS;
    const wr = TOOL_SCHEMA.input_schema.properties.items.items.properties
      .workspace_relevance;
    expect(wr.enum).toEqual(WORKSPACE_RELEVANCE_VALUES);
    expect(wr.enum).toEqual(["high", "medium", "low", "none"]);
  });

  test("type enum lists all 12 ExternalSignalType values", () => {
    const { TOOL_SCHEMA, VALID_TYPES } = NEWSLETTER_INTERNALS;
    const t = TOOL_SCHEMA.input_schema.properties.items.items.properties.type;
    expect(t.enum.length).toBe(12);
    for (const v of VALID_TYPES) {
      expect(t.enum).toContain(v);
    }
  });
});

// ─── 2. workspace_relevance per-extraction is on every signal ────────────

describe("newsletter-adapter · workspace_relevance per signal", () => {
  test("each extracted signal carries the Haiku-emitted workspace_relevance", async () => {
    const r = await classifyNewsletter(
      mkEmail(),
      [HELIOS],
      PUBLISHER,
      {
        haikuCall: async () => ({
          items: [
            {
              mention: "Helios Manufacturing",
              type: "funding_round",
              summary: "Helios Manufacturing closed a Series B.",
              workspace_relevance: "high",
            },
            {
              mention: "RandomCo",
              type: "product_launch",
              summary: "RandomCo shipped a new feature.",
              workspace_relevance: "low",
            },
          ],
        }),
      },
    );
    expect(r.signals.length).toBe(2);
    expect(r.signals[0].workspace_relevance).toBe("high");
    expect(r.signals[1].workspace_relevance).toBe("low");
  });

  test("missing workspace_relevance from Haiku → coerced to 'low'", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => ({
        items: [
          {
            mention: "Stripe",
            type: "press_release",
            summary: "Stripe announced something.",
            // workspace_relevance intentionally absent
          },
        ],
      }),
    });
    expect(r.signals.length).toBe(1);
    expect(r.signals[0].workspace_relevance).toBe("low");
  });

  test("invalid workspace_relevance from Haiku → coerced to 'low'", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => ({
        items: [
          {
            mention: "Stripe",
            type: "press_release",
            summary: "Stripe announced something.",
            workspace_relevance: "critical", // not in enum
          },
        ],
      }),
    });
    expect(r.signals[0].workspace_relevance).toBe("low");
  });
});

// ─── 3. determinism: same input → identical signals across 10 runs ──────

describe("newsletter-adapter · determinism", () => {
  test("same Haiku output → identical signal list across 10 runs", async () => {
    const haikuOut = {
      items: [
        {
          mention: "Moderna",
          type: "earnings",
          summary: "Moderna beat Q2 estimates.",
          workspace_relevance: "medium",
        },
      ],
    };
    const first = JSON.stringify(
      (
        await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
          haikuCall: async () => haikuOut,
        })
      ).signals,
    );
    for (let i = 0; i < 10; i++) {
      const next = JSON.stringify(
        (
          await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
            haikuCall: async () => haikuOut,
          })
        ).signals,
      );
      expect(next).toBe(first);
    }
  });
});

// ─── 4. fail-soft on Haiku error ────────────────────────────────────────

describe("newsletter-adapter · fail-soft", () => {
  test("Haiku throws → empty extraction, classifier_used='none'", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => {
        throw new Error("503 Service Unavailable");
      },
    });
    expect(r.signals).toEqual([]);
    expect(r.classifier_used).toBe("none");
  });

  test("Haiku returns non-object → empty extraction, classifier_used='haiku'", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => "garbage string",
    });
    expect(r.signals).toEqual([]);
    // classifier_used stays 'haiku' because the call succeeded — just
    // produced unparseable data. Distinct from the throw path so audit
    // counts separate "tried but garbage" from "couldn't try".
    expect(r.classifier_used).toBe("haiku");
  });

  test("body shorter than 50 chars → empty extraction, no Haiku call", async () => {
    const haikuMock = vi.fn();
    const r = await classifyNewsletter(
      mkEmail({ text_body: "tiny" }),
      [HELIOS],
      PUBLISHER,
      { haikuCall: haikuMock },
    );
    expect(r.signals).toEqual([]);
    expect(haikuMock).not.toHaveBeenCalled();
  });
});

// ─── 5. account matching still works post-refactor ──────────────────────

describe("newsletter-adapter · account matching", () => {
  test("mention matching account name → signal pinned to account, matched++", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => ({
        items: [
          {
            mention: "Helios Manufacturing",
            type: "leadership_change",
            summary: "Helios named a new CFO.",
            workspace_relevance: "high",
          },
        ],
      }),
    });
    expect(r.matched).toBe(1);
    expect(r.workspace).toBe(0);
    expect(r.signals[0].account_id).toBe("acc_helios");
  });

  test("mention not matching any account → signal pinned to workspace sentinel", async () => {
    const r = await classifyNewsletter(mkEmail(), [HELIOS], PUBLISHER, {
      haikuCall: async () => ({
        items: [
          {
            mention: "RandomCo",
            type: "product_launch",
            summary: "RandomCo did a thing.",
            workspace_relevance: "low",
          },
        ],
      }),
    });
    expect(r.matched).toBe(0);
    expect(r.workspace).toBe(1);
    expect(r.signals[0].account_id).toBe("__workspace__");
  });
});

// Suppress noisy console.warn from expected fail-soft paths.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
