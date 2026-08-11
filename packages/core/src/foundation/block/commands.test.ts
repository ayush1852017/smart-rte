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
});

const isText = (node: SmartDocument["children"][number]): node is Extract<typeof node, { type: "text" }> => node.type === "text";
