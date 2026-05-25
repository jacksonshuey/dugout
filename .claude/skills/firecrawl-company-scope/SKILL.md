---
name: firecrawl-company-scope
description: Generate a 30-second pre-meeting brief for a target company from Dugout. Pulls structured AE-brief fields (one-liner, recent funding, exec changes, key risks, strategic focus), recent moves from newsletter/news signals, SV Health score, buying committee gaps, and blocking signals with prescribed actions. Use before any AE meeting with a tracked account (Stripe, Boeing, Snowflake, etc.).
---

# /firecrawl-company-scope &lt;company&gt;

Pre-meeting prep for a target company. Calls the same Dugout endpoint as the in-product `/account/[slug]/prep` page, so the brief you see here is the same one your team sees in the UI.

## When to use

- Right before a customer meeting (10–15 min ahead, calendar reminder fires)
- When an AE asks "what do I know about Acme Corp?"
- When prepping a manager for a deal review

## How it works

1. You provide a company name, slug, ticker, or domain (e.g. `Stripe`, `acc_cobalt`, `STRIPE`, `stripe.com`).
2. The skill resolves it to a Dugout `accountId` via `GET /api/accounts/lookup?q=...`.
3. The skill calls `GET /api/firecrawl/company-scope?accountId=...` with bearer-token auth.
4. The skill formats the `MeetingBrief` JSON as a scannable Markdown brief.

The contract for `MeetingBrief` lives in `src/lib/meeting-prep.ts` — if the response shape evolves, update the `jq` extractions in the Implementation section below.

## Setup

Set two env vars in your shell (one-time):

```bash
export DUGOUT_BASE_URL="https://your-deployment.vercel.app"
export DUGOUT_SKILL_TOKEN="dskt_..."   # see README "AE pre-meeting skill" section for generation
```

Both must be set for the skill to work. The token is the same value you put in Vercel's `DUGOUT_SKILL_TOKEN` env var — see `.env.example`.

## Usage

```
/firecrawl-company-scope Stripe
/firecrawl-company-scope acc_cobalt
/firecrawl-company-scope STRIPE
/firecrawl-company-scope stripe.com
```

## Implementation

When invoked with an argument (the company string the AE typed, hereafter `$ARG`):

### Step 1 — Validate env

If `DUGOUT_BASE_URL` or `DUGOUT_SKILL_TOKEN` is unset or empty, print this message verbatim and stop:

> Set `DUGOUT_BASE_URL` and `DUGOUT_SKILL_TOKEN` before using this skill (see README's "AE pre-meeting skill" section).

### Step 2 — Resolve the account

Call the lookup endpoint with the user's argument URL-encoded:

```bash
curl -s -H "Authorization: Bearer $DUGOUT_SKILL_TOKEN" \
  "$DUGOUT_BASE_URL/api/accounts/lookup?q=$(printf '%s' "$ARG" | jq -sRr @uri)"
```

Parse the `.matches` array.

- **Zero matches** → print: `No matching account in Dugout for "<ARG>". Add it via the UI first.` and stop.
- **One match** → use `matches[0].id` as the `accountId` and proceed.
- **Multiple matches** → list them as a numbered Markdown list (name + website + id) and ask the user which one to use. Do NOT auto-pick.

### Step 3 — Pull the brief

```bash
curl -s -H "Authorization: Bearer $DUGOUT_SKILL_TOKEN" \
  "$DUGOUT_BASE_URL/api/firecrawl/company-scope?accountId=$accountId"
```

If the response is a JSON object with an `error` field, print the error and stop.

If HTTP status is `404`, the account has no website on file and a brief cannot be built — print the response's `error` field and stop.

### Step 4 — Format the response

Render the JSON as Markdown following the template below. **Omit any section whose source field is empty/null** — do not render headers with no body.

#### Status banner (top of brief)

Inspect `scrapeStatus`:

- `pending` → prepend: `⏳ Crawl in progress — some fields may be empty. Retry in 60s for fresh data.`
- `stale` → prepend: `⚠️ Last crawled $lastCrawledAt — data may be 1+ week old.`
- `fresh` → no banner.
- `missing` → endpoint returned 404, already handled in Step 3.

#### Brief body

```
# Pre-meeting brief: $accountName
*Updated $generatedAt · Scrape: $scrapeStatus*

## SV Health: $svHealth.score / 100 · $svHealth.tier
(omit this header entirely if svHealth is null)

## $companyOneLiner
**Strategic focus:** $strategicFocus
**Industry:** $industry · **HQ:** $hqLocation

## Recent moves (last 30 days)
- $recentMoves[i].headline ($recentMoves[i].occurredAt, $recentMoves[i].source)

## Recent funding
$recentFunding.amount, led by $recentFunding.leadInvestor ($recentFunding.date)

## Recent exec changes
- $exec.name ($exec.role) — $exec.change ($exec.date)

## Key risks
- $keyRisks[i]

## Buying committee
**Mapped:** $buyingCommittee.mapped contacts
**Gaps:** $buyingCommittee.gaps joined with ", "
(if gaps is empty: "**Gaps:** none — full committee mapped")

## Open opportunities
- $openOpportunities[i].name · $openOpportunities[i].stage · $openOpportunities[i].daysInStage days in stage · $$openOpportunities[i].amount

## BLOCKING signals (act before this meeting)
- **$blockingSignals[i].title** — $blockingSignals[i].body
  ↳ Action: $blockingSignals[i].suggestedAction
  ↳ Asset: $blockingSignals[i].assetLink
```

#### Rules for omission

- If `companyOneLiner` is null, skip the `## $companyOneLiner` header line (still render `Strategic focus` / `Industry` if present, under a `## Company` header instead).
- If `strategicFocus` is null, omit the `**Strategic focus:**` line.
- If `recentMoves` is `[]`, omit the whole `## Recent moves` section.
- If `recentFunding` is null, omit `## Recent funding`.
- If `recentExecChanges` is `[]`, omit `## Recent exec changes`.
- If `keyRisks` is `[]`, omit `## Key risks`.
- If `openOpportunities` is `[]`, omit `## Open opportunities`.
- If `blockingSignals` is `[]`, omit the whole `## BLOCKING signals` section.

### Step 5 — Suggested next actions

After the brief, if there were any blocking signals OR buying-committee gaps OR `scrapeStatus !== "fresh"`, append a short `## Recommended next actions` section enumerating (in order):

1. The `suggestedAction` for each blocking signal.
2. "Map a contact for: <gap1>, <gap2>" if any buying-committee gaps exist.
3. "Retry this brief in 60s — crawl is still running" if status is `pending`.
4. "Consider triggering a fresh scrape via /account/[slug] — data is 1+ week old" if status is `stale`.

If none of those conditions apply, omit the section entirely.

## Notes for engineers

- The skill is provider-agnostic — Claude Code's Bash tool is the only execution path. No SDK install, no auth flow beyond the bearer token.
- If the endpoint contract evolves (`src/lib/meeting-prep.ts:MeetingBrief`), update the field extractions above. The skill is intentionally written as instructions for the model (not a script) so a contract change is a docs edit, not a code change.
- Both endpoints (`/api/accounts/lookup` and `/api/firecrawl/company-scope`) accept the same `Authorization: Bearer $DUGOUT_SKILL_TOKEN` header. If the token is unset on the server they fall back to UI-session-only and the skill won't work — this is intentional fail-closed.
