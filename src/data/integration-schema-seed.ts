import type { BrandKey } from "@/components/landing/logos";

// Seed catalog of fields Dugout knows it can ingest from each integration.
// Hand-curated from public API docs for the 5 CRM/conversation core sources
// (Salesforce, Gong, HubSpot, Outreach, Chili Piper).
//
// This is the FALLBACK data source for the schema-catalog UI on /plan. Once
// the scraper at `scripts/scrape-integration-docs.ts` runs against the URL
// config and writes to the `integration_schema_catalog` Supabase table, the
// UI prefers the DB rows and uses this seed only when no DB rows exist for
// a brand. That way the demo never goes empty and the catalog improves as
// the scraper finds more fields.
//
// candidateCanonicals are the canonical names Haiku is most likely to route
// a field into. Pre-computing them here turns the catalog into a seed for
// zippering — at first-ingest, the zipperer can skip the Haiku call for any
// field whose candidate matches an existing canonical column for the pkey.

export interface CatalogField {
  brand: BrandKey;
  object: string; // "Opportunity" | "Call" | "Deal" | ...
  fieldPath: string; // "Amount" | "metaData.scheduled" | "properties.closedate"
  dataType: string; // "currency" | "timestamp" | "text" | "number" | ...
  description: string;
  candidateCanonicals: string[]; // pre-routed canonicals
}

export const SCHEMA_CATALOG: CatalogField[] = [
  // ---------------------------------------------------------------------------
  // Salesforce — Force.com REST. Flat CamelCase API names. Auth: JWT Bearer.
  // ---------------------------------------------------------------------------
  { brand: "salesforce", object: "Opportunity", fieldPath: "Id", dataType: "id", description: "Salesforce record ID, 18-char.", candidateCanonicals: ["external_id"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "Name", dataType: "text", description: "Deal name as entered by the AE.", candidateCanonicals: ["deal_name"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "Amount", dataType: "currency", description: "Opportunity total in workspace currency.", candidateCanonicals: ["deal_amount"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "CloseDate", dataType: "date", description: "Expected close date.", candidateCanonicals: ["occurred_at", "close_date"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "StageName", dataType: "picklist", description: "Pipeline stage label.", candidateCanonicals: ["stage"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "NextStep", dataType: "text", description: "AE-authored next-step note, 255 chars.", candidateCanonicals: ["next_step"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "Probability", dataType: "percent", description: "Stage-derived probability of close.", candidateCanonicals: ["win_probability"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "OwnerId", dataType: "reference", description: "Salesforce User ID of the deal owner.", candidateCanonicals: ["owner_id"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "AccountId", dataType: "reference", description: "Parent Account record ID.", candidateCanonicals: ["account_id"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "CreatedDate", dataType: "datetime", description: "Record creation timestamp.", candidateCanonicals: ["created_at"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "LastModifiedDate", dataType: "datetime", description: "Last edit timestamp.", candidateCanonicals: ["modified_at"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "IsClosed", dataType: "boolean", description: "Set when stage is Closed Won or Closed Lost.", candidateCanonicals: ["is_closed"] },
  { brand: "salesforce", object: "Opportunity", fieldPath: "ForecastCategoryName", dataType: "picklist", description: "Pipeline / Best Case / Commit / Closed.", candidateCanonicals: ["forecast_category"] },
  { brand: "salesforce", object: "Contact", fieldPath: "Email", dataType: "email", description: "Primary email address for the contact.", candidateCanonicals: ["contact_email"] },
  { brand: "salesforce", object: "Contact", fieldPath: "FirstName", dataType: "text", description: "Given name.", candidateCanonicals: ["contact_first_name"] },
  { brand: "salesforce", object: "Contact", fieldPath: "LastName", dataType: "text", description: "Family name.", candidateCanonicals: ["contact_last_name"] },
  { brand: "salesforce", object: "Contact", fieldPath: "Title", dataType: "text", description: "Job title at the account.", candidateCanonicals: ["contact_title"] },
  { brand: "salesforce", object: "Account", fieldPath: "Name", dataType: "text", description: "Company name.", candidateCanonicals: ["account_name"] },
  { brand: "salesforce", object: "Account", fieldPath: "Industry", dataType: "picklist", description: "Industry classification.", candidateCanonicals: ["industry"] },
  { brand: "salesforce", object: "Account", fieldPath: "NumberOfEmployees", dataType: "integer", description: "Headcount estimate.", candidateCanonicals: ["employee_count"] },

  // ---------------------------------------------------------------------------
  // Gong — /v2/calls/extensive. Nested under metaData / parties / content.
  // ---------------------------------------------------------------------------
  { brand: "gong", object: "Call", fieldPath: "metaData.id", dataType: "id", description: "Gong call ID, used to link to gong.io URL.", candidateCanonicals: ["external_id"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.title", dataType: "text", description: "Calendar event title for the call.", candidateCanonicals: ["title"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.scheduled", dataType: "datetime", description: "Calendar-scheduled start time, ISO 8601.", candidateCanonicals: ["occurred_at"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.started", dataType: "datetime", description: "Actual call start, ISO 8601.", candidateCanonicals: ["started_at"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.duration", dataType: "integer", description: "Length of the call, seconds.", candidateCanonicals: ["duration_seconds"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.direction", dataType: "enum", description: "Inbound / Outbound / Conference / Unknown.", candidateCanonicals: ["call_direction"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.url", dataType: "url", description: "Deep link to the call recording in Gong.", candidateCanonicals: ["source_url"] },
  { brand: "gong", object: "Call", fieldPath: "metaData.primaryUserId", dataType: "reference", description: "Internal user who hosted the call.", candidateCanonicals: ["host_user_id"] },
  { brand: "gong", object: "Call", fieldPath: "parties[].emailAddress", dataType: "email", description: "Email of each call participant.", candidateCanonicals: ["contact_email"] },
  { brand: "gong", object: "Call", fieldPath: "parties[].name", dataType: "text", description: "Display name of each participant.", candidateCanonicals: ["contact_name"] },
  { brand: "gong", object: "Call", fieldPath: "parties[].title", dataType: "text", description: "Title of each participant if known.", candidateCanonicals: ["contact_title"] },
  { brand: "gong", object: "Call", fieldPath: "parties[].affiliation", dataType: "enum", description: "Internal / External / Unknown.", candidateCanonicals: ["affiliation"] },
  { brand: "gong", object: "Call", fieldPath: "content.brief", dataType: "text", description: "Gong-generated executive summary.", candidateCanonicals: ["summary"] },
  { brand: "gong", object: "Call", fieldPath: "content.highlights", dataType: "array", description: "Key moments with timestamps.", candidateCanonicals: ["highlights"] },
  { brand: "gong", object: "Call", fieldPath: "content.callOutcome", dataType: "text", description: "Outcome label generated by Gong.", candidateCanonicals: ["outcome"] },
  { brand: "gong", object: "Call", fieldPath: "content.keyPoints", dataType: "array", description: "Bullet list of key call points.", candidateCanonicals: ["key_points"] },
  { brand: "gong", object: "Call", fieldPath: "content.trackers", dataType: "array", description: "Tracker categories detected (competitor, pricing, etc.).", candidateCanonicals: ["trackers"] },
  { brand: "gong", object: "Call", fieldPath: "interaction.speakers", dataType: "array", description: "Per-speaker stats: talk time, longest monologue.", candidateCanonicals: ["speaker_stats"] },

  // ---------------------------------------------------------------------------
  // HubSpot — CRM v3 API. snake_case under .properties wrapper.
  // ---------------------------------------------------------------------------
  { brand: "hubspot", object: "Deal", fieldPath: "properties.dealname", dataType: "text", description: "Deal name.", candidateCanonicals: ["deal_name"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.amount", dataType: "number", description: "Deal amount in account currency.", candidateCanonicals: ["deal_amount"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.dealstage", dataType: "enumeration", description: "Pipeline stage internal ID.", candidateCanonicals: ["stage"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.closedate", dataType: "datetime", description: "Expected close date.", candidateCanonicals: ["occurred_at", "close_date"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.pipeline", dataType: "enumeration", description: "Pipeline the deal lives in.", candidateCanonicals: ["pipeline"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.hubspot_owner_id", dataType: "number", description: "Owner HubSpot user ID.", candidateCanonicals: ["owner_id"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.dealtype", dataType: "enumeration", description: "newbusiness / existingbusiness.", candidateCanonicals: ["deal_type"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.createdate", dataType: "datetime", description: "Record creation timestamp.", candidateCanonicals: ["created_at"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.hs_lastmodifieddate", dataType: "datetime", description: "Last property mutation timestamp.", candidateCanonicals: ["modified_at"] },
  { brand: "hubspot", object: "Deal", fieldPath: "properties.hs_priority", dataType: "enumeration", description: "low / medium / high.", candidateCanonicals: ["priority"] },
  { brand: "hubspot", object: "Contact", fieldPath: "properties.email", dataType: "email", description: "Primary email.", candidateCanonicals: ["contact_email"] },
  { brand: "hubspot", object: "Contact", fieldPath: "properties.firstname", dataType: "text", description: "Given name.", candidateCanonicals: ["contact_first_name"] },
  { brand: "hubspot", object: "Contact", fieldPath: "properties.lastname", dataType: "text", description: "Family name.", candidateCanonicals: ["contact_last_name"] },
  { brand: "hubspot", object: "Contact", fieldPath: "properties.jobtitle", dataType: "text", description: "Title.", candidateCanonicals: ["contact_title"] },
  { brand: "hubspot", object: "Contact", fieldPath: "properties.lifecyclestage", dataType: "enumeration", description: "subscriber / lead / MQL / SQL / opportunity / customer.", candidateCanonicals: ["lifecycle_stage"] },
  { brand: "hubspot", object: "Company", fieldPath: "properties.name", dataType: "text", description: "Company name.", candidateCanonicals: ["account_name"] },
  { brand: "hubspot", object: "Company", fieldPath: "properties.domain", dataType: "text", description: "Company root domain.", candidateCanonicals: ["account_domain"] },
  { brand: "hubspot", object: "Company", fieldPath: "properties.industry", dataType: "enumeration", description: "Industry classification.", candidateCanonicals: ["industry"] },
  { brand: "hubspot", object: "Company", fieldPath: "properties.numberofemployees", dataType: "number", description: "Headcount.", candidateCanonicals: ["employee_count"] },

  // ---------------------------------------------------------------------------
  // Outreach — JSON:API spec, attributes namespace. Activity events too.
  // ---------------------------------------------------------------------------
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.firstName", dataType: "text", description: "Given name.", candidateCanonicals: ["contact_first_name"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.lastName", dataType: "text", description: "Family name.", candidateCanonicals: ["contact_last_name"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.emails", dataType: "array", description: "All email addresses for the prospect.", candidateCanonicals: ["contact_email"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.title", dataType: "text", description: "Job title.", candidateCanonicals: ["contact_title"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.company", dataType: "text", description: "Company name as captured.", candidateCanonicals: ["account_name"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.engagedAt", dataType: "datetime", description: "Most-recent engagement timestamp.", candidateCanonicals: ["engaged_at"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.openCount", dataType: "integer", description: "Total email opens.", candidateCanonicals: ["open_count"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.clickCount", dataType: "integer", description: "Total email clicks.", candidateCanonicals: ["click_count"] },
  { brand: "outreach", object: "Prospect", fieldPath: "attributes.replyCount", dataType: "integer", description: "Total email replies.", candidateCanonicals: ["reply_count"] },
  { brand: "outreach", object: "Opportunity", fieldPath: "attributes.name", dataType: "text", description: "Deal name in Outreach.", candidateCanonicals: ["deal_name"] },
  { brand: "outreach", object: "Opportunity", fieldPath: "attributes.amount", dataType: "number", description: "Deal value.", candidateCanonicals: ["deal_amount"] },
  { brand: "outreach", object: "Opportunity", fieldPath: "attributes.closeDate", dataType: "datetime", description: "Expected close.", candidateCanonicals: ["occurred_at", "close_date"] },
  { brand: "outreach", object: "Opportunity", fieldPath: "attributes.nextStep", dataType: "text", description: "Next-step note.", candidateCanonicals: ["next_step"] },
  { brand: "outreach", object: "Opportunity", fieldPath: "attributes.probability", dataType: "percent", description: "Win probability.", candidateCanonicals: ["win_probability"] },
  { brand: "outreach", object: "Sequence", fieldPath: "attributes.name", dataType: "text", description: "Sequence name as labeled by the SDR.", candidateCanonicals: ["sequence_name"] },
  { brand: "outreach", object: "Sequence", fieldPath: "attributes.totalActiveCount", dataType: "integer", description: "Active prospects in this sequence.", candidateCanonicals: ["sequence_active_count"] },

  // ---------------------------------------------------------------------------
  // Chili Piper — booking + assignment metadata. Webhook-driven.
  // ---------------------------------------------------------------------------
  { brand: "chilipiper", object: "Booking", fieldPath: "id", dataType: "id", description: "Booking ID.", candidateCanonicals: ["external_id"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "scheduledTime", dataType: "datetime", description: "Meeting start time, ISO 8601.", candidateCanonicals: ["occurred_at"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "duration", dataType: "integer", description: "Meeting length, minutes.", candidateCanonicals: ["duration_minutes"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "meetingType", dataType: "text", description: "Type label (demo, discovery, etc.).", candidateCanonicals: ["meeting_type"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "status", dataType: "enum", description: "scheduled / canceled / completed / no_show.", candidateCanonicals: ["meeting_status"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "attendee.email", dataType: "email", description: "Booker email · the prospect.", candidateCanonicals: ["contact_email"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "attendee.name", dataType: "text", description: "Booker display name.", candidateCanonicals: ["contact_name"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "assignedRep.email", dataType: "email", description: "Internal rep assigned to the meeting.", candidateCanonicals: ["rep_email"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "assignedRep.name", dataType: "text", description: "Internal rep display name.", candidateCanonicals: ["rep_name"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "meetingRoom.url", dataType: "url", description: "Video meeting link (Zoom/Meet/etc).", candidateCanonicals: ["meeting_url"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "formData", dataType: "jsonb", description: "Custom form responses captured at booking.", candidateCanonicals: ["intake_form_data"] },
  { brand: "chilipiper", object: "Booking", fieldPath: "sourceUrl", dataType: "url", description: "Page the booking was initiated from.", candidateCanonicals: ["source_url"] },
];

// ---------------------------------------------------------------------------
// Selectors keyed for the UI. Group by brand once at module load so renders
// don't repeat the work.
// ---------------------------------------------------------------------------

const BY_BRAND: Map<BrandKey, CatalogField[]> = (() => {
  const m = new Map<BrandKey, CatalogField[]>();
  for (const row of SCHEMA_CATALOG) {
    if (!m.has(row.brand)) m.set(row.brand, []);
    m.get(row.brand)!.push(row);
  }
  return m;
})();

export function fieldsForBrand(brand: BrandKey): CatalogField[] {
  return BY_BRAND.get(brand) ?? [];
}

export function fieldCount(brand: BrandKey): number {
  return BY_BRAND.get(brand)?.length ?? 0;
}

// Convenience: group fields by object for nicer per-brand display
// (Opportunity / Contact / Account inside Salesforce, etc.)
export function fieldsByObject(brand: BrandKey): Record<string, CatalogField[]> {
  const out: Record<string, CatalogField[]> = {};
  for (const row of fieldsForBrand(brand)) {
    if (!out[row.object]) out[row.object] = [];
    out[row.object].push(row);
  }
  return out;
}
