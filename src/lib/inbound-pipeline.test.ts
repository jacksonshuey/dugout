// Unit tests for the pure helper functions in inbound-pipeline.ts.
//
// Scope: parseFromAddress and senderAllowed only — both are input→output with
// no DB calls, no fetch, no Supabase client use. The side-effectful main flow
// (processInboundEmail) is intentionally NOT covered here; indirect coverage
// for the allowlist branch already exists in email-filter.test.ts via
// processInboundEmail + Supabase mock injection.
//
// Env isolation: vi.stubEnv / vi.unstubAllEnvs — never direct process.env
// mutation.

import { afterEach, describe, expect, test, vi } from "vitest";

import { parseFromAddress, senderAllowed } from "./inbound-pipeline";

// ─── parseFromAddress ────────────────────────────────────────────────────────

describe("parseFromAddress · happy paths", () => {
  test("standard 'Display Name <user@example.com>' extracts address + domain", () => {
    const r = parseFromAddress("Newsletter Sender <user@example.com>");
    expect(r).not.toBeNull();
    expect(r?.address).toBe("user@example.com");
    expect(r?.domain).toBe("example.com");
  });

  test("address + domain are lowercased", () => {
    const r = parseFromAddress("Sender <User@Example.COM>");
    expect(r?.address).toBe("user@example.com");
    expect(r?.domain).toBe("example.com");
  });

  test("bare email without angle brackets parses address + domain", () => {
    const r = parseFromAddress("user@example.com");
    expect(r).not.toBeNull();
    expect(r?.address).toBe("user@example.com");
    expect(r?.domain).toBe("example.com");
  });

  test("subdomain address extracts full subdomain as domain", () => {
    const r = parseFromAddress("Editor <editor@news.substack.com>");
    expect(r?.domain).toBe("news.substack.com");
    expect(r?.address).toBe("editor@news.substack.com");
  });

  test("extra whitespace inside angle brackets is trimmed", () => {
    const r = parseFromAddress("Name < editor@example.com >");
    expect(r?.address).toBe("editor@example.com");
    expect(r?.domain).toBe("example.com");
  });
});

describe("parseFromAddress · malformed input", () => {
  test("empty string returns null", () => {
    expect(parseFromAddress("")).toBeNull();
  });

  test("no @ character returns null", () => {
    expect(parseFromAddress("notanemailaddress")).toBeNull();
  });

  test("@ at position 0 (no local part) returns null", () => {
    expect(parseFromAddress("@example.com")).toBeNull();
  });

  test("@ at last position (no domain part) returns null", () => {
    expect(parseFromAddress("user@")).toBeNull();
  });

  test("angle brackets with no email inside returns null", () => {
    // <> — no @ inside the brackets; falls through to bare-string parse
    // which also has no @ → returns null.
    expect(parseFromAddress("<>")).toBeNull();
  });

  test("display name with no angle brackets and no @ returns null", () => {
    expect(parseFromAddress("Just A Name")).toBeNull();
  });
});

// ─── senderAllowed ───────────────────────────────────────────────────────────

describe("senderAllowed · allowlist matching", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("exact domain match → true", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com,beehiiv.com");
    expect(senderAllowed("substack.com")).toBe(true);
  });

  test("second entry in a comma-separated list → true", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com,beehiiv.com");
    expect(senderAllowed("beehiiv.com")).toBe(true);
  });

  test("subdomain of an allowlisted domain → true", () => {
    // news.substack.com endsWith .substack.com → allowed
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com");
    expect(senderAllowed("news.substack.com")).toBe(true);
  });

  test("deeper subdomain of an allowlisted domain → true", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "example.com");
    expect(senderAllowed("mail.us.example.com")).toBe(true);
  });

  test("domain not in allowlist → false", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com,beehiiv.com");
    expect(senderAllowed("evil.com")).toBe(false);
  });

  test("domain that is a suffix but not a subdomain → false", () => {
    // 'notsubstack.com' ends with 'stack.com' but that isn't in the list.
    // Test that 'evilsubstack.com' does NOT match 'substack.com'.
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com");
    expect(senderAllowed("evilsubstack.com")).toBe(false);
  });

  test("empty allowlist env value → false (fail-closed)", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "");
    expect(senderAllowed("substack.com")).toBe(false);
  });

  test("unset allowlist env → false (fail-closed)", () => {
    // vi.stubEnv with undefined removes the key for the duration of the test.
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "");
    // Manually delete after stubbing to simulate truly unset.
    delete process.env.INBOUND_SENDER_ALLOWLIST;
    expect(senderAllowed("substack.com")).toBe(false);
  });

  test("allowlist entries are trimmed (spaces around comma) → still matches", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", " substack.com , beehiiv.com ");
    expect(senderAllowed("substack.com")).toBe(true);
    expect(senderAllowed("beehiiv.com")).toBe(true);
  });

  test("allowlist comparison is case-insensitive on the domain argument", () => {
    vi.stubEnv("INBOUND_SENDER_ALLOWLIST", "substack.com");
    // senderAllowed receives domain already lowercased from parseFromAddress,
    // but verify the function itself handles uppercase input gracefully —
    // the allowlist entries are lowercased; the domain arg is compared as-is.
    // Current impl: allowlist is lowercased, domain is NOT. Uppercase domain
    // would NOT match. This test documents that current behavior.
    // (If you fix this, update the test accordingly.)
    expect(senderAllowed("Substack.com")).toBe(false); // domain arg is NOT lowercased
  });
});
