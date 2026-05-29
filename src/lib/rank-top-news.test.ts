// Tests for rankTopWorkspaceNews — the "Top news of the week" ranker. The bug
// it fixes: one newsletter digest emitting several signals monopolizing the
// feed. So the key guarantees are the per-publisher cap and relevance ranking.

import { describe, expect, test } from "vitest";
import { rankTopWorkspaceNews } from "./external-signals";
import type { ExternalSignal } from "./external-signals";

function sig(
  id: string,
  publisher: string,
  relevance: ExternalSignal["workspace_relevance"],
  occurredAt = "2026-05-26T00:00:00Z",
): ExternalSignal {
  return {
    id,
    account_id: "__workspace__",
    source: "newsletter",
    type: "other",
    summary: id,
    occurred_at: occurredAt,
    is_demo: false,
    publisher_canonical_name: publisher,
    workspace_relevance: relevance,
    created_at: occurredAt,
  } as ExternalSignal;
}

describe("rankTopWorkspaceNews", () => {
  test("caps how many items a single publisher contributes", () => {
    // 4 PharmExec + 1 each from two others; ask for 4. The cap (2) binds
    // because the other publishers can fill the remaining slots.
    const pool = [
      sig("p1", "PharmExec", "medium"),
      sig("p2", "PharmExec", "medium"),
      sig("p3", "PharmExec", "medium"),
      sig("p4", "PharmExec", "medium"),
      sig("r1", "Reuters", "medium"),
      sig("t1", "TechCrunch", "medium"),
    ];
    const top = rankTopWorkspaceNews(pool, 4, 2);
    const pharmExec = top.filter(
      (s) => s.publisher_canonical_name === "PharmExec",
    );
    expect(pharmExec.length).toBeLessThanOrEqual(2);
    // The other publishers make the cut instead of more PharmExec.
    expect(top.map((s) => s.publisher_canonical_name)).toContain("Reuters");
    expect(top.map((s) => s.publisher_canonical_name)).toContain("TechCrunch");
  });

  test("higher workspace_relevance ranks first", () => {
    const pool = [
      sig("low", "A", "low"),
      sig("high", "B", "high"),
      sig("med", "C", "medium"),
    ];
    const top = rankTopWorkspaceNews(pool, 3, 2);
    expect(top[0].id).toBe("high");
    expect(top[2].id).toBe("low");
  });

  test("backfills past the cap when there aren't enough publishers", () => {
    const pool = [
      sig("p1", "PharmExec", "medium"),
      sig("p2", "PharmExec", "medium"),
      sig("p3", "PharmExec", "medium"),
    ];
    // Only one publisher; cap is 2, but we still need 3 → backfill ignores cap.
    const top = rankTopWorkspaceNews(pool, 3, 2);
    expect(top).toHaveLength(3);
  });
});
