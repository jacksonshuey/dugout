import type { RawObject } from "./types";

// Zendesk Support API. Tickets + users + organizations. Feeds the new
// canonical SupportTicket object plus light contributions to Contact and
// Account (CS-side identity overlap with CRM).

export const ZENDESK_OBJECTS: readonly RawObject[] = [
  {
    source: "Zendesk",
    object: "Ticket",
    fields: [
      { key: "id", type: "int", description: "Ticket numeric ID" },
      { key: "subject", type: "string", description: "Ticket subject" },
      { key: "description", type: "text", description: "Initial ticket body" },
      { key: "type", type: "enum", description: "Ticket type", enumValues: ["question", "incident", "problem", "task"] },
      { key: "priority", type: "enum", description: "Priority", enumValues: ["urgent", "high", "normal", "low"] },
      { key: "status", type: "enum", description: "Lifecycle status", enumValues: ["new", "open", "pending", "hold", "solved", "closed"] },
      { key: "requester_id", type: "int", description: "User who opened the ticket" },
      { key: "submitter_id", type: "int", description: "User who submitted on behalf" },
      { key: "assignee_id", type: "int", description: "Currently assigned agent" },
      { key: "organization_id", type: "int", description: "Linked Zendesk Organization" },
      { key: "group_id", type: "int", description: "Assigned support group" },
      { key: "tags", type: "string", description: "Ticket tags" },
      { key: "created_at", type: "date", description: "Creation timestamp" },
      { key: "updated_at", type: "date", description: "Last update timestamp" },
      { key: "due_at", type: "date", description: "SLA due time" },
      { key: "solved_at", type: "date", description: "When ticket was solved" },
      { key: "satisfaction_rating_score", type: "enum", description: "CSAT score", enumValues: ["offered", "good", "bad", "good_with_comment", "bad_with_comment", "unoffered"] },
      { key: "satisfaction_rating_comment", type: "text", description: "CSAT comment" },
      { key: "via_channel", type: "enum", description: "Source channel", enumValues: ["web", "email", "chat", "voice", "api", "twitter", "facebook", "mobile", "any_channel"] },
      { key: "is_public", type: "bool", description: "Public-facing flag" },
      { key: "reply_count", type: "int", unit: "count", description: "Number of replies" },
      { key: "first_resolution_time_minutes", type: "int", unit: "minutes", description: "Time to first resolution" },
    ],
  },
  {
    source: "Zendesk",
    object: "User",
    fields: [
      { key: "id", type: "int", description: "Zendesk user ID" },
      { key: "name", type: "string", description: "Full name" },
      { key: "email", type: "string", description: "Email address (the join key)" },
      { key: "phone", type: "string", description: "Phone number" },
      { key: "role", type: "enum", description: "Account role", enumValues: ["end-user", "agent", "admin"] },
      { key: "organization_id", type: "int", description: "Linked organization" },
      { key: "active", type: "bool", description: "Active flag" },
      { key: "verified", type: "bool", description: "Email-verified flag" },
      { key: "time_zone", type: "string", description: "User timezone" },
      { key: "locale", type: "string", description: "Locale code" },
      { key: "tags", type: "string", description: "User tags" },
      { key: "last_login_at", type: "date", description: "Last login timestamp" },
      { key: "created_at", type: "date", description: "Creation timestamp" },
    ],
  },
  {
    source: "Zendesk",
    object: "Organization",
    fields: [
      { key: "id", type: "int", description: "Organization ID" },
      { key: "name", type: "string", description: "Organization name" },
      { key: "domain_names", type: "string", description: "Domains attributed to the org" },
      { key: "tags", type: "string", description: "Organization tags" },
      { key: "details", type: "text", description: "Notes field" },
      { key: "external_id", type: "string", description: "External system ID (often Salesforce Account ID)" },
      { key: "created_at", type: "date", description: "Creation timestamp" },
    ],
  },
];
