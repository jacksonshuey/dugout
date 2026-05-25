import { describe, expect, test } from "vitest";
import { _internal } from "./meeting-prep";
import type { ExternalSignal } from "./external-signals";
import type { Account, Contact, Opportunity } from "./types";

const { mergeBriefFields, buildBuyingCommittee, determineScrapeStatus, tierLabel } =
  _internal;

function makeScrapeSignal(
  briefFields: Record<string, unknown> | null,
  occurredAt: string,
): ExternalSignal {
  return {
    id: `s_${occurredAt}`,
    account_id: "acc_x",
    source: "web_scrape",
    type: "press_release",
    summary: "summary",
    occurred_at: occurredAt,
    url: "https://example.com",
    meta: briefFields ? { brief_fields: briefFields } : null,
    is_demo: false,
    created_at: occurredAt,
  } as ExternalSignal;
}

describe("mergeBriefFields", () => {
  test("returns empty shape when given no signals", () => {
    const out = mergeBriefFields([]);
    expect(out.company_one_liner).toBeNull();
    expect(out.exec_change).toBeNull();
    expect(out.recent_funding).toBeNull();
    expect(out.key_risks).toEqual([]);
    expect(out.strategic_focus).toBeNull();
  });

  test("picks the freshest non-null value per field (signals pre-sorted newest first)", () => {
    const newer = makeScrapeSignal(
      {
        company_one_liner: "Newer one-liner",
        strategic_focus: null,
        key_risks: ["risk-a"],
      },
      "2026-05-20T00:00:00Z",
    );
    const older = makeScrapeSignal(
      {
        company_one_liner: "Older one-liner",
        strategic_focus: "Older focus",
        key_risks: ["risk-b"],
      },
      "2026-05-10T00:00:00Z",
    );
    const merged = mergeBriefFields([newer, older]);
    expect(merged.company_one_liner).toBe("Newer one-liner");
    // strategic_focus null on newer → falls back to older
    expect(merged.strategic_focus).toBe("Older focus");
    // key_risks combine (max 3, dedup by lowercase)
    expect(merged.key_risks).toEqual(["risk-a", "risk-b"]);
  });

  test("caps key_risks at 3", () => {
    const sig = makeScrapeSignal(
      { key_risks: ["a", "b", "c", "d", "e"] },
      "2026-05-20T00:00:00Z",
    );
    const merged = mergeBriefFields([sig]);
    expect(merged.key_risks).toHaveLength(3);
  });
});

describe("buildBuyingCommittee", () => {
  function contact(id: string, role: Contact["role"]): Contact {
    return { id, accountId: "acc_x", name: id, title: "", role };
  }

  test("reports gaps for the required roles", () => {
    const champion = contact("c1", "Champion");
    const opp: Opportunity = {
      id: "opp_x",
      accountId: "acc_x",
      name: "Test",
      ownerId: "r",
      stage: "Selected Vendor",
      amount: 100,
      enteredStageAt: "2026-05-01",
      createdAt: "2026-04-01",
      closeDate: "2026-08-01",
      contactRoleIds: [champion.id],
    };
    const result = buildBuyingCommittee(opp, [champion]);
    expect(result.mapped).toBe(1);
    expect(result.gaps).toContain("Finance");
    expect(result.gaps).toContain("IT/Security");
    expect(result.gaps).not.toContain("Champion");
  });

  test("returns empty gaps when all required roles are on the OCR", () => {
    const cs: Contact[] = [
      contact("c1", "Champion"),
      contact("c2", "Executive Sponsor"),
      contact("c3", "Finance/CFO"),
      contact("c4", "IT/Security"),
      contact("c5", "GC"),
      contact("c6", "Procurement"),
    ];
    const opp: Opportunity = {
      id: "opp_x",
      accountId: "acc_x",
      name: "Test",
      ownerId: "r",
      stage: "Selected Vendor",
      amount: 100,
      enteredStageAt: "2026-05-01",
      createdAt: "2026-04-01",
      closeDate: "2026-08-01",
      contactRoleIds: cs.map((c) => c.id),
    };
    const result = buildBuyingCommittee(opp, cs);
    expect(result.mapped).toBe(6);
    expect(result.gaps).toEqual([]);
  });

  test("returns zero gaps when there is no lead opportunity", () => {
    const result = buildBuyingCommittee(null, [contact("c1", "Champion")]);
    expect(result.gaps).toEqual([]);
    expect(result.mapped).toBe(1);
  });
});

describe("determineScrapeStatus", () => {
  const now = Date.parse("2026-05-21T12:00:00Z");
  const accountWithSite: Account = {
    id: "a",
    name: "Test",
    industry: "SaaS",
    segment: "Enterprise",
    hqLocation: "",
    legalTeamSize: 0,
    website: "test.com",
  };
  const accountNoSite: Account = { ...accountWithSite, website: undefined };

  test("missing when account has no website", () => {
    expect(determineScrapeStatus(accountNoSite, null, now)).toBe("missing");
  });

  test("pending when account has website but no scrape yet", () => {
    expect(determineScrapeStatus(accountWithSite, null, now)).toBe("pending");
  });

  test("fresh when last scrape was <24h ago", () => {
    const lastCrawled = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    expect(determineScrapeStatus(accountWithSite, lastCrawled, now)).toBe(
      "fresh",
    );
  });

  test("stale when last scrape was >24h but <7d ago", () => {
    const lastCrawled = new Date(now - 48 * 60 * 60 * 1000).toISOString();
    expect(determineScrapeStatus(accountWithSite, lastCrawled, now)).toBe(
      "stale",
    );
  });

  test("stale when last scrape was >7d ago", () => {
    const lastCrawled = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(determineScrapeStatus(accountWithSite, lastCrawled, now)).toBe(
      "stale",
    );
  });
});

describe("tierLabel", () => {
  test.each([
    [90, "HEALTHY"],
    [80, "HEALTHY"],
    [79, "WATCH"],
    [60, "WATCH"],
    [59, "CRITICAL"],
    [0, "CRITICAL"],
  ])("score %i → %s", (score, tier) => {
    expect(tierLabel(score)).toBe(tier);
  });
});
