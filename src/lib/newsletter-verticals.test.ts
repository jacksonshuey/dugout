// Tests for the publisher → vertical lookup (F1).
//
// Pure unit tests — no fixtures, no mocks. The map is small enough that we
// just enumerate every canonical and every vertical.

import { describe, expect, it } from "vitest";
import {
  isTechOrAI,
  verticalFor,
  type NewsletterVertical,
} from "./newsletter-verticals";

describe("verticalFor · canonical publishers", () => {
  const cases: Array<[string, NewsletterVertical]> = [
    ["artificial_lawyer", "legal-tech"],
    ["axios_pro_rata", "private-equity"],
    ["brainyacts", "legal-tech"],
    ["cfo_dive", "fintech"],
    ["endpoints_news", "pharma"],
    ["money_stuff", "fintech"],
  ];

  for (const [slug, expected] of cases) {
    it(`maps ${slug} → ${expected}`, () => {
      expect(verticalFor(slug)).toBe(expected);
    });
  }
});

describe("verticalFor · misses", () => {
  it("returns null for an unknown publisher", () => {
    expect(verticalFor("some_unknown_publisher_xyz")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(verticalFor("")).toBeNull();
  });
});

describe("isTechOrAI", () => {
  it("returns true for ai-cross-cutting", () => {
    expect(isTechOrAI("ai-cross-cutting")).toBe(true);
  });

  it("returns true for enterprise-tech", () => {
    expect(isTechOrAI("enterprise-tech")).toBe(true);
  });

  const otherVerticals: NewsletterVertical[] = [
    "legal-tech",
    "fintech",
    "healthcare",
    "insurance",
    "pharma",
    "private-equity",
    "gtm-exec-moves",
  ];

  for (const v of otherVerticals) {
    it(`returns false for ${v}`, () => {
      expect(isTechOrAI(v)).toBe(false);
    });
  }

  it("returns false for null", () => {
    expect(isTechOrAI(null)).toBe(false);
  });
});
