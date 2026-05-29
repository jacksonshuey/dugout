import { supabaseAdmin } from "./supabase";

// Raw inbound email store. Newsletters arrive at the AgentMail webhook
// (src/app/api/inbound-email/agentmail/route.ts), get persisted here
// verbatim, then a downstream classifier reads from this table to emit
// signals into `external_signals`.
//
// We keep both text_body and html_body so the classifier can re-run as the
// prompt evolves without re-fetching from the original sender.
//
// message_id is the email's RFC822 Message-ID header - unique so AgentMail's
// retry window can't double-store a message.

export interface InboundEmail {
  id: string;
  from_address: string;
  from_domain: string;
  subject: string | null;
  received_at: string;
  text_body: string | null;
  html_body: string | null;
  raw_size_bytes: number;
  classified_at: string | null;
  signals_emitted: number;
  message_id: string | null;
  // List-ID header (RFC-2919) extracted at webhook time. Optional so old
  // rows (pre-20260525 migration) still type-check; new inserts populate
  // when the header is present. See docs/filter-design.md §9.
  list_id?: string | null;
  // Resolved publisher canonical name (see src/lib/inbound-publishers.ts).
  // Optional for the same reason as list_id - old rows are NULL.
  publisher_canonical_name?: string | null;
  created_at: string;
}

export interface NewInboundEmail {
  from_address: string;
  from_domain: string;
  subject?: string | null;
  received_at?: string; // ISO; defaults to now() server-side
  text_body?: string | null;
  html_body?: string | null;
  raw_size_bytes: number;
  message_id?: string | null;
  list_id?: string | null;
  publisher_canonical_name?: string | null;
}

// Lightweight HTML → readable plaintext used to normalize newsletter bodies
// into a single markdown-ish column. Drops style/script/heavy tags, keeps line
// breaks, decodes the four common named entities. Pure; no network. Lives here
// (not newsletter-adapter) so the webhook can compute it at insert time before
// the classifier ever runs.
export function normalizeBodyMarkdown(
  textBody: string | null | undefined,
  htmlBody: string | null | undefined,
): string | null {
  if (textBody && textBody.trim().length > 0) return textBody;
  if (!htmlBody) return null;
  const stripped = htmlBody
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : null;
}

// Returns the persisted row, or null if a row with the same message_id
// already exists (dedup hit - AgentMail/Svix retried a webhook). Throws on
// any other Supabase error so the webhook can return 5xx and let Svix retry.
export async function insertInboundEmail(
  email: NewInboundEmail,
): Promise<InboundEmail | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("inbound_emails")
    .insert({
      from_address: email.from_address,
      from_domain: email.from_domain,
      subject: email.subject ?? null,
      received_at: email.received_at ?? new Date().toISOString(),
      text_body: email.text_body ?? null,
      html_body: email.html_body ?? null,
      // body_markdown powers /inbox display + the tsvector full-text index.
      // Computed at insert so the column is populated for every new row;
      // legacy rows backfill via a future maintenance task.
      body_markdown: normalizeBodyMarkdown(email.text_body, email.html_body),
      raw_size_bytes: email.raw_size_bytes,
      message_id: email.message_id ?? null,
      list_id: email.list_id ?? null,
      publisher_canonical_name: email.publisher_canonical_name ?? null,
    })
    .select()
    .single();
  if (error) {
    // 23505 = unique_violation. Treat as a dedup hit, not an error.
    if (error.code === "23505") return null;
    throw new Error(`inbound_emails insert failed: ${error.message}`);
  }
  return data as InboundEmail;
}

// Stamp an inbound email as classified, recording how many signals it
// produced and the last classifier error (if any) for observability + sweeper
// retry routing. Idempotent: safe to call multiple times if classification
// ever gets retried. When `classifierError` is omitted, the column is cleared
// — explicit success resets a prior error.
export async function markClassified(
  id: string,
  signalCount: number,
  classifierError?: string | null,
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("inbound_emails")
    .update({
      classified_at: new Date().toISOString(),
      signals_emitted: signalCount,
      classifier_error: classifierError ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(`inbound_emails update failed: ${error.message}`);
}

export async function getRecentInboundEmails(
  limit = 50,
): Promise<InboundEmail[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("inbound_emails")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`inbound_emails read failed: ${error.message}`);
  return (data ?? []) as InboundEmail[];
}

// Pull rows that haven't been classified yet - the work queue for the
// backfill sweeper cron. Inline classification in the webhook covers the
// happy path; this catches Haiku outages, Supabase blips, and any other
// transient failure that left a row with classified_at IS NULL.
//
// Oldest-first so a backlog drains in arrival order. Limit keeps each
// sweeper invocation under the Vercel function cap (one Haiku call ~3s,
// so 10 rows ≈ 30s).
export async function getUnclassifiedInboundEmails(
  limit = 10,
): Promise<InboundEmail[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("inbound_emails")
    .select("*")
    .is("classified_at", null)
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`inbound_emails read failed: ${error.message}`);
  return (data ?? []) as InboundEmail[];
}

// Counts for the settings-page health card. Cheap query: one filter + count.
export interface InboundStats {
  received24h: number;
  receivedTotal: number;
  lastReceivedAt: string | null;
}

export async function getInboundStats(): Promise<InboundStats> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [recent, total, last] = await Promise.all([
    sb
      .from("inbound_emails")
      .select("id", { count: "exact", head: true })
      .gte("received_at", since),
    sb.from("inbound_emails").select("id", { count: "exact", head: true }),
    sb
      .from("inbound_emails")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recent.error) throw new Error(`inbound_emails count failed: ${recent.error.message}`);
  if (total.error) throw new Error(`inbound_emails count failed: ${total.error.message}`);
  if (last.error) throw new Error(`inbound_emails read failed: ${last.error.message}`);

  return {
    received24h: recent.count ?? 0,
    receivedTotal: total.count ?? 0,
    lastReceivedAt: (last.data?.received_at as string | undefined) ?? null,
  };
}

// Snapshot used by the Market Intel empty state when external_signals is
// empty but inbound_emails is not - i.e. newsletters have arrived but the
// classifier hasn't emitted signals for them yet. Lets the page say
// "X newsletters waiting to be parsed" instead of the misleading "no
// market intel yet."
export interface InboundQueueSummary {
  totalCount: number;
  pendingCount: number;
  recent: Array<{
    id: string;
    from_domain: string;
    subject: string | null;
    received_at: string;
    classified_at: string | null;
  }>;
}

export async function getInboundQueueSummary(
  sampleSize = 5,
): Promise<InboundQueueSummary> {
  const sb = supabaseAdmin();
  const [total, pending, recent] = await Promise.all([
    sb.from("inbound_emails").select("id", { count: "exact", head: true }),
    sb
      .from("inbound_emails")
      .select("id", { count: "exact", head: true })
      .is("classified_at", null),
    sb
      .from("inbound_emails")
      .select("id, from_domain, subject, received_at, classified_at")
      .order("received_at", { ascending: false })
      .limit(sampleSize),
  ]);

  if (total.error) throw new Error(`inbound_emails count failed: ${total.error.message}`);
  if (pending.error) throw new Error(`inbound_emails count failed: ${pending.error.message}`);
  if (recent.error) throw new Error(`inbound_emails read failed: ${recent.error.message}`);

  return {
    totalCount: total.count ?? 0,
    pendingCount: pending.count ?? 0,
    recent: (recent.data ?? []) as InboundQueueSummary["recent"],
  };
}
