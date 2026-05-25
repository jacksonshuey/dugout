// Tests for the shared workspace_relevance contract. These guard against
// silent drift on the four-tier enum, the JSON-schema fragment, and the
// validator helper — all three are reused across every Haiku call site
// (newsletter-adapter, web-scrape-classifier, email-filter, news-filter).

import { describe, expect, test } from "vitest";
import {
  WORKSPACE_RELEVANCE_DEFINITION,
  WORKSPACE_RELEVANCE_TOOL_PROPERTY,
  WORKSPACE_RELEVANCE_VALUES,
  coerceWorkspaceRelevance,
} from "./workspace-relevance";

describe("workspace-relevance · enum + schema", () => {
  test("exactly four canonical tier values in stable order", () => {
    expect(WORKSPACE_RELEVANCE_VALUES).toEqual([
      "high",
      "medium",
      "low",
      "none",
    ]);
  });

  test("tool-use property fragment lists the same four values", () => {
    expect(WORKSPACE_RELEVANCE_TOOL_PROPERTY.type).toBe("string");
    expect(WORKSPACE_RELEVANCE_TOOL_PROPERTY.enum).toEqual([
      "high",
      "medium",
      "low",
      "none",
    ]);
  });

  test("definition prose references every tier by quoted label", () => {
    for (const tier of WORKSPACE_RELEVANCE_VALUES) {
      expect(WORKSPACE_RELEVANCE_DEFINITION).toContain(`"${tier}"`);
    }
  });

  test("definition prose calls out tech_ai-specific examples (Checkbox primary vertical)", () => {
    // Spot-check a handful of the AI-topic anchors. If these drift, the
    // ranker's AI-topic bonus rubric and the classifier prompts will fall
    // out of sync. We collapse internal whitespace before matching so
    // template-literal line wraps don't make these assertions brittle.
    const flat = WORKSPACE_RELEVANCE_DEFINITION.replace(/\s+/g, " ");
    for (const anchor of [
      "tech_ai",
      "frontier model",
      "AI infra funding",
      "foundation-model",
    ]) {
      expect(flat).toContain(anchor);
    }
  });
});

describe("workspace-relevance · coerceWorkspaceRelevance", () => {
  test("accepts every canonical value", () => {
    for (const v of WORKSPACE_RELEVANCE_VALUES) {
      expect(coerceWorkspaceRelevance(v)).toBe(v);
    }
  });

  test("rejects non-canonical strings", () => {
    expect(coerceWorkspaceRelevance("critical")).toBeNull();
    expect(coerceWorkspaceRelevance("HIGH")).toBeNull(); // case-sensitive
    expect(coerceWorkspaceRelevance("")).toBeNull();
  });

  test("rejects non-string inputs", () => {
    expect(coerceWorkspaceRelevance(null)).toBeNull();
    expect(coerceWorkspaceRelevance(undefined)).toBeNull();
    expect(coerceWorkspaceRelevance(1)).toBeNull();
    expect(coerceWorkspaceRelevance({})).toBeNull();
  });
});
