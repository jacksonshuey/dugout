import type { RawObject } from "./types";

// Chili Piper meeting-router objects. Booking-event focused; feeds the
// canonical Meeting object alongside Salesforce.Event and Gong.Call.

export const CHILIPIPER_OBJECTS: readonly RawObject[] = [
  {
    source: "Chili Piper",
    object: "Booking",
    fields: [
      { key: "id", type: "string", description: "Booking identifier" },
      { key: "event_id", type: "string", description: "Calendar event ID (the join key to Salesforce/Gong)" },
      { key: "router_id", type: "string", description: "Router (intake form) that produced the booking" },
      { key: "router_name", type: "string", description: "Router display name" },
      { key: "queue_id", type: "string", description: "Round-robin queue the booking was assigned through" },
      { key: "assigned_user_id", type: "string", description: "User assigned to take the meeting" },
      { key: "host_email", type: "string", description: "Host email" },
      { key: "guest_email", type: "string", description: "Guest (prospect) email" },
      { key: "guest_first_name", type: "string", description: "Guest first name" },
      { key: "guest_last_name", type: "string", description: "Guest last name" },
      { key: "guest_company", type: "string", description: "Guest's company name (from form)" },
      { key: "guest_phone", type: "string", description: "Guest phone (from form)" },
      { key: "meeting_type", type: "string", description: "Meeting type label (Discovery, Demo, Renewal, etc.)" },
      { key: "duration_minutes", type: "int", unit: "minutes", description: "Scheduled duration" },
      { key: "start_at", type: "date", description: "Scheduled meeting start" },
      { key: "end_at", type: "date", description: "Scheduled meeting end" },
      { key: "location", type: "string", description: "Conferencing link or physical location" },
      { key: "timezone", type: "string", description: "Booking timezone" },
      { key: "status", type: "enum", description: "Booking status", enumValues: ["scheduled", "rescheduled", "canceled", "no_show", "completed"] },
      { key: "booked_at", type: "date", description: "When the booking was created" },
      { key: "canceled_at", type: "date", description: "When the booking was canceled" },
      { key: "cancellation_reason", type: "text", description: "Reason given for cancellation" },
      { key: "no_show_at", type: "date", description: "When the meeting was marked no-show" },
      { key: "source_url", type: "string", description: "URL the prospect was on when they booked" },
      { key: "utm_source", type: "string", description: "Marketing source" },
      { key: "utm_campaign", type: "string", description: "Marketing campaign" },
      { key: "salesforce_lead_id", type: "string", description: "Salesforce Lead created or matched" },
      { key: "salesforce_contact_id", type: "string", description: "Salesforce Contact matched" },
      { key: "salesforce_account_id", type: "string", description: "Salesforce Account matched" },
      { key: "salesforce_opportunity_id", type: "string", description: "Salesforce Opportunity created or matched" },
    ],
  },
];
