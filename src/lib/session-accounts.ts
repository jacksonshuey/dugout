// Client-side session-scoped storage for accounts a demo visitor adds
// via /onboard. Lives in localStorage so it survives page reloads in the
// same browser; closing the tab + waiting out the visit doesn't persist
// past their next clear. Demo-only — production onboarding goes through
// the Supabase `accounts` table (see migrations/20260524_accounts_table.sql).

const STORAGE_KEY = "dugout-session-accounts-v1";

export interface SessionAccount {
  id: string; // provisionalId from ExternalMatch
  name: string;
  domain: string;
  logoUrl: string;
  addedAt: string; // ISO timestamp
}

export function readSessionAccounts(): SessionAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSessionAccount);
  } catch {
    return [];
  }
}

export function addSessionAccount(
  candidate: Omit<SessionAccount, "addedAt">,
): SessionAccount[] {
  const list = readSessionAccounts();
  if (list.some((a) => a.id === candidate.id)) return list;
  const next: SessionAccount[] = [
    ...list,
    { ...candidate, addedAt: new Date().toISOString() },
  ];
  writeSessionAccounts(next);
  return next;
}

export function removeSessionAccount(id: string): SessionAccount[] {
  const list = readSessionAccounts();
  const next = list.filter((a) => a.id !== id);
  writeSessionAccounts(next);
  return next;
}

export function clearSessionAccounts(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage can throw in private-browsing modes; swallow.
  }
}

function writeSessionAccounts(list: SessionAccount[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    // localStorage's `storage` event only fires across tabs; dispatch a
    // custom event so the current tab's useSyncExternalStore subscribers
    // re-read after add/remove/clear.
    window.dispatchEvent(new Event(SESSION_ACCOUNTS_EVENT));
  } catch {
    // Private browsing or quota; swallow.
  }
}

export const SESSION_ACCOUNTS_EVENT = "dugout:session-accounts-changed";

/** Subscribe helper for `useSyncExternalStore`. Listens for cross-tab
 *  `storage` events AND same-tab custom dispatches from the writers. */
export function subscribeSessionAccounts(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(SESSION_ACCOUNTS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SESSION_ACCOUNTS_EVENT, callback);
  };
}

/** Snapshot string used by `useSyncExternalStore`. Returning the raw
 *  localStorage string (not the parsed array) keeps reference equality
 *  stable across reads when nothing changed. */
export function getSessionAccountsSnapshot(): string {
  if (typeof window === "undefined") return "[]";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

export function getSessionAccountsServerSnapshot(): string {
  return "[]";
}

function isSessionAccount(value: unknown): value is SessionAccount {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.domain === "string" &&
    typeof v.logoUrl === "string" &&
    typeof v.addedAt === "string"
  );
}
