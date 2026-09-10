import { describe, expect, it } from "vitest";
import {
  applyOperations,
  blockToolDeclarations,
  createFoundationEditor,
  createSchema,
  createScopeIndex,
  foundationSchema,
  indentBlockCommand,
  moveBlockCommand,
  moveListItems,
  outdentBlockCommand,
  setBlockAttributes,
  setBlockTypeCommand,
  unwrapBlocks,
  validate,
  wrapBlocks,
  type BlockCommandContext,
  type BlockRangeScope,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
  type SmartOperation,
  type SmartSchema,
} from "../index.js";

const paragraph = (id: string, text: string, marks?: readonly { type: string }[]): SmartElementNode => ({
  type: "paragraph", id, children: text ? [{ type: "text", text, ...(marks?.length ? { marks } : {}) }] : [],
});
const documentOf = (...children: SmartElementNode[]): SmartDocument => ({ type: "doc", id: "doc", children });
const blockScope = (...blockIds: string[]): BlockRangeScope => ({
  kind: "block-range", blockIds, promotedFromPartial: true, commonParentId: null,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: blockIds.length } },
  isolatingAncestorId: null, clamped: false,
});
const context = (document: SmartDocument, schema: SmartSchema = foundationSchema): BlockCommandContext => ({
  schema,
  positions: createScopeIndex().positions(document, schema),
});

describe("Phase 5 pure block commands", () => {
  it("adds a seventh heading or new alignment as a declaration with zero command code", () => {
    const seventh = { id: "heading7", kind: "setType" as const, type: "heading" as const, attrs: { level: 7 } };
    const alignStart = { id: "alignStart", kind: "setAttributes" as const, attrs: { align: "start" } };
    expect([...blockToolDeclarations, seventh, alignStart]).toHaveLength(blockToolDeclarations.length + 2);
    expect(setBlockTypeCommand).toBeTypeOf("function");
    expect(setBlockAttributes).toBeTypeOf("function");
  });

  it("preserves IDs, marks, and mixed block intent across paragraph/heading changes", () => {
    const before = documentOf(paragraph("a", "A", [{ type: "bold" }]), {
      type: "heading", id: "b", attrs: { level: 3 }, children: [{ type: "text", text: "B", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }],
    });
    const operations = setBlockTypeCommand(before, blockScope("a", "b"), { type: "heading", attrs: { level: 2 } }, context(before));
    const after = applyOperations(before, operations);
    expect(after.children).toMatchObject([
      { type: "heading", id: "a", attrs: { level: 2 }, children: [{ marks: [{ type: "bold" }] }] },
      { type: "heading", id: "b", attrs: { level: 2 }, children: [{ marks: [{ type: "link" }] }] },
    ]);
    expect(validate(after)).toEqual([]);
  });

  it("wraps a list as one quote and unwraps exactly one nested level", () => {
    const list: SmartElementNode = { type: "list", id: "list", children: [{
      type: "list_item", id: "item", children: [paragraph("item-p", "item")],
    }] };
    const before = documentOf(list);
    const quoted = applyOperations(before, wrapBlocks(before, blockScope("list"), { type: "blockquote", wrapperIds: ["quote"] }, context(before)));
    expect(quoted.children[0]).toMatchObject({ type: "blockquote", id: "quote", children: [{ type: "list", id: "list" }] });

    const nested = documentOf({ type: "blockquote", id: "outer", children: [{ type: "blockquote", id: "inner", children: [paragraph("p", "x")] }] });
    const unwrapped = applyOperations(nested, unwrapBlocks(nested, blockScope("outer"), {}, context(nested)));
    expect(unwrapped.children).toMatchObject([{ type: "blockquote", id: "inner", children: [{ id: "p" }] }]);
  });

  it("wraps a selected multi-item list once, then unwraps the same list and IDs", () => {
    const list: SmartElementNode = { type: "list", id: "list", children: [
      { type: "list_item", id: "item-a", children: [paragraph("p-a", "A")] },
      { type: "list_item", id: "item-b", children: [paragraph("p-b", "B")] },
    ] };
    const before = documentOf(list);
    const selected = blockScope("p-a", "p-b");
    const quoted = applyOperations(before, wrapBlocks(before, selected, { type: "blockquote", wrapperIds: ["quote"] }, context(before)));
    expect(quoted.children).toEqual([{
      type: "blockquote", id: "quote", children: [before.children[0]],
    }]);
    const unwrapped = applyOperations(quoted, unwrapBlocks(quoted, selected, {}, context(quoted)));
    expect(unwrapped).toEqual(before);
  });

  /**
   * Regression (2026-09-10, live report + screenshot): selecting from
   * partway into one list item's own paragraph through partway into a
   * *nested* sub-list's item, then applying Blockquote, threw "replaceNode
   * before payload does not match document node." and did nothing.
   *
   * Root cause: the selection's two ends resolve to two different "nearest
   * list ancestor" targets - the outer list (for the outer item's own
   * paragraph) and the inner nested list (for the sub-item's paragraph) -
   * but the inner one is itself inside the outer one. Treating both as
   * independent replaceNode targets corrupts the document: whichever runs
   * second captures a "before" snapshot of the outer list that's already
   * stale by the time it executes, since the first operation already
   * replaced a node nested inside it.
   */
  it("wraps a selection spanning an outer list item and its own nested sub-list item as one quote, not two conflicting replacements", () => {
    const list: SmartElementNode = { type: "list", id: "outer-list", children: [
      { type: "list_item", id: "item-1", children: [
        paragraph("p1", "one"),
        { type: "list", id: "inner-list", children: [
          { type: "list_item", id: "item-1a", children: [paragraph("p1a", "one-a")] },
          { type: "list_item", id: "item-1b", children: [paragraph("p1b", "one-b")] },
        ] },
      ] },
      { type: "list_item", id: "item-2", children: [paragraph("p2", "two")] },
    ] };
    const before = documentOf(list);
    const selected = blockScope("p1", "p1a");
    expect(() => applyOperations(before, wrapBlocks(before, selected, { type: "blockquote", wrapperIds: ["quote"] }, context(before))))
      .not.toThrow();
    const quoted = applyOperations(before, wrapBlocks(before, selected, { type: "blockquote", wrapperIds: ["quote"] }, context(before)));
    // Exactly one blockquote wrapping the whole outer list untouched - no
    // data loss, and the redundant inner-list target was dropped rather
    // than independently (and destructively) replaced.
    expect(quoted.children).toEqual([{ type: "blockquote", id: "quote", children: [before.children[0]] }]);

    const unwrapped = applyOperations(quoted, unwrapBlocks(quoted, selected, {}, context(quoted)));
    expect(unwrapped).toEqual(before);
  });

  it("unwraps a selection spanning an outer blockquote and its own nested blockquote as one operation, not two conflicting replacements", () => {
    const nested: SmartElementNode = {
      type: "blockquote", id: "outer-quote", children: [
        paragraph("p1", "one"),
        { type: "blockquote", id: "inner-quote", children: [paragraph("p2", "two")] },
      ],
    };
    const before = documentOf(nested);
    const selected = blockScope("p1", "p2");
    expect(() => applyOperations(before, unwrapBlocks(before, selected, {}, context(before)))).not.toThrow();
    const unwrapped = applyOperations(before, unwrapBlocks(before, selected, {}, context(before)));
    // Only the outer quote unwraps - the nested quote (already covered by
    // the outer one being a target) is left completely intact, not
    // independently unwrapped too.
    expect(unwrapped.children).toEqual([
      { type: "paragraph", id: "p1", children: [{ type: "text", text: "one" }] },
      { type: "blockquote", id: "inner-quote", children: [{ type: "paragraph", id: "p2", children: [{ type: "text", text: "two" }] }] },
    ]);
  });

  it("uses attributes for alignment and indentation and moves a contiguous run", () => {
    const before = documentOf(paragraph("a", "A"), paragraph("b", "B"), paragraph("c", "C"), paragraph("d", "D"));
    let model = applyOperations(before, setBlockAttributes(before, blockScope("b", "c"), { attrs: { align: "center" } }, context(before)));
    model = applyOperations(model, indentBlockCommand(model, blockScope("b", "c"), {}, context(model)));
    expect(model.children.slice(1, 3)).toMatchObject([
      { attrs: { align: "center", indentLevel: 1 } }, { attrs: { align: "center", indentLevel: 1 } },
    ]);
    model = applyOperations(model, outdentBlockCommand(model, blockScope("b", "c"), {}, context(model)));
    model = applyOperations(model, moveBlockCommand(model, blockScope("b", "c"), { direction: "up" }, context(model)));
    expect(model.children.map((node) => !isText(node) && node.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveBlockCommand(model, blockScope("b", "c"), { direction: "up" }, context(model))).toEqual([]);
  });

  it("shares the same moveNode implementation with list.move", () => {
    const blocks = documentOf(paragraph("a", "A"), paragraph("b", "B"));
    const blockOps = moveBlockCommand(blocks, blockScope("b"), { direction: "up" }, context(blocks));
    const listDoc = documentOf({ type: "list", id: "list", children: [
      { type: "list_item", id: "i-a", children: [paragraph("p-a", "A")] },
      { type: "list_item", id: "i-b", children: [paragraph("p-b", "B")] },
    ] });
    const listScope: ListSelectionScope = {
      kind: "list-selection", listId: "list", items: [{ itemId: "i-b", depth: 0, hasChildList: false }],
      partialSubtree: false, promotedFromPartial: false,
      range: { from: { path: [0], offset: 1 }, to: { path: [0], offset: 2 } }, isolatingAncestorId: null, clamped: false,
    };
    const listOps = moveListItems(listDoc, listScope, { direction: "up" }, context(listDoc));
    expect(blockOps.map((operation) => operation.type)).toEqual(["moveNode"]);
    expect(listOps.map((operation) => operation.type)).toEqual(["moveNode"]);
  });

  it("works in list items and isolating table cells without command special cases", () => {
    const schema = createSchema({
      version: 5,
      topNode: "doc",
      nodes: [
        ...Object.values(foundationSchema.nodes),
        { type: "grid", group: "block", content: "grid_row+", isolating: true, semanticRole: "table" },
        { type: "grid_row", group: "block", content: "grid_cell+", semanticRole: "table-row" },
        { type: "grid_cell", group: "block", content: "block+", isolating: true, semanticRole: "table-cell" },
      ],
      marks: Object.values(foundationSchema.marks),
    });
    const before = documentOf(
      { type: "list", id: "list", children: [{ type: "list_item", id: "item", children: [paragraph("list-p", "list")] }] },
      { type: "grid", id: "grid", children: [{ type: "grid_row", id: "row", children: [{ type: "grid_cell", id: "cell", children: [paragraph("cell-p", "cell")] }] }] },
    );
    const operations = [
      ...setBlockTypeCommand(before, blockScope("list-p"), { type: "heading", attrs: { level: 2 } }, context(before, schema)),
      ...setBlockTypeCommand(before, blockScope("cell-p"), { type: "heading", attrs: { level: 3 } }, context(before, schema)),
    ];
    const after = applyOperations(before, operations);
    expect(after.children).toMatchObject([
      { children: [{ children: [{ type: "heading", id: "list-p" }] }] },
      { children: [{ children: [{ children: [{ type: "heading", id: "cell-p" }] }] }] },
    ]);
    expect(validate(after, schema)).toEqual([]);
  });

  it("restores exact type, ID, attributes, marks, and reverse selection in 500 cases (seed 0xB10C500)", () => {
    let seed = 0xB10C500;
    for (let run = 0; run < 500; run += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const before = documentOf(paragraph(`a-${run}`, "A", [{ type: "bold" }]), paragraph(`b-${run}`, "B"));
      const reverse = { type: "text" as const, anchor: { path: [1], offset: 1 }, head: { path: [0], offset: 0 } };
      const editor = createFoundationEditor({ document: before, selection: reverse });
      const scope = blockScope(`a-${run}`, `b-${run}`);
      const operations: SmartOperation[] = setBlockTypeCommand(editor.document, scope, { type: "heading", attrs: { level: seed % 6 + 1 } }, {
        schema: editor.schema, positions: editor.positions,
      });
      editor.transact((transaction) => {
        transaction.operations.push(...operations);
        transaction.setSelection(reverse);
      }, { source: "toolbar", addToHistory: true, timestamp: seed });
      expect(editor.undo()).toBe(true);
      expect(editor.document).toEqual(before);
      expect(editor.selection).toEqual(reverse);
      expect(editor.redo()).toBe(true);
      expect(editor.document.children.map((node) => !isText(node) && node.id)).toEqual([`a-${run}`, `b-${run}`]);
      expect(editor.selection).toEqual(reverse);
    }
  });

  // Phase 8c collab-readiness gate, assertion 1: identity survives
  // split/merge/move/type-change/undo. The property test above covers
  // type-change at editor level; split/merge already have dedicated
  // editor-level and pure-operation coverage elsewhere (foundation.test.ts,
  // table/table.test.ts, list/history.property.test.ts). moveNode was only
  // covered at the pure-operation-algebra level (foundation.test.ts's
  // apply-then-invert case), not through a real editor undo/redo cycle -
  // this closes that gap using the same seeded-loop, editor-level shape.
  it("preserves exact IDs and order across move-then-undo-then-redo in 500 cases (seed 0x3A0BE500)", () => {
    let seed = 0x3A0BE500;
    for (let run = 0; run < 500; run += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const before = documentOf(paragraph(`a-${run}`, "A"), paragraph(`b-${run}`, "B"), paragraph(`c-${run}`, "C"));
      const selection = { type: "text" as const, anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } };
      const editor = createFoundationEditor({ document: before, selection });
      const ids = [`a-${run}`, `b-${run}`, `c-${run}`];
      const blockId = ids[seed % 3];
      const direction = (seed >>> 8) % 2 === 0 ? "down" : "up";
      const operations = moveBlockCommand(editor.document, blockScope(blockId), { direction }, { schema: editor.schema, positions: editor.positions });
      if (!operations.length) continue; // e.g. moving the first block "up" is a no-op
      const idsBefore = editor.document.children.map((node) => !isText(node) && node.id);
      editor.transact((transaction) => { transaction.operations.push(...operations); }, { source: "toolbar", addToHistory: true, timestamp: seed });
      const idsAfterMove = editor.document.children.map((node) => !isText(node) && node.id);
      expect(idsAfterMove).not.toEqual(idsBefore);
      expect(new Set(idsAfterMove)).toEqual(new Set(idsBefore));
      expect(editor.undo()).toBe(true);
      expect(editor.document).toEqual(before);
      expect(editor.document.children.map((node) => !isText(node) && node.id)).toEqual(idsBefore);
      expect(editor.redo()).toBe(true);
      expect(editor.document.children.map((node) => !isText(node) && node.id)).toEqual(idsAfterMove);
    }
  });
});

const isText = (node: SmartDocument["children"][number]): node is Extract<typeof node, { type: "text" }> => node.type === "text";
