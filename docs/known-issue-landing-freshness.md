# Known issue: landing "live pipeline" surfaces stale / off-brand runs

**Status:** selection bug fixed 2026-05-28; content-curation guard still open.
**Surfaces:** landing page → "Live newsfeed" section → `LivePipelineVisual`
(the email → Haiku → dashboard chain) and, relatedly, the "Inside the agent"
trace visual.

## Symptom (recurring — flagged multiple times)

The pipeline visual showed an **old, off-brand run as the hero example**: a
2-day-old PharmExec email about "TrumpRx" was rendered as the "latest" run
while the counters strip said **"last activity 1h ago."** Two things are wrong
at once:

1. **Stale:** the displayed run was 2 days old despite much more recent
   activity. Obviously-stale on a portfolio landing page.
2. **Off-brand:** "TrumpRx" is politically charged and not representative of
   the product. It should never be the showcased example.

This was reported repeatedly. Earlier passes fixed the *speed* of the page
(static-ISR) and *diagnosed* the data as cron-fresh, but **never changed the
selection logic that decides which run to display** — so it kept recurring.
Documenting it here so the root cause is fixed, not just re-diagnosed.

## Root cause #1 — recency (FIXED)

`getLivePipelineSnapshot()` in `src/lib/live-pipeline.ts` preferred the most
recent email that *produced a signal* over the most recent *classified* email,
"so the full chain renders end-to-end." But when recent inbounds are dropped
by the filter (no signal), the visual fell back to the newest *signal* — which
can be days old. Result: "last activity 1h ago" + a 2-day-old hero run.

**Fix (2026-05-28):** the displayed run is now always the **most recent
classified email**, regardless of outcome. The downstream decision/signal
lookup still renders the full chain when that email produced a signal, or the
drop reason when it didn't. Recency wins.

## Root cause #2 — content curation (OPEN)

Even with recency fixed, nothing prevents a politically-charged or off-brand
item (e.g. anything "TrumpRx"-like) from being the hero run, or from appearing
in the workspace feed / ticker. This is a curation gap, not a bug.

**Recommended fix (not yet built), pick one:**
- **Prefer on-brand content for the hero:** when choosing the displayed run,
  prefer the most recent signal tied to a *tracked account* over generic
  market/workspace intel. Tracked-account news is more relevant and less
  likely to be charged filler.
- **Denylist of charged terms** applied at display time for the hero example
  (and optionally the ticker), so flagged items still exist in the data but
  never get showcased.
- **Manual "featured run" override** for demo/interview moments.

## Related — the new "Inside the agent" trace visual

`getLatestAgentTraces(1)` already orders by `created_at desc`, so it shows the
*most recent* batch run by construction. Once `20260528_news_batches.sql` is
applied and ≥3 emails flow, confirm it reflects recent activity (not a stale
batch). If multiple recent runs are wanted, raise the limit and render a list.

## Regression guard / acceptance

- The displayed run's timestamp should be within the freshest activity window
  (i.e. it should *not* be days older than "last activity").
- No politically-charged term should appear as the showcased hero run.
- Consider a lightweight test/assertion: given a mix where the newest
  classified email was dropped, the snapshot still returns that newest email
  (not an older signal-linked one).
