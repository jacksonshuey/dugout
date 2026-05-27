import type { RawObject } from "./types";

// Swyft AI deal-capture. Listens to meetings, extracts pipeline-relevant
// fields (next step, decision criteria, competitor mentioned, etc.) and
// writes them back to Salesforce. Feeds canonical Meeting + Deal.

export const SWYFTAI_OBJECTS: readonly RawObject[] = [
  {
    source: "Swyft AI",
    object: "CapturedCall",
    fields: [
      { key: "id", type: "string", description: "Captured-call identifier" },
      { key: "external_call_id", type: "string", description: "Source call ID (Gong/Zoom/Meet)" },
      { key: "source_provider", type: "enum", description: "Where the call came from", enumValues: ["gong", "zoom", "google_meet", "microsoft_teams", "chorus"] },
      { key: "salesforce_opportunity_id", type: "string", description: "Linked SF Opportunity" },
      { key: "salesforce_account_id", type: "string", description: "Linked SF Account" },
      { key: "rep_user_id", type: "string", description: "Rep on the call" },
      { key: "call_start_at", type: "date", description: "Call start time" },
      { key: "call_duration_seconds", type: "int", unit: "seconds", description: "Call length" },
      { key: "summary", type: "text", description: "AI-generated meeting summary" },
      { key: "key_topics", type: "text", description: "AI-extracted topic list" },
      { key: "next_steps", type: "text", description: "Action items extracted" },
      { key: "decision_criteria", type: "text", description: "MEDDPICC: decision criteria mentioned" },
      { key: "decision_process", type: "text", description: "MEDDPICC: decision process" },
      { key: "economic_buyer", type: "string", description: "MEDDPICC: economic buyer named" },
      { key: "metrics", type: "text", description: "MEDDPICC: measurable metrics discussed" },
      { key: "pain_points", type: "text", description: "Pain points raised" },
      { key: "competitors_mentioned", type: "text", description: "Competitor names mentioned" },
      { key: "objections", type: "text", description: "Objections raised by buyer" },
      { key: "champion_signals", type: "text", description: "Champion behavior detected" },
      { key: "confidence_score", type: "float", unit: "0-1", description: "Extraction confidence" },
      { key: "salesforce_writeback_status", type: "enum", description: "Whether captured fields were written back to Salesforce", enumValues: ["pending", "applied", "rejected", "manual_review"] },
      { key: "reviewed_by_user_id", type: "string", description: "Rep who reviewed the capture" },
      { key: "reviewed_at", type: "date", description: "Review timestamp" },
    ],
  },
];
