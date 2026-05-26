# Dugout

> The operating system for GTM teams.

Dugout unifies every revenue signal across Salesforce, Slack, calendars, newsletters, and the public web, so sales teams spend less time hopping platforms and more time executing deals.

→ **Live demo:** [trydugout.com](https://trydugout.com) · **Contact:** [jacksonshuey@gmail.com](mailto:jacksonshuey@gmail.com?subject=Dugout%20walkthrough)

## Surfaces

- `/` — landing. Hero, integration constellation, embedded live Console.
- `/console` — AE Console. Morning digest, per-deal cards, inline playbooks.
- `/manager` — team risk roll-up across reps.
- `/account/[slug]` — per-account deep view: SV Health, opps, buying committee, signal timeline.
- `/market-intel` — workspace-scoped market intel feed (newsletter inbox).
- `/ask` — chat UI over your workspace, dual-provider (Claude, GPT-4o).

## How it works

- **Signal engine** ([`src/lib/signal-engine.ts`](src/lib/signal-engine.ts)) — pure functions, one per rule. Each rule tags a workspace priority and a severity tier; the tier dictates routing.
- **Workspace config** ([`src/lib/workspace.ts`](src/lib/workspace.ts)) — runtime configuration that drives the engine, digest prompt, and rule-authoring prompt.
- **Deal Health** — compound state aggregated from signals on a deal, weighted by close-date proximity. Returns `Healthy / Monitor / At Risk / Critical`.
- **Playbooks** — multi-phase workflows attached to specific signals.
- **LLM use** — Claude Sonnet 4.6 for digest synthesis and rule authoring. ~90% of useful signals are deterministic; the LLM runs where it earns its keep.

## Integrations

The integration matrix (status, auth, deployment mode, data direction, limits) lives in [`src/data/integrations.ts`](src/data/integrations.ts) and renders on the landing page. Adding a source is one entry in `INTEGRATIONS` plus one adapter file.

**Live:** Anthropic, Supabase, AgentMail, NewsAPI, SEC EDGAR, Firecrawl, Slack, Granola.
**Display:** Salesforce, Gong, Outreach, Dock, Chili Piper.

## Security posture

- **API keys never reach the browser.** Integration credentials live in Supabase Vault, encrypted at rest. Server-side adapters retrieve them through `SECURITY DEFINER` RPCs.
- **Inbound webhooks are cryptographically verified.** HMAC signatures + 5-minute replay window. Unsigned, expired, or tampered payloads are rejected pre-write.
- **Database is deny-all by default.** RLS enabled on every `public.*` table. Service role runs Dugout's reads and writes; anon role does nothing.
- **No writes to source systems.** Adapters consume; they never `POST` / `PATCH` / `DELETE` back to Salesforce, Gong, Outreach, or any source. A bug in Dugout can produce a wrong signal. It cannot push a bad CRM update.

UI gates at the proxy ([`src/proxy.ts`](src/proxy.ts)) mint a per-session cookie; protected API routes verify it in-handler.

## Stack

Next.js · TypeScript · Supabase (Postgres + Vault + RLS) · Anthropic · Vercel.

## Run locally

```bash
cp .env.example .env.local      # fill in ANTHROPIC_API_KEY
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
