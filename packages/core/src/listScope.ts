import { getNodeAtPath, type Path, type SmartBlockNode, type SmartDocument } from "./model.js";
import type { SmartSelection } from "./selection.js";

export type ListSelectionScope =
  | { kind: "all"; containerPath: Path }
  | { kind: "blocks"; containerPath: Path; start: number; end: number }
  | { kind: "list"; listPath: Path; start: number; end: number }
  | { kind: "mixed"; containerPath: Path; blockIndex: number; listPath: Path; itemStart: number; itemEnd: number }
  | { kind: "none" };

const samePath = (left: Path, right: Path) =>
  left.length === right.length && left.every((part, index) => part === right[index]);

const isBlock = (node: unknown): node is SmartBlockNode =>
  Boolean(node) && typeof node === "object" &&
  ["paragraph", "heading", "list", "blockquote", "codeBlock", "table"].includes(
    (node as { type?: string }).type || "",
  );

const structuralUnit = (document: SmartDocument, path: Path) => {
  let firstBlockPath: Path | null = null;
  let deepestList: { path: Path; listItemIndex?: number } | null = null;
  for (let depth = 1; depth <= path.length; depth += 1) {
    const candidatePath = path.slice(0, depth);
    const node = getNodeAtPath(document, candidatePath);
    if (!isBlock(node)) continue;
    if (!firstBlockPath) firstBlockPath = candidatePath;
    if (node.type === "list") {
      const itemIndex = path[depth];
      deepestList = {
        path: candidatePath,
        listItemIndex: Number.isInteger(itemIndex) ? itemIndex : undefined,
      };
      continue;
    }
    if (node.type === "table") firstBlockPath = null;
  }
  return deepestList || (firstBlockPath ? { path: firstBlockPath, listItemIndex: undefined } : null);
};

/** Resolves the semantic list scope without inspecting DOM details. */
export const resolveListSelectionScope = (
  document: SmartDocument,
  selection: SmartSelection,
): ListSelectionScope => {
  if (selection.type === "all") return { kind: "all", containerPath: [] };
  if (selection.type !== "text" && selection.type !== "node") return { kind: "none" };
  const paths = selection.type === "text"
    ? [selection.anchor.path, selection.focus.path] as const
    : [selection.path, selection.path] as const;
  const anchor = structuralUnit(document, paths[0]);
  const focus = structuralUnit(document, paths[1]);
  if (!anchor || !focus) return { kind: "none" };

  if (samePath(anchor.path, focus.path) && anchor.listItemIndex !== undefined && focus.listItemIndex !== undefined) {
    return {
      kind: "list",
      listPath: anchor.path,
      start: Math.min(anchor.listItemIndex, focus.listItemIndex),
      end: Math.max(anchor.listItemIndex, focus.listItemIndex),
    };
  }

  // A range whose endpoints are list content at different depths belongs to
  // the nearest common containing list. For example, selecting a parent item
  // through one of its nested items changes the parent list while preserving
  // the nested descendants. A nested-only range is handled by the same-path
  // branch above and therefore remains scoped to the nested list.
  if (anchor.listItemIndex !== undefined && focus.listItemIndex !== undefined) {
    const listPaths = [anchor.path, focus.path];
    const ancestor = listPaths.find((candidate) =>
      listPaths.every((path) =>
        path.length >= candidate.length && candidate.every((part, index) => path[index] === part),
      ),
    );
    if (ancestor) {
      const indices = [
        samePath(anchor.path, ancestor) ? anchor.listItemIndex : anchor.path[ancestor.length],
        samePath(focus.path, ancestor) ? focus.listItemIndex : focus.path[ancestor.length],
      ]
        .filter((index): index is number => Number.isInteger(index));
      if (indices.length === 2) {
        return {
          kind: "list",
          listPath: ancestor,
          start: Math.min(...indices),
          end: Math.max(...indices),
        };
      }
    }
  }

  const mixed = [anchor, focus].find((unit) => unit.listItemIndex !== undefined);
  const plain = [anchor, focus].find((unit) => unit.listItemIndex === undefined);
  if (mixed && plain) {
    let outerListPath: Path | null = null;
    for (let depth = 1; depth <= mixed.path.length; depth += 1) {
      if ((getNodeAtPath(document, mixed.path.slice(0, depth)) as SmartBlockNode | undefined)?.type === "list") {
        outerListPath = mixed.path.slice(0, depth);
        break;
      }
    }
    if (!outerListPath || !samePath(outerListPath.slice(0, -1), plain.path.slice(0, -1))) return { kind: "none" };
    return {
      kind: "mixed",
      containerPath: plain.path.slice(0, -1),
      blockIndex: plain.path[plain.path.length - 1],
      listPath: outerListPath,
      itemStart: mixed.path[outerListPath.length],
      itemEnd: mixed.path[outerListPath.length],
    };
  }

  const anchorParent = anchor.path.slice(0, -1);
  const focusParent = focus.path.slice(0, -1);
  if (!samePath(anchorParent, focusParent)) return { kind: "none" };
  return {
    kind: "blocks",
    containerPath: anchorParent,
    start: Math.min(anchor.path[anchor.path.length - 1], focus.path[focus.path.length - 1]),
    end: Math.max(anchor.path[anchor.path.length - 1], focus.path[focus.path.length - 1]),
  };
};
