// Unit tests for the PURE helpers in granola-adapter.ts.
//
// Scope: extractDomain, collectAllEmails, internalDomains, isInternalOnly,
//        buildMatchIndex, matchNoteToAccount.
//
// IO-touching code (Supabase, Granola client, classifyMeeting) is
// intentionally OUT OF SCOPE — those need integration tests with mocked
// clients. No vi.mock usage here.

import { describe, expect, test } from "vitest";
import type { GranolaNote } from "./granola-client";
import type { Account } from "./types";
import {
  extractDomain,
  collectAllEmails,
  internalDomains,
  isInternalOnly,
  buildMatchIndex,
  matchNoteToAccount,
} from "./granola-adapter";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkNote(overrides: Partial<GranolaNote> = {}): GranolaNote {
  return {
    id: overrides.id ?? "note_1",
    object: "note",
    title: overrides.title ?? null,
    owner: overrides.owner ?? { name: "Alice Rep", email: "alice@acme.com" },
    created_at: overrides.created_at ?? "2026-05-01T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-01T10:00:00.000Z",
    web_url: overrides.web_url ?? "https://granola.so/note/note_1",
    calendar_event: overrides.calendar_event !== undefined
      ? overrides.calendar_event
      : null,
    attendees: overrides.attendees ?? [],
    folder_membership: overrides.folder_membership ?? [],
    summary_text: overrides.summary_text ?? "",
    summary_markdown: overrides.summary_markdown ?? null,
    transcript: overrides.transcript ?? null,
  };
}

function mkAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? "acc_1",
    name: overrides.name ?? "Stripe",
    industry: overrides.industry ?? "SaaS",
    segment: overrides.segment ?? "Enterprise",
    hqLocation: overrides.hqLocation ?? "San Francisco, CA",
    legalTeamSize: overrides.legalTeamSize ?? 10,
    domain: overrides.domain,
    website: overrides.website,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractDomain
// ---------------------------------------------------------------------------

describe("extractDomain", () => {
  test("happy path — standard email", () => {
    expect(extractDomain("alice@acme.com")).toBe("acme.com");
  });

  test("lowercases the domain", () => {
    expect(extractDomain("Alice@ACME.COM")).toBe("acme.com");
  });

  test("trims whitespace from domain", () => {
    expect(extractDomain("alice@ acme.com ")).toBe("acme.com");
  });

  test("subdomain preserved as-is", () => {
    expect(extractDomain("user@mail.stripe.com")).toBe("mail.stripe.com");
  });

  test("empty string returns null", () => {
    expect(extractDomain("")).toBeNull();
  });

  test("no @ sign returns null", () => {
    expect(extractDomain("notanemail")).toBeNull();
  });

  test("trailing @ (nothing after @) returns null", () => {
    expect(extractDomain("user@")).toBeNull();
  });

  test("@ at position 0 with nothing after returns null", () => {
    expect(extractDomain("@")).toBeNull();
  });

  test("@ at position 0 with domain returns domain", () => {
    // Edge: local part is empty but domain is present
    expect(extractDomain("@example.com")).toBe("example.com");
  });

  test("multiple @ signs — takes domain after first @", () => {
    // indexOf('@') finds the first one; everything after is the domain
    expect(extractDomain("a@b@c.com")).toBe("b@c.com");
  });
});

// ---------------------------------------------------------------------------
// collectAllEmails
// ---------------------------------------------------------------------------

describe("collectAllEmails", () => {
  test("returns attendee emails", () => {
    const note = mkNote({
      attendees: [
        { name: "Bob", email: "bob@stripe.com" },
        { name: "Alice", email: "alice@acme.com" },
      ],
    });
    const emails = collectAllEmails(note);
    expect(emails).toContain("bob@stripe.com");
    expect(emails).toContain("alice@acme.com");
    expect(emails.length).toBe(2);
  });

  test("lowercases all emails", () => {
    const note = mkNote({
      attendees: [{ name: "Bob", email: "Bob@Stripe.COM" }],
    });
    const emails = collectAllEmails(note);
    expect(emails).toContain("bob@stripe.com");
  });

  test("deduplicates overlapping attendee + invitee emails", () => {
    const note = mkNote({
      attendees: [{ name: "Bob", email: "bob@stripe.com" }],
      calendar_event: {
        event_title: "Discovery call",
        organiser: null,
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [{ email: "bob@stripe.com" }],
      },
    });
    const emails = collectAllEmails(note);
    expect(emails.filter((e) => e === "bob@stripe.com").length).toBe(1);
  });

  test("includes organiser email when present", () => {
    const note = mkNote({
      calendar_event: {
        event_title: "Kickoff",
        organiser: "organiser@vendor.com",
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [],
      },
    });
    const emails = collectAllEmails(note);
    expect(emails).toContain("organiser@vendor.com");
  });

  test("returns empty array when no attendees and no calendar_event", () => {
    const note = mkNote({ attendees: [] });
    expect(collectAllEmails(note)).toEqual([]);
  });

  test("skips attendees with falsy email", () => {
    const note = mkNote({
      // Type requires string, but runtime Granola data can have blanks; cast.
      attendees: [{ name: "Unknown", email: "" } as { name: string | null; email: string }],
    });
    // The loop does `if (a.email)`, so blank string won't be added.
    const emails = collectAllEmails(note);
    expect(emails).not.toContain("");
  });
});

// ---------------------------------------------------------------------------
// internalDomains
// ---------------------------------------------------------------------------

describe("internalDomains", () => {
  test("returns owner domain", () => {
    const note = mkNote({ owner: { name: "Alice", email: "alice@acme.com" } });
    expect(internalDomains(note)).toContain("acme.com");
  });

  test("includes organiser domain when present and different", () => {
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      calendar_event: {
        event_title: "Meeting",
        organiser: "org@internal-tools.io",
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [],
      },
    });
    const domains = internalDomains(note);
    expect(domains).toContain("acme.com");
    expect(domains).toContain("internal-tools.io");
  });

  test("deduplicates when owner and organiser share the same domain", () => {
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      calendar_event: {
        event_title: "Team standup",
        organiser: "manager@acme.com",
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [],
      },
    });
    const domains = internalDomains(note);
    expect(domains.filter((d) => d === "acme.com").length).toBe(1);
  });

  test("returns empty array when owner email has no domain", () => {
    const note = mkNote({
      owner: { name: "Nobody", email: "nodomain" },
    });
    expect(internalDomains(note)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isInternalOnly
// ---------------------------------------------------------------------------

describe("isInternalOnly", () => {
  test("returns true when all attendees share the owner domain", () => {
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Bob", email: "bob@acme.com" },
        { name: "Carol", email: "carol@acme.com" },
      ],
    });
    expect(isInternalOnly(note)).toBe(true);
  });

  test("returns false when any attendee is external", () => {
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Bob", email: "bob@acme.com" },
        { name: "Vendor", email: "vendor@stripe.com" },
      ],
    });
    expect(isInternalOnly(note)).toBe(false);
  });

  test("returns true when attendees list is empty (no meetings to extract)", () => {
    const note = mkNote({ attendees: [] });
    expect(isInternalOnly(note)).toBe(true);
  });

  test("returns false when owner domain is unknown (empty string email)", () => {
    // When internalDomains returns [] and emails is non-empty, returns false
    const note = mkNote({
      owner: { name: "Nobody", email: "nodomain" },
      attendees: [{ name: "External", email: "ext@stripe.com" }],
    });
    expect(isInternalOnly(note)).toBe(false);
  });

  test("handles multi-domain internal roster correctly", () => {
    // Both acme.com and internal-tools.io are internal
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      calendar_event: {
        event_title: "Cross-team sync",
        organiser: "manager@internal-tools.io",
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [{ email: "ops@internal-tools.io" }],
      },
      attendees: [{ name: "Bob", email: "bob@acme.com" }],
    });
    expect(isInternalOnly(note)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMatchIndex
// ---------------------------------------------------------------------------

describe("buildMatchIndex", () => {
  test("indexes accounts by domain (lowercased)", () => {
    const stripe = mkAccount({ id: "acc_stripe", name: "Stripe", domain: "stripe.com" });
    const index = buildMatchIndex([stripe]);
    expect(index.byDomain.get("stripe.com")).toBe(stripe);
  });

  test("domain lookup is case-insensitive (stored lowercase)", () => {
    const acct = mkAccount({ domain: "Stripe.COM" });
    const index = buildMatchIndex([acct]);
    expect(index.byDomain.has("stripe.com")).toBe(true);
  });

  test("account without domain is not in byDomain", () => {
    const acct = mkAccount({ name: "No Domain Corp", domain: undefined });
    const index = buildMatchIndex([acct]);
    expect(index.byDomain.size).toBe(0);
  });

  test("byNameLower entries are sorted longest-first", () => {
    const kkr = mkAccount({ name: "KKR" });
    const kkrCo = mkAccount({ name: "KKR & Co." });
    const index = buildMatchIndex([kkr, kkrCo]);
    expect(index.byNameLower[0].name.length).toBeGreaterThan(
      index.byNameLower[1].name.length,
    );
  });

  test("empty accounts array returns empty index", () => {
    const index = buildMatchIndex([]);
    expect(index.byDomain.size).toBe(0);
    expect(index.byNameLower.length).toBe(0);
  });

  test("multiple accounts indexed independently", () => {
    const stripe = mkAccount({ id: "acc_stripe", name: "Stripe", domain: "stripe.com" });
    const openai = mkAccount({ id: "acc_openai", name: "OpenAI", domain: "openai.com" });
    const index = buildMatchIndex([stripe, openai]);
    expect(index.byDomain.size).toBe(2);
    expect(index.byDomain.get("stripe.com")).toBe(stripe);
    expect(index.byDomain.get("openai.com")).toBe(openai);
  });
});

// ---------------------------------------------------------------------------
// matchNoteToAccount
// ---------------------------------------------------------------------------

describe("matchNoteToAccount · domain matching", () => {
  test("external attendee domain matches known account → matched via domain", () => {
    const stripe = mkAccount({ id: "acc_stripe", name: "Stripe", domain: "stripe.com" });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Alice", email: "alice@acme.com" },
        { name: "Bob", email: "bob@stripe.com" },
      ],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.account).toBe(stripe);
      expect(result.via).toBe("domain");
    }
  });

  test("internal attendees only (no external domain) → unmatched no_external_domain", () => {
    const stripe = mkAccount({ domain: "stripe.com" });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Alice", email: "alice@acme.com" },
        { name: "Bob", email: "bob@acme.com" },
      ],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("unmatched");
    if (result.kind === "unmatched") {
      expect(result.reason).toBe("no_external_domain");
    }
  });

  test("external domain not in index → unmatched domain_unknown", () => {
    const stripe = mkAccount({ domain: "stripe.com" });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Alice", email: "alice@acme.com" },
        { name: "Unknown", email: "person@unknown-vendor.io" },
      ],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("unmatched");
    if (result.kind === "unmatched") {
      expect(result.reason).toBe("domain_unknown");
    }
  });
});

describe("matchNoteToAccount · title matching", () => {
  test("no domain match but account name in note title → matched via title", () => {
    const stripe = mkAccount({ id: "acc_stripe", name: "Stripe", domain: undefined });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      title: "Stripe contract review",
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [
        { name: "Alice", email: "alice@acme.com" },
        { name: "Bob", email: "bob@unknown.io" },
      ],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.account).toBe(stripe);
      expect(result.via).toBe("title");
    }
  });

  test("title match uses calendar_event.event_title as fallback when note.title is null", () => {
    const openai = mkAccount({ name: "OpenAI", domain: undefined });
    const index = buildMatchIndex([openai]);
    const note = mkNote({
      title: null,
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [{ name: "Vendor", email: "vendor@unknown.io" }],
      calendar_event: {
        event_title: "OpenAI partnership sync",
        organiser: null,
        calendar_event_id: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        invitees: [],
      },
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.via).toBe("title");
    }
  });

  test("partial word inside a longer word does NOT match (word-boundary heuristic)", () => {
    // "ups" should not match a title like "upside-down" or "disruption"
    const ups = mkAccount({ name: "ups", domain: undefined });
    const index = buildMatchIndex([ups]);
    const note = mkNote({
      title: "Quarterly disruption analysis",
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [{ name: "Bob", email: "bob@other.io" }],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("unmatched");
  });

  test("domain match wins over title match for same account", () => {
    // Both mechanisms point to stripe, but result should come via domain
    const stripe = mkAccount({ name: "Stripe", domain: "stripe.com" });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      title: "Stripe renewal discussion",
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [{ name: "Bob", email: "bob@stripe.com" }],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      // Domain check runs first
      expect(result.via).toBe("domain");
    }
  });

  test("empty title skips title matching and returns unmatched", () => {
    const stripe = mkAccount({ name: "Stripe", domain: undefined });
    const index = buildMatchIndex([stripe]);
    const note = mkNote({
      title: null,
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [{ name: "Bob", email: "bob@unknown.io" }],
      // No calendar_event either
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("unmatched");
  });

  test("longest account name wins over shorter partial name (longest-first sort)", () => {
    const kkr = mkAccount({ id: "kkr_short", name: "KKR", domain: undefined });
    const kkrCo = mkAccount({ id: "kkr_long", name: "KKR & Co.", domain: undefined });
    const index = buildMatchIndex([kkr, kkrCo]);
    // Title contains the full "KKR & Co." — the longest-name candidate wins
    const note = mkNote({
      title: "KKR & Co. legal team introduction",
      owner: { name: "Alice", email: "alice@acme.com" },
      attendees: [{ name: "Bob", email: "bob@unknown.io" }],
    });
    const result = matchNoteToAccount(note, index);
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.account.id).toBe("kkr_long");
    }
  });
});
