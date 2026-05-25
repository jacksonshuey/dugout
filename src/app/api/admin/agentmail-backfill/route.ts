import { NextResponse } from "next/server";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
  type ProcessOutcome,
} from "@/lib/inbound-pipeline";

// One-shot backfill for newsletters that arrived in an AgentMail inbox
// before the AgentMail console webhook was registered (or while it was
// misconfigured). Lists every message currently in every inbox on the
// account, fetches each one's full body, and runs the same
// `processInboundEmail` pipeline the live webhook uses. Storage dedup on
// `inbound_emails.message_id` makes this idempotent - running it twice
// stores nothing the second time.
//
// Auth: CRON_SECRET via `Authorization: Bearer ${CRON_SECRET}`. Mirrors
// the existing cron routes so the same secret already in Vercel works.
//
// Side effects: writes to `inbound_emails` + `external_signals`. Each
// stored row triggers one Haiku classifier call (~2-3s, ~$0.001).
//
// Usage:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     https://trydugout.com/api/admin/agentmail-backfill
//
// Optional query params:
//   ?limit=50       (default 50, max 200) - caps total messages processed
//                   per invocation to stay under the 300s function timeout.
//   ?inbox_id=…     - restrict to one inbox; default is all inboxes.
//
// AgentMail API reference (live): https://docs.agentmail.to/llms-full.txt

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const AGENTMAIL_BASE = "https://api.agentmail.to/v0";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAGE_SIZE = 100;

interface AgentMailInbox {
  inbox_id: string;
  email_address?: string;
}

interface AgentMailMessageItem {
  message_id: string;
  from?: string;
  subject?: string;
}

interface AgentMailMessageFull {
  message_id: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

type OutcomeKind = ProcessOutcome["kind"];

const OUTCOME_KINDS: OutcomeKind[] = [
  "body_too_large",
  "bad_from_header",
  "sender_not_allowlisted",
  "dedup",
  "stored",
  "storage_failed",
];

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  return req.headers.get("authorization") === `Bearer ${required}`;
}

async function agentMailGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // Don't let Next cache mutate intermediate responses.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `AgentMail GET ${path} → ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// RFC-2919: List-ID may be "<inner-id>" or "Description <inner-id>". The
// webhook handler does the same extraction - mirror it so backfilled rows
// resolve to the same publisher.
function extractListId(headers?: Record<string, string>): string | null {
  if (!headers) return null;
  const raw = headers["list-id"] ?? headers["List-ID"];
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const token = (angle ? angle[1] : raw).trim();
  return token.length > 0 ? token : null;
}

function normalizeMessageId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  // Match the webhook handler's strip-angle-brackets pass so dedup works
  // regardless of which surface (webhook or backfill) saw a given message
  // first.
  return raw.replace(/^\s*<|>\s*$/g, "").trim() || null;
}

interface BackfillResult {
  ranAt: string;
  durationMs: number;
  inboxesScanned: number;
  messagesProcessed: number;
  outcomes: Record<OutcomeKind, number>;
  signalsEmitted: number;
  // Per-domain count of messages dropped at the sender allowlist gate. Lets
  // operators see WHICH senders aren't currently allowlisted so the gap can
  // be filled in INBOUND_SENDER_ALLOWLIST. Sender domains aren't sensitive
  // (newsletter from-addresses are public), so safe to surface in the API
  // response.
  droppedSenders: Record<string, number>;
  errors: { message_id: string; error: string }[];
  note?: string;
}

async function handle(req: Request): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Server not configured: set AGENTMAIL_API_KEY (am_…) in environment.",
      },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
  );
  const restrictInboxId = url.searchParams.get("inbox_id");

  const startedAt = Date.now();
  const outcomes: Record<OutcomeKind, number> = Object.fromEntries(
    OUTCOME_KINDS.map((k) => [k, 0]),
  ) as Record<OutcomeKind, number>;
  const errors: { message_id: string; error: string }[] = [];
  const droppedSenders: Record<string, number> = {};
  let signalsEmitted = 0;
  let processed = 0;

  let inboxes: AgentMailInbox[];
  try {
    const listed = await agentMailGet<{ inboxes?: AgentMailInbox[] }>(
      "/inboxes?limit=50",
      apiKey,
    );
    inboxes = listed.inboxes ?? [];
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  if (restrictInboxId) {
    inboxes = inboxes.filter((i) => i.inbox_id === restrictInboxId);
  }

  outer: for (const inbox of inboxes) {
    let pageToken: string | undefined = undefined;
    do {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageToken) qs.set("page_token", pageToken);
      const page = await agentMailGet<{
        messages?: AgentMailMessageItem[];
        next_page_token?: string;
      }>(`/inboxes/${inbox.inbox_id}/messages?${qs.toString()}`, apiKey);

      for (const item of page.messages ?? []) {
        if (processed >= limit) break outer;
        processed++;
        try {
          const full = await agentMailGet<AgentMailMessageFull>(
            `/inboxes/${inbox.inbox_id}/messages/${item.message_id}`,
            apiKey,
          );
          const normalized: NormalizedInboundEmail = {
            from_raw: String(full.from ?? "").slice(0, 500),
            subject: String(full.subject ?? "").slice(0, 1000),
            text_body: typeof full.text === "string" ? full.text : "",
            html_body: typeof full.html === "string" ? full.html : "",
            message_id: normalizeMessageId(full.message_id),
            headers: full.headers,
            list_id: extractListId(full.headers),
          };
          const outcome = await processInboundEmail(normalized, "agentmail");
          outcomes[outcome.kind] += 1;
          if (outcome.kind === "stored" && outcome.classification.ok) {
            signalsEmitted += outcome.classification.signals;
          }
          if (outcome.kind === "sender_not_allowlisted") {
            droppedSenders[outcome.domain] =
              (droppedSenders[outcome.domain] ?? 0) + 1;
          }
        } catch (e) {
          errors.push({
            message_id: item.message_id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      pageToken = page.next_page_token;
    } while (pageToken && processed < limit);
  }

  const result: BackfillResult = {
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    inboxesScanned: inboxes.length,
    messagesProcessed: processed,
    outcomes,
    signalsEmitted,
    droppedSenders,
    errors,
  };
  if (processed >= limit) {
    result.note = `Hit limit=${limit}; rerun to process more.`;
  }
  console.log(`[agentmail-backfill] ${JSON.stringify(result)}`);
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
