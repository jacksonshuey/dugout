import { describe, test, expect } from "vitest";
import { generateAccountId } from "./account-id";

describe("generateAccountId", () => {
  test("simple name", () => {
    expect(generateAccountId("SAP")).toBe("acc_sap");
  });

  // Note: existing seed accounts use hand-coded short IDs (acc_adi, acc_ccep,
  // acc_woolworths, acc_hitachi) chosen for readability. The generator emits
  // longer slugs based on the full company name. For future seed additions,
  // either match the existing short-slug convention by hand or let the
  // generator produce the longer form. For production-onboarded accounts,
  // Supabase mints a UUID via gen_random_uuid() and this helper isn't used.
  test("emits longer-form slugs from full company names", () => {
    expect(generateAccountId("SAP")).toBe("acc_sap");
    expect(generateAccountId("Analog Devices")).toBe("acc_analog_devices");
    expect(generateAccountId("Coca-Cola Europacific Partners")).toBe(
      "acc_coca_cola_europacific_partners",
    );
    expect(generateAccountId("Woolworths Group")).toBe("acc_woolworths_group");
    expect(generateAccountId("Hitachi Digital")).toBe("acc_hitachi_digital");
  });

  test("collapses ampersands and punctuation", () => {
    expect(generateAccountId("KKR & Co.")).toBe("acc_kkr_co");
    expect(generateAccountId("AT&T, Inc.")).toBe("acc_at_t_inc");
  });

  test("strips diacritics", () => {
    expect(generateAccountId("Société Générale")).toBe("acc_societe_generale");
    expect(generateAccountId("Nestlé")).toBe("acc_nestle");
  });

  test("caps slug length to keep DB columns sane", () => {
    const long = generateAccountId(
      "Some Absurdly Long Company Name Limited Group Holdings International",
    );
    expect(long.length).toBeLessThanOrEqual(4 + 30); // "acc_" + 30
  });

  test("trims trailing underscore after slicing", () => {
    // Length tuned so the cut would land mid-separator
    const id = generateAccountId(
      "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Bbb",
    );
    expect(id).not.toMatch(/_$/);
  });

  test("throws on names with no alphanumerics", () => {
    expect(() => generateAccountId("   ")).toThrow();
    expect(() => generateAccountId("---")).toThrow();
  });

  test("idempotent for already-clean slugs", () => {
    const first = generateAccountId("Stripe");
    const second = generateAccountId(first.replace(/^acc_/, ""));
    expect(first).toBe(second);
  });
});
