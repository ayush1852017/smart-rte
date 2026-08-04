import type { PositionLookup } from "../scope/types.js";
import type { SmartSelection } from "../types.js";

export const nodeSelectionForAtom = (nodeId: string, positions: PositionLookup): SmartSelection | null => {
  const range = positions.rangeOf(nodeId);
  return range ? { type: "node", anchor: range.from, head: range.to } : null;
};

