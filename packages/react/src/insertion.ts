import {
  atomDeclarations,
  createNodeId,
  insertAtom,
  isTextNode,
  type FoundationEditor,
  type ResolvedScope,
  type SmartElementNode,
  type SmartNode,
  type SmartOperation,
} from "smartrte-core/foundation";

export type BlockAtomType = "block_image" | "video" | "audio" | "divider" | "page_break";

export interface BlockAtomInsertion {
  operations: SmartOperation[];
  /** Set when a trailing paragraph was added (the atom landed at the end of its container): the caret belongs there. */
  selectionOwnerId?: string;
}

const findNode = (root: SmartNode, id: string): SmartElementNode | null => {
  if (isTextNode(root)) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
};

/**
 * Where a block atom goes, shared by the toolbar/media-library insert and the
 * host-facing `insertImage` API so both behave identically:
 * - caret inside a paragraph (or any text block) -> after that block;
 * - a selected block atom -> after it;
 * - a table cell selection -> inside the cell.
 * `position: "end"` appends to the document root instead, and
 * `{ rootIndex }` inserts at that document-root child index (the host
 * section/after-block positions resolve to one).
 *
 * Block atoms cannot hold a caret, so an atom placed at the end of its
 * container (document root or table cell) is followed by a new empty
 * paragraph whose id is returned as `selectionOwnerId`.
 *
 * Returns null when no legal insertion point exists for that request.
 */
export const planBlockAtomInsertion = (
  editor: FoundationEditor,
  type: BlockAtomType,
  attrs: Record<string, unknown>,
  nodeId: string,
  position: "selection" | "end" | { rootIndex: number } = "selection",
): BlockAtomInsertion | null => {
  const declaration = atomDeclarations.find((entry) => entry.type === type)!;
  const ctx = { schema: editor.schema, positions: editor.positions };
  const atomScope = () => editor.resolveScope({ want: "atomic-node" }) as ResolvedScope;
  let parentId: string | undefined;
  let index: number | undefined;
  if (position === "end") {
    parentId = editor.document.id;
    index = editor.document.children.length;
  } else if (typeof position === "object") {
    if (!Number.isInteger(position.rootIndex) || position.rootIndex < 0 || position.rootIndex > editor.document.children.length) return null;
    parentId = editor.document.id;
    index = position.rootIndex;
  } else {
    const selection = editor.selection;
    const resolved = editor.resolve({ pos: selection.head });
    // A selected atom's own parent is only a legal insertion point for a
    // *block* atom (image/video/audio/table etc., whose parent is the
    // document root or a table cell). An inline atom (formula, inline image)
    // lives inside a paragraph - inserting a block atom there would nest a
    // block inside a paragraph, which insertAtom's schema validation rejects,
    // silently no-opping. Fall through to the generic "insert after the
    // current block" logic below for that case instead.
    const selectedBlockAtom = (() => {
      if (selection.type !== "node") return false;
      const scope = atomScope();
      const atomType = scope.kind === "atomic-node" ? findNode(editor.document, scope.nodeId)?.type : undefined;
      return atomType ? atomDeclarations.find((entry) => entry.type === atomType)?.group === "block" : false;
    })();
    if (selection.type === "cell") {
      // A cell range resolves at the active cell's content boundary. Block
      // atoms belong inside that cell, never as invalid siblings of the row.
      parentId = resolved.nodeId;
      index = resolved.pos.offset;
    } else if (resolved.kind === "structural" && resolved.pos.path.length === selection.anchor.path.length
      && resolved.pos.path.every((part, pathIndex) => part === selection.anchor.path[pathIndex])) {
      // A browser may expose a clicked block atom as a structural text range
      // (the atom occupies one unit). Keep insertion in that same parent.
      parentId = resolved.parent.id;
      index = Math.max(selection.anchor.offset, selection.head.offset);
    } else if (selectedBlockAtom) {
      parentId = resolved.parent.id;
      index = resolved.pos.offset;
    } else {
      const location = editor.positions.positionOf(resolved.nodeId);
      parentId = location?.parent.id;
      index = location ? location.pos.offset + 1 : undefined;
    }
  }
  if (!parentId || index === undefined) return null;
  const operations = insertAtom(editor.document, atomScope(), { declaration, nodeId, parentId, index, attrs }, ctx);
  if (!operations.length) return null;
  const parent = findNode(editor.document, parentId);
  const contentRange = editor.positions.contentRangeOf(parentId);
  if (parent?.children && index >= parent.children.length && contentRange) {
    const selectionOwnerId = createNodeId();
    operations.push({
      type: "insertNode",
      pos: { path: [...contentRange.from.path], offset: index + 1 },
      node: { type: "paragraph", id: selectionOwnerId, children: [] },
    });
    return { operations, selectionOwnerId };
  }
  return { operations };
};
