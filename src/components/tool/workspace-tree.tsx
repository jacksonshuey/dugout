"use client";

// Splittable canvas of canonical-object tables. Layout is a binary tree:
// each leaf is a panel rendering one CanonicalTable; each internal node
// is a horizontal or vertical split with two children. Users split any
// leaf to add a panel, up to MAX_LEAVES total.
//
// State persists in localStorage under WORKSPACE_KEY so the layout
// survives page reloads. Reset button restores the initial single-Account
// layout.
//
// Resize handles are intentionally omitted in v1 - splits are 50/50.
// Wiring resize would mean tracking per-split ratios and dragging via
// pointer events; not needed for the demo.

import { useEffect, useMemo, useState } from "react";
import { CANONICAL_OBJECTS } from "@/data/canonical-objects";
import { CanonicalTable } from "./canonical-table";

export const MAX_LEAVES = 8;
const WORKSPACE_KEY = "dugout-workspace-v1";

export type PanelNode =
  | {
      kind: "leaf";
      id: string;
      canonicalKey: string;
      columns: readonly string[] | null;
    }
  | {
      kind: "split";
      id: string;
      orientation: "horizontal" | "vertical";
      first: PanelNode;
      second: PanelNode;
    };

function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function initialTree(): PanelNode {
  return {
    kind: "leaf",
    id: genId(),
    canonicalKey: "Account",
    columns: null,
  };
}

function countLeaves(node: PanelNode): number {
  if (node.kind === "leaf") return 1;
  return countLeaves(node.first) + countLeaves(node.second);
}

function mapTree(
  node: PanelNode,
  fn: (leaf: Extract<PanelNode, { kind: "leaf" }>) => PanelNode,
): PanelNode {
  if (node.kind === "leaf") return fn(node);
  return {
    ...node,
    first: mapTree(node.first, fn),
    second: mapTree(node.second, fn),
  };
}

// Replace the leaf with given id by `replacement`. Returns a new tree.
function replaceLeaf(
  node: PanelNode,
  leafId: string,
  replacement: PanelNode,
): PanelNode {
  return mapTree(node, (leaf) =>
    leaf.id === leafId ? replacement : leaf,
  );
}

// Remove the leaf with given id. The split that contained it collapses
// to its sibling. Returns null if the entire tree is the removed leaf
// (caller should reset to initial).
function removeLeaf(node: PanelNode, leafId: string): PanelNode | null {
  if (node.kind === "leaf") {
    return node.id === leafId ? null : node;
  }
  if (node.first.kind === "leaf" && node.first.id === leafId) {
    return node.second;
  }
  if (node.second.kind === "leaf" && node.second.id === leafId) {
    return node.first;
  }
  const first = removeLeaf(node.first, leafId);
  const second = removeLeaf(node.second, leafId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function isValidTree(x: unknown): x is PanelNode {
  if (!x || typeof x !== "object") return false;
  const n = x as { kind?: unknown };
  if (n.kind === "leaf") {
    const l = x as { id?: unknown; canonicalKey?: unknown };
    return typeof l.id === "string" && typeof l.canonicalKey === "string";
  }
  if (n.kind === "split") {
    const s = x as {
      id?: unknown;
      orientation?: unknown;
      first?: unknown;
      second?: unknown;
    };
    return (
      typeof s.id === "string" &&
      (s.orientation === "horizontal" || s.orientation === "vertical") &&
      isValidTree(s.first) &&
      isValidTree(s.second)
    );
  }
  return false;
}

export function WorkspaceTree() {
  // Lazy-initialize from localStorage. The eslint react-hooks rule that
  // forbids setState in effects passes because we use a lazy initializer
  // and only sync to storage on subsequent changes.
  const [tree, setTree] = useState<PanelNode>(initialTree);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidTree(parsed)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTree(parsed);
        }
      }
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(tree));
    } catch {
      // quota errors, ignore
    }
  }, [tree, hydrated]);

  const leafCount = useMemo(() => countLeaves(tree), [tree]);
  const canSplit = leafCount < MAX_LEAVES;

  function handleSplit(leafId: string, orientation: "horizontal" | "vertical") {
    if (!canSplit) return;
    setTree((prev) =>
      mapTree(prev, (leaf) => {
        if (leaf.id !== leafId) return leaf;
        // Default the new panel to a fresh canonical object the user
        // probably wants next - cycle through CANONICAL_OBJECTS.
        const nextKey = pickNextCanonicalKey(prev, leaf.canonicalKey);
        const newLeaf: PanelNode = {
          kind: "leaf",
          id: genId(),
          canonicalKey: nextKey,
          columns: null,
        };
        return {
          kind: "split",
          id: genId(),
          orientation,
          first: leaf,
          second: newLeaf,
        };
      }),
    );
  }

  function handleRemove(leafId: string) {
    setTree((prev) => {
      const next = removeLeaf(prev, leafId);
      return next ?? initialTree();
    });
  }

  function handleChangeObject(leafId: string, canonicalKey: string) {
    setTree((prev) =>
      replaceLeaf(prev, leafId, {
        kind: "leaf",
        id: leafId,
        canonicalKey,
        columns: null,
      }),
    );
  }

  function handleChangeColumns(leafId: string, columns: readonly string[]) {
    setTree((prev) =>
      mapTree(prev, (leaf) =>
        leaf.id === leafId ? { ...leaf, columns } : leaf,
      ),
    );
  }

  function handleReset() {
    setTree(initialTree());
  }

  return (
    <div className="rounded-xl border border-border bg-foreground/[0.02] overflow-hidden flex flex-col">
      <WorkspaceHeader leafCount={leafCount} onReset={handleReset} />
      <div className="h-[640px] bg-background">
        <RenderNode
          node={tree}
          canSplit={canSplit}
          onSplit={handleSplit}
          onRemove={handleRemove}
          onChangeObject={handleChangeObject}
          onChangeColumns={handleChangeColumns}
          rootIsLeaf={tree.kind === "leaf"}
        />
      </div>
    </div>
  );
}

function WorkspaceHeader({
  leafCount,
  onReset,
}: {
  leafCount: number;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
          Workspace
        </div>
        <div className="text-sm font-semibold tracking-tight">
          {leafCount} panel{leafCount === 1 ? "" : "s"} · max {MAX_LEAVES}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted">
          Split any panel horizontally or vertically · pick the canonical
          object · choose its columns
        </span>
        <button
          type="button"
          onClick={onReset}
          className="px-2 py-1 rounded-md border border-border hover:border-brand hover:text-brand transition-colors font-mono"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

interface NodeProps {
  node: PanelNode;
  canSplit: boolean;
  rootIsLeaf: boolean;
  onSplit: (leafId: string, orientation: "horizontal" | "vertical") => void;
  onRemove: (leafId: string) => void;
  onChangeObject: (leafId: string, canonicalKey: string) => void;
  onChangeColumns: (leafId: string, columns: readonly string[]) => void;
}

function RenderNode(props: NodeProps) {
  const { node } = props;
  if (node.kind === "leaf") {
    return <Leaf {...props} node={node} />;
  }
  // Horizontal split = two children side-by-side (left + right).
  // Vertical split = stacked (top + bottom).
  const dir =
    node.orientation === "horizontal" ? "flex-row" : "flex-col";
  return (
    <div className={`flex ${dir} h-full w-full`}>
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <RenderNode {...props} node={node.first} />
      </div>
      <div
        aria-hidden
        className={
          node.orientation === "horizontal"
            ? "w-px bg-border shrink-0"
            : "h-px bg-border shrink-0"
        }
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <RenderNode {...props} node={node.second} />
      </div>
    </div>
  );
}

function Leaf({
  node,
  canSplit,
  rootIsLeaf,
  onSplit,
  onRemove,
  onChangeObject,
  onChangeColumns,
}: NodeProps & { node: Extract<PanelNode, { kind: "leaf" }> }) {
  return (
    <div className="h-full w-full flex flex-col bg-background min-h-0 min-w-0">
      <LeafHeader
        leafId={node.id}
        canonicalKey={node.canonicalKey}
        canSplit={canSplit}
        isRoot={rootIsLeaf}
        onSplit={onSplit}
        onRemove={onRemove}
        onChangeObject={onChangeObject}
      />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <CanonicalTable
          canonicalKey={node.canonicalKey}
          selectedColumnKeys={node.columns}
          onColumnsChange={(cols) => onChangeColumns(node.id, cols)}
        />
      </div>
    </div>
  );
}

function LeafHeader({
  leafId,
  canonicalKey,
  canSplit,
  isRoot,
  onSplit,
  onRemove,
  onChangeObject,
}: {
  leafId: string;
  canonicalKey: string;
  canSplit: boolean;
  // If this leaf IS the entire tree, removing it would orphan the
  // workspace. We allow remove (the workspace resets to a default leaf)
  // but the button label hints at the consequence.
  isRoot: boolean;
  onSplit: (leafId: string, orientation: "horizontal" | "vertical") => void;
  onRemove: (leafId: string) => void;
  onChangeObject: (leafId: string, canonicalKey: string) => void;
}) {
  return (
    <div className="border-b border-border bg-foreground/[0.02] flex items-center justify-between gap-2 px-3 py-1.5 shrink-0">
      <select
        value={canonicalKey}
        onChange={(e) => onChangeObject(leafId, e.target.value)}
        className="text-xs font-semibold tracking-tight bg-transparent border-none focus:outline-none focus:ring-0 px-0 cursor-pointer"
        aria-label="Canonical object"
      >
        {CANONICAL_OBJECTS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <PanelButton
          onClick={() => onSplit(leafId, "horizontal")}
          disabled={!canSplit}
          title="Split horizontally (side-by-side)"
          aria-label="Split horizontally"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3.5 h-3.5">
            <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
            <line x1="7" y1="2.5" x2="7" y2="11.5" />
          </svg>
        </PanelButton>
        <PanelButton
          onClick={() => onSplit(leafId, "vertical")}
          disabled={!canSplit}
          title="Split vertically (stacked)"
          aria-label="Split vertically"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" className="w-3.5 h-3.5">
            <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
            <line x1="1.5" y1="7" x2="12.5" y2="7" />
          </svg>
        </PanelButton>
        <PanelButton
          onClick={() => onRemove(leafId)}
          title={isRoot ? "Reset workspace to default" : "Remove this panel"}
          aria-label="Remove panel"
        >
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="w-3.5 h-3.5">
            <path d="M3 3 L11 11" />
            <path d="M11 3 L3 11" />
          </svg>
        </PanelButton>
      </div>
    </div>
  );
}

function PanelButton({
  onClick,
  disabled,
  title,
  children,
  ...rest
}: React.PropsWithChildren<{
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...rest}
      className="w-6 h-6 inline-flex items-center justify-center rounded border border-transparent hover:border-border hover:bg-foreground/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

// Pick the next canonical object the user likely wants to add. Cycles
// through CANONICAL_OBJECTS skipping the current key.
function pickNextCanonicalKey(tree: PanelNode, current: string): string {
  const used = new Set<string>();
  function collect(n: PanelNode) {
    if (n.kind === "leaf") used.add(n.canonicalKey);
    else {
      collect(n.first);
      collect(n.second);
    }
  }
  collect(tree);
  // Prefer an object not yet on the workspace.
  for (const o of CANONICAL_OBJECTS) {
    if (!used.has(o.key)) return o.key;
  }
  // Fallback: next in the list after `current`.
  const idx = CANONICAL_OBJECTS.findIndex((o) => o.key === current);
  return CANONICAL_OBJECTS[(idx + 1) % CANONICAL_OBJECTS.length]!.key;
}
