# Cloudflare Email Routing Pivot — Handoff

> **Read this if you're picking up the inbound-email pivot.** State of the build, what's done, what's next, and the full architectural plan for replacing Mailgun with Cloudflare Email Routing.

**Created:** 2026-05-22, mid-session.
**Branch to use:** `claude/cloudflare-email-routing` (not created yet — create it off latest `main`).
**Latest `main`:** `3a0325e` ("Merge pull request #9 from claude/knowledge-base-mailgun-adapter").

---

## 1. TL;DR

We're dropping Mailgun and switching to **Cloudflare Email Routing + Cloudflare Email Worker**. The pivot is driven by Mailgun's free trial blocking inbound mail (returns `550 5.7.1 Relaying denied` even with verified MX records and correct routes). Cloudflare Email Routing is genuinely free, no card required, no trial restrictions.

**Why Cloudflare wins for this use case:**
- Free forever, unlimited inbound on custom domains
- Email Workers free tier = 100k requests/day (we'll use ~5/day)
- Domain (`dugoutdemo.com`) already on Cloudflare DNS — confirmed via sidebar tab in user's browser
- Industry-standard MIME parsing via `postal-mime`
- No third-party billing relationship to maintain

**Tradeoff accepted:** small amount of new code (one Worker + one webhook route) vs. continued Mailgun debugging.

---

## 2. Current state of inbound (before pivot)

### What exists in `main`

| File | Role | Status after pivot |
|---|---|---|
| `src/app/api/inbound-email/mailgun/route.ts` | Mailgun HMAC-signed webhook | **Delete in Phase 5** |
| `src/app/api/inbound-email/[secret]/route.ts` | SendGrid path-secret webhook | Keep (alt provider, untested in prod) |
| `src/lib/inbound-pipeline.ts` | Shared validate → store → classify pipeline | **Modify**: add `"cloudflare"` to provider union |
| `src/lib/inbound-email.ts` | Supabase CRUD for `inbound_emails` table | No change |
| `src/lib/newsletter-adapter.ts` | Haiku classifier | No change |
| `supabase/migrations/20260522_inbound_emails.sql` | `inbound_emails` table | No change |
| `.env.example` | Has `MAILGUN_SIGNING_KEY`, `INBOUND_WEBHOOK_SECRET`, `INBOUND_SENDER_ALLOWLIST` | **Modify**: add `CLOUDFLARE_INBOUND_SECRET` |

### Current Mailgun config (what we're tearing down)

- Domain in Mailgun: `inbox.dugoutdemo.com` (US region)
- MX records on `inbox.dugoutdemo.com` → `mxa.mailgun.org` / `mxb.mailgun.org` (verified)
- Mailgun Route: `match_recipient(".*@inbox.dugoutdemo.com")` → `forward("https://dugout-pi.vercel.app/api/inbound-email/mailgun")` (Priority 0, saved)
- Mailgun env vars: `MAILGUN_SIGNING_KEY` set on Vercel
- **Status:** receiving mail bounces at SMTP with `550 5.7.1 Relaying denied`. Cause: Mailgun's free trial blocks inbound until payment method added. This is why we're pivoting.

---

## 3. Target architecture (after pivot)

```
Newsletter sender (e.g. tldr@tldrnewsletter.com)
         │
         │  SMTP
         ▼
Cloudflare MX servers (route100.mx.cloudflare.net, route1/2/3...)
         │
         │  (MX records on inbox.dugoutdemo.com point here)
         ▼
Cloudflare Email Routing rule:
  "*@inbox.dugoutdemo.com" → Email Worker `dugout-inbound`
         │
         ▼
Email Worker (workers/dugout-inbound/src/worker.ts):
  1. Parse MIME with postal-mime
  2. Extract { from, subject, text, html, message_id }
  3. POST JSON to https://dugout-pi.vercel.app/api/inbound-email/cloudflare
     with X-Cloudflare-Secret header
         │
         ▼
Next.js webhook (src/app/api/inbound-email/cloudflare/route.ts):
  1. Verify X-Cloudflare-Secret matches CLOUDFLARE_INBOUND_SECRET env
  2. Build NormalizedInboundEmail
  3. Call processInboundEmail(normalized, "cloudflare")
         │
         ▼
Existing pipeline (src/lib/inbound-pipeline.ts):
  Allowlist check → insertInboundEmail → classifyNewsletter →
  insertSignalsDedup → markClassified
```

**Auth model:** shared secret in HTTP header. Worker holds it as a Cloudflare secret binding; Next.js holds it as `CLOUDFLARE_INBOUND_SECRET`. Constant-time compare in the route handler (same pattern as `src/lib/ui-auth.ts`).

**Why not put the whole pipeline IN the Worker?** Supabase client + Anthropic SDK both work in Workers, but the pipeline is already battle-tested in Node.js on Vercel. Keeping the Worker as a thin adapter means one source of truth for classification, dedup, and allowlist logic. Easier to test, easier to swap providers later.

---

## 4. File-by-file plan

### New files

#### `src/app/api/inbound-email/cloudflare/route.ts`

The webhook endpoint Cloudflare's Worker POSTs to. Mirrors `mailgun/route.ts` structurally:

```ts
import { NextResponse } from "next/server";
import {
  processInboundEmail,
  type NormalizedInboundEmail,
} from "@/lib/inbound-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = process.env.CLOUDFLARE_INBOUND_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json(
      { error: "Server not configured: set CLOUDFLARE_INBOUND_SECRET (>=16 chars)" },
      { status: 500 },
    );
  }

  const provided = req.headers.get("x-cloudflare-secret") ?? "";
  if (!timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON" }, { status: 200 });
  }

  const normalized: NormalizedInboundEmail = {
    from_raw: String(body.from_raw ?? "").slice(0, 500),
    subject: String(body.subject ?? "").slice(0, 1000),
    text_body: String(body.text_body ?? ""),
    html_body: String(body.html_body ?? ""),
    message_id: typeof body.message_id === "string" ? body.message_id : null,
  };

  const outcome = await processInboundEmail(normalized, "cloudflare");

  // Same response shape as Mailgun route — see mailgun/route.ts:179-217
  switch (outcome.kind) {
    case "body_too_large":
      return NextResponse.json({ ok: false, dropped: "body_too_large" }, { status: 200 });
    case "bad_from_header":
      return NextResponse.json({ ok: false, dropped: "bad_from_header" }, { status: 200 });
    case "sender_not_allowlisted":
      return NextResponse.json({ ok: true, dropped: "sender_not_allowlisted" }, { status: 200 });
    case "dedup":
      return NextResponse.json({ ok: true, dedup: true });
    case "stored":
      if (outcome.classification.ok) {
        return NextResponse.json({
          ok: true,
          id: outcome.id,
          signals: outcome.classification.signals,
          matched: outcome.classification.matched,
          workspace: outcome.classification.workspace,
        });
      }
      return NextResponse.json({ ok: true, id: outcome.id, classification: "deferred" });
    case "storage_failed":
      return NextResponse.json({ ok: false, error: "Storage failed" }, { status: 503 });
  }
}
```

#### `workers/dugout-inbound/wrangler.toml`

Cloudflare Workers config. Lives at repo root in a new `workers/` directory.

```toml
name = "dugout-inbound"
main = "src/worker.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

# Secret (set via `wrangler secret put WEBHOOK_SECRET`):
#   CLOUDFLARE_INBOUND_SECRET — must match the one set in Vercel

[vars]
WEBHOOK_URL = "https://dugout-pi.vercel.app/api/inbound-email/cloudflare"
```

#### `workers/dugout-inbound/src/worker.ts`

The Email Worker itself. ~40 lines.

```ts
import PostalMime from "postal-mime";

interface Env {
  WEBHOOK_URL: string;
  WEBHOOK_SECRET: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parser = new PostalMime();
    const email = await parser.parse(message.raw);

    const payload = {
      from_raw: message.from,
      subject: email.subject ?? "",
      text_body: email.text ?? "",
      html_body: email.html ?? "",
      message_id: email.messageId ?? null,
    };

    try {
      const res = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cloudflare-Secret": env.WEBHOOK_SECRET,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Log + accept. Don't bounce real mail just because our backend blipped.
        // The provider will not retry, but the alternative (reject) bounces back
        // to the sender, which is worse UX for newsletters.
        console.error(`[dugout-inbound] webhook returned ${res.status}`);
      }
    } catch (e) {
      console.error("[dugout-inbound] webhook fetch failed", e);
    }
  },
};
```

#### `workers/dugout-inbound/package.json`

```json
{
  "name": "dugout-inbound",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  },
  "dependencies": {
    "postal-mime": "^2.2.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260101.0",
    "wrangler": "^3.90.0"
  }
}
```

#### `workers/dugout-inbound/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"]
}
```

### Modified files

#### `src/lib/inbound-pipeline.ts`

One-line change at line 117:

```ts
// BEFORE
provider: "sendgrid" | "mailgun",

// AFTER
provider: "sendgrid" | "mailgun" | "cloudflare",
```

#### `.env.example`

Add (don't remove Mailgun vars yet — leave them so anyone running off old configs sees the diff):

```
CLOUDFLARE_INBOUND_SECRET=
```

#### `README.md`

Add a new "Setup (Cloudflare Email Routing)" section above the Mailgun section, mark Mailgun as legacy. Document:
- Cloudflare dashboard steps (Email → Email Routing → enable)
- DNS auto-config (Cloudflare adds MX itself; remove Mailgun MX records first)
- Worker deploy: `cd workers/dugout-inbound && npm install && wrangler secret put WEBHOOK_SECRET && wrangler deploy`
- Wire Worker to routing rule: dashboard → Email Routing → Routes → Custom address → "*@inbox.dugoutdemo.com" → Action: "Send to Worker" → pick `dugout-inbound`
- Env vars: `CLOUDFLARE_INBOUND_SECRET` set on Vercel + as Worker secret (must match)

### Files to delete (Phase 5, after cutover confirmed)

- `src/app/api/inbound-email/mailgun/route.ts`
- Remove `MAILGUN_SIGNING_KEY` line from `.env.example`
- Remove Mailgun setup section from `README.md`
- Remove `MAILGUN_SIGNING_KEY` from Vercel env vars (dashboard step)

---

## 5. Env vars

### To add

| Variable | Where | Notes |
|---|---|---|
| `CLOUDFLARE_INBOUND_SECRET` | Vercel (all envs) + Worker secret | Random ≥16 chars. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Same value in both places** — that's the contract. |

### To keep (no change)

- `INBOUND_SENDER_ALLOWLIST` — still gates which sender domains are stored. Already set.
- `ANTHROPIC_API_KEY` — classifier.
- `SUPABASE_*` — storage.

### To remove (Phase 5)

- `MAILGUN_SIGNING_KEY` — unused once Mailgun adapter is deleted.

---

## 6. Phased rollout

### Phase 1 — Build the new pieces (no DNS changes yet) [~45 min]

1. Create branch: `git checkout -b claude/cloudflare-email-routing`
2. Write `src/app/api/inbound-email/cloudflare/route.ts`.
3. Edit `src/lib/inbound-pipeline.ts` provider union (line 117).
4. Set `CLOUDFLARE_INBOUND_SECRET` on Vercel (all three envs: Production, Preview, Development).
5. Add to `.env.example`.
6. `npx vercel env pull .env.local` to sync locally.
7. Smoke test the route with curl:
   ```bash
   SECRET=$(grep CLOUDFLARE_INBOUND_SECRET .env.local | cut -d= -f2)
   curl -X POST http://localhost:3000/api/inbound-email/cloudflare \
     -H "Content-Type: application/json" \
     -H "X-Cloudflare-Secret: $SECRET" \
     -d '{"from_raw":"test@substack.com","subject":"hello","text_body":"test body","html_body":"","message_id":"<test-1@example.com>"}'
   ```
   Expect `{"ok":true,"id":"...",...}` and a row in `inbound_emails`.
8. Commit + push + open PR. **Don't merge yet** — Phase 2 needs to coexist.

### Phase 2 — Build and deploy the Worker [~30 min]

1. Create `workers/dugout-inbound/` directory with the four files above.
2. From `workers/dugout-inbound/`:
   ```bash
   npm install
   npx wrangler login                      # OAuth flow in browser
   npx wrangler secret put WEBHOOK_SECRET  # paste the same secret as Vercel
   npx wrangler deploy
   ```
3. Note the Worker URL printed at the end (we don't use it — the email trigger is via Cloudflare Email Routing, not HTTP — but it confirms deploy worked).
4. Verify Worker shows up in Cloudflare dashboard → Workers & Pages → Overview.

### Phase 3 — Switch DNS to Cloudflare Email Routing [~10 min, then DNS wait]

⚠️ **Mailgun will stop receiving once we do this. Cutover, not gradual.**

1. Cloudflare dashboard → Email → Email Routing → **Get started**.
2. Select domain: `dugoutdemo.com`.
3. Cloudflare will say "we need to update your DNS." Click **"Add records and enable"** — it will:
   - Remove existing MX records on the apex (if any)
   - Add Cloudflare's MX records (`route1.mx.cloudflare.net`, etc.)
4. **Crucial:** Cloudflare Email Routing operates on the **apex domain** by default (`dugoutdemo.com`), not the `inbox.` subdomain. Two options here:
   - **Option A (simpler):** Drop the subdomain. Change addresses from `test@inbox.dugoutdemo.com` to `test@dugoutdemo.com`. Update Worker routing rule to `*@dugoutdemo.com`. Update `INBOUND_SENDER_ALLOWLIST` notes if needed.
   - **Option B (preserve subdomain):** Enable Email Routing on a subdomain. Cloudflare supports this — in the Email Routing settings, you can add subdomain routing. Stays as `*@inbox.dugoutdemo.com`. Slight extra config.
   - **Recommendation:** Option A. Simpler, fewer moving parts. The "inbox." prefix had no semantic value — was just a Mailgun-era convention.
5. **Remove Mailgun MX records FIRST** in the Cloudflare DNS panel (DNS tab, find the `mxa.mailgun.org` / `mxb.mailgun.org` entries, delete). Otherwise you have two providers fighting for the same MX slot — Email Routing setup will refuse to proceed.
6. Wait 5-15 min for DNS propagation. Check with:
   ```bash
   dig MX dugoutdemo.com +short      # if Option A
   dig MX inbox.dugoutdemo.com +short # if Option B
   ```
   Expect `route1.mx.cloudflare.net` etc.

### Phase 4 — Wire Worker to inbound rule [~5 min]

1. Cloudflare dashboard → Email Routing → **Routes** tab.
2. Click **Create address** → **Custom address**.
3. Pattern: `*@dugoutdemo.com` (or `*@inbox.dugoutdemo.com` for Option B).
4. Action: **Send to a Worker** → select `dugout-inbound`.
5. Save.
6. **Test:** send an email from a sender in `INBOUND_SENDER_ALLOWLIST` (e.g. forward yourself a Substack newsletter) to `test@dugoutdemo.com`.
7. Verify:
   - Cloudflare → Email Routing → Activity log shows the message.
   - Cloudflare → Workers & Pages → `dugout-inbound` → Logs (real-time tail) shows the POST attempt.
   - Vercel → Deployments → Latest → Functions → `/api/inbound-email/cloudflare` → logs show the request.
   - Supabase: `select * from inbound_emails order by received_at desc limit 1;` shows the row.
   - Supabase: `select * from external_signals where source = 'newsletter' order by created_at desc limit 5;` shows signals if the classifier matched anything.

### Phase 5 — Cleanup (after Phase 4 confirmed working) [~15 min]

1. Delete `src/app/api/inbound-email/mailgun/route.ts`.
2. Remove `MAILGUN_SIGNING_KEY` from `.env.example`.
3. Remove Mailgun setup section from `README.md`.
4. Remove `MAILGUN_SIGNING_KEY` from Vercel env vars (dashboard).
5. **Optional:** delete the Mailgun domain + account if not used elsewhere.
6. Update `HANDOFF.md` (the main one) to reflect Cloudflare as the inbound provider.
7. Commit, merge PR.

---

## 7. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Worker fetch to Vercel times out | Low | Vercel function `maxDuration = 60` ; Haiku classification averages 2-3s. Worker request budget is 30s CPU time, plenty. |
| Vercel cold start delays first email | Low | First email after deploy may take ~3s. Acceptable. |
| `postal-mime` fails on a weird MIME structure | Low | Worker catches the parse error → logs → accepts (don't bounce real mail). Body shows as empty in DB; sweeper retries classification next day. |
| Secret rotation breaks pipeline | N/A | Just update both places. Worker is `wrangler secret put`, Vercel is dashboard. Brief window of mismatch = 401s, no data loss. |
| Cloudflare changes Workers pricing | Very low | If it happens, Mailgun-with-card or SendGrid are still here. Adapters are isolated. |
| DNS propagation slow | Medium | Just wait. Mail bounces with a transient error during propagation; legit senders retry. |
| User accidentally deletes Mailgun MX before Cloudflare is enabled | Medium | Phase 3 step order is explicit: enable Cloudflare Email Routing FIRST (which writes new MX), then it auto-removes old ones. If they get it backwards, no-MX state = inbound rejected for ~15 min. Not catastrophic. |
| Sender allowlist drops the test email | High during testing | The allowlist (`INBOUND_SENDER_ALLOWLIST`) defaults to `substack.com,beehiiv.com,tldrnewsletter.com,lennysnewsletter.com`. Sending from Gmail will get dropped at the allowlist step. To test, either: (a) add `gmail.com` temporarily, or (b) forward a real newsletter from a Gmail rule. |

---

## 8. Verification checklist

When everything's working, all of these should be true:

- [ ] `dig MX dugoutdemo.com +short` returns `route1.mx.cloudflare.net` (and other Cloudflare hosts)
- [ ] Cloudflare → Email Routing → Activity log shows test email as "Forwarded"
- [ ] Cloudflare → Workers → `dugout-inbound` → Logs show POST to Vercel with 2xx response
- [ ] Vercel → Functions → `/api/inbound-email/cloudflare` shows hits in last hour
- [ ] Supabase `inbound_emails` table has row for the test email, `classified_at IS NOT NULL`
- [ ] Supabase `external_signals` table has rows where `source = 'newsletter'` (if classifier matched)
- [ ] `/market-intel` page on https://dugout-pi.vercel.app shows the new signals
- [ ] Sending from a non-allowlisted domain returns `{"ok":true,"dropped":"sender_not_allowlisted"}` (test via curl, not real email)
- [ ] Sending with wrong/missing `X-Cloudflare-Secret` returns 401

---

## 9. Open decisions before starting

These need a call from Jackson before Phase 3:

1. **Subdomain or apex?** Option A (`*@dugoutdemo.com`, drop the `inbox.` prefix) vs. Option B (`*@inbox.dugoutdemo.com`). Recommendation: Option A.
2. **Test sender domain?** Gmail isn't in the allowlist. Add `gmail.com` temporarily for testing, or use a forwarded newsletter? Recommendation: temporarily add `gmail.com`, remove after end-to-end test passes.
3. **Keep the Mailgun account?** Just disable receiving, or close entirely? Recommendation: close — it has billing risk on a free trial.

---

## 10. Why this isn't a Mailgun debugging problem anymore

Captured for the next session so we don't re-relitigate the decision:

- Mailgun's MX records were correctly configured (verified in their UI + via `dig`).
- Mailgun Route was correctly configured (regex match recipient + forward URL, Priority 0).
- Webhook code was correct (HMAC verification properly implemented at `src/app/api/inbound-email/mailgun/route.ts`).
- The bounce was `550 5.7.1 Relaying denied` — Mailgun's MTA refusing the SMTP connection at the protocol level.
- Cause: **Mailgun's free trial blocks inbound on custom domains until a payment method is added.** This is a deliberate anti-abuse measure, documented in Mailgun's terms but not surfaced in the dashboard.
- Adding a card would have fixed it (at ~$0/mo for this volume), but the user reasonably preferred not to put a card down for a demo project.
- Cloudflare has no equivalent restriction. Genuinely free, no card.

**Lesson for future sessions:** when debugging an external service, ask "is this the right tool for the user's constraints" as an early-stage diagnostic, not after burning an hour on configuration. The right question this time was "are you OK putting a card down?" — that single answer would have routed us to Cloudflare in turn 2 instead of turn 12.

---

## 11. References

- Cloudflare Email Routing docs: https://developers.cloudflare.com/email-routing/
- Email Workers reference: https://developers.cloudflare.com/email-routing/email-workers/
- `postal-mime` (MIME parser used in the Worker): https://github.com/postalsys/postal-mime
- `wrangler` CLI docs: https://developers.cloudflare.com/workers/wrangler/
- Existing Mailgun adapter (for reference / structural mirror): `src/app/api/inbound-email/mailgun/route.ts`
- Shared pipeline (the part that doesn't change): `src/lib/inbound-pipeline.ts`
- Main project handoff (for broader context): `checkpoint/HANDOFF.md`
