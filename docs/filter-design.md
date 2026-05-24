# Email Content Filter — design doc

> Author: design agent (D-Filter, Opus 4.7). Implementer: I-Filter.
> Scope: a content-level gate (Stage 1 deterministic rules + Stage 2
> Haiku 4.5 verdict) that sits BEFORE the existing newsletter classifier,
> plus a source-attribution layer that surfaces publisher + subject + view-
> source link + raw-email drawer on every signal on `/market-intel`. **No
> code in this doc — implementer owns the diff.**
> Cross-checked against: `orgs/checkbox/BUILD_ALIGNMENT.md` (11 principles),
> `orgs/checkbox/synthesis.md` (12 canonical signal_types + §2.3 `external_*`
> objects), `docs/newsletters/MASTER.md §2` (5 prerequisites — this doc
> subsumes §2.1 + §2.2), `AGENTS.md` (Next 16 caveats), `docs/ranker-design.md`
> (sister design doc, mirrored structure).

---

## 0. Decisions already made (do not relitigate)

Restated for the implementer so the design surface is honest about what is
fixed vs. what's an open call.

- **Two-stage filter.** Stage 1 = deterministic rules; Stage 2 = Haiku 4.5
  gate. Both stages always run for emails that pass Stage 1.
- **Single-shot Haiku tool-use** with strict JSON schema. Mirror the
  ranker's `submit_ranking` pattern: force a `submit_verdict` tool call.
- **Confidence threshold: 0.7.** Stage 2 verdicts with confidence < 0.7 →
  `needs_review` status.
- **`needs_review` is suppressed entirely in v1.** Not surfaced on
  `/market-intel`. Future v2 may add a hidden admin page; do NOT scope that.
- **Fail-CLOSED at the gate.** Haiku 5xx / malformed / timeout → email
  routes to `needs_review`, NOT auto-published. This is opposite to the
  ranker (which fails open). Reasoning: false positives in `/market-intel`
  are worse than missed items for an intel feed.
- **Provider neutrality carve-out applies (BUILD_ALIGNMENT #11).** Single-
  shot, stable cost, no chat — Anthropic-only Haiku 4.5 with no user picker.
  Same justification as ranker, newsletter classifier, and Sonnet digest.
- **Source attribution on every signal:** publisher chip + subject line +
  view-source link + raw-email drawer + sender domain footnote.
- **`publisher_canonical_name` column** on `external_signals` (and
  `inbound_emails`) — subsumes MASTER.md §2.2 prerequisite.
- **List-ID header extraction** on inbound emails (RFC-2919) — subsumes
  MASTER.md §2.1 prerequisite. Adds `list_id` column to `inbound_emails`.
  Used by Stage 1 for publisher dedup before the classifier sees the email.
- **Stage 1 rules (deterministic).** Subject regex blocks, sender-role
  blocks, body-statistic thresholds, auto-reply/bounce header blocks. Full
  catalog in §5; every magic number is named and tunable.
- **Audit table `email_filter_decisions`:** one row per gate decision
  (Stage 1 reject, Stage 2 verdict, low-confidence routing). Captures
  `inbound_email_id, stage (1|2), verdict, confidence, reasoning, model,
  prompt_version, decided_at, manually_overridden, override_reason`.
- **Manual override:** "Mark as bad signal" button on `/market-intel`
  signal cards writes to `email_filter_decisions` with `manually_overridden
  =true` + `override_reason`. New tiny API route `/api/admin/signal-feedback`.
  Gated by existing `requireUiSession()`.
- **Prompt versioning.** Every change to the Stage 2 prompt bumps a
  `STAGE2_PROMPT_VERSION` constant. Audit queries answer "which emails were
  classified under v3?"
- **No re-classify on prompt change in v1.** Forward-apply only.
  Documented escape hatch: a single SQL `DELETE FROM email_filter_decisions
  WHERE prompt_version='<old>'` plus a backfill cron re-run picks them up.
- **"View source" link extraction.** First URL in body that is NOT
  unsubscribe / preferences / tracking / list-management. Heuristic, ~95%
  correct. Raw-email drawer is the fallback when extraction returns null.

---

## 1. Files to create

| Path | Purpose |
|---|---|
| `src/lib/email-filter-types.ts` | Pure type module: `FilterInput`, `Stage1Result`, `Stage2Verdict`, `FilterDecision`, `FilterResult`, `EmailFilterRejectReason`, `PublisherInfo`, `Stage2Output`. No imports beyond `InboundEmail`. |
| `src/lib/email-filter-stage1.ts` | Deterministic Stage 1 rules. Exports `runStage1(email): Stage1Result`. Pure function, no I/O. All magic numbers exported as named constants for test + tunability. |
| `src/lib/email-filter-stage2-prompt.ts` | Exports `STAGE2_PROMPT_VERSION` constant + `getStage2SystemPrompt({publisherInfo})`. Mirrors `ranker-system-prompt.ts` pattern. |
| `src/lib/email-filter.ts` | Public entry: `filterEmail(email): Promise<FilterResult>`. Owns the Stage 1 → Stage 2 orchestration, fail-closed routing, audit write, and the `proceed | needs_review | rejected` decision. |
| `src/lib/email-filter-decisions.ts` | Supabase CRUD for `email_filter_decisions`. `writeDecision(decision)`, `markOverridden(inbound_email_id, reason)`, `getDecisionsFor(inbound_email_id)`. Write failures log + swallow — never block the classifier. |
| `src/lib/email-filter.test.ts` | Vitest cases for Stage 1 rules, Stage 2 verdicts, fail-closed, audit writes, schema rejection. ~18 cases — see §10. |
| `src/lib/inbound-publishers.ts` | Pure lookup: `resolvePublisher({list_id, sender_domain}): PublisherInfo` returning `{publisher_canonical_name, display_name, source_url_origin?}`. Keyed map. Falls back to `sender_domain` when no entry matches. |
| `src/lib/extract-lead-article-url.ts` | Pure helper: `extractLeadArticleUrl(htmlOrText): string | null`. URL-extraction heuristic per §9. Exported standalone so the test suite can fixture-drive it (Substack, Beehiiv, Industry Dive, Campaign Monitor). |
| `src/app/api/admin/signal-feedback/route.ts` | POST `{signal_id, reason}`. Looks up the signal's `inbound_email_id`, writes an `email_filter_decisions` row with `manually_overridden=true`. Gated by `requireUiSession()`. Fail-closed on missing session. |
| `src/components/signal-source-chip.tsx` | Small client component (or inline server) rendering a row of attribution: publisher chip + subject + view-source link + "view raw email" drawer trigger. Reused by `/market-intel` ranked + chronological tables. |
| `src/components/raw-email-drawer.tsx` | Client drawer that lazy-fetches `/api/admin/inbound-email/[id]` and renders subject + sender + received_at + sanitized body (text first, HTML in iframe with `sandbox`). Used by `signal-source-chip`. |
| `src/app/api/admin/inbound-email/[id]/route.ts` | GET `/api/admin/inbound-email/<id>`. Returns the row from `inbound_emails` (subject, from_address, received_at, text_body, html_body). Gated by `requireUiSession()`. |
| `supabase/migrations/20260525_email_filter_decisions.sql` | Creates `email_filter_decisions` table + RLS deny-all. **Must be run manually in Supabase Studio.** |
| `supabase/migrations/20260525_external_signals_source_attribution.sql` | `ALTER TABLE external_signals ADD COLUMN publisher_canonical_name TEXT, source_url TEXT, inbound_email_id UUID, email_subject TEXT;` plus `ALTER TABLE inbound_emails ADD COLUMN list_id TEXT, publisher_canonical_name TEXT;`. Adds an index on `(inbound_email_id)` for the drawer lookup. **Must be run manually.** |

**Total new files: 13** (10 src + 1 component + 1 API route + 2 migrations,
counting the per-route folder as one file).

---

## 2. Files to modify

| Path | Change |
|---|---|
| `src/app/api/cron/classify-pending/route.ts` | Wrap the existing `classifyNewsletter()` call with `filterEmail()`. If `decision === "proceed"`: existing path runs; the resulting signals carry `publisher_canonical_name`, `email_subject`, `inbound_email_id`, `source_url`. If `decision === "rejected" | "needs_review"`: mark the inbound_email classified with `signals_emitted=0` so it stops cycling through the sweeper queue. Audit row written by `filterEmail()` in either case. |
| `src/lib/newsletter-adapter.ts` | Accept an optional `PublisherInfo` arg (or `list_id` + `publisher_canonical_name`). On signal construction, populate the four new columns from inputs already in scope. Keep the existing `meta.inbound_email_id`, `meta.sender_domain`, `meta.newsletter_subject`, `meta.mention` keys — those are how the current UI reads them today; the new top-level columns are a parallel surface so `/market-intel` queries don't need to dig into JSONB. |
| `src/lib/external-signals.ts` | Add the 4 new optional columns to `ExternalSignal` + `NewExternalSignal` types (`publisher_canonical_name`, `source_url`, `inbound_email_id`, `email_subject`). Dedup function stays unchanged (still keys on `(account_id, url)`). |
| `src/lib/inbound-email.ts` | Add `list_id`, `publisher_canonical_name` to the `InboundEmail` type. `insertInboundEmail()` accepts and persists them. Add a new `extractListId(headers)` helper or accept `list_id` as a pre-extracted field on `NewInboundEmail` (implementer's choice — see §12). |
| `src/lib/inbound-pipeline.ts` | Extract `List-ID` from the normalized payload's headers (requires the webhook handler to forward headers — see next row). Resolve `PublisherInfo` via `inbound-publishers.ts` before insert. Persist on the row. The existing inline `classifyAndPersist()` path also runs `filterEmail()` first; same routing logic as the cron sweeper. |
| `src/app/api/inbound-email/agentmail/route.ts` | Add a `headers` field to the `NormalizedInboundEmail` shape (or just `list_id` if extraction happens here) and forward AgentMail's `message.headers` if available. The Svix verification stays unchanged. |
| `src/app/market-intel/page.tsx` | Render `<SignalSourceChip signal={s} />` in both the ranked + chronological tables. The chip handles the publisher chip + subject + "view source" link + raw-email drawer trigger inline. The existing `meta.sender_domain` rendering becomes a small fallback caption when `publisher_canonical_name` is missing (older rows). |

**Total modified: 7** (one beyond the brief's ~5 estimate because the
webhook handler must forward headers + the pipeline must extract before
insert — easy to forget if not enumerated).

---

## 3. Types

All new types live in `src/lib/email-filter-types.ts`. They reference
`InboundEmail` and `ExternalSignal` but never duplicate fields; the goal is
that adding a column to `InboundEmail` doesn't cascade into the filter.

```ts
import type { InboundEmail } from "./inbound-email";

// What the filter receives. Single email, already persisted to inbound_emails.
// publisherInfo is resolved upstream (by the webhook/pipeline) so the filter
// doesn't have to re-do publisher lookup.
export interface FilterInput {
  email: InboundEmail;          // full row, including text_body + html_body
  publisherInfo: PublisherInfo; // already resolved (may be a degenerate
                                // "unknown" entry — see PublisherInfo)
  now: Date;                    // pass-in for testability — no Date.now in core
}

// Resolved publisher identity. The same publication can route through
// multiple sender domains (Endpoints uses endpts.com AND endpointsnews.com
// AND Campaign Monitor relays — MASTER.md §2.2). `publisher_canonical_name`
// is the join key; `display_name` is what the UI shows; `source_url_origin`
// is an optional hint for extractLeadArticleUrl() when a publisher has a
// known article-URL pattern (e.g. all Substack lead URLs share an origin).
export interface PublisherInfo {
  publisher_canonical_name: string;   // "endpoints_news" — slug, lowercase
  display_name: string;               // "Endpoints News"
  source_url_origin?: string;         // "https://endpts.com" — optional hint
  is_known: boolean;                  // false when we fell back to sender_domain
}

// Stage 1 deterministic output. `accepted` means "pass through to Stage 2";
// `rejected` means "do not call Haiku, write audit row, mark the inbound
// email classified with 0 signals."
export type Stage1Result =
  | { accepted: true; body_chars: number; link_ratio: number; list_id: string | null }
  | { accepted: false; reason: EmailFilterRejectReason; detail: string };

// The 5 deterministic rejection families. Each maps to a Stage 1 rule
// group in §5. `detail` on Stage1Result.rejected carries which sub-rule
// fired (e.g., "subject_regex:password_reset").
export type EmailFilterRejectReason =
  | "subject_pattern"        // §5.1 subject regex hit
  | "sender_role"            // §5.2 no-reply/billing/support/etc.
  | "body_thin_or_link_only" // §5.3 <200 words OR >90% link content OR only unsubscribe/preferences
  | "auto_reply_or_bounce"   // §5.4 Auto-Submitted / X-Autoreply / Delivery-Status header
  | "empty_body";            // §5.5 trimmed body <50 chars after stripHtml

// Stage 2 Haiku verdict. The full enum is the 4 values from the brief.
export type Stage2Verdict = "newsworthy" | "logistics" | "promotional" | "other";

// Tool-use output shape. Haiku is forced to call `submit_verdict` with
// exactly this object. The implementer post-validates length + range
// defensively (matches ranker pattern).
export interface Stage2Output {
  verdict: Stage2Verdict;
  confidence: number;        // 0..1 inclusive
  reasoning: string;         // ≤200 chars, plain prose, one sentence
}

// A single audit row. Written at every gate decision branch — including
// rejects (stage=1) and low-confidence routing (stage=2, manually_overridden
// stays false until a human flips it via the feedback API).
export interface FilterDecision {
  inbound_email_id: string;          // FK → inbound_emails.id
  stage: 1 | 2;                       // which gate produced the decision
  verdict: Stage2Verdict | "stage1_rejected";  // 5 distinct values total
  confidence: number | null;          // null on Stage 1 rejects + on no_api_key path
  reasoning: string;                  // Stage 1: which sub-rule fired. Stage 2: model's prose.
  model: string | null;               // "claude-haiku-4-5" or null on Stage 1
  prompt_version: string;             // "stage2-v1" (matches STAGE2_PROMPT_VERSION)
  decided_at: string;                 // ISO; defaults to now() server-side
  manually_overridden: boolean;       // false by default; flipped by /api/admin/signal-feedback
  override_reason: string | null;     // free-text from the operator
}

// Final result returned to the caller (cron sweeper or webhook pipeline).
// The caller dispatches based on `decision`:
//   - "proceed"      → run the existing newsletter classifier
//   - "needs_review" → mark classified, signals_emitted=0; future admin page surfaces these
//   - "rejected"     → mark classified, signals_emitted=0
export interface FilterResult {
  decision: "proceed" | "needs_review" | "rejected";
  stage1: Stage1Result;
  stage2?: Stage2Output;             // present only when Stage 1 accepted + Stage 2 ran
  stage2_failure?: Stage2FailureReason;  // present only on fail-closed paths
  publisherInfo: PublisherInfo;      // echoed for the classifier to pass through
  decision_id?: string;              // PK of the audit row, when write succeeded
}

// Why Stage 2 didn't return a usable verdict. All of these route to needs_review
// (fail-CLOSED) except `no_api_key` which is the operator's deployment choice —
// see §8 for the rationale.
export type Stage2FailureReason =
  | "no_api_key"            // ANTHROPIC_API_KEY missing
  | "haiku_5xx"             // any 5xx from Anthropic (after SDK retries)
  | "haiku_timeout"         // request exceeded 15s wall clock
  | "haiku_malformed_json"  // parser couldn't validate response
  | "haiku_schema_violation" // valid JSON, failed our schema
  | "low_confidence";       // verdict ok but confidence < 0.7
```

**Integration with existing `InboundEmail`.** The two new persisted fields
(`list_id`, `publisher_canonical_name`) are added as optional columns on
the table + optional fields on the type. Every existing read path keeps
working — old rows simply have NULL. `insertInboundEmail()` accepts them
as optional inputs; webhook callers pass them, the sweeper backfills nothing
(forward-apply only, like the prompt-version policy).

**Integration with existing `ExternalSignal`.** Four new optional columns
(`publisher_canonical_name`, `source_url`, `inbound_email_id`, `email_subject`)
on `external_signals`. The cron sweeper's `classifyNewsletter()` call
populates them on every new write. The page renders the chip when at least
`publisher_canonical_name` is present; older rows degrade gracefully to the
`meta.sender_domain` fallback.

---

## 4. Prompt design

### System prompt — ready to paste

`src/lib/email-filter-stage2-prompt.ts` exports `STAGE2_PROMPT_VERSION =
"stage2-v1"` and `getStage2SystemPrompt({publisherInfo}): string`. Full
text below. `{publisherInfo}` is the only template hole.

```
You are the content gate for Dugout's market-intel inbox. Your one job is
to decide whether this email contains real newsletter content worth
classifying into signals, or whether it is subscription admin, billing,
promotional marketing, or some other non-signal artifact.

You are NOT the classifier. You do not extract entities, identify events,
or label signal types. A downstream Haiku classifier handles that — but
only for emails YOU approve as `newsworthy`. False positives here pollute
Dugout's `/market-intel` page; false negatives miss intel. Both matter;
the threshold below biases the system slightly toward fail-closed (per
Dugout product principle: trust over reach).

# What the user message contains
- Publisher: canonical name + display name (already resolved upstream)
- Sender domain and full From address
- Subject line
- A truncated plaintext body (first ~8,000 chars; HTML stripped)

# The four verdicts

`newsworthy` — substantive editorial content covering business events,
deals, regulatory actions, product launches, leadership moves, market
analysis, vertical trends. The kind of thing an AE or sales manager would
benefit from seeing in their morning intel feed. Examples: Axios Pro Rata
deal roundup, CFO Dive lead article on a Fortune 500 reorg, Endpoints News
clinical-trial update, Money Stuff column on a market dislocation.

`logistics` — anything about the subscription itself, the publisher's
business operations, or the reader's account. Examples: "Confirm your
subscription," "Welcome to Brainyacts!", "Your free trial ends in 3 days,"
"Your billing receipt," "We're updating our terms of service," password
resets, calendar holds, webinar invites with no editorial substance.

`promotional` — vendor marketing dressed as content. Sponsored deep-dives,
product announcements from a single vendor with no broader context, demo
booking pushes, "Want to see how our customers got 4× ROI?" — the
classifier would just extract a press_release signal that adds zero value
to the intel feed. When in doubt between `promotional` and `newsworthy`,
ask: would this email be the *only* place the AE encounters this fact, or
is it the vendor amplifying its own announcement?

`other` — anything that fits none of the above. Out-of-office auto-replies
that somehow slipped through, transactional notifications, bounce-back
messages, RSS aggregators that arrived as email, multi-language emails
where the editorial substance is below the language barrier. Use sparingly
— if a piece of editorial content is in English and on-topic, prefer
`newsworthy`.

# Hard constraints (BUILD_ALIGNMENT principles enforced)

- **Voice (#8).** `reasoning` is plain prose, ≤200 chars, ONE sentence,
  no markdown, no emoji, no exclamation marks. Describe what you see; do
  not editorialize about the publisher.
- **Read-only (#9).** Do not include action recommendations in `reasoning`
  ("the AE should…"). You are a gate, not a recommender.
- **Provider neutrality carve-out (#11).** This filter is Anthropic-only
  Haiku 4.5 by design — single-shot, stable cost, no chat. Do not propose
  prompting the user, requesting clarification, or any multi-turn pattern.
- **No fact invention.** Your `reasoning` must be supported by the email's
  own subject and body. If the body is empty or ambiguous, say so.

# Confidence — what the number means

- `0.9 – 1.0` — Unambiguous. A canonical example of the verdict you picked.
- `0.7 – 0.89` — Confident. Some ambiguity but the verdict clearly wins.
- `0.5 – 0.69` — Uncertain. Could be the verdict you picked or one
  neighbor. Dugout's downstream pipeline routes < 0.7 to a `needs_review`
  bucket; emit honest numbers below 0.7 rather than reaching for false
  certainty.
- `< 0.5` — Genuinely cannot decide. Pick the most likely verdict and
  emit the low number; the pipeline will route appropriately.

# Publisher context
{publisherInfo}

# Output format (tool-use, mandatory)
You MUST emit your answer via the `submit_verdict` tool. Free-text replies
will be rejected. The tool's input schema is enforced; emit JSON that
satisfies it on the first try.
```

### Tool / structured output schema

Same shape as the ranker's `submit_ranking`: one tool, forced via
`tool_choice: { type: "tool", name: "submit_verdict" }`.

```json
{
  "name": "submit_verdict",
  "description": "Submit the gate verdict. Call this exactly once.",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["verdict", "confidence", "reasoning"],
    "properties": {
      "verdict": {
        "type": "string",
        "enum": ["newsworthy", "logistics", "promotional", "other"]
      },
      "confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "reasoning": {
        "type": "string",
        "minLength": 10,
        "maxLength": 200
      }
    }
  }
}
```

The wrapper ALSO post-validates: `verdict` ∈ the 4 enum values, `confidence`
∈ [0, 1] and finite, `reasoning.length` ≤ 200 (the schema's maxLength is
also enforced server-side but defensive — see ranker §4 for the same
pattern). Any failure → `Stage2FailureReason = "haiku_schema_violation"`
→ `needs_review`.

### User message template

```
Publisher: {display_name} ({publisher_canonical_name})
Sender domain: {from_domain}
From address: {from_address}
Subject: {subject}
Received: {received_at}

Body (first {body_chars} chars, HTML stripped):
{plaintext_body_excerpt}
```

`plaintext_body_excerpt` is the same `emailBodyForClassification()` output
the existing newsletter-adapter uses — text_body when present, else
stripped HTML — capped at 8,000 chars (lower than the classifier's 12K
because the gate doesn't need full context; the verdict is usually decidable
from the first few hundred chars).

### Which BUILD_ALIGNMENT principles the prompt enforces

- **#2 (Canonical signal_types only).** The prompt explicitly notes the
  filter does NOT label signal_types — that's the downstream classifier's
  job. The filter only emits the 4 verdicts above; the canonical 12 are
  not referenced (no risk of invented types here).
- **#6 (Evidence chain mandatory).** Every audit row references the
  source `inbound_email_id` — the gate's decision is itself part of the
  evidence trail. Downstream signals carry `inbound_email_id` so any
  signal can drill back to the raw email AND to the gate verdict that
  let it through.
- **#8 (Voice).** Explicit ban on markdown/emoji/exclamation, 200-char
  cap, one sentence.
- **#9 (Read-only v1).** "Do not include action recommendations" — the
  gate is plumbing, not advice.
- **#11 (Provider neutrality carve-out).** Stated in the prompt + in the
  PR description: single-shot, stable cost, no chat ⇒ Anthropic-only is
  the right call. Matches the ranker, newsletter classifier, and Sonnet
  digest — every other model-specific surface in Dugout.

---

## 5. Stage 1 rules (deterministic algorithm)

Lives in `src/lib/email-filter-stage1.ts`. Pure function, no I/O. All
magic numbers exported as named constants so the test file (and a future
RevOps tuning pass) can adjust without editing logic.

```ts
// Tunable constants — exported so the test file imports the exact value
// rather than re-typing it. Tweaks happen here, not in scattered literals.
export const MIN_BODY_WORDS = 200;
export const MAX_LINK_RATIO = 0.90;          // text-content-to-link-content ratio ceiling
export const MIN_BODY_CHARS_AFTER_STRIP = 50;
export const BODY_TRUNCATION_FOR_STATS = 20_000;  // cap before counting words/links

// Subject patterns that mean "this is admin, not editorial." Anchored
// where possible to reduce false positives on real subjects that happen
// to contain the phrase ("Welcome to the AI age" should NOT match — the
// regex requires `welcome` to be followed by "to your" / "to our" / a
// quoted product name, not generic prose).
export const SUBJECT_REJECT_PATTERNS: Array<{ re: RegExp; tag: string }> = [
  { re: /^\s*welcome\s+to\s+(your|our|the\s+\S+\s+(team|community|family))/i, tag: "welcome" },
  { re: /\bconfirm\s+your\b/i, tag: "confirm_your" },
  { re: /\b(password|account)\s+reset\b/i, tag: "password_reset" },
  { re: /\byour\s+(receipt|invoice|order|subscription|billing\s+statement)\b/i, tag: "billing_receipt" },
  { re: /\bout\s+of\s+(the\s+)?office\b/i, tag: "out_of_office" },
  { re: /\bauto[-\s]?reply\b/i, tag: "autoreply" },
  { re: /\b(webinar|workshop)\s+(invite|invitation|reminder|registration)\b/i, tag: "webinar_invite" },
  { re: /\b(verify|verification)\s+(your|code|link)\b/i, tag: "verify" },
  { re: /\b(unsubscribe|update\s+(your\s+)?(preferences|subscription))\b/i, tag: "unsub_in_subject" },
  { re: /\b(payment|card)\s+(failed|declined|expired)\b/i, tag: "payment_failed" },
];

// Sender LOCAL-PART role prefixes. Match on the part before `@` only —
// `marketing@artificiallawyer.com` is fine (whole-domain newsletter),
// `support@artificiallawyer.com` is not. Paired with body characteristics
// below: a `noreply@` sender is a hard reject only if the body also looks
// thin (Substack uses `noreply@` for legit content; we don't want to
// blanket-reject those).
export const SENDER_ROLE_HARD_REJECT = new Set([
  "billing", "invoicing", "accounts-receivable", "ar", "ap",
  "calendar", "calendars", "scheduler",
  "noreply-billing", "noreply-receipts",
]);

// Sender roles that reject ONLY when paired with a weak body. These are
// the ambiguous ones — Substack noreply@substack.com is legit; Salesforce
// noreply@email.salesforce.com is usually trial-spam.
export const SENDER_ROLE_WEAK_REJECT = new Set([
  "no-reply", "noreply", "do-not-reply", "donotreply",
  "support", "notifications", "alerts", "system",
]);

// Auto-reply + bounce headers. Names are case-insensitive (matched via
// .toLowerCase()) and presence-only — value sniffing is brittle across
// MTAs. RFC-3834 for Auto-Submitted; X-Autoreply is the Postini/legacy
// convention; X-Failed-Recipients is the standard bounce marker.
export const AUTO_REPLY_HEADERS = [
  "auto-submitted",        // RFC-3834; value typically "auto-replied" or "auto-generated"
  "x-autoreply",           // any presence
  "x-autorespond",
  "x-mailer-autoreply",
];
export const BOUNCE_HEADERS = [
  "x-failed-recipients",   // delivery failure
  "x-bounce-info",
];
// Auto-Submitted: skip when value is "no" — only reject on "auto-replied"
// or "auto-generated" per RFC-3834. Other auto-reply headers reject on
// presence alone.

// Calendar attachment marker — easiest sniff is the body content-type
// signature when the webhook gives us multipart info; falls back to
// looking for "Content-Type: text/calendar" / "method=REQUEST" in the
// raw body. Keeps the rule cheap.
```

### Algorithm — exact order of operations

```
function runStage1(email: InboundEmail, headers: HeaderMap): Stage1Result {
  // ── 5.4: bounce + auto-reply check (cheapest, runs first) ──────────────
  for (const h of BOUNCE_HEADERS) {
    if (headers.has(h)) {
      return { accepted: false, reason: "auto_reply_or_bounce",
               detail: `bounce_header:${h}` };
    }
  }
  if (headers.get("auto-submitted")?.toLowerCase().startsWith("auto-")) {
    return { accepted: false, reason: "auto_reply_or_bounce",
             detail: "auto_submitted" };
  }
  for (const h of AUTO_REPLY_HEADERS) {
    if (h === "auto-submitted") continue;  // handled above
    if (headers.has(h)) {
      return { accepted: false, reason: "auto_reply_or_bounce",
               detail: `header:${h}` };
    }
  }

  // ── 5.1: subject pattern check ─────────────────────────────────────────
  const subject = (email.subject ?? "").trim();
  for (const { re, tag } of SUBJECT_REJECT_PATTERNS) {
    if (re.test(subject)) {
      return { accepted: false, reason: "subject_pattern",
               detail: `subject_regex:${tag}` };
    }
  }

  // ── 5.5: empty body check (cheaper than role check; do it before stats) ─
  const plaintext = emailBodyForClassification(email);  // existing helper
  if (plaintext.trim().length < MIN_BODY_CHARS_AFTER_STRIP) {
    return { accepted: false, reason: "empty_body",
             detail: `body_chars=${plaintext.trim().length}` };
  }

  // ── 5.3: body stats — words + link ratio + only-unsub check ────────────
  const truncated = plaintext.slice(0, BODY_TRUNCATION_FOR_STATS);
  const wordCount = countWords(truncated);
  const linkRatio = computeLinkRatio(email.html_body ?? "", truncated);
  const isOnlyUnsubLinks = onlyUnsubAndPreferenceLinks(email.html_body ?? "");

  if (wordCount < MIN_BODY_WORDS) {
    return { accepted: false, reason: "body_thin_or_link_only",
             detail: `word_count=${wordCount} < ${MIN_BODY_WORDS}` };
  }
  if (linkRatio > MAX_LINK_RATIO) {
    return { accepted: false, reason: "body_thin_or_link_only",
             detail: `link_ratio=${linkRatio.toFixed(2)} > ${MAX_LINK_RATIO}` };
  }
  if (isOnlyUnsubLinks) {
    return { accepted: false, reason: "body_thin_or_link_only",
             detail: "only_unsub_links" };
  }

  // ── 5.2: sender role check (last — most context-dependent) ─────────────
  const localPart = email.from_address.split("@")[0].toLowerCase();
  if (SENDER_ROLE_HARD_REJECT.has(localPart)) {
    return { accepted: false, reason: "sender_role",
             detail: `local_part:${localPart}` };
  }
  if (SENDER_ROLE_WEAK_REJECT.has(localPart) && wordCount < 400) {
    // ambiguous role + thin-ish body → reject
    return { accepted: false, reason: "sender_role",
             detail: `local_part:${localPart} + word_count=${wordCount}` };
  }

  // ── Calendar attachment check ──────────────────────────────────────────
  if (hasCalendarAttachment(email, headers)) {
    return { accepted: false, reason: "subject_pattern",
             detail: "ics_attachment" };
  }

  const listId = headers.get("list-id") ?? null;
  return {
    accepted: true,
    body_chars: plaintext.length,
    link_ratio: linkRatio,
    list_id: listId,
  };
}
```

### Helper specs

```
countWords(plaintext):
  return plaintext.trim().split(/\s+/).filter(w => w.length > 0).length

computeLinkRatio(html, plaintext):
  // Approx: total chars inside <a>...</a> divided by total visible chars.
  // When html is empty, use plaintext URL count × avg URL len as numerator.
  const anchorText = sum(match.length for match of html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi))
  const visibleText = plaintext.length
  if (visibleText === 0) return 1.0
  return Math.min(1.0, anchorText / visibleText)

onlyUnsubAndPreferenceLinks(html):
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  if (anchors.length === 0) return false  // can't tell — not "only" anything
  const isUnsubLike = (href, text) =>
    /unsubscribe|preferences|email[-_ ]?settings|manage[-_ ]?subscription/i.test(href + " " + text)
  return anchors.every(a => isUnsubLike(a[1], a[2]))

hasCalendarAttachment(email, headers):
  const ct = headers.get("content-type") ?? ""
  if (/text\/calendar/i.test(ct)) return true
  if (/method=REQUEST/i.test(ct)) return true
  // Fallback for cases where AgentMail flattened the parts:
  if (/BEGIN:VCALENDAR/i.test(email.text_body ?? "")) return true
  return false
```

### Tunable constants summary (for review)

| Constant | Value | What it gates | Why this number |
|---|---|---|---|
| `MIN_BODY_WORDS` | 200 | Reject thin emails | Newsletter median is ~600 words; 200 is well below the floor but above transactional messages (~50). |
| `MAX_LINK_RATIO` | 0.90 | Reject link-farms | A real newsletter has prose; a "your account" email is mostly buttons. 0.90 keeps Industry Dive's brief-roundup format (~70% links) on the safe side. |
| `MIN_BODY_CHARS_AFTER_STRIP` | 50 | Empty-body short-circuit | Catches the `<p>&nbsp;</p>`-only HTML pattern that stripHtml reduces to noise. |
| `BODY_TRUNCATION_FOR_STATS` | 20,000 | Cap counting cost | The first 20K chars contain enough signal for stats; full-body iteration adds ~5ms on long emails. |
| `SUBJECT_REJECT_PATTERNS` | 10 regexes | Subject-level admin signal | Hand-picked from a manual sample of ~50 AgentMail inbox messages. Bias toward false negatives — better to let Stage 2 catch borderline cases. |
| `SENDER_ROLE_HARD_REJECT` | 7 prefixes | Role-account hard block | Roles that are NEVER editorial (`billing`, `calendar`). |
| `SENDER_ROLE_WEAK_REJECT` | 8 prefixes | Role-account contextual block | `noreply` etc. — combined with body word count for context (Substack uses these for real content). |
| 400 | sender-weak-reject body-word threshold | Border above which `noreply@` sends are trusted as editorial | Empirically: real newsletters always exceed 400 words; admin emails almost never. |

Every constant is exported. The test file imports them and asserts the
threshold values so any change is a deliberate test-update.

---

## 6. Data flow

Text sequence covering both entry points (inline webhook + cron sweeper).
The filter is identical in both; only the dispatch differs.

```
A) Webhook entry path (push)
──────────────────────────────────────────────────────────────────────────
POST /api/inbound-email/agentmail
  → Svix signature verify
  → normalize to NormalizedInboundEmail
  → extract headers, including List-ID (NEW: webhook handler forwards them)
  → processInboundEmail(normalized, "agentmail")
      → sender allowlist check (existing)
      → resolvePublisher({list_id, sender_domain}) → PublisherInfo
      → insertInboundEmail({..., list_id, publisher_canonical_name})
      → classifyAndPersist(row, "agentmail")
         │
         ↓
         (B) shared filter+classify pipeline — see below
         │
      → return outcome to webhook

B) Cron sweeper entry path (pull)
──────────────────────────────────────────────────────────────────────────
GET /api/cron/classify-pending
  → CRON_SECRET auth
  → getUnclassifiedInboundEmails(10)
  → for each row:
      → resolvePublisher({list_id: row.list_id, sender_domain: row.from_domain})
      → classifyAndPersist(row, "sweeper")
         │
         ↓
         (B) shared filter+classify pipeline ↓

B) Shared filter+classify pipeline (the new part)
──────────────────────────────────────────────────────────────────────────
classifyAndPersist(row, source):
  filterResult = await filterEmail({email: row, publisherInfo, now})
  │
  ├─ Stage 1 runs (pure function, ~1ms)
  │   ├─ if Stage 1 rejects:
  │   │   → writeDecision({stage:1, verdict:"stage1_rejected",
  │   │                    confidence:null, reasoning:detail,
  │   │                    model:null, prompt_version:"stage2-v1",
  │   │                    manually_overridden:false})
  │   │   → log "[email-filter] rejected stage1 reason=<reason> id=<id>"
  │   │   → return { decision:"rejected", stage1, publisherInfo }
  │   │
  │   └─ if Stage 1 accepts:
  │       continue to Stage 2 ↓
  │
  ├─ Stage 2 check: HAS_ANTHROPIC_KEY?
  │   ├─ NO  → writeDecision({stage:2, verdict:"other", confidence:0,
  │   │                       reasoning:"no_api_key — Stage 2 skipped",
  │   │                       model:null, prompt_version:"stage2-v1"})
  │   │       → log "[email-filter] needs_review stage2_failure=no_api_key"
  │   │       → return { decision:"needs_review", stage1,
  │   │                  stage2_failure:"no_api_key", publisherInfo }
  │   │
  │   └─ YES → continue to Haiku call ↓
  │
  ├─ Haiku call (single-shot, tool_choice=submit_verdict, 15s wall clock)
  │   ├─ 5xx / timeout / malformed / schema_violation:
  │   │   → writeDecision({stage:2, verdict:"other", confidence:0,
  │   │                    reasoning:`fail-closed: <reason>`,
  │   │                    model:"claude-haiku-4-5",
  │   │                    prompt_version:"stage2-v1"})
  │   │   → log "[email-filter] needs_review stage2_failure=<reason>"
  │   │   → return { decision:"needs_review", stage1,
  │   │              stage2_failure:<reason>, publisherInfo }
  │   │
  │   └─ valid Stage2Output { verdict, confidence, reasoning }:
  │       → writeDecision({stage:2, verdict, confidence, reasoning,
  │                        model:"claude-haiku-4-5",
  │                        prompt_version:"stage2-v1"})
  │       │
  │       ├─ confidence < 0.7:
  │       │   → log "[email-filter] needs_review low_confidence verdict=<v>"
  │       │   → return { decision:"needs_review", stage1, stage2,
  │       │              stage2_failure:"low_confidence", publisherInfo }
  │       │
  │       ├─ confidence >= 0.7 AND verdict === "newsworthy":
  │       │   → log "[email-filter] proceed verdict=newsworthy conf=<n>"
  │       │   → return { decision:"proceed", stage1, stage2, publisherInfo }
  │       │
  │       └─ confidence >= 0.7 AND verdict !== "newsworthy":
  │           → log "[email-filter] rejected stage2 verdict=<v>"
  │           → return { decision:"rejected", stage1, stage2, publisherInfo }

C) Dispatch (caller acts on FilterResult.decision)
──────────────────────────────────────────────────────────────────────────
  if (decision === "proceed"):
    → classifyNewsletter(email, trackable, publisherInfo)  // existing, with PublisherInfo passed through
    → insertSignalsDedup(signals)  // signals carry publisher_canonical_name, source_url, inbound_email_id, email_subject
    → markClassified(email.id, signals.length)
  else:  // "needs_review" | "rejected"
    → markClassified(email.id, 0)  // stops the sweeper re-queueing
    // (the audit row already written by filterEmail() carries the WHY)
```

**Audit row written at every branch.** Including the rejects from Stage 1.
Including low-confidence. Including fail-closed Haiku failures. Including
the `no_api_key` operator-deployment path. The only path that DOESN'T
write an audit row is a Supabase write failure on the audit table itself —
in which case we log + continue (the classifier still runs; the missing
audit row is acceptable degradation).

---

## 7. Schemas

Two migrations. Both must be run manually in Supabase Studio.

### `20260525_email_filter_decisions.sql`

```sql
-- Email content filter audit log. One row per gate decision — including
-- Stage 1 rejects, Stage 2 verdicts, low-confidence routings, and
-- fail-closed Haiku failures.
--
-- Lets us answer:
--   "How many emails were rejected at Stage 1 this week, by reason?"
--   "What's the confidence distribution from Stage 2 over the last month?"
--   "Which prompt_version was running when this signal was let through?"
--   "Which signals were manually flagged as bad?"
--
-- inbound_email_id is the FK. We do NOT use a UUID id on this table — the
-- composite (inbound_email_id, stage, decided_at) is the natural key. That
-- lets a re-classify under a new prompt_version add a row instead of
-- updating one, preserving the full history.
--
-- Run manually in Supabase Studio (SQL Editor → New query) or via
-- supabase CLI migrate. Same posture as ask_request_log + ranker_cache.

create table if not exists email_filter_decisions (
  id                    uuid         primary key default gen_random_uuid(),
  inbound_email_id      uuid         not null references inbound_emails(id) on delete cascade,
  stage                 smallint     not null check (stage in (1, 2)),
  verdict               text         not null check (verdict in (
                          'newsworthy', 'logistics', 'promotional', 'other',
                          'stage1_rejected'
                        )),
  confidence            numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reasoning             text         not null,
  model                 text,
  prompt_version        text         not null,
  decided_at            timestamptz  not null default now(),
  manually_overridden   boolean      not null default false,
  override_reason       text
);

-- Hot path: lookup by inbound_email for the "view audit history" drawer.
create index if not exists efd_inbound on email_filter_decisions (inbound_email_id, decided_at desc);

-- Reporting path: count by reason/version over a time window.
create index if not exists efd_reason_window on email_filter_decisions (prompt_version, verdict, decided_at desc);

-- RLS deny-all. Service role bypasses; anon/authenticated cannot read.
alter table email_filter_decisions enable row level security;
```

### `20260525_external_signals_source_attribution.sql`

```sql
-- Source-attribution columns on external_signals + the publisher/list-id
-- prerequisites on inbound_emails. Subsumes MASTER.md §2.1 (List-ID
-- classifier) and §2.2 (publisher canonical name) since both are required
-- for the new source-attribution UI to work.
--
-- All columns are nullable so the migration is backward-compatible. The
-- newsletter-adapter writes the new columns on every new signal; older
-- rows degrade gracefully to the meta JSONB fallback already in place.
--
-- Run manually in Supabase Studio. No data backfill is performed — the
-- next inbound webhook + the next sweeper run start populating
-- automatically as new emails arrive.

alter table external_signals
  add column if not exists publisher_canonical_name  text,
  add column if not exists source_url                text,
  add column if not exists inbound_email_id          uuid references inbound_emails(id) on delete set null,
  add column if not exists email_subject             text;

-- Index supports the raw-email drawer ("show me the source email for this
-- signal") and the audit drawer ("show me every signal that came from
-- this email").
create index if not exists es_inbound_email on external_signals (inbound_email_id)
  where inbound_email_id is not null;

alter table inbound_emails
  add column if not exists list_id                  text,
  add column if not exists publisher_canonical_name text;

-- Optional: index on list_id for future analytics ("how many emails came
-- from this publication?"). Cheap to add now since the column is sparse.
create index if not exists ie_list_id on inbound_emails (list_id)
  where list_id is not null;

-- No RLS change needed here — both tables already have RLS enabled
-- deny-all per the session-7 posture.
```

---

## 8. Failure modes

Every branch is enumerated. The table is the contract — every cell maps to
a code path the implementer needs to write.

| Condition | Behavior | Audit row written? | Log line |
|---|---|---|---|
| `ANTHROPIC_API_KEY` missing | `needs_review`. Stage 2 skipped. Signals NOT published. This is the operator's deployment choice — the filter cannot fail open without a key, by design (per "fail-CLOSED at the gate" decision). | YES — `stage=2, verdict='other', confidence=0, reasoning='no_api_key — Stage 2 skipped'` | `[email-filter] needs_review stage2_failure=no_api_key id=<id>` |
| Haiku 5xx (after SDK retries) | `needs_review`. | YES — `stage=2, verdict='other', confidence=0, reasoning='fail-closed: haiku_5xx status=<n>'` | `[email-filter] needs_review stage2_failure=haiku_5xx status=<n> id=<id>` |
| Haiku timeout (>15s wall) | `needs_review`. | YES — `stage=2, verdict='other', confidence=0, reasoning='fail-closed: haiku_timeout'` | `[email-filter] needs_review stage2_failure=haiku_timeout id=<id>` |
| Malformed tool-use response | `needs_review`. | YES — `stage=2, verdict='other', confidence=0, reasoning='fail-closed: haiku_malformed_json'` | `[email-filter] needs_review stage2_failure=haiku_malformed_json: <err>` |
| Schema violation (verdict outside enum, confidence > 1, reasoning > 200, missing field) | `needs_review`. | YES — `stage=2, verdict='other', confidence=0, reasoning='fail-closed: haiku_schema_violation: <which>'` | `[email-filter] needs_review stage2_failure=haiku_schema_violation: <reason> id=<id>` |
| Valid verdict, confidence < 0.7 | `needs_review`. | YES — `stage=2, verdict=<v>, confidence=<n>, reasoning=<haiku reasoning>` (the audit row preserves the model's actual verdict + reasoning; the routing decision is separate) | `[email-filter] needs_review low_confidence verdict=<v> conf=<n> id=<id>` |
| Valid verdict `newsworthy` + conf ≥ 0.7 | `proceed`. Downstream classifier runs; signals published with attribution columns populated. | YES — `stage=2, verdict='newsworthy', confidence=<n>, reasoning=<haiku reasoning>` | `[email-filter] proceed verdict=newsworthy conf=<n> id=<id>` |
| Valid verdict `logistics | promotional | other` + conf ≥ 0.7 | `rejected`. No classifier call. Email marked classified with 0 signals. | YES — `stage=2, verdict=<v>, confidence=<n>, reasoning=<haiku reasoning>` | `[email-filter] rejected stage2 verdict=<v> conf=<n> id=<id>` |
| Stage 1 reject (any rule) | `rejected`. No Stage 2 call. | YES — `stage=1, verdict='stage1_rejected', confidence=null, reasoning=<detail>` | `[email-filter] rejected stage1 reason=<reason> detail=<detail> id=<id>` |
| Empty body (post-strip < 50 chars) | `rejected` (Stage 1 `empty_body`). | YES — same as Stage 1 reject above | `[email-filter] rejected stage1 reason=empty_body id=<id>` |
| Missing `List-ID` header | Not an error. `publisher_canonical_name` falls back to `sender_domain` via `resolvePublisher`'s `is_known=false` path. Filter still runs. | n/a (no rejection on this alone) | `[email-filter] publisher_unknown sender=<domain> id=<id>` (debug only) |
| Supabase write failure on audit | Log warning + continue. Filter result is honored (no audit row, but the email is still routed correctly). Re-classifier-on-prompt-bump-by-deleting-rows depends on the audit row existing — flag in PR description that intermittent audit failures degrade the re-classify escape hatch. | NO — write failed | `[email-filter] audit_write_failed: <err> id=<id> — continuing` |
| Outer unhandled error in `filterEmail()` | Caught by `try/catch` wrapper. Returns `{decision:"needs_review", stage2_failure:"haiku_schema_violation", ...}`. Best-effort audit write. The sweeper/webhook never 500s on a filter bug. | Best-effort — same row as schema_violation | `[email-filter] unhandled_error: <err> id=<id>` |

Wrap the entire `filterEmail()` body in a `try/catch` as the final safety
net — mirrors the ranker's outer try/catch. The classify-pending cron and
the AgentMail webhook must never 500 on a filter bug.

---

## 9. Source-attribution wiring

Five pieces of attribution appear on every `/market-intel` signal card.
Each piece's source is pinned below so I-Filter never has to guess.

| Piece | Where it comes from | When populated |
|---|---|---|
| **Publisher chip** (e.g., "Endpoints News") | `external_signals.publisher_canonical_name` → looked up against `PUBLISHER_DISPLAY_NAMES` map in `inbound-publishers.ts` for the friendly label. Falls back to `meta.sender_domain` when missing (older rows). | Populated by `classifyNewsletter()` in the same write that creates the signal row. The publisher is resolved upstream in the webhook handler (or sweeper) BEFORE the filter runs, so it's already in scope when the classifier emits signals. |
| **Subject line** | `external_signals.email_subject` ← copied from `inbound_emails.subject` at signal-write time. | Populated by `classifyNewsletter()`. |
| **"View source" link** | `external_signals.source_url` ← extracted from email body by `extractLeadArticleUrl(html_or_text)`. Heuristic (~95%) — see algorithm below. NULL when extraction returns nothing. | Populated by `classifyNewsletter()` (or by the URL the classifier itself already attaches to the extraction, when present). Already-extracted URLs from the classifier take precedence. |
| **Raw-email drawer** | Click "View raw email" → `/api/admin/inbound-email/<id>` (gated) → returns subject + from_address + received_at + text_body + html_body → rendered in `<RawEmailDrawer />`. | Lazy-fetched on click. The `inbound_email_id` link is on the signal row already; the drawer is just a fetch + render. |
| **Sender domain footnote** | `external_signals.meta.sender_domain` (legacy field, kept for backward-compat with older rows). | Already populated today; no change. |

### `extractLeadArticleUrl(htmlOrText)` heuristic — pseudocode

```ts
const TRACKING_HOSTS = [
  "list-manage.com",            // Mailchimp
  "track.beehiiv.com",
  "click.convertkit-mail4.com", // convertkit
  "open.convertkit-mail4.com",
  "links.substack.com",
  "go.pardot.com",
  "click.linksynergy.com",
  "trk.klclick.com",            // klaviyo
  "email.fortune.com",          // generic newsletter tracker pattern
  "links.cmail19.com",          // campaign monitor
  "createsend4.com",
];
const UNSUB_PATH_RE = /(unsubscribe|preferences|email[-_ ]?settings|manage[-_ ]?subscription|view[-_ ]?in[-_ ]?browser|forward[-_ ]?to[-_ ]?friend)/i;
const ASSET_EXT_RE  = /\.(jpg|jpeg|png|gif|svg|webp|css|js|ico)(\?|$)/i;

function extractLeadArticleUrl(htmlOrText: string): string | null {
  // 1. Prefer HTML anchors over bare-text URLs — the anchor text often
  //    hints at editorial vs. nav (longer anchor text → more likely the
  //    lead article).
  const anchors = [...htmlOrText.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: m[1], text: stripTags(m[2]).trim() }));

  const candidates = anchors.length > 0
    ? anchors
    : extractBareUrls(htmlOrText).map(u => ({ href: u, text: "" }));

  for (const c of candidates) {
    if (!/^https?:\/\//i.test(c.href)) continue;
    const host = new URL(c.href).hostname.toLowerCase();

    // Skip tracking hosts (almost always wrappers around real URLs we can't
    // easily resolve without making an HTTP call — accept the loss).
    if (TRACKING_HOSTS.some(t => host === t || host.endsWith("." + t))) continue;

    // Skip unsubscribe / preferences / view-in-browser navigation.
    if (UNSUB_PATH_RE.test(c.href)) continue;

    // Skip asset URLs.
    if (ASSET_EXT_RE.test(c.href)) continue;

    // Skip mailto: and bare anchors.
    if (/^(mailto:|#)/i.test(c.href)) continue;

    // First candidate that survives all filters wins.
    return c.href;
  }

  return null;
}
```

**Known limitations (document in code comment + PR description):**

- **Wrapped tracking URLs are lost.** Mailchimp/Beehiiv wrap real article
  URLs in tracker redirects. We do NOT follow redirects (would require an
  HTTP call per email — too slow at scale and adds dependencies). The raw-
  email drawer is the fallback for those.
- **First-URL bias.** A newsletter that puts its "Forward to a friend"
  CTA above the lead article would surface the forward link first. Mitigated
  by the unsubscribe/preferences/forward regex (already covers the common
  cases). If RevOps reports a problem publisher, add it to the regex.
- **Sponsored-content false positive.** Industry Dive's lead anchor is
  usually the lead article, but their daily roundup sometimes leads with a
  sponsor block. Accept the ~5% miss rate; the drawer makes recovery cheap.

---

## 10. Test plan

`src/lib/email-filter.test.ts`. Mock the Anthropic SDK (same pattern as
`ranker.test.ts`) and `email-filter-decisions` module. 18 cases:

1. **`stage1_rejects_subject_password_reset`** — subject `"Reset your password — Brainyacts"` → `accepted: false, reason: "subject_pattern", detail: "subject_regex:password_reset"`. Pure function; no I/O.
2. **`stage1_rejects_subject_welcome_to_your`** — subject `"Welcome to your Brainyacts subscription"` → `subject_pattern:welcome`.
3. **`stage1_does_not_reject_welcome_in_editorial_prose`** — subject `"Welcome to the AI age — Brainyacts daily"` → Stage 1 ACCEPTS (regex requires `welcome to your/our/the X team`).
4. **`stage1_rejects_billing_sender_role`** — `billing@example.com` → `sender_role:billing` regardless of body.
5. **`stage1_rejects_noreply_only_with_thin_body`** — `noreply@substack.com` + 600-word body → ACCEPTED. Same sender + 100-word body → `sender_role:no-reply + word_count=100`.
6. **`stage1_rejects_thin_body`** — 150-word body → `body_thin_or_link_only:word_count=150 < 200`.
7. **`stage1_rejects_link_farm_body`** — body where linkRatio > 0.9 → `body_thin_or_link_only:link_ratio=0.94 > 0.90`.
8. **`stage1_rejects_only_unsub_links`** — HTML with anchors that are all unsubscribe/preferences → `body_thin_or_link_only:only_unsub_links`.
9. **`stage1_rejects_auto_reply_header`** — `Auto-Submitted: auto-replied` → `auto_reply_or_bounce:auto_submitted`. ALSO test that `Auto-Submitted: no` does NOT trigger (RFC-3834 compliance).
10. **`stage1_rejects_bounce_header`** — `X-Failed-Recipients: foo@bar.com` → `auto_reply_or_bounce:bounce_header:x-failed-recipients`.
11. **`stage1_rejects_calendar_attachment`** — Content-Type containing `text/calendar` → `subject_pattern:ics_attachment`.
12. **`stage1_rejects_empty_body`** — body after strip < 50 chars → `empty_body:body_chars=12`.
13. **`stage2_proceeds_on_newsworthy_high_confidence`** — mock Haiku returns `{verdict:"newsworthy", confidence:0.92, reasoning:"Lead article covers..."}` → `decision: "proceed"`. Audit row asserted: stage=2, verdict='newsworthy', confidence=0.92.
14. **`stage2_routes_low_confidence_to_needs_review`** — mock returns `{verdict:"newsworthy", confidence:0.55, ...}` → `decision: "needs_review", stage2_failure: "low_confidence"`. Audit row preserves the ACTUAL verdict ('newsworthy'), not 'other' — important so we can audit "what would the gate have said if we'd trusted it?"
15. **`stage2_rejects_promotional_high_confidence`** — `{verdict:"promotional", confidence:0.85, ...}` → `decision: "rejected"`.
16. **`fail_closed_on_haiku_5xx`** — mock throws `APIError {status: 503}` → `decision: "needs_review", stage2_failure: "haiku_5xx"`. Audit row written: confidence=0, reasoning starts with "fail-closed".
17. **`fail_closed_on_haiku_malformed_json`** — mock returns `{verdict:"unknown_verdict", confidence:0.9, reasoning:"..."}` (verdict outside enum) → `decision: "needs_review", stage2_failure: "haiku_schema_violation"`.
18. **`audit_row_written_on_every_branch`** — parameterized test: 5 scenarios (stage1 reject, stage2 proceed, stage2 reject, low-confidence, fail-closed). Each asserts `writeDecision()` was called exactly once with the right stage + verdict.

Plus 4 helper / endpoint tests in separate files:

19. **`extract_lead_article_url.test.ts` — `substack_fixture`** — known Substack newsletter HTML → returns the first non-tracking, non-unsubscribe URL (the lead article).
20. **`extract_lead_article_url.test.ts` — `beehiiv_fixture`** — same against a Brainyacts fixture (Beehiiv).
21. **`extract_lead_article_url.test.ts` — `industry_dive_fixture`** — same against a CFO Dive fixture.
22. **`signal_feedback_route.test.ts` — `round_trip`** — POST to `/api/admin/signal-feedback` with `{signal_id, reason: "test"}` → looks up the signal's `inbound_email_id` → writes an `email_filter_decisions` row with `manually_overridden=true, override_reason="test"`. Assert the row appears in `getDecisionsFor(inbound_email_id)`.

Plus 1 prompt-drift test:

23. **`stage2_prompt_enumerates_all_four_verdicts`** — `getStage2SystemPrompt({publisherInfo: stubbed})` contains `"newsworthy"`, `"logistics"`, `"promotional"`, `"other"` AND `"submit_verdict"` AND `"BUILD_ALIGNMENT principles enforced"`. Guards against prompt-version bumps that silently drop a verdict.

Run target: `npm test` passes 131 (current ranker total) + 18 + 4 + 1 = **154 tests** post-merge.

---

## 11. BUILD_ALIGNMENT cross-check

Walked all 11 principles. The file is `orgs/checkbox/BUILD_ALIGNMENT.md`.

1. **Schema fidelity.** **Satisfied.** New columns on `external_signals`
   and `inbound_emails` use snake_case matching project convention. The
   `email_filter_decisions` table is new but its field names align with
   the `signal_instances`/audit-style convention (`occurred_at` →
   `decided_at`, `source_event_id`-style FK via `inbound_email_id`).
2. **Canonical signal_type only.** **N/A.** The filter does NOT emit
   `external_signals` rows; it only decides whether the existing
   classifier may run. No signal_type is invented. Downstream
   `classifyNewsletter()` continues to use the legacy 12-value
   `ExternalSignalType` enum exactly as today.
3. **Severity = 3 tiers.** **N/A.** Filter does not assign severity.
   The downstream classifier and ranker handle severity per their own
   contracts. No new severity values are introduced.
4. **Direction required.** **N/A.** Same reasoning as #3 — the filter is
   not emitting signals, so `direction` is not in scope.
5. **No per-signal confidence.** **Satisfied with caveat.** The audit
   table carries `confidence` — but that is **per-decision** confidence
   from the Stage 2 classifier, not per-signal confidence on
   `signal_instances`. The principle is about not re-adding `confidence`
   to `signal_instances` / `signal_correlations`; this is a different
   table (`email_filter_decisions`) and the number is a real model
   self-report, not an analyst's vibe-estimate. The principle's exception
   already allows confidence on `transcript_segments` (real ASR
   confidence from the provider) — this is the same shape: a real
   number from a real source (Haiku itself), about its own classification.
   **Implementer should call this out in the PR description** so the
   AD-style review doesn't re-flag it.
6. **Evidence chain mandatory.** **Satisfied (and load-bearing).** This
   IS the evidence chain for newsletter-derived signals. Every
   `external_signals` row gains `inbound_email_id` (FK to the raw email)
   + `email_subject` + `source_url` + `publisher_canonical_name`. Every
   filter decision gains an audit row linked to the same `inbound_email_id`
   carrying the model + prompt_version + reasoning. From a `/market-intel`
   signal card, an operator can drill to: source URL (the article) → raw
   email (the source) → filter decision (why it was let through). That's
   the complete chain.
7. **No direct DB access from UI.** **Satisfied.** The new
   `<SignalSourceChip />` and `<RawEmailDrawer />` components consume
   `/api/admin/inbound-email/[id]` and `/api/admin/signal-feedback` only.
   The market-intel page is a server component reading via the existing
   `getWorkspaceSignals()` helper — no raw Supabase clients in
   components.
8. **Voice.** **Satisfied.** Stage 2 prompt explicitly bans markdown,
   emoji, exclamation; caps reasoning at 200 chars one sentence. Stage 1
   doesn't produce user-facing copy — it produces audit-only `detail`
   strings (e.g., `"subject_regex:password_reset"`) which are machine-
   readable. The new UI chips use the existing Dugout palette and the
   same tone as the rest of `/market-intel`.
9. **Read-only v1.** **Satisfied.** The filter writes to two Dugout
   tables (`email_filter_decisions`, `external_signals` new columns) and
   updates one (`inbound_emails` adds `list_id` + `publisher_canonical_name`
   on insert). No calls to AgentMail, Anthropic, Supabase that
   mutate source systems. Prompt explicitly bans action recommendations
   ("Do not include action recommendations in reasoning").
10. **Demo data only.** **Satisfied.** No real keys checked in. No PII
    in audit reasoning strings (the reasoning is the model's own prose
    about the email's content, not about identifiable people). The
    feedback API stores `override_reason` as free text — document that
    operators should not paste sensitive content into the field.
11. **AI provider neutrality.** **Gap (intentional, justified — same as
    ranker §10).** The filter is Anthropic-only Haiku 4.5, single-shot,
    no user picker. Principle #11's own text carves this out: *"The
    other AI surfaces stay model-specific. Morning digest stays on
    Sonnet 4.6; inbound-email classifier stays on Haiku 4.5. Those are
    single-shot prompts with stable cost where provider choice doesn't
    earn its keep."* This filter is exactly that pattern. Mirror the
    ranker's PR-description wording so the AD review doesn't re-flag it.

---

## 12. Open questions for the implementer

Things D-Filter left ambiguous on purpose — I-Filter picks:

1. **Where `extractLeadArticleUrl()` lives.** I-Filter chooses between
   (a) standalone `src/lib/extract-lead-article-url.ts` (my recommendation
   — keeps it test-fixture-driveable) or (b) a private helper inside
   `newsletter-adapter.ts`. (a) is cheaper to test in isolation.
2. **Where `List-ID` extraction happens.** Two options: (a) extract in
   the webhook handler and pass the value through `NormalizedInboundEmail`,
   (b) extract inside `inbound-pipeline.ts` via a new `headers` field. I'd
   pick (a) — keeps the handler responsible for "everything provider-shaped"
   and the pipeline pure-business-logic.
3. **Stage 1 rules: code vs. JSON config.** I chose inline TS constants
   (`SUBJECT_REJECT_PATTERNS` etc.). Alternative: ship as `src/data/filter-
   rules.json` so RevOps could tune without a deploy. Defer to v1.1 —
   inline is fine for now, and the constants are exported so a JSON-config
   swap is mechanical.
4. **Exact tracking-host regex shape.** I gave a starter list of ~10 hosts
   in §9. The implementer will discover more during the first week of
   real traffic. Suggest logging unmatched extractions for a week as a
   debug breadcrumb (`[email-filter] extract_lead_url_returned=null
   from=<domain>`) so RevOps can pattern-mine new entries from logs.
5. **`SENDER_ROLE_WEAK_REJECT` body-word threshold (currently 400).** This
   is empirical — picked from a small inbox sample. The first week of
   Phase 1 traffic should validate. Bias adjustment toward higher
   (= more strict) if false-positive rate is unacceptable.
6. **Should the feedback API also write an `external_signals` mutation
   to soft-delete or tag the signal?** Brief says "Mark as bad signal";
   I interpreted as "audit-only, no signal mutation in v1" (read-only
   principle). If Jackson wants the signal to disappear from the page
   after override, add a `suppressed_at` column to `external_signals`
   and filter on the page query. Out of scope as written.
7. **Raw-email drawer authn.** I gated `/api/admin/inbound-email/[id]`
   with `requireUiSession()` — same gate as the existing paid endpoints.
   That's the cheapest correct answer. Per-row authorization (e.g., only
   the workspace owner can view) is not in scope for v1 (Dugout is
   single-tenant per HANDOFF.md §12).
8. **What to do with NULL `publisher_canonical_name` on the page.** I
   said "fall back to `meta.sender_domain`." If the implementer prefers
   no fallback (cleaner UI but older rows show no chip), that's a UX
   call I defer to. The fallback is one line of code; either is fine.
9. **`STAGE2_PROMPT_VERSION` semantic.** I picked `"stage2-v1"` — flat
   string. Some teams use semver (`"stage2-1.0.0"`). I'd keep flat:
   audit queries don't need to range-compare, they need to equality-match.
10. **Whether the `is_known: false` PublisherInfo path needs its own
    Stage 1 rule.** I treated unknown publishers as eligible (Stage 1
    still runs all checks; Stage 2 still gets a chance). Alternative:
    reject all unknown publishers at Stage 1 until manually added to
    the publisher map. Too aggressive for v1 — would block new
    subscriptions before RevOps notices. Leave as-is.

---

## 13. Estimated diff

| Metric | Estimate |
|---|---|
| Files created | **13** (10 src + 1 component file pair (chip + drawer) + 1 admin API route + 2 migrations) — close to the brief's "~10" once each route folder is counted as one file. |
| Files modified | **7** (`classify-pending`, `newsletter-adapter`, `external-signals`, `inbound-email`, `inbound-pipeline`, `agentmail/route`, `market-intel/page`) — one over the brief's ~5 because the pipeline + webhook each need to forward headers. |
| Net LOC added | **~1,400** (types ~120, Stage 1 ~180, Stage 2 prompt ~150, filter entry ~220, audit CRUD ~80, publisher lookup ~60, URL extractor ~80, signal-feedback route ~60, raw-email route ~50, source-chip component ~80, raw-email drawer ~100, migrations ~60, tests ~360) |
| Test cases added | **23** (18 main + 3 URL-extractor + 1 feedback + 1 prompt-drift); brings `npm test` total to **154**. |
| Migrations to run manually | **2** (`20260525_email_filter_decisions.sql` + `20260525_external_signals_source_attribution.sql`) in Supabase Studio. |
| Env vars added | **0.** Reuses `ANTHROPIC_API_KEY`, `SUPABASE_*`, `DUGOUT_UI_SECRET`. |
| Time estimate (I-Filter single agent) | **~8 hours** including the test suite + a smoke run against real Supabase + a screenshot for the PR. Roughly 2× the ranker because the surface area is wider (filter + audit + attribution + drawer + admin route + 2 migrations vs. ranker's single-table additive). |

PR title suggestion: `feat(market-intel): two-stage email content filter with source attribution`.

---

## 14. Pre-merge alignment checklist (for A-Filter to walk)

- [ ] `npm test` passes (154 cases).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
- [ ] Stage 2 prompt enumerates all 4 verdicts (`newsworthy`,
      `logistics`, `promotional`, `other`) AND the `submit_verdict` tool
      name AND the confidence-band documentation.
- [ ] Every Stage 1 magic number is exported as a named constant
      (not inline literal) and asserted in tests.
- [ ] Every failure-mode branch in §8 writes an audit row (except the
      "Supabase write failure on audit" branch, which is intentionally
      best-effort). Tests assert this for all 5 non-Supabase-failure
      branches.
- [ ] Migrations run cleanly in Supabase Studio. `email_filter_decisions`
      shows up with RLS enabled; new columns visible on
      `external_signals` and `inbound_emails`; new indexes present.
- [ ] Manual smoke: subscribe one real newsletter (Phase 0 — Artificial
      Lawyer per MASTER.md §3). Receive one webhook. Confirm:
      - `inbound_emails` row has `list_id` and `publisher_canonical_name`
        populated.
      - `email_filter_decisions` has a row with `stage=2, verdict='newsworthy'`.
      - `external_signals` row has `publisher_canonical_name`,
        `email_subject`, `source_url`, `inbound_email_id` populated.
      - `/market-intel` page renders the publisher chip + subject +
        "view source" link.
      - Clicking "View raw email" opens the drawer and loads the
        original body.
- [ ] Manual smoke: send a `welcome@...` email to the AgentMail inbox
      (or fixture-mock one). Confirm Stage 1 rejects, audit row written,
      no signal published.
- [ ] Manual smoke: with `ANTHROPIC_API_KEY` unset locally, run the
      sweeper against one email that passes Stage 1. Confirm:
      `decision: "needs_review"`, audit row written with `reasoning='no_api_key
      — Stage 2 skipped'`, email marked classified with 0 signals.
- [ ] `BUILD_ALIGNMENT.md` principles 1-11 walked; principle #5 (filter's
      `confidence` on audit table) and #11 (Anthropic-only carve-out)
      are explicitly called out in the PR description as intentional
      with the same wording the ranker used.
- [ ] HANDOFF.md §11 (Supabase RLS posture) honored — both migrations
      include the `enable row level security` one-liner.
- [ ] HANDOFF.md §11 (AgentMail webhook still untested-with-real-event)
      caveat: the filter inherits this gap. The first real webhook tests
      both pipelines at once. Document in PR.
- [ ] MASTER.md §2.1 (List-ID classifier) and §2.2 (publisher canonical
      name) marked DONE in MASTER.md after merge — both are subsumed by
      this feature.
