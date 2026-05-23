import { NextResponse } from "next/server";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

// Mailgun Inbound webhook receiver — paired with a Mailgun route that POSTs
// here (configure in Mailgun: Receiving → Routes → action "forward to URL").
//
// Auth: Mailgun signs every webhook with HMAC-SHA256(SIGNING_KEY, timestamp
// + token). We verify the signature and reject anything older than 5 min to
// prevent replay. This is stronger than the path-secret model used on the
// SendGrid route because the signature is a function of every request — a
// leaked URL can't be replayed by an attacker without also having the key.
//
// Signing key lives in MAILGUN_SIGNING_KEY env var. Grab it from Mailgun:
// Settings → API security → "HTTP webhook signing key".
//
// Mailgun's payload uses different field names than SendGrid:
//   from / From           — "Display Name <user@example.com>"
//   subject / Subject     — email subject
//   body-plain            — plaintext body
//   body-html             — HTML body
//   stripped-text/html    — body without quoted reply chains (we prefer these
//                           when present; cleaner for the classifier)
//   message-headers       — JSON array of [name, value] header tuples
//   Message-Id            — convenience field (also in headers)
//   timestamp/token/signature — HMAC auth fields
//
// Provider-shared business logic (validate, store, classify) lives in
// src/lib/inbound-pipeline.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Mailgun webhook timeout is 75s; stay under

// Mailgun's recommended replay window. Older webhooks are rejected.
const TIMESTAMP_WINDOW_SECONDS = 5 * 60;

// Constant-time string compare. Same approach as src/lib/ui-auth.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyMailgunSignature(
  signingKey: string,
  timestamp: string,
  token: string,
  signature: string,
): Promise<boolean> {
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSeconds > TIMESTAMP_WINDOW_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(timestamp + token),
  );
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature);
}

function extractMessageId(headersJson: string): string | null {
  // Mailgun ships `message-headers` as a JSON array of [name, value] tuples.
  // The Message-ID header is RFC 5322 angle-bracket wrapped; strip them.
  try {
    const parsed = JSON.parse(headersJson);
    if (!Array.isArray(parsed)) return null;
    for (const pair of parsed) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [name, value] = pair;
      if (typeof name !== "string" || typeof value !== "string") continue;
      if (name.toLowerCase() === "message-id") {
        return value.replace(/^\s*<|>\s*$/g, "").trim();
      }
    }
  } catch {
    // Not JSON — fall through. (Some Mailgun versions send raw headers.)
  }
  return null;
}

export async function POST(req: Request) {
  const signingKey = process.env.MAILGUN_SIGNING_KEY;
  if (!signingKey || signingKey.length < 16) {
    // Fail-closed when the key is missing. 500 makes the misconfiguration
    // visible in Mailgun's webhook logs rather than silently dropping mail.
    return NextResponse.json(
      {
        error:
          "Server not configured: set MAILGUN_SIGNING_KEY (>=16 chars) in env.",
      },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    // Real Mailgun POSTs use multipart/form-data. Empty probes (curl with
    // no body) hit formData() with nothing to parse and throw — we want
    // those to look like the 401 they morally are, not a 200 dropped.
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data")) {
      return NextResponse.json(
        {
          error:
            "Unauthorized — expected multipart/form-data from Mailgun Inbound",
        },
        { status: 401 },
      );
    }
    form = await req.formData();
  } catch (e) {
    // Multipart Content-Type was present but the body itself is corrupt.
    // Treat as a Mailgun-side hiccup; 200 so Mailgun doesn't retry forever
    // on a payload we can't make sense of.
    console.warn(
      "[inbound-email/mailgun] failed to parse multipart payload",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: "Bad form payload" },
      { status: 200 },
    );
  }

  // HMAC verification first — never touch payload fields until the
  // signature is proven authentic.
  const timestamp = String(form.get("timestamp") ?? "");
  const token = String(form.get("token") ?? "");
  const signature = String(form.get("signature") ?? "");
  if (!timestamp || !token || !signature) {
    return NextResponse.json(
      { error: "Missing signature fields" },
      { status: 401 },
    );
  }
  const sigOk = await verifyMailgunSignature(
    signingKey,
    timestamp,
    token,
    signature,
  );
  if (!sigOk) {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  // Prefer stripped-* bodies (no quoted reply chains) for the classifier;
  // fall back to full body if Mailgun didn't strip.
  const textBody =
    String(form.get("stripped-text") ?? "") ||
    String(form.get("body-plain") ?? "");
  const htmlBody =
    String(form.get("stripped-html") ?? "") ||
    String(form.get("body-html") ?? "");

  const normalized: NormalizedInboundEmail = {
    from_raw: String(form.get("from") ?? form.get("From") ?? "").slice(0, 500),
    subject: String(form.get("subject") ?? form.get("Subject") ?? "").slice(
      0,
      1000,
    ),
    text_body: textBody,
    html_body: htmlBody,
    message_id:
      // Prefer the convenience Message-Id field; fall back to scanning headers.
      (String(form.get("Message-Id") ?? "")
        .replace(/^\s*<|>\s*$/g, "")
        .trim() ||
        null) ?? extractMessageId(String(form.get("message-headers") ?? "")),
  };

  const outcome = await processInboundEmail(normalized);

  switch (outcome.kind) {
    case "body_too_large":
      return NextResponse.json(
        { ok: false, dropped: "body_too_large" },
        { status: 200 },
      );
    case "bad_from_header":
      return NextResponse.json(
        { ok: false, dropped: "bad_from_header" },
        { status: 200 },
      );
    case "sender_not_allowlisted":
      return NextResponse.json(
        { ok: true, dropped: "sender_not_allowlisted" },
        { status: 200 },
      );
    case "dedup":
      return NextResponse.json({ ok: true, dedup: true });
    case "stored":
      if (outcome.classification.ok) {
        return NextResponse.json({
          ok: true,
          id: outcome.id,
          signals: outcome.classification.signals,
          matched: outcome.classification.matched,
          workspace: outcome.classification.workspace,
        });
      }
      return NextResponse.json({
        ok: true,
        id: outcome.id,
        classification: "deferred",
      });
    case "storage_failed":
      return NextResponse.json(
        { ok: false, error: "Storage failed" },
        { status: 503 },
      );
  }
}
