import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "svix";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

// AgentMail webhook receiver — paired with a webhook endpoint configured in
// the AgentMail console (https://console.agentmail.to → Webhooks) that POSTs
// `message.received` events here.
//
// Auth: AgentMail uses Svix for webhook delivery. Each registered endpoint
// gets its own signing secret (starts with `whsec_`). Three headers carry
// the signature: svix-id, svix-timestamp, svix-signature. The svix library
// verifies all three against the raw body in one call.
//
// Replay protection is built into Svix — timestamps older than 5 minutes
// fail verification, no extra check needed here.
//
// Event payload shape (from agentmail-docs/fern/definition/messages.yml):
//   {
//     event_type: "message.received" | "message.received.spam" |
//                 "message.received.blocked" | "message.received.unauthenticated",
//     message: {
//       message_id, from, to, subject, text, html, timestamp, ...
//     },
//     thread: { ... }
//   }
//
// Provider-shared business logic (validate, store, classify) lives in
// src/lib/inbound-pipeline.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface AgentMailMessage {
  message_id?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
}

interface AgentMailEventPayload {
  event_type?: string;
  message?: AgentMailMessage;
}

// Only act on inbound message events. The other event types we'd see on this
// endpoint (sent, delivered, bounced, complained, rejected, domain.verified)
// don't carry a `message` object and aren't relevant to the newsletter pipeline.
// `.spam` / `.blocked` / `.unauthenticated` are kept in case the inbox ever
// receives mail flagged by AgentMail's filters — the sender allowlist in
// inbound-pipeline.ts is the second line of defense.
const RECEIVED_EVENTS = new Set([
  "message.received",
  "message.received.spam",
  "message.received.blocked",
  "message.received.unauthenticated",
]);

export async function POST(req: Request) {
  const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    // Fail-closed when the secret is missing. 500 makes the misconfiguration
    // visible in the AgentMail console's delivery logs rather than silently
    // dropping mail.
    return NextResponse.json(
      {
        error:
          "Server not configured: set AGENTMAIL_WEBHOOK_SECRET (whsec_...) in env.",
      },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const headers = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let payload: AgentMailEventPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, headers) as AgentMailEventPayload;
  } catch (e) {
    if (e instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const eventType = String(payload.event_type ?? "");
  if (!RECEIVED_EVENTS.has(eventType)) {
    // Acknowledge so Svix doesn't retry, but don't process.
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const message = payload.message;
  if (!message || typeof message !== "object") {
    return NextResponse.json(
      { ok: false, error: "Missing message" },
      { status: 200 },
    );
  }

  const normalized: NormalizedInboundEmail = {
    from_raw: String(message.from ?? "").slice(0, 500),
    subject: String(message.subject ?? "").slice(0, 1000),
    text_body: typeof message.text === "string" ? message.text : "",
    html_body: typeof message.html === "string" ? message.html : "",
    message_id:
      typeof message.message_id === "string" && message.message_id.length > 0
        ? message.message_id.replace(/^\s*<|>\s*$/g, "").trim()
        : null,
  };

  const outcome = await processInboundEmail(normalized, "agentmail");

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
