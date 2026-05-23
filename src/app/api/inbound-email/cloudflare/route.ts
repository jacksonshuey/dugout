import { NextResponse } from "next/server";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

// Cloudflare Email Routing webhook receiver — paired with an Email Worker
// (workers/dugout-inbound) that parses incoming MIME via postal-mime and
// POSTs the normalized fields here.
//
// Auth: shared secret in an X-Cloudflare-Secret header. The Worker holds it
// as a Cloudflare secret binding (WEBHOOK_SECRET); we hold it here as
// CLOUDFLARE_INBOUND_SECRET. Same value, two names — that's the contract.
// Constant-time compare to defeat timing attacks. Weaker than Mailgun's
// per-request HMAC but adequate here: the Worker is the only thing on the
// internet that has the secret, and Cloudflare → Cloudflare → Vercel is the
// whole path. There's no untrusted middlebox.
//
// Payload (JSON, set by the Worker):
//   from_raw     — unparsed From header
//   subject      — Subject header
//   text_body    — text/plain body (may be empty if HTML-only)
//   html_body    — text/html body (may be empty if text-only)
//   message_id   — RFC 5322 Message-ID, or null
//
// Provider-shared business logic (validate, store, classify) lives in
// src/lib/inbound-pipeline.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Constant-time string compare. Same approach as src/lib/ui-auth.ts.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = process.env.CLOUDFLARE_INBOUND_SECRET;
  if (!expected || expected.length < 16) {
    // Fail-closed when the secret is missing. 500 makes the misconfiguration
    // visible in Worker logs (the Worker will see the 500 and log it) rather
    // than silently accepting unauthenticated POSTs.
    return NextResponse.json(
      {
        error:
          "Server not configured: set CLOUDFLARE_INBOUND_SECRET (>=16 chars) in env.",
      },
      { status: 500 },
    );
  }

  const provided = req.headers.get("x-cloudflare-secret") ?? "";
  if (!timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (e) {
    console.warn(
      "[inbound-email/cloudflare] failed to parse JSON payload",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: "Bad JSON payload" },
      { status: 200 },
    );
  }

  const normalized: NormalizedInboundEmail = {
    from_raw: String(body.from_raw ?? "").slice(0, 500),
    subject: String(body.subject ?? "").slice(0, 1000),
    text_body: String(body.text_body ?? ""),
    html_body: String(body.html_body ?? ""),
    message_id:
      typeof body.message_id === "string" && body.message_id.length > 0
        ? body.message_id.replace(/^\s*<|>\s*$/g, "").trim()
        : null,
  };

  const outcome = await processInboundEmail(normalized, "cloudflare");

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
