import type { BrandKey } from "@/components/landing/logos";
import {
  INTEGRATIONS,
  type AuthMethod,
  type DataDirection,
  type IntegrationSpec,
  type IntegrationStatus,
} from "@/data/integrations";
import type { Account } from "../types";

// Prebuilt adapter scaffolds — one per integration in the registry. Every
// integration plugs in the same way (paste a key / OAuth, set a sync
// frequency, verify) and emits RAW ROWS that the zipper reconciles onto the
// canonical ontology. That uniform shape is the whole promise on the landing
// page ("every integration comes prebuilt").
//
// Each scaffold declares its auth, sync frequency, and the raw object types it
// pulls. The actual network code is the only thing left to fill in: verify()
// and fetch() default to a `not_implemented` result (fail-soft, never throw),
// so the registry is complete and callable today and each provider can be
// turned real one fetch() at a time without touching the interface, the
// zipper, or the UI.

// A single raw record as pulled from a provider, pre-zipper. `data` is the
// provider's native payload; the zipper maps it onto canonical objects.
export interface RawRow {
  brand: BrandKey;
  objectType: string;
  externalId: string;
  accountId: string;
  fetchedAt: string;
  data: Record<string, unknown>;
}

export type SyncFrequency = "realtime" | "hourly" | "daily";

export interface SyncConfig {
  frequency: SyncFrequency;
  // The provider object types this adapter pulls (its raw-row vocabulary).
  objectTypes: string[];
}

export interface AdapterCredentials {
  apiKey?: string;
  oauthToken?: string;
}

export interface AdapterContext {
  account: Account;
  credentials?: AdapterCredentials;
  // Incremental-sync watermark; adapters pull rows changed since this.
  since?: string | null;
}

export type VerifyResult = { ok: boolean; note: string };

export type FetchResult =
  | { status: "ok"; rows: RawRow[] }
  | { status: "not_implemented"; brand: BrandKey; note: string }
  | { status: "not_connected"; brand: BrandKey; note: string }
  | { status: "error"; brand: BrandKey; error: string };

export interface IntegrationAdapter {
  brand: BrandKey;
  role: string;
  status: IntegrationStatus;
  auth: AuthMethod;
  direction: DataDirection;
  sync: SyncConfig;
  // Confirm credentials reach the provider (the "verify" step in setup).
  verify(credentials: AdapterCredentials): Promise<VerifyResult>;
  // Pull raw rows for one account. Scaffolds return not_implemented until the
  // provider's API code is filled in.
  fetch(ctx: AdapterContext): Promise<FetchResult>;
}

// Per-brand raw object vocabulary + sync cadence. This is the part that's
// genuinely provider-specific; filling in fetch() later just means returning
// these object types as RawRows. Outbound/delivery brands (Slack) pull
// nothing — they're a destination, not a source.
const BRAND_SPECS: Partial<
  Record<BrandKey, { objectTypes: string[]; frequency: SyncFrequency }>
> = {
  salesforce: {
    objectTypes: ["Account", "Opportunity", "Contact", "Task", "Event"],
    frequency: "hourly",
  },
  hubspot: {
    objectTypes: ["Company", "Deal", "Contact", "Engagement"],
    frequency: "hourly",
  },
  gong: {
    objectTypes: ["Call", "CallTranscript", "CallStats"],
    frequency: "hourly",
  },
  outreach: {
    objectTypes: ["Prospect", "Sequence", "Mailing", "Call"],
    frequency: "hourly",
  },
  dock: {
    objectTypes: ["Workspace", "AssetView", "Stakeholder"],
    frequency: "daily",
  },
  chilipiper: {
    objectTypes: ["Meeting", "Route", "Assignment"],
    frequency: "hourly",
  },
  zoominfo: {
    objectTypes: ["Company", "Contact", "IntentSignal"],
    frequency: "daily",
  },
  nooks: {
    objectTypes: ["Call", "Dial", "Disposition"],
    frequency: "hourly",
  },
  swyftai: {
    objectTypes: ["Deal", "MeddpiccField", "CallNote"],
    frequency: "hourly",
  },
  xero: {
    objectTypes: ["Invoice", "Payment", "Contact"],
    frequency: "daily",
  },
  zendesk: {
    objectTypes: ["Ticket", "User", "SatisfactionRating"],
    frequency: "hourly",
  },
  webflow: {
    objectTypes: ["FormSubmission", "Lead"],
    frequency: "realtime",
  },
  granola: {
    objectTypes: ["Meeting", "Transcript"],
    frequency: "hourly",
  },
  slack: {
    objectTypes: [],
    frequency: "realtime",
  },
};

function specFor(spec: IntegrationSpec): {
  objectTypes: string[];
  frequency: SyncFrequency;
} {
  const known = BRAND_SPECS[spec.brand];
  if (known) return known;
  // Sensible default for any brand added to INTEGRATIONS without a spec:
  // outbound/delivery brands pull nothing, everything else syncs daily.
  return {
    objectTypes: [],
    frequency: spec.direction === "outbound" ? "realtime" : "daily",
  };
}

// Build a uniform scaffold from a registry entry. verify()/fetch() are the
// only stubs — everything else is real config the zipper + setup UI can use
// today.
export function createScaffold(spec: IntegrationSpec): IntegrationAdapter {
  const { objectTypes, frequency } = specFor(spec);
  return {
    brand: spec.brand,
    role: spec.role,
    status: spec.status,
    auth: spec.auth,
    direction: spec.direction,
    sync: { frequency, objectTypes },
    async verify() {
      return {
        ok: false,
        note: `${spec.brand} adapter is scaffolded but not yet connected.`,
      };
    },
    async fetch() {
      return {
        status: "not_implemented",
        brand: spec.brand,
        note:
          spec.direction === "outbound"
            ? `${spec.brand} is a delivery destination — no rows to pull.`
            : `${spec.brand}: scaffold ready — implement fetch() to emit ${
                objectTypes.join(", ") || "rows"
              } to the zipper.`,
      };
    },
  };
}

// The registry: one adapter per integration, derived from INTEGRATIONS so
// coverage is automatic — adding a row there gives it a scaffold for free.
export const INTEGRATION_ADAPTERS: Record<string, IntegrationAdapter> =
  Object.fromEntries(INTEGRATIONS.map((s) => [s.brand, createScaffold(s)]));

export function getIntegrationAdapter(
  brand: BrandKey,
): IntegrationAdapter | null {
  return INTEGRATION_ADAPTERS[brand] ?? null;
}

export function listIntegrationAdapters(): IntegrationAdapter[] {
  return Object.values(INTEGRATION_ADAPTERS);
}
