# Xero — Signal Dictionary

**Category:** Finance / billing / accounting
**Role in stack:** System of record for invoicing, AR, and payment lifecycle for the workspace's existing customer base. Downstream wedge — tracks what happens *after* Selected Vendor → CW.
**Integration surface:** REST API (Accounting API v2.0, base `https://api.xero.com/api.xro/2.0/`), Webhooks (Invoices + Contacts events only), OAuth 2.0 authorization code + PKCE with 30-min access tokens and 60-day rolling refresh tokens that rotate on every use ([developer.xero.com/documentation/oauth2/overview](https://developer.xero.com/documentation/oauth2/overview)).
**Pricing/access reality:** Free developer access for uncertified apps capped at 25 connected tenants. Production scale requires Xero App Partner certification (security review + UX audit). Rate limits per tenant: **60 calls/min**, **5,000 calls/day**, **5 concurrent**, plus a 10,000/min app-wide ceiling ([developer.xero.com/documentation/guides/oauth2/limits](https://developer.xero.com/documentation/guides/oauth2/limits)) — adapter must respect `X-Rate-Limit-Problem` response header and back off.

## What it emits
Invoices (`ACCREC`/`ACCPAY` with line items, amounts, due dates, status enum), Payments (applied/reconciled events against invoices), Contacts (customer records with payment terms, outstanding/overdue balances, IsCustomer flag), Credit Notes, and Accounts Receivable aging via the Reports endpoint. Webhooks fire only on `INVOICE` and `CONTACT` events with action `CREATE` or `UPDATE` — payloads contain **only** `resourceId`, `tenantId`, `eventType`, `eventCategory`, and `eventDateUtc`, so the adapter must round-trip back to `GET /Invoices/{InvoiceID}` or `/Contacts/{ContactID}` to fetch the body ([developer.xero.com/documentation/webhooks/overview](https://developer.xero.com/documentation/webhooks/overview)). Payment status transitions (`AUTHORISED → PAID`) do not fire webhooks directly — they surface as an `INVOICE` UPDATE event, which the adapter then resolves.

## Wedge alignment honesty
Xero does not help with the Selected Vendor → budget approval wedge — those deals haven't been invoiced yet. Its signals extend Dugout downstream into retention/expansion, catching at-risk renewals and quiet downgrades before they show up in Salesforce as churn. Treat as a Phase 2 adapter behind Salesforce, HubSpot, Gong.

## Signals we'd extract

### 1. Renewal window approaching — AWARENESS (90d) / ACTION (60d) / BLOCKING (30d)
- **What it is:** Annual `ACCREC` invoice (or active Repeating Invoice schedule) approaching end-of-term based on invoice cadence + contract metadata.
- **Why for the (extended) wedge — retention version:** Auto-renewals lapse silently; AE needs runway to re-engage champion and finance before the renewal date, mirroring the original wedge problem one tier later.
- **Rule shape:** `today + N days >= last_annual_invoice.Date + 365` where N ∈ {90, 60, 30} → tier accordingly. Cross-check against Salesforce Opportunity renewal date if present. For subscriptions use `GET /RepeatingInvoices` and read `Schedule.NextScheduledDate`.
- **Source fields:** `Invoice.Date`, `Invoice.DueDate`, `Invoice.Reference`, `Invoice.Contact.ContactID`, `Invoice.LineItems[].Description`, `RepeatingInvoice.Schedule.NextScheduledDate`, `RepeatingInvoice.Status` (`AUTHORISED`/`DRAFT`).
- **Endpoint:** `GET /api.xro/2.0/Invoices?where=Type=="ACCREC"&&Status=="PAID"&&Contact.ContactID==guid("...")` plus `GET /api.xro/2.0/RepeatingInvoices`.

### 2. Payment health degradation — ACTION → BLOCKING
- **What it is:** Customer has invoices that are past `DueDate` while still in `AUTHORISED` status (Xero does not have a separate `OVERDUE` status — overdue is `AUTHORISED` + `DueDate < today` + `AmountDue > 0`), or `Contact.Balances.AccountsReceivable.Overdue` is non-zero and trending up.
- **Why for the (extended) wedge — retention version:** Late payment is the earliest financial signal of dissatisfaction or budget pressure — expansion conversations stall when AP is fighting AR.
- **Rule shape:** `count(invoices WHERE Status=="AUTHORISED" AND DueDate < today AND AmountDue > 0) >= 1 AND max(days_overdue) > 15` → ACTION; `> 45` days → BLOCKING. Pull `Contact.Balances.AccountsReceivable.Overdue` for total exposure.
- **Source fields:** `Invoice.Status`, `Invoice.DueDate`, `Invoice.AmountDue`, `Invoice.CurrencyCode`, `Invoice.Contact.ContactID`, `Contact.Balances.AccountsReceivable.Outstanding`, `Contact.Balances.AccountsReceivable.Overdue`.
- **Endpoint:** `GET /api.xro/2.0/Invoices?Statuses=AUTHORISED&where=Type=="ACCREC"&&AmountDue>0` with `If-Modified-Since` header for incremental sync ([developer.xero.com/documentation/api/accounting/invoices](https://developer.xero.com/documentation/api/accounting/invoices)).

### 3. Customer downgrade detected — ACTION
- **What it is:** New recurring `ACCREC` invoice issued with `Total` materially lower than prior period for same `Contact.ContactID` (seat reduction, plan downgrade), OR a `Credit Note` (`ACCRECCREDIT`) applied against a recent invoice for the same SKU.
- **Why for the (extended) wedge — retention version:** Quiet downgrades are leading indicators of full churn next cycle; AE has one billing cycle to intervene.
- **Rule shape:** `new_invoice.Total < prior_invoice.Total * 0.85` AND same `Contact.ContactID` AND overlapping `LineItems[].ItemCode` set → ACTION. Currency-normalize both totals against the installed base currency before comparing.
- **Source fields:** `Invoice.Total`, `Invoice.SubTotal`, `Invoice.CurrencyCode`, `Invoice.CurrencyRate`, `Invoice.LineItems[].Quantity`, `Invoice.LineItems[].UnitAmount`, `Invoice.LineItems[].ItemCode`, `Invoice.Reference`, `CreditNote.Type=="ACCRECCREDIT"`, `CreditNote.Total`.
- **Endpoint:** `GET /api.xro/2.0/Invoices` and `GET /api.xro/2.0/CreditNotes`.

### 4. First-invoice-issued (deal-closed confirmation) — AWARENESS
- **What it is:** First `ACCREC` invoice in status `AUTHORISED` or `PAID` issued to a `Contact.ContactID` that maps to a recently closed-won Salesforce Opportunity.
- **Why for the (extended) wedge — retention version:** Confirms the closed-won actually monetized — tightens forecast accuracy and flags closed-won deals that stalled in provisioning (CW with no invoice within 45 days = ops escalation).
- **Rule shape:** `Contact.ContactID NOT IN prior_invoices` AND mapped Salesforce Opp `CloseDate within last 45 days` AND `Invoice.Status IN (AUTHORISED, PAID)` → AWARENESS digest entry. Inverse rule (CW without invoice at day 45) → ACTION.
- **Source fields:** `Invoice.Type=="ACCREC"`, `Invoice.Status`, `Invoice.Date`, `Invoice.Contact.Name`, `Invoice.Contact.ContactID`, `Contact.IsCustomer`, `Contact.ContactStatus=="ACTIVE"`.
- **Webhook trigger:** `eventCategory=INVOICE`, `eventType=CREATE` → fetch invoice → check first-touch heuristic.

## What we'd ignore
- `ACCPAY` invoices and `ACCPAYPAYMENT` payments (the workspace's own bills to vendors)
- `Payroll`, `Expenses`, `BankTransactions`, `ManualJournals`, `Assets`, `Files`, `Projects` APIs
- `Reports` endpoint beyond AR aging (P&L, Balance Sheet, Trial Balance are out of scope)
- Chart-of-accounts changes, `TaxRates`, `TrackingCategories` updates
- Invoices in status `DRAFT`, `SUBMITTED`, `DELETED`, `VOIDED` ([developer.xero.com/documentation/api/accounting/types#invoice-status-codes](https://developer.xero.com/documentation/api/accounting/types#invoice-status-codes))
- Contacts where `ContactStatus IN (ARCHIVED, GDPRREQUEST)` or `IsCustomer == false`
- `BrandingThemes`, `Currencies`, `Organisation` metadata changes

## Effort to wire
- **Adapter LOC estimate:** ~450 LOC. OAuth refresh + rotating-refresh-token persistence ~80 LOC, webhook intent-to-receive HMAC-SHA256 signature verification against `x-xero-signature` header ~50 LOC, tenant-connections sync via `GET https://api.xero.com/connections` ~40 LOC, the rest is invoice/contact/payment fetch + signal evaluation.
- **Time estimate:** 2–3 days for working adapter behind a feature flag, +1 day for Salesforce Contact↔Account mapping table and currency normalization.
- **Hardest part:** Mapping Xero `Contact.ContactID` to Salesforce `Account.Id`. Xero contacts are billing entities (often "Acme Corp - AP" or a parent-company shell) and are not always 1:1 with sales accounts. Strategy: prefer `Contact.AccountNumber` as a deterministic key if the customer populates it from SFDC at invoice creation, fall back to fuzzy match on `Contact.Name` + EmailAddress, expose a manual override table. Multi-currency contracts require normalizing `Invoice.Total` via `Invoice.CurrencyRate` to a base reporting currency before any cross-period comparison.

## Install-time discovery
1. **Xero Contact ↔ SFDC Account mapping setup** — does the customer already write Salesforce `Account.Id` (or a shared CRM ID) into Xero `Contact.AccountNumber` at invoice-creation time? If yes, mapping is a direct join; if no, we need a fuzzy-match + override table and an onboarding pass over the existing customer book.
2. **Currency normalization base** — what reporting currency does the customer standardize on for cross-period comparisons (USD? AUD given Xero's NZ/AU heritage?), and is the FX rate sourced from `Invoice.CurrencyRate` at invoice date or a centralized FX feed? Locks down how signal #3 thresholds are evaluated for multi-currency customers.
3. **Renewal-tracking field convention** — is contract term tracked on `Invoice.Reference`, `Invoice.LineItems[].Description`, a Tracking Category, or only in Salesforce CPQ? Determines whether signal #1 reads from Xero directly or needs SFDC as the authoritative renewal-date source with Xero only confirming the invoice cadence.
