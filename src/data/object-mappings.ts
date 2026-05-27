// Raw field → canonical object.field mappings. This is the "zipper" - the
// actual join logic that turns ~900 raw API fields into the canonical
// objects in canonical-objects.ts.
//
// Mapping format is tuple-compact for density:
//   [source, raw_object, raw_field, canonical_object, canonical_field]
//
// Not every raw field is mapped. Pure foreign-key/system IDs that have no
// semantic equivalent in the canonical model are intentionally left as
// "orphan" raw fields - they show up in the connectivity graph as
// unmapped nodes, which is useful information (e.g., Gong.Scorecard
// fields are orphans because Dugout doesn't have a canonical Scorecard
// object yet).
//
// When a canonical field receives multiple raw contributors, it's a
// "join point". Look at the joinNote in canonical-objects.ts for the
// reconciliation rule.

import { RAW_FIELDS_CATALOG } from "./raw-fields";
import { CANONICAL_OBJECTS } from "./canonical-objects";

export type MappingTuple = readonly [
  source: string,
  rawObject: string,
  rawField: string,
  canonicalObject: string,
  canonicalField: string,
];

export const FIELD_MAPPINGS: readonly MappingTuple[] = [
  // ── Salesforce.Opportunity → Deal ─────────────────────────────────
  ["Salesforce", "Opportunity", "name", "Deal", "name"],
  ["Salesforce", "Opportunity", "amount", "Deal", "amount"],
  ["Salesforce", "Opportunity", "expected_revenue", "Deal", "expected_revenue"],
  ["Salesforce", "Opportunity", "probability", "Deal", "probability"],
  ["Salesforce", "Opportunity", "stage_name", "Deal", "stage"],
  ["Salesforce", "Opportunity", "forecast_category_name", "Deal", "forecast_category"],
  ["Salesforce", "Opportunity", "close_date", "Deal", "close_date"],
  ["Salesforce", "Opportunity", "type", "Deal", "type"],
  ["Salesforce", "Opportunity", "lead_source", "Deal", "lead_source"],
  ["Salesforce", "Opportunity", "is_closed", "Deal", "is_closed"],
  ["Salesforce", "Opportunity", "is_won", "Deal", "is_won"],
  ["Salesforce", "Opportunity", "account_id", "Deal", "account_id"],
  ["Salesforce", "Opportunity", "owner_id", "Deal", "owner_user_id"],
  ["Salesforce", "Opportunity", "last_stage_change_date", "Deal", "last_stage_change_date"],
  ["Salesforce", "Opportunity", "last_activity_date", "Deal", "last_activity_date"],
  ["Salesforce", "Opportunity", "days_in_stage", "Deal", "days_in_stage"],
  ["Salesforce", "Opportunity", "push_count", "Deal", "push_count"],
  ["Salesforce", "Opportunity", "iq_score", "Deal", "iq_score"],

  // ── Salesforce.Account → Account ──────────────────────────────────
  ["Salesforce", "Account", "name", "Account", "name"],
  ["Salesforce", "Account", "website", "Account", "website"],
  ["Salesforce", "Account", "industry", "Account", "industry"],
  ["Salesforce", "Account", "naics_code", "Account", "naics_code"],
  ["Salesforce", "Account", "sic", "Account", "sic_code"],
  ["Salesforce", "Account", "annual_revenue", "Account", "annual_revenue"],
  ["Salesforce", "Account", "number_of_employees", "Account", "employee_count"],
  ["Salesforce", "Account", "year_started", "Account", "founded_year"],
  ["Salesforce", "Account", "billing_city", "Account", "hq_city"],
  ["Salesforce", "Account", "billing_state", "Account", "hq_state"],
  ["Salesforce", "Account", "billing_country", "Account", "hq_country"],
  ["Salesforce", "Account", "ticker_symbol", "Account", "ticker_symbol"],
  ["Salesforce", "Account", "type", "Account", "account_type"],
  ["Salesforce", "Account", "is_partner", "Account", "is_partner"],
  ["Salesforce", "Account", "parent_id", "Account", "parent_account_id"],
  ["Salesforce", "Account", "owner_id", "Account", "owner_user_id"],
  ["Salesforce", "Account", "last_activity_date", "Account", "last_activity_date"],

  // ── Salesforce.Contact → Contact ──────────────────────────────────
  ["Salesforce", "Contact", "first_name", "Contact", "first_name"],
  ["Salesforce", "Contact", "last_name", "Contact", "last_name"],
  ["Salesforce", "Contact", "name", "Contact", "full_name"],
  ["Salesforce", "Contact", "email", "Contact", "email"],
  ["Salesforce", "Contact", "phone", "Contact", "phone"],
  ["Salesforce", "Contact", "mobile_phone", "Contact", "mobile_phone"],
  ["Salesforce", "Contact", "title", "Contact", "title"],
  ["Salesforce", "Contact", "department", "Contact", "department"],
  ["Salesforce", "Contact", "account_id", "Contact", "account_id"],
  ["Salesforce", "Contact", "reports_to_id", "Contact", "reports_to_id"],
  ["Salesforce", "Contact", "has_opted_out_of_email", "Contact", "opted_out"],
  ["Salesforce", "Contact", "do_not_call", "Contact", "do_not_call"],
  ["Salesforce", "Contact", "owner_id", "Contact", "owner_user_id"],

  // ── Salesforce.Lead → Contact (lead is_lead=true) ─────────────────
  ["Salesforce", "Lead", "first_name", "Contact", "first_name"],
  ["Salesforce", "Lead", "last_name", "Contact", "last_name"],
  ["Salesforce", "Lead", "name", "Contact", "full_name"],
  ["Salesforce", "Lead", "email", "Contact", "email"],
  ["Salesforce", "Lead", "phone", "Contact", "phone"],
  ["Salesforce", "Lead", "mobile_phone", "Contact", "mobile_phone"],
  ["Salesforce", "Lead", "title", "Contact", "title"],
  ["Salesforce", "Lead", "company", "Account", "name"],
  ["Salesforce", "Lead", "website", "Account", "website"],
  ["Salesforce", "Lead", "industry", "Account", "industry"],
  ["Salesforce", "Lead", "annual_revenue", "Account", "annual_revenue"],
  ["Salesforce", "Lead", "number_of_employees", "Account", "employee_count"],
  ["Salesforce", "Lead", "has_opted_out_of_email", "Contact", "opted_out"],
  ["Salesforce", "Lead", "do_not_call", "Contact", "do_not_call"],
  ["Salesforce", "Lead", "owner_id", "Contact", "owner_user_id"],

  // ── Salesforce.OpportunityHistory → Deal (snapshots; merged at canonical level) ──
  ["Salesforce", "OpportunityHistory", "stage_name", "Deal", "stage"],
  ["Salesforce", "OpportunityHistory", "amount", "Deal", "amount"],
  ["Salesforce", "OpportunityHistory", "close_date", "Deal", "close_date"],
  ["Salesforce", "OpportunityHistory", "probability", "Deal", "probability"],
  ["Salesforce", "OpportunityHistory", "forecast_category", "Deal", "forecast_category"],

  // ── Salesforce.Task → Activity / Email / Call ─────────────────────
  ["Salesforce", "Task", "subject", "Activity", "subject"],
  ["Salesforce", "Task", "description", "Activity", "description"],
  ["Salesforce", "Task", "activity_date", "Activity", "activity_date"],
  ["Salesforce", "Task", "status", "Activity", "status"],
  ["Salesforce", "Task", "type", "Activity", "type"],
  ["Salesforce", "Task", "owner_id", "Activity", "owner_user_id"],
  ["Salesforce", "Task", "what_id", "Activity", "linked_deal_id"],
  ["Salesforce", "Task", "account_id", "Activity", "linked_account_id"],
  ["Salesforce", "Task", "completed_date_time", "Activity", "completed_date"],
  // Task type=Call branches into Call
  ["Salesforce", "Task", "call_type", "Call", "direction"],
  ["Salesforce", "Task", "call_duration_in_seconds", "Call", "duration_seconds"],
  ["Salesforce", "Task", "call_disposition", "Call", "outcome"],

  // ── Salesforce.Event → Meeting ────────────────────────────────────
  ["Salesforce", "Event", "subject", "Meeting", "title"],
  ["Salesforce", "Event", "start_date_time", "Meeting", "scheduled_start_at"],
  ["Salesforce", "Event", "end_date_time", "Meeting", "end_at"],
  ["Salesforce", "Event", "duration_in_minutes", "Meeting", "duration_seconds"],
  ["Salesforce", "Event", "description", "Meeting", "summary"],
  ["Salesforce", "Event", "owner_id", "Meeting", "organizer_user_id"],
  ["Salesforce", "Event", "what_id", "Meeting", "linked_deal_id"],
  ["Salesforce", "Event", "account_id", "Meeting", "linked_account_id"],

  // ── Salesforce.User → User ────────────────────────────────────────
  ["Salesforce", "User", "name", "User", "full_name"],
  ["Salesforce", "User", "first_name", "User", "first_name"],
  ["Salesforce", "User", "last_name", "User", "last_name"],
  ["Salesforce", "User", "email", "User", "email"],
  ["Salesforce", "User", "title", "User", "title"],
  ["Salesforce", "User", "manager_id", "User", "manager_user_id"],
  ["Salesforce", "User", "time_zone_sid_key", "User", "time_zone"],
  ["Salesforce", "User", "is_active", "User", "is_active"],
  ["Salesforce", "User", "last_login_date", "User", "last_login_date"],
  ["Salesforce", "User", "forecast_enabled", "User", "forecast_enabled"],
  ["Salesforce", "User", "employee_number", "User", "employee_number"],

  // ── Gong.Call → Meeting (PRIMARY JOIN with SF Event) ──────────────
  ["Gong", "Call", "call_id", "Meeting", "id"],
  ["Gong", "Call", "title", "Meeting", "title"],
  ["Gong", "Call", "scheduled_start_at", "Meeting", "scheduled_start_at"],
  ["Gong", "Call", "effective_start_at", "Meeting", "effective_start_at"],
  ["Gong", "Call", "planned_end_at", "Meeting", "end_at"],
  ["Gong", "Call", "duration_seconds", "Meeting", "duration_seconds"],
  ["Gong", "Call", "scope", "Meeting", "is_internal"],
  ["Gong", "Call", "media_type", "Meeting", "media_type"],
  ["Gong", "Call", "primary_user_id", "Meeting", "organizer_user_id"],
  ["Gong", "Call", "call_url", "Meeting", "recording_url"],
  ["Gong", "Call", "call_spotlight_brief", "Meeting", "summary"],
  ["Gong", "Call", "call_spotlight_key_points", "Meeting", "key_points"],
  ["Gong", "Call", "call_spotlight_next_steps", "Meeting", "next_steps"],
  ["Gong", "Call", "call_spotlight_automatic_disposition", "Meeting", "outcome"],
  ["Gong", "Call", "disposition", "Meeting", "outcome"],
  ["Gong", "Call", "question_company_count", "Meeting", "question_count_company"],
  ["Gong", "Call", "question_non_company_count", "Meeting", "question_count_customer"],
  ["Gong", "Call", "status", "Meeting", "is_recorded"],

  // ── Gong.CallParticipant → Meeting.attendees ──────────────────────
  ["Gong", "CallParticipant", "name", "Contact", "full_name"],
  ["Gong", "CallParticipant", "email_address", "Contact", "email"],
  ["Gong", "CallParticipant", "title", "Contact", "title"],
  ["Gong", "CallParticipant", "phone_number", "Contact", "phone"],
  ["Gong", "CallParticipant", "user_id", "Meeting", "attendee_user_ids"],

  // ── Gong.Topic / Tracker → Meeting ───────────────────────────────
  ["Gong", "Topic", "name", "Meeting", "topics"],
  ["Gong", "Tracker", "name", "Meeting", "trackers_fired"],
  ["Gong", "ConversationTracker", "count", "Meeting", "trackers_fired"],

  // ── Gong.InteractionStat → Meeting ───────────────────────────────
  ["Gong", "InteractionStat", "talk_ratio", "Meeting", "talk_ratio_company"],

  // ── Gong.Meeting → Meeting (alternative source) ──────────────────
  ["Gong", "Meeting", "title", "Meeting", "title"],
  ["Gong", "Meeting", "start_datetime", "Meeting", "scheduled_start_at"],
  ["Gong", "Meeting", "end_datetime", "Meeting", "end_at"],
  ["Gong", "Meeting", "organizer_user_id", "Meeting", "organizer_user_id"],
  ["Gong", "Meeting", "is_internal", "Meeting", "is_internal"],

  // ── Gong.User → User ──────────────────────────────────────────────
  ["Gong", "User", "user_id", "User", "id"],
  ["Gong", "User", "email_address", "User", "email"],
  ["Gong", "User", "first_name", "User", "first_name"],
  ["Gong", "User", "last_name", "User", "last_name"],
  ["Gong", "User", "title", "User", "title"],
  ["Gong", "User", "active", "User", "is_active"],
  ["Gong", "User", "manager_id", "User", "manager_user_id"],
  ["Gong", "User", "time_zone", "User", "time_zone"],

  // ── Outreach.Prospect → Contact ───────────────────────────────────
  ["Outreach", "Prospect", "id", "Contact", "id"],
  ["Outreach", "Prospect", "first_name", "Contact", "first_name"],
  ["Outreach", "Prospect", "last_name", "Contact", "last_name"],
  ["Outreach", "Prospect", "title", "Contact", "title"],
  ["Outreach", "Prospect", "emails", "Contact", "email"],
  ["Outreach", "Prospect", "work_phone", "Contact", "phone"],
  ["Outreach", "Prospect", "mobile_phone", "Contact", "mobile_phone"],
  ["Outreach", "Prospect", "linkedin_url", "Contact", "linkedin_url"],
  ["Outreach", "Prospect", "engaged_at", "Contact", "last_engaged_at"],
  ["Outreach", "Prospect", "engaged_score", "Contact", "engagement_score"],
  ["Outreach", "Prospect", "touched_at", "Contact", "last_contacted_at"],
  ["Outreach", "Prospect", "opted_out", "Contact", "opted_out"],
  ["Outreach", "Prospect", "account_id", "Contact", "account_id"],
  ["Outreach", "Prospect", "owner_id", "Contact", "owner_user_id"],

  // ── Outreach.Account → Account ────────────────────────────────────
  ["Outreach", "Account", "name", "Account", "name"],
  ["Outreach", "Account", "domain", "Account", "domain"],
  ["Outreach", "Account", "website", "Account", "website"],
  ["Outreach", "Account", "industry", "Account", "industry"],
  ["Outreach", "Account", "linked_in_employees", "Account", "employee_count"],
  ["Outreach", "Account", "linked_in", "Account", "linkedin_url"],
  ["Outreach", "Account", "touched_at", "Account", "last_activity_date"],
  ["Outreach", "Account", "owner_id", "Account", "owner_user_id"],

  // ── Outreach.Mailing → Email ──────────────────────────────────────
  ["Outreach", "Mailing", "id", "Email", "id"],
  ["Outreach", "Mailing", "message_id", "Email", "message_id"],
  ["Outreach", "Mailing", "subject", "Email", "subject"],
  ["Outreach", "Mailing", "body_text", "Email", "body_text"],
  ["Outreach", "Mailing", "body_html", "Email", "body_html"],
  ["Outreach", "Mailing", "state", "Email", "state"],
  ["Outreach", "Mailing", "scheduled_at", "Email", "scheduled_at"],
  ["Outreach", "Mailing", "delivered_at", "Email", "delivered_at"],
  ["Outreach", "Mailing", "opened_at", "Email", "opened_at"],
  ["Outreach", "Mailing", "open_count", "Email", "open_count"],
  ["Outreach", "Mailing", "clicked_at", "Email", "clicked_at"],
  ["Outreach", "Mailing", "click_count", "Email", "click_count"],
  ["Outreach", "Mailing", "replied_at", "Email", "replied_at"],
  ["Outreach", "Mailing", "bounced_at", "Email", "bounced_at"],
  ["Outreach", "Mailing", "unsubscribed_at", "Email", "unsubscribed_at"],
  ["Outreach", "Mailing", "prospect_id", "Email", "to_contact_id"],
  ["Outreach", "Mailing", "sequence_id", "Email", "sequence_id"],
  ["Outreach", "Mailing", "opportunity_id", "Email", "linked_deal_id"],

  // ── Outreach.Sequence → Sequence ──────────────────────────────────
  ["Outreach", "Sequence", "id", "Sequence", "id"],
  ["Outreach", "Sequence", "name", "Sequence", "name"],
  ["Outreach", "Sequence", "description", "Sequence", "description"],
  ["Outreach", "Sequence", "click_count", "Sequence", "click_count"],
  ["Outreach", "Sequence", "open_count", "Sequence", "open_count"],
  ["Outreach", "Sequence", "reply_count", "Sequence", "reply_count"],
  ["Outreach", "Sequence", "bounce_count", "Sequence", "bounce_count"],
  ["Outreach", "Sequence", "deliver_count", "Sequence", "delivered_count"],
  ["Outreach", "Sequence", "opt_out_count", "Sequence", "opt_out_count"],
  ["Outreach", "Sequence", "last_used_at", "Sequence", "last_used_at"],
  ["Outreach", "Sequence", "archived_at", "Sequence", "is_archived"],
  ["Outreach", "Sequence", "owner_id", "Sequence", "owner_user_id"],

  // ── Outreach.Call → Call ──────────────────────────────────────────
  ["Outreach", "Call", "id", "Call", "id"],
  ["Outreach", "Call", "direction", "Call", "direction"],
  ["Outreach", "Call", "state", "Call", "state"],
  ["Outreach", "Call", "dialed_at", "Call", "dialed_at"],
  ["Outreach", "Call", "answered_at", "Call", "answered_at"],
  ["Outreach", "Call", "completed_at", "Call", "completed_at"],
  ["Outreach", "Call", "from_number", "Call", "from_number"],
  ["Outreach", "Call", "to_number", "Call", "to_number"],
  ["Outreach", "Call", "recording_url", "Call", "recording_url"],
  ["Outreach", "Call", "note", "Call", "notes"],
  ["Outreach", "Call", "outcome", "Call", "outcome"],
  ["Outreach", "Call", "user_id", "Call", "user_id"],
  ["Outreach", "Call", "prospect_id", "Call", "contact_id"],
  ["Outreach", "Call", "opportunity_id", "Call", "linked_deal_id"],
  ["Outreach", "Call", "sequence_id", "Call", "sequence_id"],

  // ── Outreach.Task → Activity (catch-all) ──────────────────────────
  ["Outreach", "Task", "id", "Activity", "id"],
  ["Outreach", "Task", "action", "Activity", "type"],
  ["Outreach", "Task", "state", "Activity", "status"],
  ["Outreach", "Task", "due_at", "Activity", "activity_date"],
  ["Outreach", "Task", "note", "Activity", "description"],
  ["Outreach", "Task", "prospect_id", "Activity", "linked_contact_id"],
  ["Outreach", "Task", "account_id", "Activity", "linked_account_id"],
  ["Outreach", "Task", "opportunity_id", "Activity", "linked_deal_id"],
  ["Outreach", "Task", "owner_id", "Activity", "owner_user_id"],

  // ── Outreach.User → User ──────────────────────────────────────────
  ["Outreach", "User", "id", "User", "id"],
  ["Outreach", "User", "email", "User", "email"],
  ["Outreach", "User", "first_name", "User", "first_name"],
  ["Outreach", "User", "last_name", "User", "last_name"],
  ["Outreach", "User", "title", "User", "title"],
  ["Outreach", "User", "locked", "User", "is_active"],

  // ── Apollo.Person → Contact ───────────────────────────────────────
  ["Apollo", "Person", "first_name", "Contact", "first_name"],
  ["Apollo", "Person", "last_name", "Contact", "last_name"],
  ["Apollo", "Person", "name", "Contact", "full_name"],
  ["Apollo", "Person", "title", "Contact", "title"],
  ["Apollo", "Person", "email", "Contact", "email"],
  ["Apollo", "Person", "email_status", "Contact", "email_status"],
  ["Apollo", "Person", "photo_url", "Contact", "photo_url"],
  ["Apollo", "Person", "linkedin_url", "Contact", "linkedin_url"],
  ["Apollo", "Person", "twitter_url", "Contact", "twitter_url"],
  ["Apollo", "Person", "sanitized_phone", "Contact", "phone"],
  ["Apollo", "Person", "organization_id", "Contact", "account_id"],
  ["Apollo", "Person", "seniority", "Contact", "seniority"],
  ["Apollo", "Person", "departments", "Contact", "department"],
  ["Apollo", "Person", "intent_strength", "Contact", "intent_strength"],

  // ── Apollo.Organization → Account ─────────────────────────────────
  ["Apollo", "Organization", "name", "Account", "name"],
  ["Apollo", "Organization", "website_url", "Account", "website"],
  ["Apollo", "Organization", "primary_domain", "Account", "domain"],
  ["Apollo", "Organization", "industry", "Account", "industry"],
  ["Apollo", "Organization", "founded_year", "Account", "founded_year"],
  ["Apollo", "Organization", "publicly_traded_symbol", "Account", "ticker_symbol"],
  ["Apollo", "Organization", "publicly_traded_exchange", "Account", "exchange"],
  ["Apollo", "Organization", "estimated_num_employees", "Account", "employee_count"],
  ["Apollo", "Organization", "annual_revenue", "Account", "annual_revenue"],
  ["Apollo", "Organization", "total_funding", "Account", "total_funding"],
  ["Apollo", "Organization", "latest_funding_stage", "Account", "latest_funding_stage"],
  ["Apollo", "Organization", "city", "Account", "hq_city"],
  ["Apollo", "Organization", "state", "Account", "hq_state"],
  ["Apollo", "Organization", "country", "Account", "hq_country"],
  ["Apollo", "Organization", "linkedin_url", "Account", "linkedin_url"],
  ["Apollo", "Organization", "twitter_url", "Account", "twitter_url"],
  ["Apollo", "Organization", "logo_url", "Account", "logo_url"],
  ["Apollo", "Organization", "technology_names", "Account", "technology_stack"],
  ["Apollo", "Organization", "owned_by_organization_id", "Account", "parent_account_id"],

  // ── Apollo.Account → Account (CRM-like) ───────────────────────────
  ["Apollo", "Account", "name", "Account", "name"],
  ["Apollo", "Account", "website_url", "Account", "website"],
  ["Apollo", "Account", "linkedin_url", "Account", "linkedin_url"],
  ["Apollo", "Account", "city", "Account", "hq_city"],
  ["Apollo", "Account", "country", "Account", "hq_country"],
  ["Apollo", "Account", "owner_id", "Account", "owner_user_id"],
  ["Apollo", "Account", "intent_strength", "Account", "intent_strength"],
  ["Apollo", "Account", "last_activity_date", "Account", "last_activity_date"],

  // ── Apollo.EmailerCampaign → Sequence (alternative source) ────────
  ["Apollo", "EmailerCampaign", "id", "Sequence", "id"],
  ["Apollo", "EmailerCampaign", "name", "Sequence", "name"],
  ["Apollo", "EmailerCampaign", "active", "Sequence", "is_active"],
  ["Apollo", "EmailerCampaign", "archived", "Sequence", "is_archived"],
  ["Apollo", "EmailerCampaign", "num_steps", "Sequence", "num_steps"],
  ["Apollo", "EmailerCampaign", "num_contacts", "Sequence", "num_contacts"],
  ["Apollo", "EmailerCampaign", "opened", "Sequence", "open_count"],
  ["Apollo", "EmailerCampaign", "unique_clicked", "Sequence", "click_count"],
  ["Apollo", "EmailerCampaign", "replied", "Sequence", "reply_count"],
  ["Apollo", "EmailerCampaign", "bounced", "Sequence", "bounce_count"],
  ["Apollo", "EmailerCampaign", "opt_out", "Sequence", "opt_out_count"],
  ["Apollo", "EmailerCampaign", "demoed", "Sequence", "demoed_count"],

  // ── SEC EDGAR.Filing → Filing + Account (firmographics enrichment) ──
  ["SEC EDGAR", "Filing", "accession_number", "Filing", "accession_number"],
  ["SEC EDGAR", "Filing", "cik", "Filing", "cik"],
  ["SEC EDGAR", "Filing", "name", "Filing", "registrant_name"],
  ["SEC EDGAR", "Filing", "form", "Filing", "form"],
  ["SEC EDGAR", "Filing", "filing_date", "Filing", "filing_date"],
  ["SEC EDGAR", "Filing", "report_date", "Filing", "report_date"],
  ["SEC EDGAR", "Filing", "items", "Filing", "items"],
  ["SEC EDGAR", "Filing", "primary_document", "Filing", "primary_document_url"],
  ["SEC EDGAR", "Filing", "is_xbrl", "Filing", "is_xbrl"],
  ["SEC EDGAR", "Filing", "size", "Filing", "size_bytes"],
  // EDGAR Filing also feeds Account firmographics
  ["SEC EDGAR", "Filing", "name", "Account", "name"],
  ["SEC EDGAR", "Filing", "tickers", "Account", "ticker_symbol"],
  ["SEC EDGAR", "Filing", "exchanges", "Account", "exchange"],
  ["SEC EDGAR", "Filing", "cik", "Account", "cik"],
  ["SEC EDGAR", "Filing", "sic", "Account", "sic_code"],
  ["SEC EDGAR", "Filing", "sic_description", "Account", "industry"],
  ["SEC EDGAR", "Filing", "description", "Account", "name"],
  ["SEC EDGAR", "Filing", "website", "Account", "website"],

  // ── EDGAR 10-K/Q Cover → Account ──────────────────────────────────
  ["SEC EDGAR", "10-K/Q Cover", "registrant_name", "Account", "name"],
  ["SEC EDGAR", "10-K/Q Cover", "trading_symbol", "Account", "ticker_symbol"],
  ["SEC EDGAR", "10-K/Q Cover", "name_of_each_exchange", "Account", "exchange"],
  ["SEC EDGAR", "10-K/Q Cover", "city", "Account", "hq_city"],
  ["SEC EDGAR", "10-K/Q Cover", "state", "Account", "hq_state"],
  ["SEC EDGAR", "10-K/Q Cover", "employees_count", "Account", "employee_count"],

  // ── EDGAR 8-K Items → Filing.item_details (consolidation) ─────────
  // Each Item's fields feed the merged item_details text field on Filing.
  ["SEC EDGAR", "8-K Item 1.01", "agreement_description", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 1.01", "counterparty_name", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.01", "transaction_type", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.01", "counterparty_name", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.01", "consideration_amount", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.02", "revenue", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.02", "net_income", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.02", "earnings_per_share", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.05", "exit_activity_description", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 2.05", "estimated_total_cost", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 5.02", "event_type", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 5.02", "person_name", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 5.02", "position", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 7.01", "disclosure_summary", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 8.01", "event_description", "Filing", "item_details"],
  ["SEC EDGAR", "8-K Item 9.01", "exhibits_list", "Filing", "exhibits"],
  ["SEC EDGAR", "8-K Item 9.01", "exhibit_number", "Filing", "exhibits"],

  // ── NewsAPI.Article → NewsArticle ─────────────────────────────────
  ["NewsAPI", "Article", "url", "NewsArticle", "url"],
  ["NewsAPI", "Article", "title", "NewsArticle", "title"],
  ["NewsAPI", "Article", "description", "NewsArticle", "description"],
  ["NewsAPI", "Article", "content", "NewsArticle", "content"],
  ["NewsAPI", "Article", "author", "NewsArticle", "author"],
  ["NewsAPI", "Article", "source_name", "NewsArticle", "source_name"],
  ["NewsAPI", "Article", "published_at", "NewsArticle", "published_at"],
  ["NewsAPI", "Article", "url_to_image", "NewsArticle", "url_to_image"],

  // ── HubSpot.Contact → Contact (marketing-side identity) ───────────
  ["HubSpot", "Contact", "email", "Contact", "email"],
  ["HubSpot", "Contact", "firstname", "Contact", "first_name"],
  ["HubSpot", "Contact", "lastname", "Contact", "last_name"],
  ["HubSpot", "Contact", "jobtitle", "Contact", "title"],
  ["HubSpot", "Contact", "phone", "Contact", "phone"],
  ["HubSpot", "Contact", "mobilephone", "Contact", "mobile_phone"],
  ["HubSpot", "Contact", "hs_email_optout", "Contact", "opted_out"],
  ["HubSpot", "Contact", "notes_last_contacted", "Contact", "last_contacted_at"],
  ["HubSpot", "Contact", "hs_owner_id", "Contact", "owner_user_id"],
  ["HubSpot", "Contact", "associatedcompanyid", "Contact", "account_id"],

  // ── HubSpot.Company → Account ─────────────────────────────────────
  ["HubSpot", "Company", "name", "Account", "name"],
  ["HubSpot", "Company", "domain", "Account", "domain"],
  ["HubSpot", "Company", "website", "Account", "website"],
  ["HubSpot", "Company", "industry", "Account", "industry"],
  ["HubSpot", "Company", "numberofemployees", "Account", "employee_count"],
  ["HubSpot", "Company", "annualrevenue", "Account", "annual_revenue"],
  ["HubSpot", "Company", "country", "Account", "hq_country"],
  ["HubSpot", "Company", "city", "Account", "hq_city"],
  ["HubSpot", "Company", "state", "Account", "hq_state"],
  ["HubSpot", "Company", "founded_year", "Account", "founded_year"],
  ["HubSpot", "Company", "linkedin_company_page", "Account", "linkedin_url"],
  ["HubSpot", "Company", "hubspot_owner_id", "Account", "owner_user_id"],

  // ── HubSpot.Deal → Deal (parallel to Salesforce.Opportunity) ──────
  ["HubSpot", "Deal", "dealname", "Deal", "name"],
  ["HubSpot", "Deal", "amount", "Deal", "amount"],
  ["HubSpot", "Deal", "dealstage", "Deal", "stage"],
  ["HubSpot", "Deal", "closedate", "Deal", "close_date"],
  ["HubSpot", "Deal", "hs_deal_stage_probability", "Deal", "probability"],
  ["HubSpot", "Deal", "hs_forecast_amount", "Deal", "expected_revenue"],
  ["HubSpot", "Deal", "hs_forecast_category", "Deal", "forecast_category"],
  ["HubSpot", "Deal", "dealtype", "Deal", "type"],
  ["HubSpot", "Deal", "hubspot_owner_id", "Deal", "owner_user_id"],
  ["HubSpot", "Deal", "hs_is_closed_won", "Deal", "is_won"],
  ["HubSpot", "Deal", "hs_is_closed", "Deal", "is_closed"],
  ["HubSpot", "Deal", "hs_days_in_current_stage", "Deal", "days_in_stage"],

  // ── HubSpot.Engagement → Activity / Email / Call / Meeting ────────
  ["HubSpot", "Engagement", "id", "Activity", "id"],
  ["HubSpot", "Engagement", "type", "Activity", "type"],
  ["HubSpot", "Engagement", "subject", "Activity", "subject"],
  ["HubSpot", "Engagement", "body", "Activity", "description"],
  ["HubSpot", "Engagement", "timestamp", "Activity", "activity_date"],
  ["HubSpot", "Engagement", "ownerId", "Activity", "owner_user_id"],
  ["HubSpot", "Engagement", "duration_milliseconds", "Call", "duration_seconds"],
  ["HubSpot", "Engagement", "meeting_title", "Meeting", "title"],
  ["HubSpot", "Engagement", "meeting_start_time", "Meeting", "scheduled_start_at"],
  ["HubSpot", "Engagement", "meeting_end_time", "Meeting", "end_at"],

  // ── ZoomInfo.Contact → Contact (enrichment) ───────────────────────
  ["ZoomInfo", "Contact", "first_name", "Contact", "first_name"],
  ["ZoomInfo", "Contact", "last_name", "Contact", "last_name"],
  ["ZoomInfo", "Contact", "full_name", "Contact", "full_name"],
  ["ZoomInfo", "Contact", "job_title", "Contact", "title"],
  ["ZoomInfo", "Contact", "email", "Contact", "email"],
  ["ZoomInfo", "Contact", "email_status", "Contact", "email_status"],
  ["ZoomInfo", "Contact", "direct_phone", "Contact", "phone"],
  ["ZoomInfo", "Contact", "mobile_phone", "Contact", "mobile_phone"],
  ["ZoomInfo", "Contact", "linkedin_url", "Contact", "linkedin_url"],
  ["ZoomInfo", "Contact", "department", "Contact", "department"],
  ["ZoomInfo", "Contact", "management_level", "Contact", "seniority"],
  ["ZoomInfo", "Contact", "company_id", "Contact", "account_id"],

  // ── ZoomInfo.Company → Account (enrichment) ───────────────────────
  ["ZoomInfo", "Company", "name", "Account", "name"],
  ["ZoomInfo", "Company", "website", "Account", "website"],
  ["ZoomInfo", "Company", "primary_industry", "Account", "industry"],
  ["ZoomInfo", "Company", "sic_code", "Account", "sic_code"],
  ["ZoomInfo", "Company", "naics_code", "Account", "naics_code"],
  ["ZoomInfo", "Company", "employee_count", "Account", "employee_count"],
  ["ZoomInfo", "Company", "revenue", "Account", "annual_revenue"],
  ["ZoomInfo", "Company", "founded_year", "Account", "founded_year"],
  ["ZoomInfo", "Company", "ticker", "Account", "ticker_symbol"],
  ["ZoomInfo", "Company", "linkedin_url", "Account", "linkedin_url"],
  ["ZoomInfo", "Company", "country", "Account", "hq_country"],
  ["ZoomInfo", "Company", "state", "Account", "hq_state"],
  ["ZoomInfo", "Company", "city", "Account", "hq_city"],
  ["ZoomInfo", "Company", "technologies", "Account", "technology_stack"],

  // ── ZoomInfo.Intent → Account.intent_strength ─────────────────────
  ["ZoomInfo", "Intent", "score", "Account", "intent_strength"],

  // ── Chili Piper.Booking → Meeting ─────────────────────────────────
  ["Chili Piper", "Booking", "id", "Meeting", "id"],
  ["Chili Piper", "Booking", "meeting_type", "Meeting", "title"],
  ["Chili Piper", "Booking", "start_at", "Meeting", "scheduled_start_at"],
  ["Chili Piper", "Booking", "end_at", "Meeting", "end_at"],
  ["Chili Piper", "Booking", "duration_minutes", "Meeting", "duration_seconds"],
  ["Chili Piper", "Booking", "assigned_user_id", "Meeting", "organizer_user_id"],
  ["Chili Piper", "Booking", "location", "Meeting", "recording_url"],
  ["Chili Piper", "Booking", "salesforce_opportunity_id", "Meeting", "linked_deal_id"],
  ["Chili Piper", "Booking", "salesforce_account_id", "Meeting", "linked_account_id"],
  ["Chili Piper", "Booking", "guest_email", "Contact", "email"],
  ["Chili Piper", "Booking", "guest_first_name", "Contact", "first_name"],
  ["Chili Piper", "Booking", "guest_last_name", "Contact", "last_name"],
  ["Chili Piper", "Booking", "guest_phone", "Contact", "phone"],
  ["Chili Piper", "Booking", "guest_company", "Account", "name"],

  // ── Dock.Workspace / Asset / Visit → Activity ─────────────────────
  ["Dock", "Workspace", "id", "Activity", "id"],
  ["Dock", "Workspace", "name", "Activity", "subject"],
  ["Dock", "Workspace", "published_at", "Activity", "activity_date"],
  ["Dock", "Workspace", "owner_user_id", "Activity", "owner_user_id"],
  ["Dock", "Workspace", "salesforce_opportunity_id", "Activity", "linked_deal_id"],
  ["Dock", "Workspace", "salesforce_account_id", "Activity", "linked_account_id"],
  ["Dock", "Asset", "title", "Activity", "subject"],
  ["Dock", "Asset", "added_at", "Activity", "activity_date"],
  ["Dock", "Visit", "visitor_email", "Activity", "linked_contact_id"],
  ["Dock", "Visit", "started_at", "Activity", "activity_date"],
  ["Dock", "Visit", "duration_seconds", "Activity", "description"],

  // ── Nooks.Call → Call ─────────────────────────────────────────────
  ["Nooks", "Call", "id", "Call", "id"],
  ["Nooks", "Call", "user_id", "Call", "user_id"],
  ["Nooks", "Call", "prospect_id", "Call", "contact_id"],
  ["Nooks", "Call", "dialed_at", "Call", "dialed_at"],
  ["Nooks", "Call", "connected_at", "Call", "answered_at"],
  ["Nooks", "Call", "ended_at", "Call", "completed_at"],
  ["Nooks", "Call", "duration_seconds", "Call", "duration_seconds"],
  ["Nooks", "Call", "disposition", "Call", "outcome"],
  ["Nooks", "Call", "recording_url", "Call", "recording_url"],
  ["Nooks", "Call", "transcript", "Call", "notes"],
  ["Nooks", "Call", "ai_summary", "Call", "notes"],
  ["Nooks", "Call", "prospect_phone", "Call", "to_number"],
  ["Nooks", "Call", "caller_id", "Call", "from_number"],
  ["Nooks", "DialerSession", "id", "Activity", "id"],
  ["Nooks", "DialerSession", "started_at", "Activity", "activity_date"],
  ["Nooks", "DialerSession", "user_id", "Activity", "owner_user_id"],

  // ── Swyft AI.CapturedCall → Meeting (MEDDPICC extraction) ─────────
  ["Swyft AI", "CapturedCall", "external_call_id", "Meeting", "id"],
  ["Swyft AI", "CapturedCall", "call_start_at", "Meeting", "scheduled_start_at"],
  ["Swyft AI", "CapturedCall", "call_duration_seconds", "Meeting", "duration_seconds"],
  ["Swyft AI", "CapturedCall", "summary", "Meeting", "summary"],
  ["Swyft AI", "CapturedCall", "key_topics", "Meeting", "topics"],
  ["Swyft AI", "CapturedCall", "next_steps", "Meeting", "next_steps"],
  ["Swyft AI", "CapturedCall", "salesforce_opportunity_id", "Meeting", "linked_deal_id"],
  ["Swyft AI", "CapturedCall", "salesforce_account_id", "Meeting", "linked_account_id"],
  ["Swyft AI", "CapturedCall", "rep_user_id", "Meeting", "organizer_user_id"],

  // ── Zendesk.Ticket → SupportTicket ────────────────────────────────
  ["Zendesk", "Ticket", "id", "SupportTicket", "id"],
  ["Zendesk", "Ticket", "subject", "SupportTicket", "subject"],
  ["Zendesk", "Ticket", "description", "SupportTicket", "description"],
  ["Zendesk", "Ticket", "type", "SupportTicket", "type"],
  ["Zendesk", "Ticket", "priority", "SupportTicket", "priority"],
  ["Zendesk", "Ticket", "status", "SupportTicket", "status"],
  ["Zendesk", "Ticket", "via_channel", "SupportTicket", "channel"],
  ["Zendesk", "Ticket", "requester_id", "SupportTicket", "requester_contact_id"],
  ["Zendesk", "Ticket", "assignee_id", "SupportTicket", "assignee_user_id"],
  ["Zendesk", "Ticket", "organization_id", "SupportTicket", "linked_account_id"],
  ["Zendesk", "Ticket", "created_at", "SupportTicket", "created_at"],
  ["Zendesk", "Ticket", "updated_at", "SupportTicket", "updated_at"],
  ["Zendesk", "Ticket", "solved_at", "SupportTicket", "solved_at"],
  ["Zendesk", "Ticket", "due_at", "SupportTicket", "due_at"],
  ["Zendesk", "Ticket", "satisfaction_rating_score", "SupportTicket", "csat_score"],
  ["Zendesk", "Ticket", "satisfaction_rating_comment", "SupportTicket", "csat_comment"],
  ["Zendesk", "Ticket", "first_resolution_time_minutes", "SupportTicket", "first_resolution_minutes"],
  ["Zendesk", "Ticket", "reply_count", "SupportTicket", "reply_count"],
  ["Zendesk", "Ticket", "tags", "SupportTicket", "tags"],

  // ── Zendesk.User → Contact (CS-side identity) ─────────────────────
  ["Zendesk", "User", "email", "Contact", "email"],
  ["Zendesk", "User", "name", "Contact", "full_name"],
  ["Zendesk", "User", "phone", "Contact", "phone"],

  // ── Zendesk.Organization → Account (CS-side identity) ─────────────
  ["Zendesk", "Organization", "name", "Account", "name"],
  ["Zendesk", "Organization", "domain_names", "Account", "domain"],
  ["Zendesk", "Organization", "external_id", "Account", "id"],

  // ── Webflow.FormSubmission → Contact (inbound demand) ─────────────
  ["Webflow", "FormSubmission", "email", "Contact", "email"],
  ["Webflow", "FormSubmission", "name", "Contact", "full_name"],
  ["Webflow", "FormSubmission", "phone", "Contact", "phone"],
  ["Webflow", "FormSubmission", "company", "Account", "name"],
  ["Webflow", "FormSubmission", "title", "Contact", "title"],
  ["Webflow", "FormSubmission", "message", "Activity", "description"],
  ["Webflow", "FormSubmission", "submitted_at", "Activity", "activity_date"],
  ["Webflow", "FormSubmission", "form_name", "Activity", "subject"],

  // ── Xero.Invoice → Invoice ────────────────────────────────────────
  ["Xero", "Invoice", "invoice_id", "Invoice", "id"],
  ["Xero", "Invoice", "invoice_number", "Invoice", "invoice_number"],
  ["Xero", "Invoice", "type", "Invoice", "type"],
  ["Xero", "Invoice", "status", "Invoice", "status"],
  ["Xero", "Invoice", "contact_id", "Invoice", "linked_account_id"],
  ["Xero", "Invoice", "reference", "Invoice", "linked_deal_id"],
  ["Xero", "Invoice", "date", "Invoice", "issue_date"],
  ["Xero", "Invoice", "due_date", "Invoice", "due_date"],
  ["Xero", "Invoice", "fully_paid_on_date", "Invoice", "paid_date"],
  ["Xero", "Invoice", "currency_code", "Invoice", "currency_code"],
  ["Xero", "Invoice", "subtotal", "Invoice", "subtotal"],
  ["Xero", "Invoice", "total_tax", "Invoice", "total_tax"],
  ["Xero", "Invoice", "total", "Invoice", "total"],
  ["Xero", "Invoice", "amount_paid", "Invoice", "amount_paid"],
  ["Xero", "Invoice", "amount_due", "Invoice", "amount_due"],
  ["Xero", "Invoice", "is_overdue", "Invoice", "is_overdue"],

  // ── Xero.Contact → Account (billing identity) ─────────────────────
  ["Xero", "Contact", "name", "Account", "name"],
  ["Xero", "Contact", "email_address", "Account", "domain"],
  ["Xero", "Contact", "tax_number", "Account", "id"],
];

// ── Derived helpers ────────────────────────────────────────────────

// All raw fields (source.object.field) that have at least one canonical
// mapping.
function buildMappedRawKeys(): Set<string> {
  const s = new Set<string>();
  for (const [src, obj, field] of FIELD_MAPPINGS) {
    s.add(`${src}::${obj}::${field}`);
  }
  return s;
}
const MAPPED_RAW_KEYS = buildMappedRawKeys();

export function isRawFieldMapped(source: string, object: string, field: string): boolean {
  return MAPPED_RAW_KEYS.has(`${source}::${object}::${field}`);
}

export interface CanonicalContribution {
  source: string;
  rawObject: string;
  rawField: string;
}

// All raw contributors for a given canonical field. The count of these
// is the "join weight" - >1 means multiple sources agree (or disagree) on
// that field.
export function contributorsFor(
  canonicalObject: string,
  canonicalField: string,
): CanonicalContribution[] {
  const out: CanonicalContribution[] = [];
  for (const [src, obj, field, co, cf] of FIELD_MAPPINGS) {
    if (co === canonicalObject && cf === canonicalField) {
      out.push({ source: src, rawObject: obj, rawField: field });
    }
  }
  return out;
}

// For each canonical object, the count of total contributing raw fields
// across all its fields. Drives edge weight in the overview graph.
export function rawFieldsContributingTo(canonicalObject: string): CanonicalContribution[] {
  const out: CanonicalContribution[] = [];
  for (const [src, obj, field, co] of FIELD_MAPPINGS) {
    if (co === canonicalObject) {
      out.push({ source: src, rawObject: obj, rawField: field });
    }
  }
  return out;
}

// All canonical fields with > 1 contributing raw field. These are the
// "join attention" nodes - the visualization highlights them.
export function joinPointFields(): {
  canonicalObject: string;
  canonicalField: string;
  contributors: CanonicalContribution[];
}[] {
  const groupKey = (co: string, cf: string) => `${co}::${cf}`;
  const groups = new Map<string, CanonicalContribution[]>();
  for (const [src, obj, field, co, cf] of FIELD_MAPPINGS) {
    const k = groupKey(co, cf);
    const arr = groups.get(k) ?? [];
    arr.push({ source: src, rawObject: obj, rawField: field });
    groups.set(k, arr);
  }
  const out: {
    canonicalObject: string;
    canonicalField: string;
    contributors: CanonicalContribution[];
  }[] = [];
  for (const [k, contribs] of groups) {
    if (contribs.length > 1) {
      const [co, cf] = k.split("::");
      out.push({ canonicalObject: co, canonicalField: cf, contributors: contribs });
    }
  }
  return out.sort((a, b) => b.contributors.length - a.contributors.length);
}

// All raw fields with no canonical mapping. These are intentional orphans
// (Gong scorecards, transcript timestamps, system IDs) - useful info to
// surface so an integrator knows what's not yet connected.
export function unmappedRawFields(): { source: string; object: string; field: string }[] {
  const out: { source: string; object: string; field: string }[] = [];
  for (const obj of RAW_FIELDS_CATALOG) {
    for (const f of obj.fields) {
      if (!isRawFieldMapped(obj.source, obj.object, f.key)) {
        out.push({ source: obj.source, object: obj.object, field: f.key });
      }
    }
  }
  return out;
}

// Total mapping count - useful for the overview header.
export function totalMappingCount(): number {
  return FIELD_MAPPINGS.length;
}

// Per-source contribution counts (for the source list in the graph).
export function sourceContributionCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const [src] of FIELD_MAPPINGS) {
    m.set(src, (m.get(src) ?? 0) + 1);
  }
  return m;
}

// Per-canonical-object contribution counts (for the canonical object
// list).
export function canonicalObjectContributionCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const [, , , co] of FIELD_MAPPINGS) {
    m.set(co, (m.get(co) ?? 0) + 1);
  }
  return m;
}

// Sanity check used in tests / dev: every canonical-side reference in
// FIELD_MAPPINGS should resolve to a real canonical object.field. If you
// add a mapping to a non-existent canonical field, this returns the
// dangling references.
export function danglingCanonicalReferences(): MappingTuple[] {
  const validFields = new Set<string>();
  for (const co of CANONICAL_OBJECTS) {
    for (const f of co.fields) {
      validFields.add(`${co.key}::${f.key}`);
    }
  }
  return FIELD_MAPPINGS.filter(([, , , co, cf]) => !validFields.has(`${co}::${cf}`));
}
