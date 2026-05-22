import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard Tailwind class-name helper. Lets us conditionally join class strings.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Fixed "today" so stage-age math is deterministic across demo runs.
// In production this would be `new Date()` — fixed here so the seed data
// always reflects the same signal state for the demo.
export const TODAY = new Date("2026-05-21T09:00:00Z");

export function daysBetween(iso: string, from: Date = TODAY): number {
  const then = new Date(iso);
  const ms = from.getTime() - then.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Lookup a record by id, throwing a useful error if it's missing. Replaces the
// `list.find(...)!` pattern in joins — a typo in the id field now produces a
// named error at the point of failure instead of a downstream `Cannot read
// property of undefined`. Throws are fine here: every call site is a join
// against in-process seed data where a missing id is a programming error,
// not a runtime condition.
export function lookupBy<T extends { id: string }>(
  list: readonly T[],
  id: string,
  label: string,
): T {
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`${label} not found: ${id}`);
  return found;
}
