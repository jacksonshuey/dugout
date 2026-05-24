// Tests for the email content filter (Stage 1 deterministic +
// Stage 2 Haiku gate + routing + audit writes).
//
// Design doc: /docs/filter-design.md §10.
//
// Mocks: the Haiku call and the email_filter_decisions Supabase CRUD are
// both injectable via the deps argument on filterEmail() — no vi.mock
// magic needed. Stage 1 tests call runStage1 directly (pure function).

import { describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runStage1,
  MIN_BODY_WORDS,
  MAX_LINK_RATIO,
  MIN_BODY_CHARS_AFTER_STRIP,
  SENDER_ROLE_WEAK_REJECT_WORD_THRESHOLD,
  SUBJECT_REJECT_PATTERNS,
} from "./email-filter-stage1";
import { filterEmail, CONFIDENCE_THRESHOLD } from "./email-filter";
import {
  STAGE2_PROMPT_VERSION,
  getStage2SystemPrompt,
} from "./email-filter-stage2-prompt";
import type {
  FilterInput,
  PublisherInfo,
  Stage2Output,
} from "./email-filter-types";
import type { InboundEmail } from "./inbound-email";

// ─── Fixture helpers ────────────────────────────────────────────────────

function mkEmail(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    id: overrides.id ?? "email_1",
    from_address: overrides.from_address ?? "editor@artificiallawyer.com",
    from_domain: overrides.from_domain ?? "artificiallawyer.com",
    subject: overrides.subject ?? "Newsletter — daily digest of legal AI",
    received_at: overrides.received_at ?? "2026-05-23T12:00:00.000Z",
    text_body:
      overrides.text_body ??
      Array.from({ length: 300 }, (_, i) => `word${i}`).join(" "),
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

const ALWAYS_KNOWN_PUBLISHER: PublisherInfo = {
  publisher_canonical_name: "artificial_lawyer",
  display_name: "Artificial Lawyer",
  is_known: true,
};

function mkInput(
  email: InboundEmail,
  headers: Record<string, string> = {},
): FilterInput {
  return {
    email,
    publisherInfo: ALWAYS_KNOWN_PUBLISHER,
    headers,
    now: new Date("2026-05-23T17:00:00.000Z"),
  };
}

// In-memory audit recorder for tests that assert write counts/content.
function captureAudits() {
  const writes: Array<Record<string, unknown>> = [];
  const fake = {
    from(_t: string) {
      void _t;
      return {
        insert(row: Record<string, unknown>) {
          writes.push(row);
          return {
            select(_cols: string) {
              void _cols;
              return {
                async single() {
                  return { data: { id: `decision_${writes.length}` }, error: null };
                },
              };
            },
          };
        },
        update(_row: Record<string, unknown>) {
          void _row;
          return {
            eq(_c: string, _v: string) {
              void _c;
              void _v;
              return {
                select(_cols: string) {
                  void _cols;
                  return Promise.resolve({ data: [{ id: "x" }], error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    writes,
    supabase: fake as unknown as SupabaseClient,
  };
}

// ─── 1. stage1_rejects_subject_password_reset ───────────────────────────

describe("runStage1 · subject regex rejects", () => {
  test("password reset subject", () => {
    const r = runStage1(
      mkEmail({ subject: "Reset your password — Brainyacts" }),
    );
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.reason).toBe("subject_pattern");
    expect(r.accepted === false && r.detail).toBe("subject_regex:password_reset");
  });

  // ─── 2. stage1_rejects_subject_welcome_to_your ─────────────────────────
  test("welcome to your X subject", () => {
    const r = runStage1(
      mkEmail({ subject: "Welcome to your Brainyacts subscription" }),
    );
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.detail).toBe("subject_regex:welcome");
  });

  // ─── 3. stage1_does_not_reject_welcome_in_editorial_prose ──────────────
  test("editorial 'Welcome to the AI age' subject is NOT rejected", () => {
    const r = runStage1(
      mkEmail({ subject: "Welcome to the AI age — Brainyacts daily" }),
    );
    expect(r.accepted).toBe(true);
  });

  // Sanity: all 10 patterns are present in the exported list.
  test("exports 10 subject reject patterns", () => {
    expect(SUBJECT_REJECT_PATTERNS.length).toBe(10);
  });
});

// ─── 4. stage1_rejects_billing_sender_role ──────────────────────────────

describe("runStage1 · sender role rejects", () => {
  test("billing@ hard reject regardless of body", () => {
    const r = runStage1(
      mkEmail({
        from_address: "billing@example.com",
        from_domain: "example.com",
      }),
    );
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.reason).toBe("sender_role");
    expect(r.accepted === false && r.detail).toBe("local_part:billing");
  });

  // ─── 5. stage1_rejects_noreply_only_with_thin_body ─────────────────────
  test("noreply@ + thin body rejects; noreply@ + long body accepts", () => {
    // Long body — 600 words — should pass.
    const longBody = Array.from({ length: 600 }, (_, i) => `word${i}`).join(" ");
    const okEmail = mkEmail({
      from_address: "noreply@substack.com",
      from_domain: "substack.com",
      text_body: longBody,
    });
    const ok = runStage1(okEmail);
    expect(ok.accepted).toBe(true);

    // Short body — 100 words — should reject under SENDER_ROLE_WEAK threshold.
    const shortBody = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    // Need body to pass MIN_BODY_WORDS check first, but 100 < 200 will hit
    // body_thin_or_link_only BEFORE sender_role. Test the boundary: a body
    // just above MIN_BODY_WORDS (220 words) + noreply@ should still reject
    // because 220 < SENDER_ROLE_WEAK_REJECT_WORD_THRESHOLD (400).
    void shortBody;
    const borderlineBody = Array.from(
      { length: 220 },
      (_, i) => `word${i}`,
    ).join(" ");
    const reject = runStage1(
      mkEmail({
        from_address: "noreply@example.com",
        from_domain: "example.com",
        text_body: borderlineBody,
      }),
    );
    expect(reject.accepted).toBe(false);
    expect(reject.accepted === false && reject.reason).toBe("sender_role");
  });
});

// ─── 6. stage1_rejects_thin_body ────────────────────────────────────────

describe("runStage1 · body stats rejects", () => {
  test("body under MIN_BODY_WORDS is rejected", () => {
    const body = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
    const r = runStage1(mkEmail({ text_body: body }));
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.reason).toBe("body_thin_or_link_only");
    expect(r.accepted === false && r.detail).toContain(`< ${MIN_BODY_WORDS}`);
  });

  // ─── 7. stage1_rejects_link_farm_body ──────────────────────────────────
  test("link-farm body (linkRatio > MAX_LINK_RATIO) is rejected", () => {
    // Construct HTML where anchor text dominates visible chars.
    const plain = "x y";
    const html =
      "<a>" + "a".repeat(1000) + "</a>" + "<a>" + "b".repeat(1000) + "</a>";
    const r = runStage1(
      mkEmail({
        // Make plaintext short so the ratio is high. But we still need
        // word_count >= MIN_BODY_WORDS to reach the link-ratio check, so
        // build a separate text body that's word-count-rich.
        text_body: Array.from(
          { length: 300 },
          (_, i) => `tok${i}`,
        ).join(" "),
        // The link-ratio check reads html_body for anchor chars and
        // plaintext for visible chars. We want anchor_chars / plaintext > 0.9
        // Make plaintext relatively short by going through html_body path:
        // setting text_body keeps it as the body, so the html anchor count
        // gets divided by the much-longer plaintext. Instead force the html
        // path by making text_body very short — but then MIN_BODY_WORDS
        // gates it. Solve: leave a moderate text body (300 words ~ 1700
        // chars) and make html anchor chars dwarf it.
        html_body: html,
      }),
    );
    void plain;
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.reason).toBe("body_thin_or_link_only");
    expect(r.accepted === false && r.detail).toContain("link_ratio");
    expect(MAX_LINK_RATIO).toBe(0.9);
  });

  // ─── 8. stage1_rejects_only_unsub_links ────────────────────────────────
  test("HTML with only unsubscribe-style anchors is rejected", () => {
    const html =
      '<a href="https://x.com/unsubscribe">Unsubscribe</a>' +
      '<a href="https://x.com/preferences">Email preferences</a>' +
      '<a href="https://x.com/manage-subscription">Manage subscription</a>';
    const r = runStage1(
      mkEmail({
        text_body: Array.from(
          { length: 300 },
          (_, i) => `tok${i}`,
        ).join(" "),
        html_body: html,
      }),
    );
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.detail).toBe("only_unsub_links");
  });
});

// ─── 9. stage1_rejects_auto_reply_header ────────────────────────────────

describe("runStage1 · auto-reply + bounce header rejects", () => {
  test("Auto-Submitted: auto-replied rejects", () => {
    const r = runStage1(mkEmail(), { "Auto-Submitted": "auto-replied" });
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.detail).toBe("auto_submitted");
  });

  test("Auto-Submitted: no does NOT reject (RFC-3834)", () => {
    const r = runStage1(mkEmail(), { "Auto-Submitted": "no" });
    expect(r.accepted).toBe(true);
  });

  // ─── 10. stage1_rejects_bounce_header ──────────────────────────────────
  test("X-Failed-Recipients header rejects", () => {
    const r = runStage1(mkEmail(), {
      "X-Failed-Recipients": "foo@bar.com",
    });
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.detail).toBe(
      "bounce_header:x-failed-recipients",
    );
  });
});

// ─── 11. stage1_rejects_calendar_attachment ─────────────────────────────

describe("runStage1 · calendar attachment", () => {
  test("Content-Type containing text/calendar rejects", () => {
    const r = runStage1(mkEmail(), {
      "Content-Type": "text/calendar; method=REQUEST",
    });
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.detail).toBe("ics_attachment");
  });
});

// ─── 12. stage1_rejects_empty_body ──────────────────────────────────────

describe("runStage1 · empty body", () => {
  test("body under MIN_BODY_CHARS_AFTER_STRIP rejects with body_chars detail", () => {
    const r = runStage1(mkEmail({ text_body: "tiny", html_body: null }));
    expect(r.accepted).toBe(false);
    expect(r.accepted === false && r.reason).toBe("empty_body");
    expect(r.accepted === false && r.detail).toBe("body_chars=4");
    expect(MIN_BODY_CHARS_AFTER_STRIP).toBe(50);
  });
});

// Magic-number sanity (so silent constant changes break tests).
describe("Stage 1 exported constants", () => {
  test("threshold constants have expected values", () => {
    expect(MIN_BODY_WORDS).toBe(200);
    expect(MAX_LINK_RATIO).toBe(0.9);
    expect(MIN_BODY_CHARS_AFTER_STRIP).toBe(50);
    expect(SENDER_ROLE_WEAK_REJECT_WORD_THRESHOLD).toBe(400);
  });
});

// ─── 13. stage2_proceeds_on_newsworthy_high_confidence ──────────────────

describe("filterEmail · Stage 2 proceed", () => {
  test("newsworthy + confidence 0.92 → proceed; audit row written", async () => {
    const recorder = captureAudits();
    const stage2Out: Stage2Output = {
      verdict: "newsworthy",
      confidence: 0.92,
      reasoning: "Lead article covers a Fortune 500 reorg with named entities.",
    };
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => stage2Out,
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("proceed");
    expect(r.stage2?.verdict).toBe("newsworthy");
    expect(recorder.writes.length).toBe(1);
    expect(recorder.writes[0].stage).toBe(2);
    expect(recorder.writes[0].verdict).toBe("newsworthy");
    expect(recorder.writes[0].confidence).toBe(0.92);
  });
});

// ─── 14. stage2_routes_low_confidence_to_needs_review ───────────────────

describe("filterEmail · low confidence", () => {
  test("newsworthy + confidence 0.55 → needs_review; audit row preserves actual verdict", async () => {
    const recorder = captureAudits();
    const stage2Out: Stage2Output = {
      verdict: "newsworthy",
      confidence: 0.55,
      reasoning: "Probably editorial but the lead is ambiguous about scope.",
    };
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => stage2Out,
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("needs_review");
    expect(r.stage2_failure).toBe("low_confidence");
    // Important: audit row preserves what the model said, not the routing.
    expect(recorder.writes[0].verdict).toBe("newsworthy");
    expect(recorder.writes[0].confidence).toBe(0.55);
    // Sanity on threshold.
    expect(CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});

// ─── 15. stage2_rejects_promotional_high_confidence ─────────────────────

describe("filterEmail · Stage 2 reject", () => {
  test("promotional + confidence 0.85 → rejected", async () => {
    const recorder = captureAudits();
    const stage2Out: Stage2Output = {
      verdict: "promotional",
      confidence: 0.85,
      reasoning: "Vendor amplifying its own product with a single-vendor pitch.",
    };
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => stage2Out,
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("rejected");
    expect(r.stage2?.verdict).toBe("promotional");
    expect(recorder.writes[0].verdict).toBe("promotional");
  });
});

// ─── 16. fail_closed_on_haiku_5xx ───────────────────────────────────────

class FakeAPIError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

describe("filterEmail · fail-closed paths", () => {
  test("Haiku 5xx → needs_review; audit row carries fail-closed reasoning", async () => {
    const recorder = captureAudits();
    // We can't instantiate Anthropic.APIError directly without the SDK
    // constructor; the classifyError() function falls through to "haiku_5xx"
    // for any non-timeout error, so a plain throw is enough to cover the
    // routing branch. The reasoning string asserts the error message
    // reached the audit row.
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => {
        throw new FakeAPIError(503, "Service unavailable");
      },
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("needs_review");
    expect(r.stage2_failure).toBe("haiku_5xx");
    expect(recorder.writes[0].verdict).toBe("other");
    expect(recorder.writes[0].confidence).toBe(0);
    expect(String(recorder.writes[0].reasoning)).toContain("fail-closed");
  });

  test("missing tool_use block → haiku_malformed_json → needs_review", async () => {
    const recorder = captureAudits();
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => {
        throw new Error("Haiku returned no tool_use block");
      },
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("needs_review");
    expect(r.stage2_failure).toBe("haiku_malformed_json");
    expect(String(recorder.writes[0].reasoning)).toContain("haiku_malformed_json");
  });

  // ─── 17. fail_closed_on_haiku_malformed_json ───────────────────────────
  test("verdict outside enum → haiku_schema_violation → needs_review", async () => {
    const recorder = captureAudits();
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: true,
      haikuCall: async () => ({
        verdict: "unknown_verdict",
        confidence: 0.9,
        reasoning: "This verdict is not in the enum, schema should reject.",
      }),
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("needs_review");
    expect(r.stage2_failure).toBe("haiku_schema_violation");
    expect(String(recorder.writes[0].reasoning)).toContain("haiku_schema_violation");
  });

  test("no_api_key path → needs_review with audit row", async () => {
    const recorder = captureAudits();
    const r = await filterEmail(mkInput(mkEmail()), {
      hasApiKey: false,
      audit: { supabase: recorder.supabase },
    });
    expect(r.decision).toBe("needs_review");
    expect(r.stage2_failure).toBe("no_api_key");
    expect(recorder.writes[0].model).toBeNull();
    expect(recorder.writes[0].reasoning).toBe("no_api_key — Stage 2 skipped");
  });
});

// ─── 18. audit_row_written_on_every_branch ──────────────────────────────

describe("filterEmail · audit row at every branch", () => {
  type Scenario = {
    label: string;
    haikuCall?: () => Promise<unknown>;
    hasApiKey?: boolean;
    email?: Partial<InboundEmail>;
    expectedStage: 1 | 2;
    expectedVerdict: string;
  };

  const SCENARIOS: Scenario[] = [
    {
      label: "stage1_reject",
      email: { subject: "Reset your password" },
      expectedStage: 1,
      expectedVerdict: "stage1_rejected",
    },
    {
      label: "stage2_proceed",
      hasApiKey: true,
      haikuCall: async () => ({
        verdict: "newsworthy",
        confidence: 0.9,
        reasoning: "Lead article looks editorial and timely.",
      }),
      expectedStage: 2,
      expectedVerdict: "newsworthy",
    },
    {
      label: "stage2_reject",
      hasApiKey: true,
      haikuCall: async () => ({
        verdict: "logistics",
        confidence: 0.95,
        reasoning: "Subscription admin only, no editorial substance.",
      }),
      expectedStage: 2,
      expectedVerdict: "logistics",
    },
    {
      label: "low_confidence",
      hasApiKey: true,
      haikuCall: async () => ({
        verdict: "newsworthy",
        confidence: 0.55,
        reasoning: "Ambiguous lead with mixed editorial and promotional cues.",
      }),
      expectedStage: 2,
      expectedVerdict: "newsworthy",
    },
    {
      label: "fail_closed",
      hasApiKey: true,
      haikuCall: async () => {
        throw new FakeAPIError(503, "down");
      },
      expectedStage: 2,
      expectedVerdict: "other",
    },
  ];

  for (const s of SCENARIOS) {
    test(`${s.label}: writes exactly one audit row with stage=${s.expectedStage}`, async () => {
      const recorder = captureAudits();
      await filterEmail(mkInput(mkEmail(s.email)), {
        hasApiKey: s.hasApiKey ?? true,
        haikuCall: s.haikuCall,
        audit: { supabase: recorder.supabase },
      });
      expect(recorder.writes.length).toBe(1);
      expect(recorder.writes[0].stage).toBe(s.expectedStage);
      expect(recorder.writes[0].verdict).toBe(s.expectedVerdict);
    });
  }
});

// ─── 23. stage2_prompt_enumerates_all_four_verdicts ─────────────────────

describe("getStage2SystemPrompt", () => {
  test("enumerates 4 verdicts + submit_verdict + BUILD_ALIGNMENT enforcement", () => {
    const prompt = getStage2SystemPrompt({
      publisherInfo: ALWAYS_KNOWN_PUBLISHER,
    });
    for (const v of ["newsworthy", "logistics", "promotional", "other"]) {
      expect(prompt).toContain(v);
    }
    expect(prompt).toContain("submit_verdict");
    expect(prompt).toContain("BUILD_ALIGNMENT principles enforced");
    expect(STAGE2_PROMPT_VERSION).toBe("stage2-v1");
  });
});

// ─── Q0: feedback writes audit row AND suppresses the signal ────────────
//
// End-to-end-ish: simulates the round-trip without spinning up the
// Next route. Verifies that
//   1. signal suppression flips the page query (getWorkspaceSignals
//      includes `where suppressed_at is null`)
//   2. an audit row tagged with manually_overridden=true is written
//
// Implementation cross-check: src/lib/external-signals.ts +
// src/lib/email-filter-decisions.ts.

describe("Q0 · signal feedback suppression + audit dual-write", () => {
  test("signal_feedback_suppresses_signal_from_page", async () => {
    // Record the suppression update + the audit insert.
    const updates: Array<{ id: string; suppressed_at: string }> = [];
    const inserts: Array<Record<string, unknown>> = [];
    const fakeSb = {
      from(table: string) {
        if (table === "external_signals") {
          return {
            update(row: Record<string, unknown>) {
              return {
                eq(_c: string, id: string) {
                  void _c;
                  return {
                    select(_cols: string) {
                      void _cols;
                      updates.push({
                        id,
                        suppressed_at: String(row.suppressed_at),
                      });
                      return Promise.resolve({
                        data: [{ id }],
                        error: null,
                      });
                    },
                  };
                },
              };
            },
            select(_cols: string) {
              void _cols;
              // For getWorkspaceSignals — after suppression, return []
              // because suppressed_at is null filter excludes it.
              return {
                eq(_c1: string, _v1: string) {
                  void _c1;
                  void _v1;
                  return {
                    is(_c2: string, _v2: unknown) {
                      void _c2;
                      void _v2;
                      // The .is(suppressed_at, null) filter is what makes
                      // suppressed signals disappear — assert it gets
                      // called by simulating the chain returning [].
                      return {
                        gte(_c3: string, _v3: string) {
                          void _c3;
                          void _v3;
                          return {
                            order(_c4: string, _o: unknown) {
                              void _c4;
                              void _o;
                              return {
                                limit(_n: number) {
                                  void _n;
                                  return Promise.resolve({
                                    data: [],
                                    error: null,
                                  });
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "email_filter_decisions") {
          return {
            insert(row: Record<string, unknown>) {
              inserts.push(row);
              return {
                select(_cols: string) {
                  void _cols;
                  return {
                    async single() {
                      return {
                        data: { id: `audit_${inserts.length}` },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    // Suppression path: import and exercise the function with the fake
    // client. We need a singleton override; use a module-level mock by
    // re-importing supabaseAdmin via vi.spyOn. The simpler shape: call
    // the writers directly with the same client shape.

    // 1. Suppress the signal (mirrors what /api/admin/signal-feedback
    //    does on a real request).
    const { suppressSignal } = await import("./external-signals");
    const { markOverridden } = await import("./email-filter-decisions");

    // External-signals + email-filter-decisions both use the singleton
    // supabaseAdmin() via resolveClient(). Inject a fake by mocking the
    // supabase module.
    vi.spyOn(await import("./supabase"), "supabaseAdmin").mockReturnValue(
      fakeSb as unknown as SupabaseClient,
    );

    const suppressed = await suppressSignal("sig_test");
    expect(suppressed).toBe(1);
    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe("sig_test");
    expect(updates[0].suppressed_at).toBeTruthy();

    // 2. Audit row written tagged with manually_overridden=true.
    const auditId = await markOverridden(
      "email_test",
      "false positive promotional",
      STAGE2_PROMPT_VERSION,
    );
    expect(auditId).toBe("audit_1");
    expect(inserts.length).toBe(1);
    expect(inserts[0].manually_overridden).toBe(true);
    expect(inserts[0].override_reason).toBe("false positive promotional");
    expect(inserts[0].prompt_version).toBe(STAGE2_PROMPT_VERSION);

    // 3. After suppression, getWorkspaceSignals returns [] because the
    //    .is("suppressed_at", null) filter excludes the row.
    const { getWorkspaceSignals } = await import("./external-signals");
    const signalsAfter = await getWorkspaceSignals(
      "2026-01-01T00:00:00.000Z",
      50,
    );
    expect(signalsAfter).toEqual([]);

    vi.restoreAllMocks();
  });
});
