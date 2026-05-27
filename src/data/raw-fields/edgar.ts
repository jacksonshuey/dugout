import type { RawObject } from "./types";

// SEC EDGAR API + Form 8-K, 10-K/Q field surface. Filing metadata verified
// against data.sec.gov/submissions/CIK*.json. Per-Item field shapes are
// derived from the SEC's official Form 8-K instructions.

const FILING_METADATA: RawObject = {
  source: "SEC EDGAR",
  object: "Filing",
  fields: [
    { key: "cik", type: "string", description: "Central Index Key (10-digit, zero-padded)" },
    { key: "entity_type", type: "enum", description: "Entity type", enumValues: ["operating", "investment_company", "individual", "other"] },
    { key: "sic", type: "string", unit: "code", description: "Standard Industrial Classification code" },
    { key: "sic_description", type: "string", description: "Human-readable SIC label" },
    { key: "name", type: "string", description: "Registrant legal name" },
    { key: "tickers", type: "string", description: "Array of stock tickers" },
    { key: "exchanges", type: "string", description: "Array of listing exchanges" },
    { key: "ein", type: "string", description: "IRS Employer Identification Number" },
    { key: "lei", type: "string", description: "Legal Entity Identifier (ISO 17442)" },
    { key: "description", type: "text", description: "EDGAR-stored business description" },
    { key: "website", type: "string", description: "Corporate website" },
    { key: "investor_website", type: "string", description: "Investor relations website" },
    { key: "category", type: "enum", description: "Filer category", enumValues: ["Large accelerated filer", "Accelerated filer", "Non-accelerated filer", "Smaller reporting company"] },
    { key: "fiscal_year_end", type: "string", unit: "MMDD", description: "Fiscal year-end month/day" },
    { key: "state_of_incorporation", type: "string", description: "Two-letter incorporation state code" },
    { key: "addresses_mailing", type: "text", description: "Mailing address object" },
    { key: "addresses_business", type: "text", description: "Business address object" },
    { key: "phone", type: "string", description: "Registrant phone number" },
    { key: "former_names", type: "text", description: "Prior legal names with from/to dates" },
    { key: "accession_number", type: "string", description: "Filing accession number" },
    { key: "filing_date", type: "date", description: "Date filing was submitted" },
    { key: "report_date", type: "date", description: "Period-of-report date" },
    { key: "acceptance_date_time", type: "date", description: "EDGAR acceptance timestamp" },
    { key: "form", type: "string", description: "Form type (10-K, 10-Q, 8-K, 4)" },
    { key: "file_number", type: "string", description: "SEC-assigned file number" },
    { key: "items", type: "string", description: "Comma-separated 8-K item codes" },
    { key: "size", type: "int", unit: "bytes", description: "Filing size" },
    { key: "is_xbrl", type: "bool", description: "Whether filing has XBRL data" },
    { key: "primary_document", type: "string", description: "Filename of primary document" },
  ],
};

const PERIODIC_COVER: RawObject = {
  source: "SEC EDGAR",
  object: "10-K/Q Cover",
  fields: [
    { key: "registrant_name", type: "string", description: "Exact registrant name as filed" },
    { key: "commission_file_number", type: "string", description: "SEC commission file number" },
    { key: "irs_employer_identification_number", type: "string", description: "IRS EIN" },
    { key: "address_of_principal_executive_offices", type: "string", description: "HQ street address" },
    { key: "city", type: "string", description: "HQ city" },
    { key: "state", type: "string", description: "HQ state" },
    { key: "zip_code", type: "string", description: "HQ ZIP/postal code" },
    { key: "registrant_telephone_number", type: "string", description: "Main registrant phone" },
    { key: "title_of_each_class", type: "string", description: "Title of each registered class of securities" },
    { key: "trading_symbol", type: "string", description: "Ticker for each class" },
    { key: "name_of_each_exchange", type: "string", description: "Exchange on which registered" },
    { key: "fiscal_year_end_date", type: "date", description: "End date of fiscal year covered" },
    { key: "is_emerging_growth_company", type: "bool", description: "EGC box" },
    { key: "is_shell_company", type: "bool", description: "Shell company box" },
    { key: "aggregate_market_value_held_by_non_affiliates", type: "float", unit: "USD", description: "Public float" },
    { key: "common_shares_outstanding", type: "int", unit: "count", description: "Shares outstanding" },
    { key: "shares_outstanding_as_of_date", type: "date", description: "As-of date for share count" },
    { key: "auditor_name", type: "string", description: "Name of registered public accounting firm" },
    { key: "auditor_location", type: "string", description: "City/country of auditor" },
    { key: "auditor_firm_id", type: "string", description: "PCAOB firm ID" },
    { key: "employees_count", type: "int", unit: "count", description: "Total employees" },
  ],
};

const ITEM_1_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 1.01", group: "8-K Items",
  fields: [
    { key: "effective_date", type: "date", description: "Date the agreement was entered" },
    { key: "counterparty_name", type: "string", description: "Name of the counterparty" },
    { key: "counterparty_relationship", type: "string", description: "Material relationship to registrant" },
    { key: "agreement_type", type: "string", description: "Type of agreement" },
    { key: "agreement_description", type: "text", description: "Brief description of terms" },
    { key: "exhibit_reference", type: "string", description: "Exhibit number" },
  ],
};

const ITEM_1_02: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 1.02", group: "8-K Items",
  fields: [
    { key: "termination_date", type: "date", description: "Effective termination date" },
    { key: "counterparty_name", type: "string", description: "Counterparty to terminated agreement" },
    { key: "agreement_description", type: "text", description: "Description of agreement being terminated" },
    { key: "termination_reason", type: "text", description: "Material circumstances" },
    { key: "material_early_termination_penalties", type: "text", description: "Penalties incurred" },
  ],
};

const ITEM_1_03: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 1.03", group: "8-K Items",
  fields: [
    { key: "proceeding_type", type: "enum", description: "Type of proceeding", enumValues: ["bankruptcy", "receivership"] },
    { key: "court_name", type: "string", description: "Court of jurisdiction" },
    { key: "case_number", type: "string", description: "Court case identifier" },
    { key: "petition_date", type: "date", description: "Date petition filed" },
    { key: "receiver_name", type: "string", description: "Receiver or trustee appointed" },
    { key: "plan_summary", type: "text", description: "Summary of plan of reorganization" },
  ],
};

const ITEM_1_05: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 1.05", group: "8-K Items",
  fields: [
    { key: "incident_discovery_date", type: "date", description: "Date incident was determined material" },
    { key: "incident_nature", type: "text", description: "Nature and scope of incident" },
    { key: "material_impact", type: "text", description: "Material impact on operations" },
    { key: "data_compromised", type: "text", description: "Categories of data affected" },
    { key: "remediation_status", type: "text", description: "Remediation steps taken" },
  ],
};

const ITEM_2_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.01", group: "8-K Items",
  fields: [
    { key: "transaction_type", type: "enum", description: "Direction of transaction", enumValues: ["acquisition", "disposition"] },
    { key: "effective_date", type: "date", description: "Date of completion" },
    { key: "counterparty_name", type: "string", description: "Other party to transaction" },
    { key: "counterparty_relationship", type: "string", description: "Material relationship if any" },
    { key: "assets_description", type: "text", description: "Description of assets involved" },
    { key: "consideration_amount", type: "float", unit: "USD", description: "Consideration paid/received" },
    { key: "consideration_form", type: "string", description: "Form of consideration (cash, stock, debt)" },
    { key: "source_of_funds", type: "string", description: "How the consideration was financed" },
  ],
};

const ITEM_2_02: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.02", group: "8-K Items",
  fields: [
    { key: "period_end_date", type: "date", description: "Fiscal period being reported" },
    { key: "press_release_date", type: "date", description: "Date of related press release" },
    { key: "revenue", type: "float", unit: "USD", description: "Reported revenue" },
    { key: "net_income", type: "float", unit: "USD", description: "Reported net income" },
    { key: "earnings_per_share", type: "float", unit: "USD", description: "Diluted EPS" },
    { key: "guidance_provided", type: "text", description: "Forward-looking guidance content" },
    { key: "exhibit_reference", type: "string", description: "Press release exhibit number" },
  ],
};

const ITEM_2_03: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.03", group: "8-K Items",
  fields: [
    { key: "obligation_type", type: "enum", description: "Obligation category", enumValues: ["long_term_debt", "short_term_debt", "capital_lease", "operating_lease", "off_balance_sheet"] },
    { key: "creation_date", type: "date", description: "Date obligation was incurred" },
    { key: "principal_amount", type: "float", unit: "USD", description: "Principal amount" },
    { key: "interest_rate", type: "float", unit: "percent", description: "Stated interest rate" },
    { key: "maturity_date", type: "date", description: "Maturity date" },
    { key: "counterparty_name", type: "string", description: "Lender or counterparty" },
    { key: "terms_summary", type: "text", description: "Material terms" },
  ],
};

const ITEM_2_04: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.04", group: "8-K Items",
  fields: [
    { key: "triggering_event_date", type: "date", description: "Date of triggering event" },
    { key: "triggering_event_description", type: "text", description: "Description of event" },
    { key: "accelerated_obligation_amount", type: "float", unit: "USD", description: "Amount accelerated" },
    { key: "consequences", type: "text", description: "Impact on registrant" },
  ],
};

const ITEM_2_05: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.05", group: "8-K Items",
  fields: [
    { key: "commitment_date", type: "date", description: "Date the registrant committed to the plan" },
    { key: "exit_activity_description", type: "text", description: "Description (layoffs, plant closure)" },
    { key: "estimated_total_cost", type: "float", unit: "USD", description: "Total estimated cost" },
    { key: "estimated_cash_cost", type: "float", unit: "USD", description: "Cash portion of cost" },
    { key: "estimated_charges_by_type", type: "text", description: "Breakdown by major cost type" },
    { key: "expected_completion_date", type: "date", description: "Expected completion" },
  ],
};

const ITEM_2_06: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 2.06", group: "8-K Items",
  fields: [
    { key: "impairment_determination_date", type: "date", description: "Date impairment was concluded" },
    { key: "asset_description", type: "text", description: "Description of impaired asset" },
    { key: "estimated_impairment_amount", type: "float", unit: "USD", description: "Estimated total impairment" },
    { key: "estimated_cash_charges", type: "float", unit: "USD", description: "Cash-component portion" },
    { key: "impairment_reason", type: "text", description: "Triggering circumstances" },
  ],
};

const ITEM_3_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 3.01", group: "8-K Items",
  fields: [
    { key: "exchange_name", type: "string", description: "Listing exchange" },
    { key: "notice_date", type: "date", description: "Date notice was received" },
    { key: "listing_rule_violated", type: "string", description: "Specific listing rule" },
    { key: "delisting_effective_date", type: "date", description: "Effective delisting date" },
    { key: "remediation_plan", type: "text", description: "Plan to regain compliance" },
  ],
};

const ITEM_3_02: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 3.02", group: "8-K Items",
  fields: [
    { key: "sale_date", type: "date", description: "Date of sale" },
    { key: "security_class", type: "string", description: "Class/type of security sold" },
    { key: "securities_amount", type: "float", unit: "count", description: "Number of securities sold" },
    { key: "consideration_amount", type: "float", unit: "USD", description: "Total consideration" },
    { key: "purchaser_description", type: "text", description: "Description of purchaser(s)" },
    { key: "exemption_claimed", type: "string", description: "Securities Act exemption" },
  ],
};

const ITEM_4_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 4.01", group: "8-K Items",
  fields: [
    { key: "change_type", type: "enum", description: "Direction of change", enumValues: ["dismissal", "resignation", "engagement"] },
    { key: "effective_date", type: "date", description: "Effective date of change" },
    { key: "former_accountant_name", type: "string", description: "Outgoing accountant firm" },
    { key: "new_accountant_name", type: "string", description: "Incoming accountant firm" },
    { key: "disagreements_disclosed", type: "bool", description: "Whether disagreements existed" },
    { key: "disagreements_description", type: "text", description: "Description of disagreements" },
    { key: "audit_committee_approved", type: "bool", description: "Approved by audit committee" },
  ],
};

const ITEM_4_02: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 4.02", group: "8-K Items",
  fields: [
    { key: "determination_date", type: "date", description: "Date of non-reliance determination" },
    { key: "affected_periods", type: "string", description: "Reporting periods affected" },
    { key: "restatement_reason", type: "text", description: "Reason for non-reliance" },
    { key: "auditor_discussed", type: "bool", description: "Whether auditor was consulted" },
  ],
};

const ITEM_5_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 5.01", group: "8-K Items",
  fields: [
    { key: "change_of_control_date", type: "date", description: "Effective date" },
    { key: "acquiring_party_name", type: "string", description: "Identity of acquiring person/entity" },
    { key: "consideration_amount", type: "float", unit: "USD", description: "Consideration paid" },
    { key: "source_of_funds", type: "string", description: "How transaction was financed" },
    { key: "voting_securities_acquired", type: "float", unit: "percent", description: "Percent of voting securities" },
    { key: "arrangements_summary", type: "text", description: "Arrangements that resulted in change" },
  ],
};

const ITEM_5_02: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 5.02", group: "8-K Items",
  fields: [
    { key: "event_type", type: "enum", description: "Type of personnel event", enumValues: ["departure", "election", "appointment", "retirement", "compensation_arrangement"] },
    { key: "effective_date", type: "date", description: "Effective date" },
    { key: "person_name", type: "string", description: "Director or officer name" },
    { key: "position", type: "string", description: "Title/position" },
    { key: "departure_reason", type: "text", description: "Reason for departure" },
    { key: "successor_name", type: "string", description: "Successor's name" },
    { key: "compensation_terms", type: "text", description: "Compensation arrangement details" },
  ],
};

const ITEM_5_03: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 5.03", group: "8-K Items",
  fields: [
    { key: "amendment_date", type: "date", description: "Effective date of amendment" },
    { key: "amendment_type", type: "enum", description: "Document amended", enumValues: ["articles_of_incorporation", "bylaws", "fiscal_year_change"] },
    { key: "amendment_description", type: "text", description: "Substance of amendment" },
    { key: "new_fiscal_year_end", type: "string", unit: "MMDD", description: "New fiscal year-end" },
  ],
};

const ITEM_5_07: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 5.07", group: "8-K Items",
  fields: [
    { key: "meeting_date", type: "date", description: "Date of meeting" },
    { key: "meeting_type", type: "enum", description: "Type of meeting", enumValues: ["annual", "special"] },
    { key: "matters_voted", type: "text", description: "Each matter with vote counts" },
    { key: "directors_elected", type: "text", description: "Directors elected with vote counts" },
  ],
};

const ITEM_7_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 7.01", group: "8-K Items",
  fields: [
    { key: "disclosure_date", type: "date", description: "Date of disclosure" },
    { key: "disclosure_summary", type: "text", description: "Substance of information disclosed" },
    { key: "exhibit_reference", type: "string", description: "Press release or other exhibit" },
  ],
};

const ITEM_8_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 8.01", group: "8-K Items",
  fields: [
    { key: "event_date", type: "date", description: "Date of event" },
    { key: "event_description", type: "text", description: "Description of event" },
    { key: "exhibit_reference", type: "string", description: "Related exhibit" },
  ],
};

const ITEM_9_01: RawObject = {
  source: "SEC EDGAR", object: "8-K Item 9.01", group: "8-K Items",
  fields: [
    { key: "financial_statements_filed", type: "text", description: "Description of financial statements" },
    { key: "pro_forma_financial_information", type: "text", description: "Pro forma financial information" },
    { key: "exhibits_list", type: "text", description: "List of exhibits with numbers" },
    { key: "exhibit_number", type: "string", description: "Exhibit number (e.g. 99.1)" },
    { key: "exhibit_description", type: "string", description: "Description of each exhibit" },
  ],
};

export const EDGAR_OBJECTS: readonly RawObject[] = [
  FILING_METADATA,
  PERIODIC_COVER,
  ITEM_1_01, ITEM_1_02, ITEM_1_03, ITEM_1_05,
  ITEM_2_01, ITEM_2_02, ITEM_2_03, ITEM_2_04, ITEM_2_05, ITEM_2_06,
  ITEM_3_01, ITEM_3_02,
  ITEM_4_01, ITEM_4_02,
  ITEM_5_01, ITEM_5_02, ITEM_5_03, ITEM_5_07,
  ITEM_7_01, ITEM_8_01, ITEM_9_01,
];
