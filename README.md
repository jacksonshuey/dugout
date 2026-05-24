# Dugout

> *The dugout view of your pipeline.*

A working deal intelligence layer for GTM teams. Configurable per workspace (presets live in `src/lib/workspace.ts`), built by Jackson Shuey.

Tells sellers and managers what's happening in their pipeline before they have to ask.

→ **Live demo:** _link to be added after Vercel deploy_

## Surfaces

- `/` — landing. Hero → integration constellation (autoplay setup reel) → onboarding walkthrough → embedded live Console.
- `/console` — standalone AE Console (same component as the embedded one on `/`). Morning digest + per-deal cards + inline playbooks.
- `/manager` — team risk roll-up. SVHealthHeroDashboard three-up + team aggregates.
- `/account/[slug]` — per-account deep view. SV Health Hero, opps, buying committee, Procurement Tracker, unified signal timeline.
- `/ask` — chat-thread UI. Dual-provider (GPT-4o, Claude Sonnet 4.6, Claude Haiku 4.5), user-picked, env-key-aware.
- `/market-intel` — workspace-scoped signal table (newsletter inbox feature).
- `/spec` — single-scroll architecture/rollout writeup.

> Workspace configuration (priorities, assets, stack) lives in `src/lib/workspace.ts` as code — the `/settings` editor that earlier README versions described was removed during demo prep (see PR #20).

## How the engine works

- **Signal engine** (`src/lib/signal-engine.ts`) — pure functions, one per rule. Each rule tags a workspace priority and a severity tier. The tier dictates routing.
- **Workspace config** (`src/lib/workspace.ts`) — runtime configuration that drives behavior. Priorities, asset names, and stack labels flow through the engine, the digest prompt, and the rule-authoring prompt.
- **Deal Health** — compound state aggregated from signals on a deal, weighted by close-date proximity. Returns `Healthy / Monitor / At Risk / Critical`.
- **Playbooks** — multi-phase workflows attached to specific signals. The Champion Departure playbook ships in v1.
- **Claude** — Sonnet 4.6 for digest synthesis and rule authoring. ~90% of useful signals are deterministic; the LLM runs where it earns its keep.

## Run locally

```bash
cp .env.example .env.local      # then fill in ANTHROPIC_API_KEY
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Connect this repo to Vercel. Add `ANTHROPIC_API_KEY` (and optionally `SLACK_WEBHOOK_URL`) in Vercel's Environment Variables. Push to `main` to deploy.

## Newsletter inbox

Dugout's account-scoped market intelligence (NewsAPI + SEC EDGAR) is complemented by a workspace-wide newsletter inbox. Inbound emails arrive via Mailgun, land in `inbound_emails`, get classified by Haiku, and produce signals into `external_signals` — either tagged to a tracked account (when a known company is named) or as workspace-scoped market intel. The morning digest reads the workspace-scoped items and adds a "Market intel" section when relevant.

Mailgun signs every webhook with HMAC-SHA256, which is verified server-side; the route rejects anything older than 5 minutes to prevent replay.

### Setup

**1. Pick a domain.** You need a subdomain you control DNS on — e.g. `inbox.yourdomain.com`. The full inbox address will be anything-`@inbox.yourdomain.com`.

**2. Configure DNS.** Add TWO MX records on the subdomain:

```
inbox.yourdomain.com.   MX   10 mxa.mailgun.org.
inbox.yourdomain.com.   MX   10 mxb.mailgun.org.
```

**3. Add the domain in Mailgun.** Sending → Domains → Add New Domain → `inbox.yourdomain.com`. Pick US region. For inbound-only you can skip the TXT/SPF/DKIM records they prompt for — those are for sending.

**4. Create the inbound Route.** Receiving → Routes → Create Route:
- **Expression Type:** Match Recipient
- **Recipient:** `.*@inbox.yourdomain.com` (regex catches every address on the subdomain)
- **Actions:** Forward → URL: `https://<your-vercel-deployment>/api/inbound-email/mailgun`
- **Priority:** `0`

**5. Grab the signing key.** Settings → API security → copy the "HTTP webhook signing key" (this is NOT the API key — it's a separate value used only for verifying webhook signatures).

**6. Run the SQL migration.** Open Supabase Studio → SQL Editor → paste `supabase/migrations/20260522_inbound_emails.sql` → Run.

**7. Set environment variables** (Vercel + `.env.local`):

```
MAILGUN_SIGNING_KEY=<paste from step 5>
INBOUND_SENDER_ALLOWLIST=substack.com,beehiiv.com,tldrnewsletter.com,lennysnewsletter.com
```

**8. Subscribe to newsletters** from `<anything>@inbox.yourdomain.com`. Only senders whose domain is in `INBOUND_SENDER_ALLOWLIST` (or a subdomain of one) are persisted; others are dropped with a 200 OK so Mailgun doesn't retry.

### What lives where

- Webhook handler: `src/app/api/inbound-email/mailgun/route.ts` (HMAC-verified)
- Pipeline (validation, storage, classification): `src/lib/inbound-pipeline.ts`
- Classifier: `src/lib/newsletter-adapter.ts`
- Storage lib: `src/lib/inbound-email.ts`
- Migration: `supabase/migrations/20260522_inbound_emails.sql`
- Digest integration: `src/app/api/digest/route.ts` (reads workspace-scoped signals into the morning briefing)
- Backfill cron for failed classifications: `src/app/api/cron/classify-pending/route.ts`

## What's real vs what's seamed

**Real:** The signal engine, workspace config, digest synthesis, and Signal Studio all do live work. The configuration genuinely drives system behavior (asset names, priority mappings, digest context).

**Seamed (intentional v1 limits):**
- Pipeline stage names are hardcoded (refactoring the `Stage` union type to be runtime-configurable is a separate ~2h job).
- Contact role names are hardcoded.
- Seed data (accounts, opportunities) is fictional and legal-tech themed — switching presets updates terminology but not the underlying deals.
