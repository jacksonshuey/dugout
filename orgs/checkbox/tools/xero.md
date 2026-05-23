# Xero — Signal Dictionary

**Category:** Finance / billing / accounting
**Role in stack:** System of record for invoicing, AR, and payment lifecycle for Checkbox's existing customer base.
**Integration surface:** REST API (Accounting API v2.0), Webhooks (Invoices + Contacts events), OAuth 2.0 with 30-min access tokens + 60-day refresh tokens.
**Pricing/access reality:** Free developer access; production app requires Xero partner review. Rate limits are tight (60 calls/min, 5,000/day per tenant) — adapter must cache and batch.

## What it emits
Invoices (ACCREC/ACCPAY with line items, amounts, due dates, statuses), Payments (applied/reconciled events), Contacts (customer records with payment terms and balances), Credit Notes, and Accounts Receivable aging. Webhooks fire on Invoice CREATE/UPDATE and Contact CREATE/UPDATE — payment status changes require polling the Invoice endpoint with `If-Modified-Since`.

## Wedge alignment honesty
Xero does not help with the Selected Vendor → budget approval wedge — those deals haven't been invoiced yet. Its signals extend Dugout downstream into retention/expansion, catching at-risk renewals and quiet downgrades before they show up in Salesforce as churn.

## Signals we'd extract

### 1. Renewal window approaching — AWARENESS (90d) / ACTION (60d) / BLOCKING (30d)
- **What it is:** Recurring invoice or annual contract approaching end-of-term based on invoice cadence + contract metadata.
- **Why for the (extended) wedge — retention version:** Auto-renewals lapse silently; AE needs runway to re-engage champion and finance before the renewal date, mirroring the original wedge problem one tier later.
- **Rule shape:** `today + N days >= last_annual_invoice.date + 365` where N ∈ {90, 60, 30} → tier accordingly. Cross-check against Salesforce Opportunity renewal date if present.
- **Source fields:** `Invoice.Date`, `Invoice.DueDate`, `Invoice.Reference`, `Contact.ContactID`, `Invoice.LineItems[].Description`.

### 2. Payment health degradation — ACTION
- **What it is:** Customer has invoices in `OVERDUE` status, or AR aging bucket shifted from 0-30 to 30-60/60-90.
- **Why for the (extended) wedge — retention version:** Late payment is the earliest financial signal of dissatisfaction or budget pressure — expansion conversations stall when AP is fighting AR.
- **Rule shape:** `count(invoices WHERE Status='AUTHORISED' AND DueDate < today) >= 1 AND days_overdue > 15` → ACTION; >45 days → BLOCKING.
- **Source fields:** `Invoice.Status`, `Invoice.DueDate`, `Invoice.AmountDue`, `Contact.ContactID`.

### 3. Customer downgrade detected — ACTION
- **What it is:** New recurring invoice issued with `Total` materially lower than prior period for same Contact (seat reduction or tier change).
- **Why for the (extended) wedge — retention version:** Quiet downgrades are leading indicators of full churn next cycle; AE has one billing cycle to intervene.
- **Rule shape:** `new_invoice.Total < prior_invoice.Total * 0.85` AND same `Contact.ContactID` AND same line-item SKU pattern → ACTION.
- **Source fields:** `Invoice.Total`, `Invoice.LineItems[].Quantity`, `Invoice.LineItems[].UnitAmount`, `Invoice.Reference`.

### 4. First-invoice-issued (deal-closed confirmation) — AWARENESS
- **What it is:** First ACCREC invoice issued to a Contact that maps to a recently closed-won Salesforce Opportunity.
- **Why for the (extended) wedge — retention version:** Confirms the closed-won actually monetized — tightens forecast accuracy and flags closed-won deals that stalled in provisioning.
- **Rule shape:** `Contact.ContactID NOT IN prior_invoices` AND mapped Salesforce Opp `CloseDate within last 45 days` → AWARENESS digest entry.
- **Source fields:** `Invoice.Type='ACCREC'`, `Invoice.Date`, `Contact.Name`, `Contact.ContactID`.

## What we'd ignore
- ACCPAY invoices (Checkbox's own bills to vendors)
- Payroll, expense claims, bank transactions, manual journals
- Report generation events, chart-of-accounts changes
- Draft and deleted invoices
- Tax rate and tracking category updates

## Effort to wire
- **Adapter LOC estimate:** ~450 LOC (OAuth refresh handling adds bulk; webhook intent verification adds ~50).
- **Time estimate:** 2-3 days for working adapter, +1 day for Salesforce Contact↔Account mapping.
- **Hardest part:** Mapping Xero `Contact.ContactID` to Salesforce `Account.Id` — Xero contacts are billing entities (often "Acme Corp - AP") not always 1:1 with sales accounts. Fuzzy match + manual override table required. Multi-currency contracts add normalization step.

## Open questions
1. Does Checkbox use Xero as system-of-record for renewals, or is contract term tracked only in Salesforce CPQ?
2. Are seat-based downgrades reflected as new invoices or as credit notes against existing ones?
3. Webhook delivery SLA is best-effort — do we need a nightly reconciliation sweep to catch missed events?
