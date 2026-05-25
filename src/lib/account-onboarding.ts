import type {
  Account,
  AccountId,
  AccountSegment,
  Activity,
  ActivityType,
  Contact,
  ContactRole,
  Industry,
  Opportunity,
  Stage,
} from "./types";
import { generateAccountId } from "./account-id";

// One-call onboarding for a new customer. Input is the minimal facts a sales
// engineer would know about an account; output is a fully-typed bundle of
// seed entries ready to drop into the matching arrays in src/data/seed.ts.
//
// Adding a new customer becomes a single createAccountSeed({...}) entry
// instead of four hand-synced array additions (accounts + opportunities +
// contacts + activities) where forgetting one breaks the demo silently.
//
// Two behaviors worth knowing:
//   1. `idOverride` lets you preserve hand-coded short IDs like `acc_adi`
//      so existing accounts can migrate to the helper without changing
//      their primary key (which would cascade to signals, scripts, docs).
//      For brand-new customers, omit it and the helper derives an id from
//      the company name via `generateAccountId`.
//   2. Contact ids and activity ids are derived from the account slug so
//      they're predictable: `c_<slug>_<index>`, `a_<slug>_<index>`.

export interface NewClientInput {
  // --- Account facts ---
  name: string;
  industry: Industry;
  segment: AccountSegment;
  hqLocation: string;
  legalTeamSize: number;
  /** Optional. When set, used as `Account.id` verbatim. When omitted, the
   *  helper derives `acc_<slug>` from `name` via `generateAccountId`. */
  idOverride?: AccountId;
  domain?: string;
  website?: string;
  linkedinSlug?: string;
  ticker?: string;
  /** Defaults false. Flip true for the rigged metric-scenario accounts. */
  isDemoScenario?: boolean;

  // --- Opportunity facts ---
  oppName: string;
  /** Rep.id of the owning AE (e.g. "rep_sc"). */
  ownerId: string;
  stage: Stage;
  /** ACV in USD (whole dollars). */
  amount: number;
  /** ISO date when the opp entered its current stage. */
  enteredStageAt: string;
  /** ISO date when the opp was created. */
  createdAt: string;
  /** ISO date the AE expects to close. */
  closeDate: string;

  // --- Contacts ---
  /** Required. The first contact is always the Champion role. */
  champion: { name: string; title: string };
  /** Optional. Additional contacts beyond the Champion. */
  additionalContacts?: Array<{
    name: string;
    title: string;
    role: ContactRole;
  }>;

  // --- Activities ---
  /** Optional. Seeds recent activity so the pipeline reads as live and the
   *  stage-age signals stay sane. Each activity gets an id derived from
   *  the account slug. */
  activities?: Array<{
    /** Defaults to the champion's id. */
    contactId?: string;
    type: ActivityType;
    /** ISO date. */
    occurredAt: string;
    summary: string;
  }>;
}

export interface AccountSeedBundle {
  account: Account;
  opportunity: Opportunity;
  contacts: Contact[];
  activities: Activity[];
}

export function createAccountSeed(input: NewClientInput): AccountSeedBundle {
  const accountId: AccountId = input.idOverride ?? generateAccountId(input.name);
  const slug = accountId.replace(/^acc_/, "");
  const oppId = `opp_${slug}`;
  const championId = `c_${slug}_1`;

  const account: Account = {
    id: accountId,
    name: input.name,
    industry: input.industry,
    segment: input.segment,
    hqLocation: input.hqLocation,
    legalTeamSize: input.legalTeamSize,
    trackable: true,
    domain: input.domain,
    website: input.website ?? input.domain,
    linkedinSlug: input.linkedinSlug,
    ticker: input.ticker,
    isDemoScenario: input.isDemoScenario ?? false,
  };

  const champion: Contact = {
    id: championId,
    accountId,
    name: input.champion.name,
    title: input.champion.title,
    role: "Champion",
  };

  const additionalContacts: Contact[] = (input.additionalContacts ?? []).map(
    (c, i) => ({
      id: `c_${slug}_${i + 2}`,
      accountId,
      name: c.name,
      title: c.title,
      role: c.role,
    }),
  );

  const allContacts = [champion, ...additionalContacts];

  const opportunity: Opportunity = {
    id: oppId,
    accountId,
    name: input.oppName,
    ownerId: input.ownerId,
    stage: input.stage,
    amount: input.amount,
    enteredStageAt: input.enteredStageAt,
    createdAt: input.createdAt,
    closeDate: input.closeDate,
    contactRoleIds: allContacts.map((c) => c.id),
  };

  const activities: Activity[] = (input.activities ?? []).map((a, i) => ({
    id: `a_${slug}_${i + 1}`,
    oppId,
    contactId: a.contactId ?? championId,
    type: a.type,
    occurredAt: a.occurredAt,
    summary: a.summary,
  }));

  return { account, opportunity, contacts: allContacts, activities };
}
