# Swyft AI — Signal Dictionary

**Category:** AI deal capture (auto-fills CRM from calls)
**Role in stack:** Makes MEDDPICC/next-step fields in Salesforce actually exist by extracting them from Gong/Chorus/Zoom recordings post-call, instead of relying on reps to type them in.
**Integration surface:** Thin public API; primary surface is Salesforce field writes via OAuth on Opportunity/Account/Contact. Field mapping is per-customer (Swyft maps extracted entities to whichever custom fields the org already uses for MEDDPICC).
**Pricing/access reality:** Sales-led, no public pricing. Help center exists but no developer docs or webhook spec — Dugout reads downstream from Salesforce, not from Swyft directly.

## What it emits
Swyft writes structured fields *to Salesforce* — MEDDIC/MEDDPICC slots, next steps, competitor mentions, customer concerns, churn risk flags, and meeting summaries — derived from call transcripts. It also fires Slack notifications about call outcomes. For Dugout, none of these are direct signals; they're the *substrate* that makes Salesforce-based rules viable. Without Swyft, those fields are mostly null at Checkbox.

## Architectural role for Dugout
Swyft is an upstream dependency, not a signal source. Several Dugout rules (Decision Criteria empty at Selected Vendor, no Economic Buyer identified, Next Steps stale) only fire usefully if the underlying Salesforce fields are populated — and at most B2B orgs reps don't fill MEDDPICC manually. Swyft ensures these fields exist and stay fresh after every customer call. So the "signal" Dugout cares about is the *presence, freshness, and confidence* of structured deal metadata in Salesforce, which Swyft is responsible for keeping current.

## Signals we'd extract (indirectly, via Salesforce)

### 1. MEDDPICC field staleness at Selected Vendor — BLOCKING
- **What it is:** Opportunity sits in Selected Vendor stage with Decision Criteria, Economic Buyer, or Paper Process fields empty/stale (>14 days since update). Means either Swyft hasn't run, no call happened, or Swyft couldn't extract it.
- **Why for the wedge:** Selected Vendor is exactly where deals stall on procurement/finance. Missing Economic Buyer = no one to escalate to when legal/IT engages.
- **Rule shape:** `stage = "Selected Vendor" AND (Economic_Buyer__c IS NULL OR Decision_Criteria__c LastModified > 14d)`
- **Source fields:** Salesforce Opportunity custom fields populated by Swyft (org-specific names).

### 2. Next Steps decay — ACTION
- **What it is:** Swyft populates a Next Steps field after each call; if it hasn't been refreshed in 7+ days on an active late-stage deal, the deal is going cold even if the rep logged activity.
- **Why for the wedge:** "Activity exists" lies; "next step is fresh and specific" is the real heartbeat. Deals dying at Selected Vendor often show stale next steps for 2-3 weeks before being marked Closed Lost.
- **Rule shape:** `stage IN (late_stages) AND Next_Steps__c.LastModified > 7d`
- **Source fields:** Next Steps field + LastModifiedDate.

### 3. Competitor mentioned mid-cycle — AWARENESS
- **What it is:** Swyft extracts competitor names from call transcripts into a Competitor field. New value appearing after stage = Proposal often precedes a bake-off.
- **Why for the wedge:** Late-stage competitor introduction is a budget-justification signal — champion is being asked to defend the choice.
- **Rule shape:** `Competitor__c changed AND stage >= "Proposal"`
- **Source fields:** Competitor / Competitive Threat custom field.

## What we'd ignore
- Swyft's own admin metrics (extraction confidence scores, model versions, audit logs of which fields it edited)
- Slack notifications Swyft fires (Dugout has its own digest layer)
- Raw call transcripts (Chorus/Gong is the canonical source for those)
- Meeting summaries (narrative, not structured)

## Effort to wire
- **Adapter LOC estimate:** Zero net new. Dugout already reads Salesforce; Swyft just populates fields we'd be reading regardless.
- **Time estimate:** 0 hours for code. ~2 hours of config to map Checkbox's actual custom field API names into Dugout's rule definitions.
- **Hardest part:** Discovering which Salesforce custom field API names Swyft writes to at Checkbox specifically — naming is org-defined, not standardized. Requires a 15-min call with Checkbox RevOps.

## Open questions
1. Does Swyft stamp a "last updated by Swyft" marker so we can distinguish AI-populated values from rep-entered ones (confidence weighting)?
2. What's Swyft's actual extraction success rate on MEDDPICC fields at Checkbox — if it only fires on 40% of calls, the "field empty" rule has too many false positives.
3. Does Swyft handle multi-thread deals (writing to multiple Contacts per Opp), or only the primary?
