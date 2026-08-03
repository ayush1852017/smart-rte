import { isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import type { PositionLookup } from "../scope/types.js";
import type { SmartDocument, SmartElementNode, SmartSchema } from "../types.js";

export interface ContentTargetContext {
  readonly schema: SmartSchema;
  readonly positions: PositionLookup;
}

export interface ContentTargetLineageEntry {
  readonly nodeId: string;
  readonly type: string;
}

export interface ResolvedContentTarget {
  readonly ownerId: string;
  /** Target-subtree lineage, outermost first and including the owner. */
  readonly lineage: readonly ContentTargetLineageEntry[];
}

const isContentOwner = (node: SmartElementNode, schema: SmartSchema) => {
  const expression = schema.nodes[node.type]?.content || "";
  return expression.includes("inline") || expression.includes("text");
};

const deepestLastContentOwner = (
  node: SmartElementNode,
  schema: SmartSchema,
  lineage: readonly ContentTargetLineageEntry[] = [],
): ResolvedContentTarget | null => {
  const nextLineage = [...lineage, { nodeId: node.id, type: node.type }];
  for (let index = (node.children?.length || 0) - 1; index >= 0; index -= 1) {
    const child = node.children?.[index];
    if (!child || isTextNode(child)) continue;
    const target = deepestLastContentOwner(child, schema, nextLineage);
    if (target) return target;
  }
  return isContentOwner(node, schema) ? { ownerId: node.id, lineage: nextLineage } : null;
};

const nearestIsolatingPath = (document: SmartDocument, path: readonly number[], schema: SmartSchema): number[] => {
  let result: number[] = [];
  for (let depth = 0; depth <= path.length; depth += 1) {
    const candidate = path.slice(0, depth);
    const node = nodeAtPath(document, candidate);
    if (node && !isTextNode(node) && schema.nodes[node.type]?.isolating) result = candidate;
  }
  return result;
};

/**
 * Resolves the previous visible content owner in logical document order.
 * It descends through the deepest last sibling subtree, climbs across parent
 * boundaries when needed, and never crosses the nearest isolating ancestor.
 */
export const resolvePrecedingContentTarget = (
  document: SmartDocument,
  nodeId: string,
  ctx: ContentTargetContext,
): ResolvedContentTarget | null => {
  const located = ctx.positions.positionOf(nodeId);
  if (!located) return null;
  let path = [...located.pos.path, located.pos.offset];
  const isolationPath = nearestIsolatingPath(document, path, ctx.schema);
  while (path.length > isolationPath.length) {
    const parentPath = path.slice(0, -1);
    const index = path[path.length - 1];
    if (index > 0) {
      const sibling = nodeAtPath(document, [...parentPath, index - 1]);
      if (sibling && !isTextNode(sibling)) return deepestLastContentOwner(sibling, ctx.schema);
    }
    path = parentPath;
  }
  return null;
};
