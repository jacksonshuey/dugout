import type { RawObject } from "./types";

// Webflow CMS API. Forms are the GTM-relevant surface: inbound contact
// requests, demo requests, content downloads.

export const WEBFLOW_OBJECTS: readonly RawObject[] = [
  {
    source: "Webflow",
    object: "FormSubmission",
    fields: [
      { key: "id", type: "string", description: "Submission identifier" },
      { key: "form_id", type: "string", description: "Source form ID" },
      { key: "form_name", type: "string", description: "Form name (e.g. 'Contact Sales', 'Demo Request')" },
      { key: "site_id", type: "string", description: "Webflow site ID" },
      { key: "page_url", type: "string", description: "URL of the page where the form was submitted" },
      { key: "submitted_at", type: "date", description: "Submission timestamp" },
      { key: "name", type: "string", description: "Submitter name (form field)" },
      { key: "email", type: "string", description: "Submitter email" },
      { key: "phone", type: "string", description: "Submitter phone" },
      { key: "company", type: "string", description: "Submitter company" },
      { key: "title", type: "string", description: "Submitter job title" },
      { key: "message", type: "text", description: "Free-text inquiry body" },
      { key: "utm_source", type: "string", description: "UTM source" },
      { key: "utm_medium", type: "string", description: "UTM medium" },
      { key: "utm_campaign", type: "string", description: "UTM campaign" },
      { key: "referrer", type: "string", description: "HTTP referrer" },
      { key: "user_agent", type: "string", description: "Browser user agent" },
      { key: "ip_address", type: "string", description: "Submitter IP (for geolocation)" },
    ],
  },
];
