// Playbooks - multi-phase workflows attached to specific signals. A signal
// tells you what's happening; a playbook tells you what to do, in order, with
// the decision points named explicitly.
//
// V1 ships with one playbook (champion departure). The framework supports
// more - the structure is intentionally generic so additions don't require
// any UI changes, only content.

export interface PlaybookStep {
  text: string;
  // Optional "if X" condition - when present, rendered as a decision point
  branch?: string;
}

export interface PlaybookBranch {
  // The condition that selects this branch (e.g., "Lower risk")
  label: string;
  description: string;
  steps: string[];
}

export interface PlaybookPhase {
  name: string;
  timeframe: string;
  summary: string;
  steps?: string[];
  branches?: PlaybookBranch[];
}

export interface Playbook {
  id: string;
  title: string;
  context: string;
  phases: PlaybookPhase[];
}

export const playbooks: Record<string, Playbook> = {
  "champion-departure": {
    id: "champion-departure",
    title: "Champion Departure Playbook",
    context:
      "Champion departure is the top predictor of deal loss at this stage. The next 14 days determine whether the deal survives - too aggressive and you spook the new contact, too slow and the deal goes dark.",
    phases: [
      {
        name: "Phase 1 - Confirm and Assess",
        timeframe: "Day 0–2",
        summary:
          "Before you reach out, gather the picture. Half the playbook is choosing the right next phase.",
        steps: [
          "Verify the departure via LinkedIn (cross-check with per-user CRM activity - has their account stopped logging in?).",
          "Pull the account health snapshot - engagement trend, who else is active, how the deal stacked rank.",
          "Identify the next-best contact on the OCR - Legal Ops or GC usually has the most context.",
          "Classify risk: lower risk (multiple active users, healthy signals, 6+ months to renewal) vs higher risk (single-threaded, existing friction, close within 90 days).",
        ],
      },
      {
        name: "Phase 2 - Branch on risk",
        timeframe: "Day 2–14",
        summary:
          "Lower-risk deals get a Rebuild motion. Higher-risk deals need the Save Play immediately. Same calendar; different urgency, different stakeholders, different tone.",
        branches: [
          {
            label: "2A - Rebuild (lower risk)",
            description:
              "Deal has multiple active stakeholders, healthy signals, and time. Reset the relationship without spooking the team.",
            steps: [
              "Reach out to the next-best contact within 48 hours - short, warm, no ask.",
              "Offer a 30-min re-onboarding session for the new account owner - frame as service, not sales.",
              "Establish a new check-in cadence (every 2 weeks for the first 60 days).",
              "Monitor usage data daily for the first 30 days - silent decline is the signal a Rebuild has failed.",
            ],
          },
          {
            label: "2B - Save Play (higher risk)",
            description:
              "Deal is single-threaded or close is imminent. Time to escalate executive-to-executive before the new contact has time to question the project.",
            steps: [
              "Escalate internally to the SVP or CEO - depending on account size, decide who makes the executive outreach.",
              "Direct executive-to-executive outreach to the economic buyer (not the new IC contact yet).",
              "Prepare a one-page value recap with concrete metrics: matters completed, time saved, accept rate.",
              "Pre-authorize a concession if needed (extended trial, additional training, pricing flex) so we don't lose days going back for approval.",
            ],
          },
        ],
      },
      {
        name: "Phase 3 - Follow the departed champion",
        timeframe: "Day 14–30",
        summary:
          "The champion who left didn't stop being a buyer - they just moved. If their new company fits ICP, this is the warmest possible lead.",
        steps: [
          "Reach out at their new company once they've had 2-3 weeks to settle in.",
          "Check ICP fit - industry, segment, in-house legal team size. If it's a fit, route to the AE for that territory with full context.",
          "If their new company is already a customer, route to CS for an expansion conversation.",
          "Log the journey in the CRM - champion-tracking compounds over years.",
        ],
      },
    ],
  },
};
