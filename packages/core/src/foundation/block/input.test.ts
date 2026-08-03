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
