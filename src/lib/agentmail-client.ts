// AgentMail REST API client — thin typed wrapper around the inbox + lists
// endpoints. Used by scripts/provision-agentmail-inbox.ts today; any future
// outbound / management work (sending replies, polling messages as a
// webhook fallback) lands here too.
//
// Spec source (read before changing endpoint shapes):
//   https://docs.agentmail.to/llms.txt
//   https://docs.agentmail.to/llms-full.txt
//   https://docs.agentmail.to/api-reference/inboxes/create.mdx
//   https://docs.agentmail.to/api-reference/inboxes/get.mdx
//   https://docs.agentmail.to/api-reference/inboxes/lists/create.mdx
//
// All endpoints use `Authorization: Bearer ${AGENTMAIL_API_KEY}` per docs.
// Failure mode mirrors firecrawl-client.ts: 4xx → thrown Error tagged with
// the status, 5xx → thrown Error, network/abort → thrown Error. Callers
// (provisioning scripts, future cron jobs) decide whether to retry.
//
// TODO(agentmail): confirm endpoint shape against latest API docs. The
// constants block at the top is the only spot to change if the path moves
// (e.g. /v0 → /v1) or the response keys rename.

const AGENTMAIL_BASE = "https://api.agentmail.to";

// Path prefix per the llms-full.txt reference page. The curl example in the
// docs uses `/inboxes` (no prefix) while the api-reference paths use
// `/v0/inboxes` — we go with the versioned form as the safer default.
// TODO(agentmail): if requests 404, drop the /v0 prefix.
const INBOXES_PATH = "/v0/inboxes";

const REQUEST_TIMEOUT_MS = 25_000;

// ─── Types ───────────────────────────────────────────────────────────────

export interface CreateInboxOptions {
  /** Human-facing display name shown in AgentMail console + outbound headers. */
  displayName: string;
  /** Local-part of the desired address (the bit before @). */
  localPart: string;
  /**
   * Optional idempotency key the AgentMail API uses to deduplicate retries
   * of the same logical create. Recommended for scripts that may be re-run.
   */
  clientId?: string;
}

export interface CreatedInbox {
  inboxId: string;
  address: string;
}

export interface InboxDetails {
  id: string;
  address: string;
  /**
   * AgentMail does not currently surface a "webhook URL" field on the
   * inbox resource (webhooks are configured at the workspace level, one
   * endpoint can fan out to many inboxes). Surfaced here as `null` so the
   * caller still has a stable shape if AgentMail adds it later.
   * TODO(agentmail): replace with the real field if/when added.
   */
  webhookUrl: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "AGENTMAIL_API_KEY not set — required for src/lib/agentmail-client.ts. " +
        "Get one at console.agentmail.to → API Keys.",
    );
  }
  return key.trim();
}

// ─── Fetch wrapper ───────────────────────────────────────────────────────

interface RequestArgs {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

async function agentmailFetch<T>(args: RequestArgs): Promise<T> {
  const key = getApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${AGENTMAIL_BASE}${args.path}`, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`AgentMail request failed (network/abort): ${msg}`);
  }
  clearTimeout(timer);

  // Read the body once — even on error, AgentMail typically returns JSON
  // with `{ "error": "...", "message": "..." }`.
  const rawText = await res.text();
  let parsed: unknown = null;
  if (rawText.length > 0) {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      // Non-JSON response. Keep raw text for the error path.
    }
  }

  if (res.status >= 200 && res.status < 300) {
    return parsed as T;
  }

  // Distinguish 4xx vs 5xx in the error message so callers (and humans
  // reading logs) can tell config errors from upstream blips.
  const category = res.status >= 500 ? "5xx" : "4xx";
  const detail =
    parsed && typeof parsed === "object"
      ? JSON.stringify(parsed).slice(0, 240)
      : rawText.slice(0, 240) || "(empty body)";
  throw new Error(
    `AgentMail ${args.method} ${args.path} → HTTP ${res.status} (${category}): ${detail}`,
  );
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Create a new inbox.
 *
 * Per POST /v0/inboxes (see llms-full.txt §"Create Inbox"). The API accepts
 * `username` (local-part), `domain`, `display_name`, and an optional
 * `client_id` for idempotent retries. We let AgentMail choose the domain
 * (it provisions `<username>@agentmail.to` by default).
 */
export async function createInbox(
  opts: CreateInboxOptions,
): Promise<CreatedInbox> {
  if (!opts.displayName || opts.displayName.trim().length === 0) {
    throw new Error("createInbox: displayName required");
  }
  if (!opts.localPart || !/^[a-z0-9._-]+$/i.test(opts.localPart)) {
    throw new Error(
      `createInbox: localPart must match /^[a-z0-9._-]+$/i (got "${opts.localPart}")`,
    );
  }

  const body: Record<string, unknown> = {
    username: opts.localPart.toLowerCase(),
    display_name: opts.displayName,
  };
  if (opts.clientId) body.client_id = opts.clientId;

  // Per llms-full.txt the response carries `inbox_id` + `email`. We accept
  // a couple of plausible field names defensively in case the API has
  // since renamed them — flagged with TODO(agentmail).
  const raw = await agentmailFetch<Record<string, unknown>>({
    method: "POST",
    path: INBOXES_PATH,
    body,
  });

  const inboxId =
    typeof raw?.inbox_id === "string"
      ? raw.inbox_id
      : typeof raw?.id === "string"
        ? raw.id
        : null;
  const address =
    typeof raw?.email === "string"
      ? raw.email
      : typeof raw?.address === "string"
        ? raw.address
        : null;

  if (!inboxId || !address) {
    throw new Error(
      `createInbox: response missing inbox_id/email — got keys [${Object.keys(raw ?? {}).join(",")}]`,
    );
  }

  return { inboxId, address };
}

/**
 * Add a sender to the inbox's receive-allow list.
 *
 * Per POST /v0/inboxes/{inbox_id}/lists. Some AgentMail accounts require
 * explicit allowlisting on the AgentMail side in addition to the
 * INBOUND_SENDER_ALLOWLIST env we enforce in inbound-pipeline.ts.
 *
 * Body fields per docs: direction ("receive"), type ("allow"), entry (the
 * domain or address).
 */
export async function subscribeNewsletter(
  inboxId: string,
  fromAddress: string,
): Promise<void> {
  if (!inboxId) throw new Error("subscribeNewsletter: inboxId required");
  if (!fromAddress) {
    throw new Error("subscribeNewsletter: fromAddress required");
  }

  await agentmailFetch<unknown>({
    method: "POST",
    path: `${INBOXES_PATH}/${encodeURIComponent(inboxId)}/lists`,
    body: {
      direction: "receive",
      type: "allow",
      entry: fromAddress.trim().toLowerCase(),
    },
  });
}

/**
 * Fetch the inbox resource — used as a health check by the provisioning
 * script and as a future debugging primitive.
 *
 * Per GET /v0/inboxes/{inbox_id}.
 */
export async function getInbox(inboxId: string): Promise<InboxDetails> {
  if (!inboxId) throw new Error("getInbox: inboxId required");

  const raw = await agentmailFetch<Record<string, unknown>>({
    method: "GET",
    path: `${INBOXES_PATH}/${encodeURIComponent(inboxId)}`,
  });

  const id =
    typeof raw?.inbox_id === "string"
      ? raw.inbox_id
      : typeof raw?.id === "string"
        ? raw.id
        : null;
  const address =
    typeof raw?.email === "string"
      ? raw.email
      : typeof raw?.address === "string"
        ? raw.address
        : null;

  if (!id || !address) {
    throw new Error(
      `getInbox: response missing id/email — got keys [${Object.keys(raw ?? {}).join(",")}]`,
    );
  }

  // AgentMail doesn't currently return a webhook URL on the inbox resource
  // (see InboxDetails.webhookUrl docstring). Keep the field so callers can
  // depend on a stable shape.
  const webhookUrl =
    typeof raw?.webhook_url === "string" ? raw.webhook_url : null;

  return { id, address, webhookUrl };
}
