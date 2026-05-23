import { NextResponse } from "next/server";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

// SendGrid Inbound Parse webhook receiver.
//
// Auth: path-segment secret matched against INBOUND_WEBHOOK_SECRET. Fail-
// closed when the env var is missing, mirroring the CRON_SECRET pattern in
// the cron route. The secret is in the URL path so we don't need custom
// headers (which SendGrid Inbound Parse doesn't support).
//
// SendGrid Inbound Parse POSTs multipart/form-data with fields:
//   from        — "Display Name <user@example.com>" or bare address
//   subject     — email subject
//   text        — plaintext body (extracted from MIME)
//   html        — HTML body
//   headers     — raw email headers (newline-separated)
//
// Provider-shared business logic (validate, store, classify) lives in
// src/lib/inbound-pipeline.ts so the Mailgun route can reuse it.
//
// Response policy: 5xx on transient storage failure so SendGrid retries
// (its window is ~3 days). 200 on payload-level rejections — retries won't
// fix those.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // SendGrid webhook timeout

function parseMessageId(headers: string): string | null {
  // headers is a newline-separated list of raw header lines. Message-ID is
  // typically wrapped in angle brackets per RFC 5322; strip them.
  const match = headers.match(/^message-id:\s*<?([^>\r\n]+)>?$/im);
  return match ? match[1].trim() : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (!expected || expected.length < 16 || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.warn(
      "[inbound-email/sendgrid] failed to parse multipart payload",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: "Bad form payload" },
      { status: 200 },
    );
  }

  const normalized: NormalizedInboundEmail = {
    from_raw: String(form.get("from") ?? "").slice(0, 500),
    subject: String(form.get("subject") ?? "").slice(0, 1000),
    text_body: String(form.get("text") ?? ""),
    html_body: String(form.get("html") ?? ""),
    message_id: parseMessageId(String(form.get("headers") ?? "")),
  };

  const outcome = await processInboundEmail(normalized, "sendgrid");

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
      // Row stored but classification failed — sweeper will retry. Still 200
      // so SendGrid doesn't re-send.
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
