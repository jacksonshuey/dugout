import { NextResponse } from "next/server";
import { insertInboundEmail } from "@/lib/inbound-email";

// SendGrid Inbound Parse webhook receiver — Phase 1: raw storage only.
// Classification (newsletter-adapter.ts → external_signals) lands in Phase 2.
//
// Auth: path-segment secret matched against INBOUND_WEBHOOK_SECRET. Fail-closed
// when the env var is missing, mirroring the CRON_SECRET pattern in the cron
// route. The secret is in the URL path so we don't need custom headers (which
// SendGrid Inbound Parse doesn't support).
//
// Sender allowlist: from_domain must be in INBOUND_SENDER_ALLOWLIST (or be a
// subdomain of an allowlisted domain). Off-allowlist mail is dropped with a
// 200 OK so SendGrid doesn't retry — those will never succeed.
//
// SendGrid Inbound Parse POSTs multipart/form-data with fields:
//   from        — "Display Name <user@example.com>" or bare address
//   to          — recipient
//   subject     — email subject
//   text        — plaintext body (extracted from MIME)
//   html        — HTML body
//   headers     — raw email headers (newline-separated)
//   attachments — count of attached files (we ignore attachments in v1)
//
// Response policy: return 5xx on transient storage failure so SendGrid retries
// (its retry window is ~3 days). Return 200 on payload-level rejections (bad
// sender, body too large, dedup) — retries won't fix those.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // SendGrid webhook timeout is 30s

// 2 MB ceiling on combined text+html. Real newsletters land at 50-300 KB; any-
// thing past 2 MB is almost certainly spam or a malformed payload.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface ParsedFrom {
  address: string;
  domain: string;
}

function parseFromAddress(raw: string): ParsedFrom | null {
  // "Display Name <user@example.com>" or bare "user@example.com"
  const angle = raw.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : raw).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 1 || at === addr.length - 1) return null;
  return { address: addr, domain: addr.slice(at + 1) };
}

function parseMessageId(headers: string): string | null {
  // headers is a newline-separated list of raw header lines. Message-ID is
  // typically wrapped in angle brackets per RFC 5322; strip them.
  const match = headers.match(/^message-id:\s*<?([^>\r\n]+)>?$/im);
  return match ? match[1].trim() : null;
}

function senderAllowed(domain: string): boolean {
  const allowlist = (process.env.INBOUND_SENDER_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  );
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
      "[inbound-email] failed to parse multipart payload",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: "Bad form payload" },
      { status: 200 },
    );
  }

  const fromRaw = String(form.get("from") ?? "").slice(0, 500);
  const subject = String(form.get("subject") ?? "").slice(0, 1000);
  const textBody = String(form.get("text") ?? "");
  const htmlBody = String(form.get("html") ?? "");
  const headers = String(form.get("headers") ?? "");

  const totalBytes = textBody.length + htmlBody.length;
  if (totalBytes > MAX_BODY_BYTES) {
    console.warn(
      `[inbound-email] body too large (${totalBytes} bytes) from=${fromRaw.slice(0, 80)} — dropping`,
    );
    return NextResponse.json(
      { ok: false, dropped: "body_too_large" },
      { status: 200 },
    );
  }

  const parsed = parseFromAddress(fromRaw);
  if (!parsed) {
    console.warn(`[inbound-email] unparseable from header: ${fromRaw.slice(0, 100)}`);
    return NextResponse.json(
      { ok: false, dropped: "bad_from_header" },
      { status: 200 },
    );
  }

  if (!senderAllowed(parsed.domain)) {
    console.warn(`[inbound-email] sender not allowlisted: ${parsed.domain}`);
    return NextResponse.json(
      { ok: true, dropped: "sender_not_allowlisted" },
      { status: 200 },
    );
  }

  try {
    const row = await insertInboundEmail({
      from_address: parsed.address,
      from_domain: parsed.domain,
      subject: subject || null,
      text_body: textBody || null,
      html_body: htmlBody || null,
      raw_size_bytes: totalBytes,
      message_id: parseMessageId(headers),
    });
    if (!row) {
      // unique_violation on message_id — SendGrid retried, we already have it
      return NextResponse.json({ ok: true, dedup: true });
    }
    console.log(
      `[inbound-email] stored ${row.id} from=${parsed.domain} subject="${subject.slice(0, 60)}"`,
    );
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e) {
    // Transient storage failure. Return 5xx so SendGrid retries within its
    // 3-day window — better than silently losing the message.
    console.error(
      "[inbound-email] storage failed",
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: "Storage failed" },
      { status: 503 },
    );
  }
}
