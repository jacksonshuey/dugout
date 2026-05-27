// Aggregated registry of integration setup specs. Read by the
// Integrations tab to drive the connect-popup catalog.

import type { IntegrationSpec } from "./types";
export type {
  IntegrationSpec,
  SetupField,
  SetupFieldType,
  AuthMethod,
  SyncModel,
  WebhookEvent,
} from "./types";

import { SALESFORCE_SPEC } from "./salesforce";
import { HUBSPOT_SPEC } from "./hubspot";
import { OUTREACH_SPEC } from "./outreach";
import { GONG_SPEC } from "./gong";
import { NOOKS_SPEC } from "./nooks";
import { CHILIPIPER_SPEC } from "./chilipiper";
import { SWYFTAI_SPEC } from "./swyftai";
import { APOLLO_SPEC } from "./apollo";
import { ZOOMINFO_SPEC } from "./zoominfo";
import { DOCK_SPEC } from "./dock";
import { ZENDESK_SPEC } from "./zendesk";
import { XERO_SPEC } from "./xero";
import { WEBFLOW_SPEC } from "./webflow";
import { EDGAR_SPEC } from "./edgar";
import { NEWSAPI_SPEC } from "./newsapi";
import { SLACK_SPEC } from "./slack";
import { CALENDLY_SPEC } from "./calendly";

// Reads come first (sources Dugout pulls FROM), then writes (Dugout's
// outbound surface). Within reads, order matches raw-fields/index.ts
// so the graph + connect grid render in the same sequence.
export const INTEGRATION_SPECS: readonly IntegrationSpec[] = [
  // Reads
  SALESFORCE_SPEC,
  HUBSPOT_SPEC,
  OUTREACH_SPEC,
  GONG_SPEC,
  NOOKS_SPEC,
  CHILIPIPER_SPEC,
  SWYFTAI_SPEC,
  APOLLO_SPEC,
  ZOOMINFO_SPEC,
  DOCK_SPEC,
  ZENDESK_SPEC,
  XERO_SPEC,
  WEBFLOW_SPEC,
  EDGAR_SPEC,
  NEWSAPI_SPEC,
  // Writes
  SLACK_SPEC,
  CALENDLY_SPEC,
];

export function getSpec(source: string): IntegrationSpec | undefined {
  return INTEGRATION_SPECS.find((s) => s.source === source);
}
