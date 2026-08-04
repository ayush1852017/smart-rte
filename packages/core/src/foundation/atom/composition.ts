import { isTextNode } from "../identity.js";
import type { SmartElementNode } from "../types.js";
import type { CompositionToken } from "./types.js";

/** Mapping-aware tokens: atoms occupy one opaque unit and are never flattened. */
export const tokenizeCompositionOwner = (owner: SmartElementNode): CompositionToken[] => (owner.children || []).map((child) =>
  isTextNode(child)
    ? { kind: "text" as const, text: child.text, marks: [...(child.marks || [])] }
    : { kind: "atom" as const, nodeId: child.id, atomType: child.type });

export const compositionSegmentAt = (tokens: readonly CompositionToken[], offset: number): { from: number; to: number } => {
  let cursor = 0;
  for (const token of tokens) {
    const width = token.kind === "atom" ? 1 : token.text.length;
    if (token.kind === "atom" && (offset === cursor || offset === cursor + 1)) return { from: offset, to: offset };
    cursor += width;
  }
  cursor = 0;
  for (const token of tokens) {
    const width = token.kind === "atom" ? 1 : token.text.length;
    if (token.kind === "text" && offset >= cursor && offset <= cursor + width) return { from: cursor, to: cursor + width };
    cursor += width;
  }
  return { from: cursor, to: cursor };
};
