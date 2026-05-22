# Dugout

> *The dugout view of your pipeline.*

A working deal intelligence layer for GTM teams. Configurable per workspace, built by Jackson Shuey.

Dugout tells sellers and managers what's happening in their pipeline before they have to ask — routed by severity tier, weighted by close-date proximity, and tied to playbooks when the moment is big enough to need one. The engine is workspace-agnostic; load a preset, edit it, or build your own from scratch in the settings.

This repo ships with a **Checkbox** preset preloaded — the workspace was originally built as the deliverable for Checkbox's GTM Engineer case. The Generic B2B SaaS preset is included to demonstrate the platform isn't tied to legal-tech or any one company.

→ **Live demo:** _link to be added after Vercel deploy_

## Surfaces

- `/` — operational home. Signal counts, deal health distribution, top signals across the team.
- `/ae` — AE Console with morning digest (live Claude call) + per-deal cards with health badges + inline playbooks.
- `/manager` — team risk roll-up, blocking queue, 1:1 coaching hooks.
- `/studio` — Signal Studio: natural-language to rule spec, mapped to your workspace's strategic priorities.
- `/settings` — workspace configuration. Edit company identity, priorities, assets, and stack. Persists via cookie; survives reloads.
- `/architecture` — 4-layer spec, signal catalog, design choices, what we don't build.
- `/rollout` — 3-phase rollout plan with metrics.
- `/part-two` — Trial Orchestrator (companion system proposal).

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

## What's real vs what's seamed

**Real:** The signal engine, workspace config, digest synthesis, and Signal Studio all do live work. The configuration genuinely drives system behavior (asset names, priority mappings, digest context).

**Seamed (intentional v1 limits):**
- Pipeline stage names are hardcoded (refactoring the `Stage` union type to be runtime-configurable is a separate ~2h job).
- Contact role names are hardcoded.
- Seed data (accounts, opportunities) is fictional and legal-tech themed — switching presets updates terminology but not the underlying deals.
