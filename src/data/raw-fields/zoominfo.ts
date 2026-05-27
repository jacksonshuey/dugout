import type { RawObject } from "./types";

// ZoomInfo enrichment + intent. Standard contact/company shapes from
// api.zoominfo.com/lookup docs. Intent fields from the Intent API.
//
// Overlaps heavily with Apollo - both are enrichment providers. The
// canonical Contact + Account fields receive contributions from both,
// which is a true "which is fresher" join question.

export const ZOOMINFO_OBJECTS: readonly RawObject[] = [
  {
    source: "ZoomInfo",
    object: "Contact",
    fields: [
      { key: "id", type: "string", description: "ZoomInfo person ID" },
      { key: "first_name", type: "string", description: "First name" },
      { key: "last_name", type: "string", description: "Last name" },
      { key: "middle_name", type: "string", description: "Middle name" },
      { key: "full_name", type: "string", description: "Full display name" },
      { key: "job_title", type: "string", description: "Current job title" },
      { key: "management_level", type: "enum", description: "Seniority bucket", enumValues: ["c_level_executive", "vp_level_executive", "director", "manager", "senior", "non_manager", "other"] },
      { key: "job_function", type: "string", description: "Functional area" },
      { key: "department", type: "string", description: "Department" },
      { key: "email", type: "string", description: "Work email" },
      { key: "email_status", type: "enum", description: "Email deliverability", enumValues: ["verified", "unverified", "catch_all", "invalid"] },
      { key: "direct_phone", type: "string", description: "Verified direct phone" },
      { key: "mobile_phone", type: "string", description: "Mobile phone" },
      { key: "company_id", type: "string", description: "ZoomInfo company ID" },
      { key: "company_name", type: "string", description: "Current employer" },
      { key: "linkedin_url", type: "string", description: "LinkedIn profile URL" },
      { key: "location_country", type: "string", description: "Country" },
      { key: "location_state", type: "string", description: "State/region" },
      { key: "location_city", type: "string", description: "City" },
      { key: "last_updated_date", type: "date", description: "When ZoomInfo last verified the record" },
    ],
  },
  {
    source: "ZoomInfo",
    object: "Company",
    fields: [
      { key: "id", type: "string", description: "ZoomInfo company ID" },
      { key: "name", type: "string", description: "Company name" },
      { key: "website", type: "string", description: "Primary website" },
      { key: "primary_industry", type: "string", description: "Primary industry" },
      { key: "sub_industry", type: "string", description: "Sub-industry" },
      { key: "sic_code", type: "string", description: "SIC code" },
      { key: "naics_code", type: "string", description: "NAICS code" },
      { key: "employee_count", type: "int", unit: "count", description: "Estimated employee count" },
      { key: "revenue", type: "float", unit: "USD", description: "Estimated annual revenue" },
      { key: "founded_year", type: "int", unit: "year", description: "Year founded" },
      { key: "ownership_type", type: "enum", description: "Ownership type", enumValues: ["Public", "Private", "Subsidiary", "Private Equity", "Non-Profit", "Government"] },
      { key: "ticker", type: "string", description: "Stock ticker" },
      { key: "company_phone", type: "string", description: "Main phone" },
      { key: "linkedin_url", type: "string", description: "Company LinkedIn URL" },
      { key: "country", type: "string", description: "HQ country" },
      { key: "state", type: "string", description: "HQ state" },
      { key: "city", type: "string", description: "HQ city" },
      { key: "address_street", type: "string", description: "HQ street" },
      { key: "technologies", type: "string", description: "Detected technologies" },
      { key: "company_status", type: "enum", description: "Operational status", enumValues: ["Active", "Acquired", "Out of Business", "Inactive"] },
    ],
  },
  {
    source: "ZoomInfo",
    object: "Intent",
    fields: [
      { key: "company_id", type: "string", description: "Company the intent signal is attributed to" },
      { key: "topic", type: "string", description: "Intent topic/keyword" },
      { key: "topic_id", type: "string", description: "Topic identifier" },
      { key: "score", type: "int", description: "Intent score (0-100)" },
      { key: "category", type: "string", description: "Topic category" },
      { key: "signal_date", type: "date", description: "When the signal was recorded" },
      { key: "trend", type: "enum", description: "Score trend over window", enumValues: ["rising", "stable", "falling"] },
    ],
  },
];
