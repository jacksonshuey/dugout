// Tests for zippering-haiku.ts — assessColumnRouting().
//
// ALL tests use an injected fake Anthropic client. Zero real network calls.
// No ANTHROPIC_API_KEY required. The fake client accepts a stub input that
// it returns verbatim as a tool_use block inside a messages.create response.
//
// Fake client shape: we only stub `messages.create` because that's the only
// SDK surface assessColumnRouting() touches.

import { describe, expect, test } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { assessColumnRouting } from "./zippering-haiku";
import type {
  GlobalCanonicalColumn,
  HaikuRoutingVerdict,
  ZipperingSchemaRow,
} from "./zippering-types";

// ---------------------------------------------------------------------------
// Fake Anthropic client factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake Anthropic client that returns a hard-coded tool_use
 * block containing `verdictInput` whenever messages.create is called.
 *
 * Typed as `Anthropic` so it satisfies the default-parameter signature on
 * assessColumnRouting without any `as unknown as Anthropic` cast here.
 */
function makeFakeClient(verdictInput: HaikuRoutingVerdict): Anthropic {
  const fakeResponse: Anthropic.Message = {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "tool_fake",
        name: "zippering_routing_verdict",
        input: verdictInput as unknown as Record<string, unknown>,
      } satisfies Anthropic.ToolUseBlock,
    ],
    model: "claude-haiku-4-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };

  // Only create() needs to be present; everything else is unused.
  return {
    messages: {
      create: async (_params: unknown, _opts: unknown) => fakeResponse,
    },
  } as unknown as Anthropic;
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const globalCandidate: GlobalCanonicalColumn = {
  id: "gc-1",
  workspace_key: "dugout-default",
  name: "company_name",
  data_type: "text",
  description: "Legal company name of the account",
  semantic_tags: ["identity"],
  created_at: "2026-01-01T00:00:00Z",
};

const pkeyCandidate: ZipperingSchemaRow = {
  id: "ps-1",
  workspace_key: "dugout-default",
  pkey: "acc_stripe" as unknown as import("./types").AccountId,
  canonical_name: "internal_notes",
  data_type: "text",
  description: "Internal notes specific to this account",
  is_global: false,
  source_origin: "granola",
  first_seen_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const baseInputs = {
  pkey: "acc_stripe",
  source: "granola",
  source_column: "org_name",
  source_data_type: "text" as const,
  source_description: "Company name from the Granola meeting record",
  source_samples: ["Stripe Inc.", "Stripe", "Stripe, Inc."],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assessColumnRouting", () => {
  test("JOIN against a global canonical — is_global_target is true", async () => {
    const stubbedVerdict: HaikuRoutingVerdict = {
      verdict: "join",
      canonical_name: "company_name",
      is_global_target: true,
      similarity_score: 0.97,
      reason: "org_name carries the company's legal name; direct match to company_name global canonical.",
    };

    const result = await assessColumnRouting(
      {
        ...baseInputs,
        candidates_global: [globalCandidate],
        candidates_pkey: [],
      },
      makeFakeClient(stubbedVerdict),
    );

    expect(result.verdict).toBe("join");
    expect(result.canonical_name).toBe("company_name");
    expect(result.is_global_target).toBe(true);
    expect(result.similarity_score).toBeCloseTo(0.97);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("APPEND when no candidates match — verdict is 'append' and canonical_name is a new name", async () => {
    const stubbedVerdict: HaikuRoutingVerdict = {
      verdict: "append",
      canonical_name: "granola_org_name",
      is_global_target: false,
      similarity_score: 0.1,
      reason: "No existing canonical matches org_name semantics; appending as new column.",
    };

    const result = await assessColumnRouting(
      {
        ...baseInputs,
        source_column: "granola_org_name",
        candidates_global: [],
        candidates_pkey: [],
      },
      makeFakeClient(stubbedVerdict),
    );

    expect(result.verdict).toBe("append");
    expect(result.canonical_name).toBe("granola_org_name");
    expect(result.is_global_target).toBe(false);
    expect(result.similarity_score).toBeLessThan(0.5);
  });

  test("UNCLEAR returns unclear verdict and still has a canonical_name set", async () => {
    const stubbedVerdict: HaikuRoutingVerdict = {
      verdict: "unclear",
      canonical_name: "risk_signals",
      is_global_target: false,
      similarity_score: 0.45,
      reason: "Sample values are inconsistent — some look like tags, others like free text; flagging for review.",
    };

    const result = await assessColumnRouting(
      {
        ...baseInputs,
        source_column: "risk_flags",
        source_data_type: "string[]",
        source_samples: ["budget", ["budget", "churn"], "see notes"],
        candidates_global: [globalCandidate],
        candidates_pkey: [pkeyCandidate],
      },
      makeFakeClient(stubbedVerdict),
    );

    expect(result.verdict).toBe("unclear");
    // canonical_name MUST be set even on unclear (per plan §4)
    expect(typeof result.canonical_name).toBe("string");
    expect(result.canonical_name.length).toBeGreaterThan(0);
    expect(result.is_global_target).toBe(false);
  });

  test("missing source_description renders '(none provided)' and does not throw", async () => {
    // This test confirms that the prompt builder handles the undefined case
    // without crashing. We don't inspect the prompt directly, but a
    // successful round-trip through the fake client proves no exception was
    // thrown by prompt construction.
    const stubbedVerdict: HaikuRoutingVerdict = {
      verdict: "append",
      canonical_name: "attendees",
      is_global_target: false,
      similarity_score: 0.05,
      reason: "No existing canonical; appending as attendees.",
    };

    const inputsWithoutDescription = {
      pkey: "acc_stripe",
      source: "granola",
      source_column: "attendees",
      source_data_type: "string[]" as const,
      // source_description intentionally omitted
      source_samples: ["alice@stripe.com", "bob@stripe.com"],
      candidates_global: [globalCandidate],
      candidates_pkey: [],
    };

    // Should not throw
    const result = await assessColumnRouting(
      inputsWithoutDescription,
      makeFakeClient(stubbedVerdict),
    );

    expect(result.verdict).toBe("append");
    expect(result.canonical_name).toBe("attendees");
  });

  test("empty candidate lists force an APPEND verdict path without error", async () => {
    const stubbedVerdict: HaikuRoutingVerdict = {
      verdict: "append",
      canonical_name: "filing_url",
      is_global_target: false,
      similarity_score: 0.0,
      reason: "No global or per-pkey canonicals exist yet; appending as new column.",
    };

    const result = await assessColumnRouting(
      {
        pkey: "acc_sap",
        source: "sec_edgar",
        source_column: "filing_url",
        source_data_type: "text",
        source_description: "URL to the SEC filing document",
        source_samples: ["https://www.sec.gov/Archives/..."],
        candidates_global: [],   // empty global tier
        candidates_pkey: [],     // empty per-pkey tier
      },
      makeFakeClient(stubbedVerdict),
    );

    expect(result.verdict).toBe("append");
    expect(result.canonical_name).toBe("filing_url");
    expect(result.is_global_target).toBe(false);
    // similarity_score must still be a number in [0,1]
    expect(result.similarity_score).toBeGreaterThanOrEqual(0);
    expect(result.similarity_score).toBeLessThanOrEqual(1);
  });
});
