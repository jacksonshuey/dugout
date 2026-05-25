import { describe, test, expect } from "vitest";
import { createAccountSeed } from "./account-onboarding";

const BASE_INPUT = {
  name: "Acme Logistics",
  industry: "Logistics" as const,
  segment: "Enterprise" as const,
  hqLocation: "New York, NY",
  legalTeamSize: 50,
  oppName: "Acme - Legal Intake Front Door",
  ownerId: "rep_sc",
  stage: "Qualified" as const,
  amount: 200000,
  enteredStageAt: "2026-05-01",
  createdAt: "2026-04-15",
  closeDate: "2026-07-30",
  champion: { name: "Jane Doe", title: "VP Legal" },
};

describe("createAccountSeed", () => {
  test("happy path: produces account, opportunity, single champion contact, no activities", () => {
    const bundle = createAccountSeed(BASE_INPUT);

    expect(bundle.account.id).toBe("acc_acme_logistics");
    expect(bundle.account.name).toBe("Acme Logistics");
    expect(bundle.opportunity.id).toBe("opp_acme_logistics");
    expect(bundle.opportunity.accountId).toBe("acc_acme_logistics");
    expect(bundle.contacts).toHaveLength(1);
    expect(bundle.contacts[0].role).toBe("Champion");
    expect(bundle.contacts[0].id).toBe("c_acme_logistics_1");
    expect(bundle.activities).toHaveLength(0);
  });

  test("idOverride preserves hand-coded short IDs", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      name: "Coca-Cola Europacific Partners",
      idOverride: "acc_ccep" as ReturnType<
        typeof createAccountSeed
      >["account"]["id"],
    });

    expect(bundle.account.id).toBe("acc_ccep");
    expect(bundle.opportunity.id).toBe("opp_ccep");
    expect(bundle.contacts[0].id).toBe("c_ccep_1");
  });

  test("additionalContacts are numbered from 2 with stable ids", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      additionalContacts: [
        { name: "Tomas Berg", title: "Deputy GC", role: "GC" },
        { name: "Aoife Walsh", title: "Finance Dir", role: "Finance/CFO" },
      ],
    });

    expect(bundle.contacts).toHaveLength(3);
    expect(bundle.contacts[1].id).toBe("c_acme_logistics_2");
    expect(bundle.contacts[1].role).toBe("GC");
    expect(bundle.contacts[2].id).toBe("c_acme_logistics_3");
    expect(bundle.contacts[2].role).toBe("Finance/CFO");
    expect(bundle.opportunity.contactRoleIds).toEqual([
      "c_acme_logistics_1",
      "c_acme_logistics_2",
      "c_acme_logistics_3",
    ]);
  });

  test("activities default contactId to champion, derive sequential ids", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      activities: [
        {
          type: "meeting",
          occurredAt: "2026-05-19",
          summary: "Discovery 2",
        },
        {
          type: "email_received",
          occurredAt: "2026-05-21",
          summary: "Champion confirmed POC",
        },
      ],
    });

    expect(bundle.activities).toHaveLength(2);
    expect(bundle.activities[0].id).toBe("a_acme_logistics_1");
    expect(bundle.activities[0].contactId).toBe("c_acme_logistics_1");
    expect(bundle.activities[0].oppId).toBe("opp_acme_logistics");
    expect(bundle.activities[1].id).toBe("a_acme_logistics_2");
  });

  test("activities can pin contactId explicitly when more than one contact", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      additionalContacts: [{ name: "T", title: "GC", role: "GC" }],
      activities: [
        {
          contactId: "c_acme_logistics_2",
          type: "meeting",
          occurredAt: "2026-05-20",
          summary: "GC sync",
        },
      ],
    });

    expect(bundle.activities[0].contactId).toBe("c_acme_logistics_2");
  });

  test("website defaults to domain when only domain provided", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      domain: "acme-logistics.com",
    });

    expect(bundle.account.domain).toBe("acme-logistics.com");
    expect(bundle.account.website).toBe("acme-logistics.com");
  });

  test("explicit website overrides domain-derived default", () => {
    const bundle = createAccountSeed({
      ...BASE_INPUT,
      domain: "acme-logistics.com",
      website: "https://www.acme-logistics.com/legal",
    });

    expect(bundle.account.website).toBe("https://www.acme-logistics.com/legal");
  });
});
