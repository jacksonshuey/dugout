// Shared types for the raw fields catalog. Each source system exports a
// `readonly RawObject[]` describing its documented API surface. The graph
// + mapping layers consume the aggregated catalog from index.ts.
//
// Why a flat raw catalog (not converted straight into canonical objects):
// the catalog is ground truth from documented API specs. Joins, aliasing,
// and consolidation happen in object-mappings.ts so the catalog never has
// to lie about what an integration actually exposes.

import type { FieldType } from "@/data/ontology-schema";

export interface RawField {
  key: string;
  type: FieldType;
  unit?: string;
  description: string;
  enumValues?: readonly string[];
}

export interface RawObject {
  // Source system name as displayed (matches the source labels in
  // ontology-schema.ts so the graph can join them).
  source: string;
  // API object/endpoint name (Opportunity, Account, Call, etc.).
  object: string;
  // Optional sub-grouping for sources that organize fields by item code
  // or sub-endpoint (e.g., SEC EDGAR 8-K Items).
  group?: string;
  fields: readonly RawField[];
}
