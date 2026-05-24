# Granola — Signal Dictionary

> **Status: the only tool in this dictionary that's actually wired end-to-end in Dugout** (session 5). Adapter pipeline ships; feature is currently deferred behind opt-in. This card therefore doubles as the **canonical example** of what every other tool card *would* look like once wired.

**Category:** Meeting notes (AI-assisted, real-time in-meeting capture)
**Role in stack:** Sits next to the AE during external meetings, transcribes and structures notes, exposes them via a clean REST API. Distinct from Gong (which records + analyzes calls async) — Granola is *real-time, AE-attended* meeting capture, including non-recorded in-person meetings.
**Integration surface:** REST API at `https://public-api.granola.ai/v1/notes`. Bearer-token auth (personal or workspace API key). Rate limit per Granola docs: **5 req/s sustained, 25 burst**.
**Pricing/access reality:** API access ships on paid Granola plans; individual users can paste their personal key. No partner program required, no sandbox approval — the cleanest API access of any tool in this dictionary.

## What it emits
Per-meeting note objects with: `id`, `title`, `created_at`, `attendees[]` (with email + name), `transcript`, `summary` (AI-generated structured), `action_items[]`, `folder` (user-organized), and raw note body. Notes are pulled (no webhook surface yet) — Dugout's adapter polls daily.

## Signals we'd extract

The shipping `granola-classifier.ts` extracts **7 buying-process signal types** via Haiku 4.5. Listed by priority for the wedge:

### 1. `finance_mentioned_not_engaged` — BLOCKING (wedge anchor)
- **What it is:** Meeting note mentions Finance / CFO / VP Finance / Controller / Budget by name or role, but no Finance-titled attendee was on the call.
- **Why for the wedge:** The single highest-fidelity Selected Vendor stall signal. Champion is talking about budget approval; the budget-approver isn't in the room. This is the exact phenomenon Priority #4 names.
- **Rule shape:** Haiku classifies summary + transcript for finance-stakeholder mentions; cross-checks `attendees[].email` titles → if mentioned AND not attending → fire.
- **Source fields:** `note.summary`, `note.transcript`, `note.attendees[].email`, attendee enrichment for title.

### 2. `it_mentioned_not_engaged` — BLOCKING
- **What it is:** Same shape as #1 for IT/Security/CIO/Privacy/Legal stakeholders.
- **Why for the wedge:** Priority #4 names Finance AND IT as the engagement gap. Same rule, different role list.

### 3. `competitor_named` — ACTION
- **What it is:** Buyer mentions a competitor (Ironclad, LinkSquares, ContractWorks, SpotDraft, etc.) in the meeting transcript.
- **Why for the wedge:** Late-stage competitor introduction = champion being asked to defend the choice.
- **Rule shape:** Haiku extracts competitor mentions with speaker attribution; if speaker is external AND stage ∈ {Selected Vendor, Negotiation} → fire.

### 4. `objection_raised` — ACTION
- **What it is:** Buyer voiced a specific objection (pricing, scope, timing, vendor concentration, security concern).
- **Why for the wedge:** Objections raised in-meeting often don't make it to SFDC. AE remembers vaguely; manager has no visibility.
- **Rule shape:** Haiku classifies + categorizes; written to `meeting_signals` table with category tag.

### 5. `next_step_committed` — POSITIVE / AWARENESS
- **What it is:** Concrete next step was agreed to (date, owner, deliverable). Inverse of Gong's `no next step committed` signal.
- **Why for the wedge:** Auto-populates SFDC Next Steps field; replaces rep manual entry; signals momentum.

### 6. `champion_signal` — AWARENESS
- **What it is:** Indication of internal champion strength — buyer used language like "we've been looking at this for a while," "I've already pitched this to my CTO," "my boss is bought in."
- **Why for the wedge:** Champion strength predicts whether the deal will survive procurement.

### 7. `timeline_signal` — AWARENESS
- **What it is:** Buyer mentioned a real timeline driver (renewal, board meeting, fiscal year end, project deadline).
- **Why for the wedge:** Time pressure is the single best predictor of close.

## What we'd ignore
- Internal Checkbox-only meetings (no external attendees) — filtered at adapter level
- Meetings in private user folders not opted into sync (per the folder-allowlist privacy gate, when shipped)
- Notes < 100 chars (too short to classify usefully)
- Notes without a transcript (Haiku needs the substance, not just title)
- Personal / HR / interview meetings — the folder-allowlist is the user's opt-in

## Effort to wire
**Zero. Already built.** The shipping pipeline:
- `lib/granola-client.ts` — REST wrapper with rate-limit throttle
- `lib/granola-classifier.ts` — Haiku 4.5 extracting the 7 signal types
- `lib/granola-adapter.ts` — orchestrator (list → filter internal → attendee-domain match → title-keyword fallback → unassigned bucket → classify → upsert)
- `lib/meeting-signals.ts` — Supabase CRUD with dedup
- `lib/workspace-integrations.ts` — Supabase Vault-encrypted API key storage
- `app/actions/granola.ts` — server actions (connect, disconnect, sync now, assign unassigned)
- `app/api/cron/granola/route.ts` — daily 9am UTC sync
- `app/api/meeting-signals/route.ts` — drawer read endpoint
- `components/connectors-section.tsx` — Settings UI
- `components/unassigned-meetings-list.tsx` — manual account-mapping UI
- `supabase/migrations/20260523_granola_integration.sql` — 3 new tables + Vault RPCs

**Migration must be run manually in Supabase Studio** before activation. Feature is currently deferred (untested with real API key).

## Why Granola is the template for every future integration

The Granola onboarding flow is **the load-bearing UX pattern** for the broader product:

1. **Settings → Connectors → paste API key** (one field, no OAuth dance)
2. **Verify-on-connect** — adapter pings `/v1/notes` immediately; success = green badge, failure = clear error
3. **Vault-encrypted storage** — plaintext key never lives in app code; SECURITY DEFINER RPCs read/write `vault.secrets`
4. **Automatic sync** — daily cron from the moment the key is stored
5. **Manual sync option** — "Sync Now" button next to the connector
6. **Last-sync timestamp + status** displayed inline
7. **Rotate / disconnect** — same UI, no dev intervention

This pattern works for any tool with: an API key OR OAuth flow + a "ping the API" endpoint + a daily-poll-or-webhook ingest model. Per HANDOFF §3.5: *"UX is the integration moat."* Granola proves the pattern. Every future tool card in this dictionary inherits this onboarding flow.

## Install-time discovery
- **Folder allowlist** — privacy gate; user picks which Granola folders to sync (default: zero folders → zero sync). **Not yet shipped — must ship before reactivating the feature** to prevent personal/medical/HR meeting titles leaking to the unassigned bucket.
- **Attendee-domain to account mapping** — adapter joins `attendees[].email` domain against `accounts.domain`; the 11 seed accounts got a `domain` field in session 5. Unmatched meetings drop to the unassigned bucket for one-click manual assignment.
- **Title-keyword fallback** — when no attendee-domain match, the adapter checks the note title against known account names (case-insensitive substring).
- **Custom Granola folder taxonomy** — varies per user; folder allowlist UI surfaces user's actual folder list at connect time.

## Mapping the 7 Granola signals to the 12 canonical types

The Granola classifier was built independently of the synthesis taxonomy; the mapping just works, which validates the taxonomy.

| Granola signal | Canonical `signal_type` | `direction` |
|---|---|---|
| `finance_mentioned_not_engaged` | `committee_gap` | negative |
| `it_mentioned_not_engaged` | `committee_gap` | negative |
| `competitor_named` | `competitive_threat` | negative |
| `objection_raised` | `momentum_change` | negative |
| `next_step_committed` | `momentum_change` | positive |
| `champion_signal` | `momentum_change` | positive |
| `timeline_signal` | `lifecycle_milestone` | neutral |

Note: `momentum_change` carries 3 of the 7 — polarity differentiated by the `direction` field on the signals table per [synthesis.md §1](../synthesis.md). This is why the rename from `momentum_stall` mattered: the old name forced these three Granola signals into awkward homes.
