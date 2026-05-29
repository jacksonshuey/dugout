import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "svix";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

// AgentMail webhook receiver - paired with a webhook endpoint configured in
// the AgentMail console (https://console.agentmail.to → Webhooks) that POSTs
// `message.received` events here.
//
// Auth: AgentMail uses Svix for webhook delivery. Each registered endpoint
// gets its own signing secret (starts with `whsec_`). Three headers carry
// the signature: svix-id, svix-timestamp, svix-signature. The svix library
// verifies all three against the raw body in one call.
//
// Replay protection is built into Svix - timestamps older than 5 minutes
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
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  // Per AgentMail's docs (messages.yml), the webhook may also carry the
  // "new content only" extractions when the inbound is a reply/forward.
  // We use them as a fallback when text/html are absent.
  extracted_text?: string;
  extracted_html?: string;
  // AgentMail forwards the original RFC822 headers (when available) under
  // `headers`. Shape is loose across providers - sometimes a flat map,
  // sometimes a list of {name, value} pairs. We normalize below.
  headers?: Record<string, unknown> | Array<{ name?: string; value?: string }>;
}

interface AgentMailEventPayload {
  event_type?: string;
  message?: AgentMailMessage;
  // Some webhook deliveries carry the inbox identifier at the event level
  // rather than the message level. Read whichever surface has it.
  inbox_id?: string;
}

// Subset of the AgentMail GET /messages/:id response we care about. Matches
// the shape used by src/app/api/admin/agentmail-backfill/route.ts.
interface AgentMailMessageFull {
  message_id: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  extracted_text?: string;
  extracted_html?: string;
  headers?: Record<string, string>;
}

const AGENTMAIL_BASE = "https://api.agentmail.to";

// Fetch the full message body from AgentMail's REST API when the webhook
// payload arrived without inline text/html. Returns null on any failure
// (auth, network, 404) so the caller can decide whether to proceed with an
// empty body or drop the message.
async function agentMailGetMessage(
  inboxId: string,
  messageId: string,
  apiKey: string,
): Promise<AgentMailMessageFull | null> {
  try {
    const res = await fetch(
      `${AGENTMAIL_BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[agentmail] body-fetch failed inbox=${inboxId} message=${messageId} status=${res.status} body=${body.slice(0, 160)}`,
      );
      return null;
    }
    return (await res.json()) as AgentMailMessageFull;
  } catch (e) {
    console.warn(
      `[agentmail] body-fetch error inbox=${inboxId} message=${messageId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// Pull an inbox address (e.g. "dugout@agentmail.to") from `message.to`,
// which may be a string, an array, or a "Display <addr>" formatted string.
function pickInboxFromTo(to: AgentMailMessage["to"]): string | null {
  if (!to) return null;
  const raw = Array.isArray(to) ? to[0] : to;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const angle = raw.match(/<([^>]+)>/);
  const cleaned = (angle ? angle[1] : raw).trim();
  return cleaned.length > 0 ? cleaned : null;
}

// Flatten AgentMail's headers payload into a lowercased {name: value} map.
// Tolerates both representations (object map, array of {name,value}).
function normalizeHeaders(
  raw: AgentMailMessage["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const name = typeof entry.name === "string" ? entry.name.toLowerCase() : "";
      const value = typeof entry.value === "string" ? entry.value : "";
      if (name && value) out[name] = value;
    }
    return out;
  }
  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== "string") continue;
      out[k.toLowerCase()] = v;
    }
    return out;
  }
  return out;
}

// Extract the inner List-ID token per RFC-2919 - strip optional angle
// brackets + description. Returns null when no header is present.
function extractListId(headers: Record<string, string>): string | null {
  const raw = headers["list-id"];
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const token = (angle ? angle[1] : raw).trim();
  return token.length > 0 ? token : null;
}

// Only act on inbound message events. The other event types we'd see on this
// endpoint (sent, delivered, bounced, complained, rejected, domain.verified)
// don't carry a `message` object and aren't relevant to the newsletter pipeline.
// `.spam` / `.blocked` / `.unauthenticated` are kept in case the inbox ever
// receives mail flagged by AgentMail's filters - the sender allowlist in
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
    // Misconfiguration - log server-side so it shows up in Vercel logs, but
    // return 202 (not 500). Svix treats 5xx as transient and retries forever;
    // 202 signals "received, not processed" and stops the retry storm.
    // We deliberately omit the env-var name from the response body to avoid
    // leaking config state to the webhook sender.
    console.error(
      "[agentmail] AGENTMAIL_WEBHOOK_SECRET is not set; rejecting webhook (no retries)",
    );
    return new NextResponse(null, { status: 202 });
  }

  const rawBody = await req.text();
  const svixHeaders = {
    "svix-id": req.headers.get("svix-id") ?? "",
    "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
    "svix-signature": req.headers.get("svix-signature") ?? "",
  };

  let payload: AgentMailEventPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, svixHeaders) as AgentMailEventPayload;
  } catch (e) {
    // Each branch logs distinctly so operators can tell which class of failure
    // is dropping webhooks without spelunking through stack traces.
    if (e instanceof WebhookVerificationError) {
      console.warn(
        `[agentmail] signature_mismatch svix-id=${svixHeaders["svix-id"] || "(missing)"} sig-len=${svixHeaders["svix-signature"].length}`,
      );
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[agentmail] bad_payload: ${msg}`);
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

  const headers = normalizeHeaders(message.headers);
  const list_id = extractListId(headers);

  // Body extraction with three fallback paths. AgentMail webhooks
  // occasionally arrive with empty text/html (HTML-only forwards, payload
  // size trims, or specific senders) - without a body Stage 1 rejects the
  // row as body_chars=0 and we lose the newsletter entirely. The fallback
  // chain recovers most of those:
  //   1. inline message.text / message.html (the happy path)
  //   2. inline message.extracted_text / message.extracted_html (the new
  //      content path AgentMail uses for replies/forwards)
  //   3. REST API GET /inboxes/:id/messages/:id when both inline paths
  //      yield empty - only fires when AGENTMAIL_API_KEY is set and we
  //      can resolve an inbox id from env or the `to` field.
  let text_body =
    (typeof message.text === "string" && message.text) ||
    (typeof message.extracted_text === "string" && message.extracted_text) ||
    "";
  let html_body =
    (typeof message.html === "string" && message.html) ||
    (typeof message.extracted_html === "string" && message.extracted_html) ||
    "";
  let body_source: "inline" | "inline_extracted" | "api_fetch" | "empty" =
    text_body || html_body ? "inline" : "empty";
  if (
    (typeof message.text === "string" && message.text) ||
    (typeof message.html === "string" && message.html)
  ) {
    body_source = "inline";
  } else if (text_body || html_body) {
    body_source = "inline_extracted";
  }

  const apiKey = process.env.AGENTMAIL_API_KEY;
  const inboxId =
    process.env.AGENTMAIL_INBOX_ID ?? pickInboxFromTo(message.to) ?? null;
  if (!text_body && !html_body && apiKey && inboxId && message.message_id) {
    const full = await agentMailGetMessage(inboxId, message.message_id, apiKey);
    if (full) {
      text_body =
        (typeof full.text === "string" && full.text) ||
        (typeof full.extracted_text === "string" && full.extracted_text) ||
        "";
      html_body =
        (typeof full.html === "string" && full.html) ||
        (typeof full.extracted_html === "string" && full.extracted_html) ||
        "";
      if (text_body || html_body) body_source = "api_fetch";
    }
  }

  if (!text_body && !html_body) {
    // Last-resort diagnostic so Vercel logs show WHY a row landed empty.
    // Useful for tuning the fallback chain when AgentMail's payload shape
    // shifts again.
    const messageKeys = Object.keys(message).slice(0, 20).join(",");
    console.warn(
      `[agentmail] empty_body sender=${message.from ?? "?"} subject="${(message.subject ?? "").slice(0, 60)}" message_keys=[${messageKeys}] inbox_resolved=${inboxId ?? "none"} api_key=${apiKey ? "set" : "missing"}`,
    );
  }

  const normalized: NormalizedInboundEmail = {
    from_raw: String(message.from ?? "").slice(0, 500),
    subject: String(message.subject ?? "").slice(0, 1000),
    text_body,
    html_body,
    message_id:
      typeof message.message_id === "string" && message.message_id.length > 0
        ? message.message_id.replace(/^\s*<|>\s*$/g, "").trim()
        : null,
    headers,
    list_id,
  };

  console.log(
    `[agentmail] body_source=${body_source} text=${text_body.length} html=${html_body.length} from=${message.from ?? "?"}`,
  );

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
