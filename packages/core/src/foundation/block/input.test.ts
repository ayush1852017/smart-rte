import { describe, expect, it } from "vitest";
import {
  applyOperations,
  createScopeIndex,
  exitCodeBlock,
  foundationSchema,
  indentInsideCodeBlock,
  insertCodeBlockNewline,
  insertPlainCodeFragment,
  reportMarkApplication,
  setBlockTypeCommand,
  applyMarkCommand,
  validate,
  type BlockCommandContext,
  type InlineRangeScope,
  type SmartDocument,
  type SmartElementNode,
} from "../index.js";

const code = (id = "code", text = "abc"): SmartElementNode => ({ type: "code_block", id, attrs: { language: "ts" }, children: text ? [{ type: "text", text }] : [] });
const doc = (...children: SmartElementNode[]): SmartDocument => ({ type: "doc", id: "doc", children });
const ctx = (document: SmartDocument): BlockCommandContext => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
const inlineScope = (ownerId: string, to: number): InlineRangeScope => ({
  kind: "inline-range", runs: [{ ownerNodeId: ownerId, from: 0, to, containsAtoms: false }], collapsed: false,
  range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: to } }, isolatingAncestorId: null, clamped: false,
});

describe("Phase 5 code block semantics", () => {
  it("strips marks on conversion and reports later mark application as skipped", () => {
    const before = doc({ type: "paragraph", id: "p", children: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] });
    const blockScope = { kind: "block-range" as const, blockIds: ["p"], promotedFromPartial: true, commonParentId: "doc", range: { from: { path: [], offset: 0 }, to: { path: [], offset: 1 } }, isolatingAncestorId: null, clamped: false };
    const converted = applyOperations(before, setBlockTypeCommand(before, blockScope, { type: "code_block", attrs: { language: "ts" } }, ctx(before)));
    expect(converted.children[0]).toEqual({ type: "code_block", id: "p", attrs: { language: "ts" }, children: [{ type: "text", text: "x" }] });
    const scope = inlineScope("p", 1);
    expect(applyMarkCommand(converted, scope, { markType: "bold" }, ctx(converted))).toEqual([]);
    expect(reportMarkApplication(converted, scope, "bold", ctx(converted))).toMatchObject({ ownerIdsSkipped: ["p"], partial: true });
    expect(validate(converted)).toEqual([]);
  });

  it("uses Enter for newline, Tab for text indentation, and Ctrl/Cmd+Enter semantics for escape", () => {
    const before = doc(code());
    const newline = insertCodeBlockNewline(before, { path: [0], offset: 1 })!;
    expect(applyOperations(before, newline.operations).children[0]).toMatchObject({ children: [{ text: "a\nbc" }] });
    const tab = indentInsideCodeBlock(before, { path: [0], offset: 1 })!;
    expect(applyOperations(before, tab.operations).children[0]).toMatchObject({ children: [{ text: "a\tbc" }] });
    const beforeExit = exitCodeBlock(before, { path: [0], offset: 0 }, "before-p")!;
    expect(applyOperations(before, beforeExit.operations).children.map((node) => "id" in node && node.id)).toEqual(["before-p", "code"]);
    const afterExit = exitCodeBlock(before, { path: [0], offset: 3 }, "after-p")!;
    expect(applyOperations(before, afterExit.operations).children.map((node) => "id" in node && node.id)).toEqual(["code", "after-p"]);
  });

  it("exits on Enter at a trailing empty line while Shift+Enter can still insert a newline", () => {
    const before = doc(code("code", "line\n"));
    const entered = insertCodeBlockNewline(before, { path: [0], offset: 5 }, {
      exitOnTrailingEmptyLine: true, paragraphId: "exit-p",
    })!;
    expect(entered.intent).toBe("exit-after");
    expect(entered.operations[0]).toMatchObject({ type: "insertNode", node: { id: "exit-p" } });
    expect(insertCodeBlockNewline(before, { path: [0], offset: 5 })?.intent).toBe("newline");
  });

  /**
   * Regression (2026-09-11, live report): "inside Blockquote I am trying to
   * add a new list item after 4 which is inside code-block. But enter only
   * creating new lines inside of code-block." list.ts's own isInlineOwner
   * deliberately excludes code_block from list-split logic (so typing more
   * code doesn't accidentally split into a new item), which previously left
   * no way to ever start a new item after one whose only content is a code
   * block - exiting just stuffed a plain paragraph in *alongside* the code
   * block, inside the same item, requiring a further Enter (and leaving
   * that paragraph as permanent clutter) to actually reach a new item.
   */
  it("exiting a code block that's the only content of a list item creates a new sibling list item, not another block inside the same one", () => {
    const listItem = (id: string, child: SmartElementNode): SmartElementNode => ({ type: "list_item", id, children: [child] });
    const before = doc({ type: "list", id: "list", attrs: { style: "decimal" }, children: [listItem("item-1", code("code", "line\n"))] });

    const afterExit = exitCodeBlock(before, { path: [0, 0, 0], offset: 5 }, "exit-p")!;
    expect(afterExit.intent).toBe("exit-after");
    const applied = applyOperations(before, afterExit.operations);
    expect(applied.children[0]).toMatchObject({
      type: "list",
      children: [
        { type: "list_item", id: "item-1", children: [{ type: "code_block", id: "code" }] },
        { type: "list_item", children: [{ type: "paragraph", id: "exit-p", children: [] }] },
      ],
    });
    expect(applied.children[0].children).toHaveLength(2);
    expect(validate(applied)).toEqual([]);
  });

  it("exiting-before a code block that's the only content of a list item creates a new sibling list item before it", () => {
    const listItem = (id: string, child: SmartElementNode): SmartElementNode => ({ type: "list_item", id, children: [child] });
    const before = doc({ type: "list", id: "list", attrs: { style: "decimal" }, children: [listItem("item-1", code("code", "line"))] });

    const beforeExit = exitCodeBlock(before, { path: [0, 0, 0], offset: 0 }, "exit-p")!;
    expect(beforeExit.intent).toBe("exit-before");
    const applied = applyOperations(before, beforeExit.operations);
    expect(applied.children[0]).toMatchObject({
      children: [
        { type: "list_item", children: [{ type: "paragraph", id: "exit-p" }] },
        { type: "list_item", id: "item-1", children: [{ type: "code_block", id: "code" }] },
      ],
    });
  });

  it("does not create a new list item when the code block isn't at the boundary of its list item", () => {
    const before = doc({
      type: "list", id: "list", attrs: { style: "decimal" }, children: [
        { type: "list_item", id: "item-1", children: [code("code", "line\n"), { type: "paragraph", id: "trailing", children: [] }] },
      ],
    });
    // Exiting after the code block, which is followed by another block in
    // the same item - stays a plain sibling block within that item, since
    // this isn't the "nothing left in this item" case the fix targets.
    const afterExit = exitCodeBlock(before, { path: [0, 0, 0], offset: 5 }, "exit-p")!;
    const applied = applyOperations(before, afterExit.operations);
    expect(applied.children[0]).toMatchObject({
      children: [{ type: "list_item", id: "item-1", children: [{ type: "code_block" }, { type: "paragraph", id: "exit-p" }, { type: "paragraph", id: "trailing" }] }],
    });
  });

  it("inserts canonical fragments as plain text with marks stripped", () => {
    const before = doc(code("code", "a"));
    const fragment = doc(
      { type: "heading", id: "h", attrs: { level: 2 }, children: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }] },
      { type: "paragraph", id: "p", children: [{ type: "text", text: "plain" }] },
    );
    const result = insertPlainCodeFragment(before, { path: [0], offset: 1 }, fragment, ctx(before))!;
    expect(applyOperations(before, result.operations).children[0]).toMatchObject({ children: [{ text: "abold\nplain" }] });
  });
});
