import { accounts } from "@/data/seed";
import {
  insertInboundEmail,
  markClassified,
  type InboundEmail,
} from "./inbound-email";
import { classifyNewsletter } from "./newsletter-adapter";
import { insertSignalsDedup } from "./external-signals";

// Shared orchestration for the Mailgun inbound webhook
// (src/app/api/inbound-email/mailgun/route.ts). Owns the validate → store
// → classify pipeline so the route handler is just auth + payload parsing
// on top.
//
// Lives in its own file to avoid a circular import — `newsletter-adapter`
// already imports the InboundEmail type from `inbound-email`, so we can't
// put the pipeline back in `inbound-email.ts`.

// 2 MB ceiling on combined text+html. Real newsletters land at 50-300 KB;
// anything past 2 MB is almost certainly spam or a malformed payload.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface NormalizedInboundEmail {
  from_raw: string; // unparsed From header from the provider payload
  subject: string;
  text_body: string;
  html_body: string;
  message_id: string | null;
}

export type ClassificationOutcome =
  | {
      ok: true;
      signals: number;
      matched: number;
      workspace: number;
      classifier_used: "haiku" | "none";
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
): Promise<ClassificationOutcome> {
  try {
    const trackable = accounts.filter((a) => a.trackable);
    const result = await classifyNewsletter(row, trackable);
    if (result.signals.length > 0) {
      await insertSignalsDedup(result.signals);
    }
    await markClassified(row.id, result.signals.length);
    console.log(
      `[inbound-email/mailgun] classified ${row.id}: ${result.signals.length} signals (${result.matched} matched, ${result.workspace} workspace) via ${result.classifier_used}`,
    );
    return {
      ok: true,
      signals: result.signals.length,
      matched: result.matched,
      workspace: result.workspace,
      classifier_used: result.classifier_used,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(
      `[inbound-email/mailgun] classification failed for ${row.id} (row saved, classified_at NULL; the daily sweeper will retry)`,
      error,
    );
    return { ok: false, error };
  }
}

// Process a normalized email through the inbound pipeline. Callers should:
//   - On `body_too_large` / `bad_from_header` / `sender_not_allowlisted` /
//     `dedup` / `stored`: return 200 to Mailgun. These are terminal states;
//     retrying won't help.
//   - On `storage_failed`: return 5xx so Mailgun retries. Supabase blips
//     clear within minutes; Mailgun's retry window is multi-day.
export async function processInboundEmail(
  email: NormalizedInboundEmail,
): Promise<ProcessOutcome> {
  const totalBytes = email.text_body.length + email.html_body.length;
  if (totalBytes > MAX_BODY_BYTES) {
    console.warn(
      `[inbound-email/mailgun] body too large (${totalBytes} bytes) from=${email.from_raw.slice(0, 80)} — dropping`,
    );
    return { kind: "body_too_large", bytes: totalBytes };
  }

  const parsed = parseFromAddress(email.from_raw);
  if (!parsed) {
    console.warn(
      `[inbound-email/mailgun] unparseable from header: ${email.from_raw.slice(0, 100)}`,
    );
    return { kind: "bad_from_header", from_raw: email.from_raw };
  }

  if (!senderAllowed(parsed.domain)) {
    console.warn(
      `[inbound-email/mailgun] sender not allowlisted: ${parsed.domain}`,
    );
    return { kind: "sender_not_allowlisted", domain: parsed.domain };
  }

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
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[inbound-email/mailgun] storage failed`, error);
    return { kind: "storage_failed", error };
  }

  if (!row) {
    // unique_violation on message_id — provider retried, we already have it
    return { kind: "dedup" };
  }

  console.log(
    `[inbound-email/mailgun] stored ${row.id} from=${parsed.domain} subject="${email.subject.slice(0, 60)}"`,
  );

  // Classify synchronously. Haiku averages 2-3s; well under Mailgun's 75s
  // webhook timeout. Classification failures don't 5xx — the row is saved
  // and the daily sweeper picks it up on next run.
  const classification = await classifyAndPersist(row);
  return { kind: "stored", id: row.id, classification };
}
