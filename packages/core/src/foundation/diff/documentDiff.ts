import { isTextNode } from "../identity.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartMark, SmartNode, SmartSchema } from "../types.js";
import { diffTextRuns, type TextRun } from "./textDiff.js";
import type { AddedNodeChange, ChangedNodeChange, DocumentDiff, RemovedNodeChange } from "./types.js";

interface IndexedNode {
  readonly node: SmartElementNode;
  readonly parentId: string | null;
  readonly path: readonly number[];
}

const indexById = (document: SmartDocument): Map<string, IndexedNode> => {
  const index = new Map<string, IndexedNode>();
  const visit = (node: SmartElementNode, parentId: string | null, path: readonly number[]) => {
    index.set(node.id, { node, parentId, path });
    (node.children || []).forEach((child, childIndex) => {
      if (!isTextNode(child)) visit(child, node.id, [...path, childIndex]);
    });
  };
  visit(document, null, []);
  return index;
};

/**
 * Every `SmartElementNode` keeps a stable id across split/merge/move/type-
 * change/undo (Phase 8c collab-readiness gate, assertion 1). That turns the
 * structural half of a document diff into a hash-map join - id present in
 * both/only-before/only-after - instead of a generic tree-alignment problem
 * a Myers/patience-style algorithm would otherwise be needed to solve.
 * `SmartTextNode` has no id, so text content is the one place a real
 * (word-level, see textDiff.ts) diff algorithm is still needed.
 */
export const diffDocuments = (before: SmartDocument, after: SmartDocument, schema: SmartSchema): DocumentDiff => {
  const beforeIndex = indexById(before);
  const afterIndex = indexById(after);

  const removed: RemovedNodeChange[] = [];
  beforeIndex.forEach((entry, id) => {
    if (afterIndex.has(id)) return;
    // Only the topmost removed root is reported - a removed id whose
    // parent id is itself removed is part of that parent's own subtree.
    if (entry.parentId && !afterIndex.has(entry.parentId)) return;
    removed.push({ kind: "removed", nodeId: id, node: entry.node, parentId: entry.parentId, path: [...entry.path] });
  });

  const added: AddedNodeChange[] = [];
  afterIndex.forEach((entry, id) => {
    if (beforeIndex.has(id)) return;
    if (entry.parentId && !beforeIndex.has(entry.parentId)) return;
    added.push({ kind: "added", nodeId: id, node: entry.node, parentId: entry.parentId, path: [...entry.path] });
  });

  const changed: ChangedNodeChange[] = [];
  beforeIndex.forEach((beforeEntry, id) => {
    const afterEntry = afterIndex.get(id);
    if (!afterEntry) return;
    const entry: { -readonly [K in keyof Omit<ChangedNodeChange, "kind" | "nodeId">]?: ChangedNodeChange[K] } = {};

    if (beforeEntry.parentId !== afterEntry.parentId) {
      entry.move = {
        fromParentId: beforeEntry.parentId, toParentId: afterEntry.parentId,
        fromPath: [...beforeEntry.path], toPath: [...afterEntry.path],
      };
    } else if (beforeEntry.parentId) {
      const move = sameParentMove(beforeEntry.parentId, beforeIndex, afterIndex, id);
      if (move) entry.move = move;
    }

    if (beforeEntry.node.type !== afterEntry.node.type) {
      entry.typeChange = { before: beforeEntry.node.type, after: afterEntry.node.type };
    }

    const attrsDiff = diffAttrs(beforeEntry.node.attrs || {}, afterEntry.node.attrs || {});
    if (attrsDiff.length) {
      entry.attrsChange = { before: beforeEntry.node.attrs || {}, after: afterEntry.node.attrs || {}, changedKeys: attrsDiff };
    }

    if (isInlineOwner(beforeEntry.node, schema) && isInlineOwner(afterEntry.node, schema)) {
      const segments = diffTextRuns(textRunsOf(beforeEntry.node), textRunsOf(afterEntry.node));
      if (segments.some((segment) => segment.op !== "equal")) entry.contentChange = segments;
    }

    if (entry.move || entry.typeChange || entry.attrsChange || entry.contentChange) {
      changed.push({ kind: "changed", nodeId: id, ...entry });
    }
  });

  return { added, removed, changed };
};

/**
 * Detects a same-parent reorder without false-positives from mere sibling
 * insertion/removal: only ids that were - and still are - direct children
 * of this exact parent on both sides are considered, and their retained-
 * only order is compared via LCS. A retained id inside that LCS kept its
 * relative order (even if its numeric index shifted because siblings were
 * added/removed around it) and is not reported as moved.
 */
const sameParentMove = (
  parentId: string,
  beforeIndex: Map<string, IndexedNode>,
  afterIndex: Map<string, IndexedNode>,
  nodeId: string,
): ChangedNodeChange["move"] | undefined => {
  const beforeParent = beforeIndex.get(parentId);
  const afterParent = afterIndex.get(parentId);
  if (!beforeParent || !afterParent) return undefined;
  const beforeChildIds = (beforeParent.node.children || []).filter((child): child is SmartElementNode => !isTextNode(child)).map((child) => child.id);
  const afterChildIds = (afterParent.node.children || []).filter((child): child is SmartElementNode => !isTextNode(child)).map((child) => child.id);
  const oldOrder = beforeChildIds.filter((id) => afterIndex.get(id)?.parentId === parentId);
  const newOrder = afterChildIds.filter((id) => beforeIndex.get(id)?.parentId === parentId);
  const lcs = lcsIds(oldOrder, newOrder);
  if (lcs.has(nodeId)) return undefined;
  const before = beforeIndex.get(nodeId)!;
  const after = afterIndex.get(nodeId)!;
  return { fromParentId: parentId, toParentId: parentId, fromPath: [...before.path], toPath: [...after.path] };
};

const lcsIds = (before: readonly string[], after: readonly string[]): Set<string> => {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      kept.add(before[i]);
      i += 1; j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return kept;
};

const diffAttrs = (before: Attrs, after: Attrs): string[] => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
};

/** Mirrors the inline-content-owner predicate in canonicalEditorRuntime.ts's firstTextSelection, reused here for consistency rather than a second definition of the same concept. */
const isInlineOwner = (node: SmartElementNode, schema: SmartSchema): boolean => {
  const children = node.children || [];
  return children.every((child) => isTextNode(child) || schema.nodes[child.type]?.group === "inline");
};

/**
 * Flattens an inline owner's children into `{text, marks}` runs for word-
 * level diffing. Inline atomic children (e.g. inline images/formulas) are
 * intentionally not represented here - only text is word-diffed; a change
 * limited entirely to an inline atom within otherwise-unchanged text will
 * not surface as a `contentChange`. Documented scope limit, not a silent
 * gap: such a change is still visible via the atom's own `added`/`removed`
 * entry if it's inserted/removed outright.
 */
const textRunsOf = (node: SmartElementNode): TextRun[] =>
  (node.children || []).filter((child): child is Extract<SmartNode, { type: "text" }> => isTextNode(child))
    .map((child) => ({ text: child.text, marks: (child.marks || []) as readonly SmartMark[] }));
