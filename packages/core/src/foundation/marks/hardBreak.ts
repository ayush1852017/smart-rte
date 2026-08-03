import { cloneNode, createNodeId, isTextNode } from "../identity.js";
import { nodeAtPath } from "../positions.js";
import type { SmartDocument, SmartElementNode, SmartNode, SmartOperation, SmartPos } from "../types.js";

export interface HardBreakMigrationResult {
  readonly document: SmartDocument;
  readonly migratedBreaks: number;
}

/** Migrates legacy canonical newline text to atomic, unmarked hard_break nodes. */
export const migrateNewlineTextToHardBreaks = (document: SmartDocument): HardBreakMigrationResult => {
  let migratedBreaks = 0;
  const visit = (node: SmartNode): SmartNode => {
    if (isTextNode(node)) {
      if (!node.text.includes("\n")) return node;
      throw new Error("Text-node migration must be performed by its inline owner.");
    }
    const children: SmartNode[] = [];
    let changed = false;
    (node.children || []).forEach((child) => {
      if (!isTextNode(child) || !child.text.includes("\n")) {
        const visited = visit(child);
        if (visited !== child) changed = true;
        children.push(visited);
        return;
      }
      changed = true;
      const pieces = child.text.split("\n");
      pieces.forEach((piece, index) => {
        if (piece) children.push({ type: "text", text: piece, ...(child.marks?.length ? { marks: [...child.marks] } : {}) });
        if (index < pieces.length - 1) {
          children.push({ type: "hard_break", id: createNodeId() });
          migratedBreaks += 1;
        }
      });
    });
    if (!changed) return node;
    return { ...node, ...(node.children ? { children } : {}) };
  };
  return { document: visit(document) as SmartDocument, migratedBreaks };
};

const splitChildrenAt = (children: readonly SmartNode[], offset: number): [SmartNode[], SmartNode[]] => {
  const before: SmartNode[] = [];
  const after: SmartNode[] = [];
  let cursor = 0;
  let split = false;
  children.forEach((child) => {
    if (split) return after.push(child);
    const width = isTextNode(child) ? child.text.length : 1;
    if (offset > cursor + width) { before.push(child); cursor += width; return; }
    const local = offset - cursor;
    if (isTextNode(child)) {
      if (local > 0) before.push({ ...child, text: child.text.slice(0, local) });
      if (local < width) after.push({ ...child, text: child.text.slice(local) });
    } else if (local === 0) after.push(child);
    else if (local === 1) before.push(child);
    else throw new Error("Hard-break insertion position is inside an atom.");
    split = true;
    cursor += width;
  });
  if (!split && cursor !== offset) throw new Error("Hard-break insertion position is out of bounds.");
  return [before, after];
};

export const insertHardBreak = (document: SmartDocument, pos: SmartPos, id = createNodeId()): SmartOperation[] => {
  const owner = nodeAtPath(document, pos.path);
  if (!owner || isTextNode(owner) || !owner.children) throw new Error("hard_break requires an inline owner position.");
  const [before, after] = splitChildrenAt(owner.children, pos.offset);
  const replacement: SmartElementNode = { ...owner, children: [...before, { type: "hard_break", id }, ...after] };
  return [{ type: "replaceNode", pos: { path: pos.path.slice(0, -1), offset: pos.path[pos.path.length - 1] }, before: cloneNode(owner), after: replacement }];
};
