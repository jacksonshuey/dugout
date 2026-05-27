import type { RawObject } from "./types";

// Dock Labs (deal room) objects. Tracks the workspace each AE shares
// with a prospect, the assets inside, and per-visitor engagement.
//
// Feeds canonical Activity (workspace activity log) and a new
// AssetDelivery-like sub-concept that lives in seed today.

export const DOCK_OBJECTS: readonly RawObject[] = [
  {
    source: "Dock",
    object: "Workspace",
    fields: [
      { key: "id", type: "string", description: "Workspace identifier" },
      { key: "name", type: "string", description: "Workspace display name" },
      { key: "url", type: "string", description: "Shareable workspace URL" },
      { key: "owner_user_id", type: "string", description: "AE who owns the workspace" },
      { key: "template_id", type: "string", description: "Template the workspace was built from" },
      { key: "status", type: "enum", description: "Workspace lifecycle status", enumValues: ["draft", "published", "archived"] },
      { key: "created_at", type: "date", description: "Creation timestamp" },
      { key: "published_at", type: "date", description: "First shared timestamp" },
      { key: "salesforce_opportunity_id", type: "string", description: "Associated Salesforce Opportunity" },
      { key: "salesforce_account_id", type: "string", description: "Associated Salesforce Account" },
      { key: "asset_count", type: "int", unit: "count", description: "Total assets in the workspace" },
      { key: "section_count", type: "int", unit: "count", description: "Total sections" },
      { key: "visit_count", type: "int", unit: "count", description: "Total recorded visits" },
      { key: "unique_visitor_count", type: "int", unit: "count", description: "Unique visitors" },
      { key: "last_visited_at", type: "date", description: "Most recent visit" },
    ],
  },
  {
    source: "Dock",
    object: "Asset",
    fields: [
      { key: "id", type: "string", description: "Asset identifier" },
      { key: "workspace_id", type: "string", description: "Parent workspace" },
      { key: "section_id", type: "string", description: "Parent section" },
      { key: "title", type: "string", description: "Asset title" },
      { key: "asset_type", type: "enum", description: "Asset kind", enumValues: ["pdf", "video", "deck", "doc", "link", "image", "embed", "mutual_action_plan", "pricing", "case_study"] },
      { key: "url", type: "string", description: "Underlying asset URL" },
      { key: "view_count", type: "int", unit: "count", description: "Total views" },
      { key: "unique_view_count", type: "int", unit: "count", description: "Unique viewer count" },
      { key: "average_view_duration_seconds", type: "int", unit: "seconds", description: "Average viewing time" },
      { key: "added_at", type: "date", description: "When the asset was added to the workspace" },
      { key: "last_viewed_at", type: "date", description: "Most recent view" },
    ],
  },
  {
    source: "Dock",
    object: "Visit",
    fields: [
      { key: "id", type: "string", description: "Visit identifier" },
      { key: "workspace_id", type: "string", description: "Workspace visited" },
      { key: "visitor_email", type: "string", description: "Visitor email (when identified)" },
      { key: "visitor_company", type: "string", description: "Inferred company" },
      { key: "started_at", type: "date", description: "Session start" },
      { key: "ended_at", type: "date", description: "Session end" },
      { key: "duration_seconds", type: "int", unit: "seconds", description: "Session length" },
      { key: "section_views", type: "int", unit: "count", description: "Sections viewed in session" },
      { key: "is_internal", type: "bool", description: "True if visitor is on the seller's side" },
      { key: "country", type: "string", description: "Visitor country" },
      { key: "device_type", type: "enum", description: "Device", enumValues: ["desktop", "mobile", "tablet"] },
    ],
  },
];
