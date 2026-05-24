// Stage 1: deterministic email content filter rules.
//
// Pure function, no I/O. Runs before the Stage 2 Haiku gate so the cheap
// rejections (subject regex, sender-role, body stats, auto-reply headers)
// short-circuit without paying for a model call.
//
// All magic numbers exported as named constants so the test file imports
// the exact value rather than re-typing it. Tweaks happen here, not in
// scattered literals — a future RevOps tuning pass adjusts one place.
//
// Design doc: /docs/filter-design.md §5.

import type { InboundEmail } from "./inbound-email";
import type { Stage1Result } from "./email-filter-types";

// ─── Tunable constants (exported for tests + RevOps tuning) ──────────────

export const MIN_BODY_WORDS = 200;
export const MAX_LINK_RATIO = 0.9; // text-content-to-link-content ratio ceiling
export const MIN_BODY_CHARS_AFTER_STRIP = 50;
export const BODY_TRUNCATION_FOR_STATS = 20_000; // cap before counting words/links
export const SENDER_ROLE_WEAK_REJECT_WORD_THRESHOLD = 400; // borderline noreply@ trust line

// Subject patterns that mean "this is admin, not editorial." Anchored
// where possible to reduce false positives on real subjects that happen
// to contain the phrase ("Welcome to the AI age" should NOT match — the
// regex requires `welcome` to be followed by "to your" / "to our" / "to
// the <X> team/community/family", not generic prose).
export const SUBJECT_REJECT_PATTERNS: Array<{ re: RegExp; tag: string }> = [
  {
    re: /^\s*welcome\s+to\s+(your|our|the\s+\S+\s+(team|community|family))/i,
    tag: "welcome",
  },
  { re: /\bconfirm\s+your\b/i, tag: "confirm_your" },
  {
    re: /\b(?:(?:password|account)\s+reset|reset\s+(?:your\s+)?(?:password|account))\b/i,
    tag: "password_reset",
  },
  {
    re: /\byour\s+(receipt|invoice|order|subscription|billing\s+statement)\b/i,
    tag: "billing_receipt",
  },
  { re: /\bout\s+of\s+(the\s+)?office\b/i, tag: "out_of_office" },
  { re: /\bauto[-\s]?reply\b/i, tag: "autoreply" },
  {
    re: /\b(webinar|workshop)\s+(invite|invitation|reminder|registration)\b/i,
    tag: "webinar_invite",
  },
  { re: /\b(verify|verification)\s+(your|code|link)\b/i, tag: "verify" },
  {
    re: /\b(unsubscribe|update\s+(your\s+)?(preferences|subscription))\b/i,
    tag: "unsub_in_subject",
  },
  {
    re: /\b(payment|card)\s+(failed|declined|expired)\b/i,
    tag: "payment_failed",
  },
];

// Sender LOCAL-PART role prefixes. Match on the part before `@` only —
// `marketing@artificiallawyer.com` is fine (whole-domain newsletter),
// `support@artificiallawyer.com` is not. Paired with body characteristics
// below: a `noreply@` sender is a hard reject only if the body also looks
// thin (Substack uses `noreply@` for legit content; we don't want to
// blanket-reject those).
export const SENDER_ROLE_HARD_REJECT = new Set<string>([
  "billing",
  "invoicing",
  "accounts-receivable",
  "ar",
  "ap",
  "calendar",
  "calendars",
  "scheduler",
  "noreply-billing",
  "noreply-receipts",
]);

// Sender roles that reject ONLY when paired with a weak body. These are
// the ambiguous ones — Substack noreply@substack.com is legit; Salesforce
// noreply@email.salesforce.com is usually trial-spam.
export const SENDER_ROLE_WEAK_REJECT = new Set<string>([
  "no-reply",
  "noreply",
  "do-not-reply",
  "donotreply",
  "support",
  "notifications",
  "alerts",
  "system",
]);

// Auto-reply + bounce headers. Names are case-insensitive (matched via
// .toLowerCase()) and presence-only — value sniffing is brittle across
// MTAs. RFC-3834 for Auto-Submitted; X-Autoreply is the Postini/legacy
// convention; X-Failed-Recipients is the standard bounce marker.
//
// Auto-Submitted is handled specially below: skip when value is "no" —
// only reject on "auto-replied" or "auto-generated" per RFC-3834. Other
// auto-reply headers reject on presence alone.
export const AUTO_REPLY_HEADERS = [
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "x-mailer-autoreply",
];
export const BOUNCE_HEADERS = [
  "x-failed-recipients",
  "x-bounce-info",
];

// ─── Helpers ──────────────────────────────────────────────────────────────

// Lightweight HTML → plaintext for the link-ratio + word-count + empty-body
// checks. Duplicated from newsletter-adapter.ts intentionally to keep
// Stage 1 pure (no side-effecting imports beyond types).
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function emailBodyPlaintext(email: InboundEmail): string {
  const text =
    email.text_body && email.text_body.length > 100
      ? email.text_body
      : email.html_body
        ? stripHtml(email.html_body)
        : (email.text_body ?? "");
  return text;
}

function countWords(plaintext: string): number {
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

function computeLinkRatio(html: string, plaintext: string): number {
  if (plaintext.length === 0) return 1.0;
  let anchorChars = 0;
  const re = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    anchorChars += stripHtml(m[1]).length;
  }
  return Math.min(1.0, anchorChars / plaintext.length);
}

function onlyUnsubAndPreferenceLinks(html: string): boolean {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const matches: Array<{ href: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    matches.push({ href: m[1], text: stripHtml(m[2]) });
  }
  if (matches.length === 0) return false; // can't tell — not "only" anything
  const unsubRe =
    /unsubscribe|preferences|email[-_ ]?settings|manage[-_ ]?subscription/i;
  return matches.every((a) => unsubRe.test(`${a.href} ${a.text}`));
}

// Normalize a headers map to lowercase keys. Callers may pass any shape.
function lowerHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function hasCalendarAttachment(
  email: InboundEmail,
  headers: Record<string, string>,
): boolean {
  const ct = headers["content-type"] ?? "";
  if (/text\/calendar/i.test(ct)) return true;
  if (/method=REQUEST/i.test(ct)) return true;
  // Fallback for cases where the webhook flattened the parts:
  if (/BEGIN:VCALENDAR/i.test(email.text_body ?? "")) return true;
  if (/BEGIN:VCALENDAR/i.test(email.html_body ?? "")) return true;
  return false;
}

// ─── Entry ────────────────────────────────────────────────────────────────

export function runStage1(
  email: InboundEmail,
  headers?: Record<string, string>,
): Stage1Result {
  const h = lowerHeaders(headers);

  // ── 5.4: bounce + auto-reply check (cheapest, runs first) ──────────────
  for (const name of BOUNCE_HEADERS) {
    if (h[name] !== undefined) {
      return {
        accepted: false,
        reason: "auto_reply_or_bounce",
        detail: `bounce_header:${name}`,
      };
    }
  }
  const autoSubmitted = h["auto-submitted"]?.toLowerCase() ?? "";
  if (autoSubmitted.startsWith("auto-")) {
    return {
      accepted: false,
      reason: "auto_reply_or_bounce",
      detail: "auto_submitted",
    };
  }
  for (const name of AUTO_REPLY_HEADERS) {
    if (name === "auto-submitted") continue; // handled above
    if (h[name] !== undefined) {
      return {
        accepted: false,
        reason: "auto_reply_or_bounce",
        detail: `header:${name}`,
      };
    }
  }

  // ── 5.1: subject pattern check ─────────────────────────────────────────
  const subject = (email.subject ?? "").trim();
  for (const { re, tag } of SUBJECT_REJECT_PATTERNS) {
    if (re.test(subject)) {
      return {
        accepted: false,
        reason: "subject_pattern",
        detail: `subject_regex:${tag}`,
      };
    }
  }

  // ── 5.5: empty body check (cheaper than role check; do it before stats) ─
  const plaintext = emailBodyPlaintext(email);
  const trimmedLen = plaintext.trim().length;
  if (trimmedLen < MIN_BODY_CHARS_AFTER_STRIP) {
    return {
      accepted: false,
      reason: "empty_body",
      detail: `body_chars=${trimmedLen}`,
    };
  }

  // ── 5.3: body stats — words + link ratio + only-unsub check ────────────
  const truncated = plaintext.slice(0, BODY_TRUNCATION_FOR_STATS);
  const wordCount = countWords(truncated);
  const linkRatio = computeLinkRatio(email.html_body ?? "", truncated);
  const isOnlyUnsubLinks = onlyUnsubAndPreferenceLinks(email.html_body ?? "");

  if (wordCount < MIN_BODY_WORDS) {
    return {
      accepted: false,
      reason: "body_thin_or_link_only",
      detail: `word_count=${wordCount} < ${MIN_BODY_WORDS}`,
    };
  }
  if (linkRatio > MAX_LINK_RATIO) {
    return {
      accepted: false,
      reason: "body_thin_or_link_only",
      detail: `link_ratio=${linkRatio.toFixed(2)} > ${MAX_LINK_RATIO}`,
    };
  }
  if (isOnlyUnsubLinks) {
    return {
      accepted: false,
      reason: "body_thin_or_link_only",
      detail: "only_unsub_links",
    };
  }

  // ── 5.2: sender role check (last — most context-dependent) ─────────────
  const localPart = (email.from_address.split("@")[0] ?? "").toLowerCase();
  if (SENDER_ROLE_HARD_REJECT.has(localPart)) {
    return {
      accepted: false,
      reason: "sender_role",
      detail: `local_part:${localPart}`,
    };
  }
  if (
    SENDER_ROLE_WEAK_REJECT.has(localPart) &&
    wordCount < SENDER_ROLE_WEAK_REJECT_WORD_THRESHOLD
  ) {
    return {
      accepted: false,
      reason: "sender_role",
      detail: `local_part:${localPart} + word_count=${wordCount}`,
    };
  }

  // ── Calendar attachment check ──────────────────────────────────────────
  if (hasCalendarAttachment(email, h)) {
    return {
      accepted: false,
      reason: "subject_pattern",
      detail: "ics_attachment",
    };
  }

  const listId = h["list-id"] ?? null;
  return {
    accepted: true,
    body_chars: plaintext.length,
    link_ratio: linkRatio,
    list_id: listId,
  };
}
