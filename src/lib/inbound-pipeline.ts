import { accounts } from "@/data/seed";
import {
  insertInboundEmail,
  markClassified,
  type InboundEmail,
} from "./inbound-email";
import { classifyNewsletter } from "./newsletter-adapter";
import { insertSignalsDedup } from "./external-signals";
import { resolvePublisher } from "./inbound-publishers";
import { filterEmail } from "./email-filter";

// Shared orchestration for inbound webhooks. The AgentMail route
// (src/app/api/inbound-email/agentmail/route.ts) parses its provider-specific
// payload, then this pipeline does the rest: validate the email, store,
// classify, return a structured outcome. Kept provider-shaped so adding a
// second provider later is just a new route handler that lands here with
// a NormalizedInboundEmail.
//
// Lives in its own file to avoid a circular import — `newsletter-adapter`
// already imports the InboundEmail type from `inbound-email`, so we can't
// put the pipeline back in `inbound-email.ts`.

// 2 MB ceiling on combined text+html. Real newsletters land at 50-300 KB;
// anything past 2 MB is almost certainly spam or a malformed payload.
// AgentMail itself caps message size below this, so this is mostly defense.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface NormalizedInboundEmail {
  from_raw: string; // unparsed From header from the provider payload
  subject: string;
  text_body: string;
  html_body: string;
  message_id: string | null;
  // Lowercased header map forwarded from the webhook (when available).
  // Used by the content filter's Stage 1 for auto-reply/bounce/content-type
  // checks. Optional so non-AgentMail providers can omit.
  headers?: Record<string, string>;
  // List-ID extracted upstream (the webhook handler is "everything provider-
  // shaped", per design Q2). Optional + redundant with headers["list-id"]
  // but cheaper to pass through than re-parse here.
  list_id?: string | null;
}

export type ClassificationOutcome =
  | {
      ok: true;
      signals: number;
      matched: number;
      workspace: number;
      classifier_used: "haiku" | "none";
      // The filter's verdict that gated the classifier. "proceed" is the
      // happy path; the others mean the classifier was skipped entirely.
      filter_decision: "proceed" | "needs_review" | "rejected";
    }
  | { ok: false; error: string };

export type ProcessOutcome =
  | { kind: "body_too_large"; bytes: number }
  | { kind: "bad_from_header"; from_raw: string }
  | { kind: "sender_not_allowlisted"; domain: string }
  | { kind: "dedup" }
  | { kind: "stored"; id: string; classification: ClassificationOutcome }
  | { kind: "storage_failed"; error: string };

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

async function classifyAndPersist(
  row: InboundEmail,
  provider: string,
  headers?: Record<string, string>,
): Promise<ClassificationOutcome> {
  try {
    // Resolve publisher up front — used by both the filter (Stage 2 prompt
    // context) and the classifier (signal attribution columns).
    const publisherInfo = resolvePublisher({
      list_id: row.list_id ?? null,
      sender_domain: row.from_domain,
    });

    // Stage 1 + Stage 2 gate. Fails CLOSED — any failure routes to
    // needs_review and the classifier is NOT called. See
    // docs/filter-design.md §6 + §8.
    const filterResult = await filterEmail({
      email: row,
      publisherInfo,
      headers,
      now: new Date(),
    });

    if (filterResult.decision !== "proceed") {
      // Mark classified with 0 signals so the sweeper stops re-queueing
      // this row. The audit row written by filterEmail() carries the WHY.
      await markClassified(row.id, 0);
      console.log(
        `[inbound-email/${provider}] filter ${filterResult.decision} ${row.id} (publisher=${publisherInfo.publisher_canonical_name})`,
      );
      return {
        ok: true,
        signals: 0,
        matched: 0,
        workspace: 0,
        classifier_used: "none",
        filter_decision: filterResult.decision,
      };
    }

    const trackable = accounts.filter((a) => a.trackable);
    const result = await classifyNewsletter(row, trackable, publisherInfo);
    if (result.signals.length > 0) {
      await insertSignalsDedup(result.signals);
    }
    await markClassified(row.id, result.signals.length);
    console.log(
      `[inbound-email/${provider}] classified ${row.id}: ${result.signals.length} signals (${result.matched} matched, ${result.workspace} workspace) via ${result.classifier_used}`,
    );
    return {
      ok: true,
      signals: result.signals.length,
      matched: result.matched,
      workspace: result.workspace,
      classifier_used: result.classifier_used,
      filter_decision: "proceed",
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(
      `[inbound-email/${provider}] classification failed for ${row.id} (row saved, classified_at NULL; the daily sweeper will retry)`,
      error,
    );
    return { ok: false, error };
  }
}

// Process a normalized email through the inbound pipeline. Callers should:
//   - On `body_too_large` / `bad_from_header` / `sender_not_allowlisted` /
//     `dedup` / `stored`: return 200 to the provider. These are terminal
//     states; retrying won't help.
//   - On `storage_failed`: return 5xx so the provider retries. Supabase
//     blips clear within minutes; Svix's exponential backoff covers it.
export async function processInboundEmail(
  email: NormalizedInboundEmail,
  provider: "agentmail",
): Promise<ProcessOutcome> {
  const totalBytes = email.text_body.length + email.html_body.length;
  if (totalBytes > MAX_BODY_BYTES) {
    console.warn(
      `[inbound-email/${provider}] body too large (${totalBytes} bytes) from=${email.from_raw.slice(0, 80)} — dropping`,
    );
    return { kind: "body_too_large", bytes: totalBytes };
  }

  const parsed = parseFromAddress(email.from_raw);
  if (!parsed) {
    console.warn(
      `[inbound-email/${provider}] unparseable from header: ${email.from_raw.slice(0, 100)}`,
    );
    return { kind: "bad_from_header", from_raw: email.from_raw };
  }

  if (!senderAllowed(parsed.domain)) {
    console.warn(
      `[inbound-email/${provider}] sender not allowlisted: ${parsed.domain}`,
    );
    return { kind: "sender_not_allowlisted", domain: parsed.domain };
  }

  // Resolve publisher BEFORE insert so the row carries
  // publisher_canonical_name from day one (no backfill needed).
  const publisherInfo = resolvePublisher({
    list_id: email.list_id ?? null,
    sender_domain: parsed.domain,
  });

  let row: InboundEmail | null;
  try {
    row = await insertInboundEmail({
      from_address: parsed.address,
      from_domain: parsed.domain,
      subject: email.subject || null,
      text_body: email.text_body || null,
      html_body: email.html_body || null,
      raw_size_bytes: totalBytes,
      message_id: email.message_id,
      list_id: email.list_id ?? null,
      publisher_canonical_name: publisherInfo.publisher_canonical_name,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[inbound-email/${provider}] storage failed`, error);
    return { kind: "storage_failed", error };
  }

  if (!row) {
    // unique_violation on message_id — provider retried, we already have it
    return { kind: "dedup" };
  }

  console.log(
    `[inbound-email/${provider}] stored ${row.id} from=${parsed.domain} subject="${email.subject.slice(0, 60)}" publisher=${publisherInfo.publisher_canonical_name}`,
  );

  // Classify synchronously. Haiku averages 2-3s; well under provider webhook
  // timeouts (SendGrid 30s, Mailgun 75s). Classification failures don't 5xx
  // — the row is saved and the daily sweeper picks it up on next run.
  const classification = await classifyAndPersist(row, provider, email.headers);
  return { kind: "stored", id: row.id, classification };
}
