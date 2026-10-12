import { isTextNode } from "../identity.js";
import { applyOperations } from "../operations.js";
import { contentMatches } from "../schema.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartSchema } from "../types.js";

/**
 * Moving block media (1.3.0 drag-and-drop): the pure half. The React drag
 * controller maps pointer or keyboard input to one of these slots and
 * commits the operations planned here. A move is a single `moveNode`, so the
 * node keeps its id and every attribute (caption, metadata, size), undo is
 * one step, and collaboration rebases it like any other structural move.
 */

/** A boundary between two block children of a container: "insert at `index` of `parentId`", in the document as it is now (before the move). */
export interface BlockDropTarget {
  parentId: string;
  /** Index among the parent's current children. The moving node's own slot and the one right after it are never listed (both are no-ops). */
  index: number;
  /** Path of the parent in the current document. */
  parentPath: number[];
  /** Nesting depth of the parent (document root = 0), for preferring the deepest container under the pointer. */
  depth: number;
  /** Id of the child just above the slot, if any - the drop line sits at its bottom edge. */
  afterNodeId?: string;
  /** Id of the child just below the slot, if any - the drop line sits at its top edge. */
  beforeNodeId?: string;
}

/** Block media a user can drag: every block-group atom (block_image, block_formula, video, audio, divider, page_break). */
export const isMovableBlockMedia = (node: SmartNode | null | undefined, schema: SmartSchema): node is SmartElementNode => {
  if (!node || isTextNode(node)) return false;
  const spec = schema.nodes[node.type];
  return Boolean(spec?.atomic && spec.group === "block");
};

interface Located { node: SmartElementNode; parentPath: number[]; index: number; parent: SmartElementNode }

const locate = (document: SmartDocument, nodeId: string): Located | null => {
  const visit = (parent: SmartElementNode, path: number[]): Located | null => {
    const children = parent.children || [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (isTextNode(child)) continue;
      if (child.id === nodeId) return { node: child, parentPath: path, index, parent };
      const found = visit(child, [...path, index]);
      if (found) return found;
    }
    return null;
  };
  return visit(document, []);
};

const findPath = (document: SmartDocument, nodeId: string): number[] | null => {
  if (document.id === nodeId) return [];
  const found = locate(document, nodeId);
  return found ? [...found.parentPath, found.index] : null;
};

const childrenAt = (document: SmartDocument, path: readonly number[]): readonly SmartNode[] | null => {
  let node: SmartNode = document;
  for (const index of path) {
    if (isTextNode(node) || !node.children?.[index]) return null;
    node = node.children[index];
  }
  return isTextNode(node) ? null : node.children || [];
};

const acceptsChildren = (node: SmartElementNode, children: readonly SmartNode[], schema: SmartSchema): boolean => {
  const spec = schema.nodes[node.type];
  if (!spec || spec.atomic || spec.content === undefined) return false;
  return contentMatches(spec.content, children, schema);
};

/**
 * Every slot the node can be dropped into, in visual (document) order: a
 * container's slot `i` comes before the slots inside its child `i`. A
 * container qualifies when its schema content expression still matches
 * with the node inserted, which is the same rule document validation
 * enforces - so the root, table cells, list items and blockquotes, but
 * never a paragraph, code block or atom. Returns [] if the node isn't
 * movable block media.
 */
export const blockDropTargets = (document: SmartDocument, schema: SmartSchema, movingNodeId: string): BlockDropTarget[] => {
  const source = locate(document, movingNodeId);
  if (!source || !isMovableBlockMedia(source.node, schema)) return [];
  const moving = source.node;
  const targets: BlockDropTarget[] = [];
  const visit = (container: SmartElementNode, path: number[], depth: number) => {
    const children = container.children || [];
    const isSource = container.id === source.parent.id;
    // Content check on the container's children as they'd be after the move.
    const remaining = isSource ? children.filter((child) => child !== moving) : children;
    const accepts = acceptsChildren(container, [...remaining, moving], schema)
      || acceptsChildren(container, [moving, ...remaining], schema);
    for (let index = 0; index <= children.length; index += 1) {
      const noOp = isSource && (index === source.index || index === source.index + 1);
      if (accepts && !noOp) {
        const above = children[index - 1];
        const below = children[index];
        targets.push({
          parentId: container.id,
          index,
          parentPath: [...path],
          depth,
          ...(above && !isTextNode(above) ? { afterNodeId: above.id } : {}),
          ...(below && !isTextNode(below) ? { beforeNodeId: below.id } : {}),
        });
      }
      const child = children[index];
      if (child && !isTextNode(child) && child.id !== movingNodeId) visit(child, [...path, index], depth + 1);
    }
  };
  visit(document, [], 0);
  return targets;
};

/**
 * The operations that move `movingNodeId` to `target` (`parentId`/`index`
 * as in the current document), or null when the move is a no-op or not
 * allowed. One `moveNode`; when the move would leave a table cell, list
 * item or blockquote with no children (all require `block+`), an empty
 * paragraph is added to it in the same transaction so the document stays
 * valid and the container stays editable.
 */
export const planBlockMove = (
  document: SmartDocument,
  schema: SmartSchema,
  movingNodeId: string,
  target: { parentId: string; index: number },
  options: { idFactory: () => string },
): SmartOperation[] | null => {
  const allowed = blockDropTargets(document, schema, movingNodeId)
    .some((candidate) => candidate.parentId === target.parentId && candidate.index === target.index);
  const source = allowed ? locate(document, movingNodeId) : null;
  const destinationPath = source ? findPath(document, target.parentId) : null;
  if (!source || !destinationPath) return null;
  // `moveNode` resolves `to` in the document *after* the removal: a later
  // sibling of the source (or anything inside one) shifts up by one.
  const sourceParentPath = source.parentPath;
  const toPath = [...destinationPath];
  if (toPath.length > sourceParentPath.length && sourceParentPath.every((part, index) => toPath[index] === part)
    && toPath[sourceParentPath.length] > source.index) {
    toPath[sourceParentPath.length] -= 1;
  }
  const sameParent = target.parentId === source.parent.id;
  const toOffset = sameParent && target.index > source.index ? target.index - 1 : target.index;
  const operations: SmartOperation[] = [{
    type: "moveNode",
    nodeId: movingNodeId,
    from: { path: [...sourceParentPath], offset: source.index },
    to: { path: toPath, offset: toOffset },
  }];
  if (!sameParent && source.parent.id !== document.id && (source.parent.children?.length ?? 0) === 1) {
    const moved = applyOperations(document, operations);
    const emptiedPath = findPath(moved, source.parent.id);
    if (emptiedPath && childrenAt(moved, emptiedPath)?.length === 0) {
      operations.push({ type: "insertNode", pos: { path: emptiedPath, offset: 0 }, node: { type: "paragraph", id: options.idFactory(), children: [] } });
    }
  }
  return operations;
};
