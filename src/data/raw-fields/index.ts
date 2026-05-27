import type { RawObject } from "./types";
import { SALESFORCE_OBJECTS } from "./salesforce";
import { GONG_OBJECTS } from "./gong";
import { OUTREACH_OBJECTS } from "./outreach";
import { APOLLO_OBJECTS } from "./apollo";
import { EDGAR_OBJECTS } from "./edgar";
import { NEWSAPI_OBJECTS } from "./newsapi";
import { HUBSPOT_OBJECTS } from "./hubspot";
import { ZOOMINFO_OBJECTS } from "./zoominfo";
import { CHILIPIPER_OBJECTS } from "./chilipiper";
import { DOCK_OBJECTS } from "./dock";
import { NOOKS_OBJECTS } from "./nooks";
import { SWYFTAI_OBJECTS } from "./swyftai";
import { ZENDESK_OBJECTS } from "./zendesk";
import { WEBFLOW_OBJECTS } from "./webflow";
import { XERO_OBJECTS } from "./xero";

export type { RawField, RawObject } from "./types";
export {
  SALESFORCE_OBJECTS,
  GONG_OBJECTS,
  OUTREACH_OBJECTS,
  APOLLO_OBJECTS,
  EDGAR_OBJECTS,
  NEWSAPI_OBJECTS,
  HUBSPOT_OBJECTS,
  ZOOMINFO_OBJECTS,
  CHILIPIPER_OBJECTS,
  DOCK_OBJECTS,
  NOOKS_OBJECTS,
  SWYFTAI_OBJECTS,
  ZENDESK_OBJECTS,
  WEBFLOW_OBJECTS,
  XERO_OBJECTS,
};

// Aggregated catalog. Source ordering is the canonical left-column order
// for the connectivity graph. Grouping logic:
//   CRM & sales engagement first (Salesforce, HubSpot, Outreach, Gong,
//   Nooks, Chili Piper, Swyft AI) — closest to the deal record.
//   Enrichment next (Apollo, ZoomInfo).
//   Deal-room + CS + commercial (Dock, Zendesk, Xero).
//   Marketing / external (Webflow, SEC EDGAR, NewsAPI).
export const RAW_FIELDS_CATALOG: readonly RawObject[] = [
  ...SALESFORCE_OBJECTS,
  ...HUBSPOT_OBJECTS,
  ...OUTREACH_OBJECTS,
  ...GONG_OBJECTS,
  ...NOOKS_OBJECTS,
  ...CHILIPIPER_OBJECTS,
  ...SWYFTAI_OBJECTS,
  ...APOLLO_OBJECTS,
  ...ZOOMINFO_OBJECTS,
  ...DOCK_OBJECTS,
  ...ZENDESK_OBJECTS,
  ...XERO_OBJECTS,
  ...WEBFLOW_OBJECTS,
  ...EDGAR_OBJECTS,
  ...NEWSAPI_OBJECTS,
];

export function getRawObjectsBySource(source: string): RawObject[] {
  return RAW_FIELDS_CATALOG.filter((o) => o.source === source);
}

export function getUniqueSources(): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const o of RAW_FIELDS_CATALOG) {
    if (!seen.has(o.source)) {
      seen.add(o.source);
      order.push(o.source);
    }
  }
  return order;
}

export function totalRawFieldCount(): number {
  let n = 0;
  for (const o of RAW_FIELDS_CATALOG) n += o.fields.length;
  return n;
}
