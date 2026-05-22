"use server";

import { accounts } from "@/data/seed";
import { fetchSignalsForCompany } from "@/lib/news-adapter";
import { insertSignalsDedup } from "@/lib/external-signals";

// Server action for the Settings → Refresh button. Calls the same
// ingestion path as the cron route but stays server-side, so the
// CRON_SECRET never leaves the server and the UI doesn't need to
// hold any credential. One call per account; the form fans out in
// parallel from the browser to keep each call under the 60s cap.

export interface RefreshAccountResult {
  accountId: string;
  companyName: string;
  status: "success" | "error";
  inserted?: number;
  skipped?: number;
  error?: string;
  durationMs: number;
}

export async function refreshAccountSignals(
  accountId: string,
): Promise<RefreshAccountResult> {
  const t0 = Date.now();
  const account = accounts.find((a) => a.id === accountId && a.trackable);
  if (!account) {
    return {
      accountId,
      companyName: accountId,
      status: "error",
      error: "Unknown or non-trackable account",
      durationMs: Date.now() - t0,
    };
  }
  try {
    const { signals } = await fetchSignalsForCompany(
      account.id,
      account.name,
      account.industry,
    );
    const { inserted, skipped } = await insertSignalsDedup(signals);
    return {
      accountId: account.id,
      companyName: account.name,
      status: "success",
      inserted,
      skipped,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      accountId: account.id,
      companyName: account.name,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - t0,
    };
  }
}
