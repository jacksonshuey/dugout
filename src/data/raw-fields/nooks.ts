import type { RawObject } from "./types";

// Nooks AI-assisted calling. Parallel-dialer call data; feeds canonical
// Call alongside Outreach.Call and Salesforce.Task(type=Call).

export const NOOKS_OBJECTS: readonly RawObject[] = [
  {
    source: "Nooks",
    object: "Call",
    fields: [
      { key: "id", type: "string", description: "Nooks call identifier" },
      { key: "user_id", type: "string", description: "Caller (rep) user ID" },
      { key: "user_email", type: "string", description: "Caller email" },
      { key: "prospect_id", type: "string", description: "Linked prospect ID (Salesforce/Outreach)" },
      { key: "prospect_email", type: "string", description: "Prospect email" },
      { key: "prospect_phone", type: "string", description: "Dialed phone number" },
      { key: "prospect_company", type: "string", description: "Prospect's company name" },
      { key: "dialed_at", type: "date", description: "When dial was initiated" },
      { key: "connected_at", type: "date", description: "When the call connected" },
      { key: "ended_at", type: "date", description: "When the call ended" },
      { key: "duration_seconds", type: "int", unit: "seconds", description: "Talk-time duration" },
      { key: "wait_time_seconds", type: "int", unit: "seconds", description: "Time spent waiting in dialer queue" },
      { key: "disposition", type: "enum", description: "Outcome disposition", enumValues: ["connected", "no_answer", "voicemail", "wrong_number", "busy", "do_not_call", "callback_requested", "meeting_booked", "qualified_out"] },
      { key: "recording_url", type: "string", description: "Recording URL" },
      { key: "transcript", type: "text", description: "AI-generated transcript" },
      { key: "ai_summary", type: "text", description: "AI call summary" },
      { key: "next_steps", type: "text", description: "AI-extracted next steps" },
      { key: "sentiment", type: "enum", description: "Detected sentiment", enumValues: ["positive", "neutral", "negative"] },
      { key: "talk_ratio", type: "float", unit: "percent", description: "Rep talk-time percentage" },
      { key: "caller_id", type: "string", description: "Local-presence phone shown to prospect" },
      { key: "campaign_id", type: "string", description: "Dialer campaign" },
      { key: "campaign_name", type: "string", description: "Campaign name" },
      { key: "session_id", type: "string", description: "Power-dialer session" },
      { key: "salesforce_task_id", type: "string", description: "Logged Salesforce Task ID" },
    ],
  },
  {
    source: "Nooks",
    object: "DialerSession",
    fields: [
      { key: "id", type: "string", description: "Session identifier" },
      { key: "user_id", type: "string", description: "Rep on the session" },
      { key: "started_at", type: "date", description: "Session start" },
      { key: "ended_at", type: "date", description: "Session end" },
      { key: "duration_minutes", type: "int", unit: "minutes", description: "Session length" },
      { key: "dial_count", type: "int", unit: "count", description: "Total dials attempted" },
      { key: "connect_count", type: "int", unit: "count", description: "Live connects" },
      { key: "meeting_count", type: "int", unit: "count", description: "Meetings booked in session" },
      { key: "callback_count", type: "int", unit: "count", description: "Callbacks scheduled" },
    ],
  },
];
