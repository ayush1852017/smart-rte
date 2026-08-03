import { isTextNode } from "../identity.js";
import type { PositionLookup } from "../scope/types.js";
import type { SmartOperation } from "../types.js";

export interface SiblingMoveContext { readonly positions: PositionLookup }

/** Shared implementation used by block.move and list.move. */
export const moveContiguousSiblings = (
  nodeIds: readonly string[],
  direction: "up" | "down",
  ctx: SiblingMoveContext,
): SmartOperation[] => {
  const located = [...new Set(nodeIds)].map((nodeId) => {
    const resolved = ctx.positions.positionOf(nodeId);
    const node = resolved?.parent.children?.[resolved.pos.offset];
    if (!resolved || !node || isTextNode(node) || node.id !== nodeId) return null;
    return { nodeId, parentId: resolved.parent.id, path: resolved.pos.path, index: resolved.pos.offset };
  });
  if (located.some((entry) => !entry)) return [];
  const entries = located.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => left.index - right.index);
  if (!entries.length || entries.some((entry) => entry.parentId !== entries[0].parentId)
    || entries.some((entry, index) => index > 0 && entry.index !== entries[index - 1].index + 1)) return [];
  const first = entries[0].index;
  const last = entries[entries.length - 1].index;
  const parent = ctx.positions.positionOf(entries[0].nodeId)!.parent;
  if (direction === "up") {
    if (first === 0) return [];
    const preceding = parent.children?.[first - 1];
    if (!preceding || isTextNode(preceding)) return [];
    return [{ type: "moveNode", from: { path: [...entries[0].path], offset: first - 1 }, to: { path: [...entries[0].path], offset: last }, nodeId: preceding.id }];
  }
  if (last >= (parent.children?.length || 0) - 1) return [];
  const following = parent.children?.[last + 1];
  if (!following || isTextNode(following)) return [];
  return [{ type: "moveNode", from: { path: [...entries[0].path], offset: last + 1 }, to: { path: [...entries[0].path], offset: first }, nodeId: following.id }];
};
