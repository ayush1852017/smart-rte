import { describe, expect, it } from "vitest";
import { applyOperations } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema, validate } from "../schema.js";
import type { SmartDocument, SmartSelection } from "../types.js";
import { insertClipboardFragment } from "./insertion.js";

const paragraph = (id: string, text: string) => ({ type: "paragraph" as const, id, children: text ? [{ type: "text" as const, text }] : [] });
const context = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema), idFactory: () => "tail" });
const selection = (path: number[], from: number, to = from): SmartSelection => ({ type: "text", anchor: { path, offset: from }, head: { path, offset: to } });

describe("canonical clipboard fragment insertion", () => {
  it("replaces a selection in one owner while preserving the defining owner identity", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "blockquote", id: "quote", children: [paragraph("p", "before after")] }] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [paragraph("fp", "inserted")] };
    const result = insertClipboardFragment(document, selection([0, 0], 7, 12), fragment, context(document));
    expect(result.definingAncestorId).toBe("quote");
    expect(result.operations).toHaveLength(1);
    const after = applyOperations(document, result.operations);
    const owner = ((after.children[0] as { children: SmartDocument["children"] }).children[0] as { children: Array<{ text?: string }> });
    expect(owner.children.map((child) => child.text || "").join("")).toBe("before inserted");
    expect(after.children[0]).toMatchObject({ id: "quote" });
  });

  it("strips structure and marks when inserting into a code block", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "code_block", id: "code", children: [{ type: "text", text: "ab" }] }] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [
      { type: "heading", id: "h", attrs: { level: 1 }, children: [{ type: "text", text: "X", marks: [{ type: "bold" }] }] },
      paragraph("p", "Y"),
    ] };
    const after = applyOperations(document, insertClipboardFragment(document, selection([0], 1), fragment, context(document)).operations);
    const code = after.children[0] as { id: string; children: Array<{ text?: string; marks?: unknown }> };
    expect(code.id).toBe("code");
    expect(code.children.map((child) => child.text || "").join("")).toBe("aX\nYb");
    expect(code.children.every((child) => child.marks === undefined)).toBe(true);
  });

  it("inserts a grid as a nested table inside a cell without losing the defining cell", () => {
    const nested = { type: "table" as const, id: "nested", children: [{ type: "table_row" as const, id: "nr", children: [{ type: "table_cell" as const, id: "nc", attrs: { rowspan: 1, colspan: 1, header: false }, children: [paragraph("np", "grid")] }] }] };
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "table", id: "outer", children: [{ type: "table_row", id: "r", children: [{ type: "table_cell", id: "cell", attrs: { rowspan: 1, colspan: 1, header: false }, children: [paragraph("p", "cell")] }] }] }] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [nested] };
    const result = insertClipboardFragment(document, selection([0, 0, 0, 0], 4), fragment, context(document));
    const after = applyOperations(document, result.operations);
    expect(validate(after)).toEqual([]);
    expect(JSON.stringify(after)).toContain('"id":"nested"');
    expect(JSON.stringify(after)).toContain('"id":"cell"');
  });

  it("replaces a selected atom with the fragment", () => {
    const atom = { type: "block_image" as const, id: "image", attrs: { src: "https://example.test/a.png", alt: "A", status: "ready" } };
    const document: SmartDocument = { type: "doc", id: "doc", children: [atom, paragraph("after", "after")] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [paragraph("replacement", "text")] };
    const nodeSelection: SmartSelection = { type: "node", anchor: { path: [], offset: 0 }, head: { path: [], offset: 1 } };
    const after = applyOperations(document, insertClipboardFragment(document, nodeSelection, fragment, context(document)).operations);
    expect(JSON.stringify(after)).not.toContain('"id":"image"');
    expect(JSON.stringify(after)).toContain('"id":"replacement"');
  });

  it("replaces a cross-block selection as one operation batch and preserves direction-independent semantics", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [paragraph("a", "alpha"), paragraph("b", "beta"), paragraph("c", "gamma")] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [paragraph("inserted", "X")] };
    const reverse: SmartSelection = { type: "text", anchor: { path: [2], offset: 2 }, head: { path: [0], offset: 2 } };
    const result = insertClipboardFragment(document, reverse, fragment, context(document));
    const after = applyOperations(document, result.operations);
    expect(after.children).toHaveLength(1);
    const remaining = after.children[0] as { id: string; children: Array<{ text?: string }> };
    expect(remaining.id).toBe("a");
    expect(remaining.children.map((node) => node.text || "").join("")).toBe("alXmma");
  });

  it("turns a multi-block fragment pasted in a list into sibling items", () => {
    const document: SmartDocument = { type: "doc", id: "doc", children: [{ type: "list", id: "list", children: [{ type: "list_item", id: "item", children: [paragraph("p", "item")] }] }] };
    const fragment: SmartDocument = { type: "doc", id: "fragment", children: [paragraph("one", "one"), paragraph("two", "two")] };
    let counter = 0;
    const ctx = { ...context(document), idFactory: () => `new-item-${counter++}` };
    const after = applyOperations(document, insertClipboardFragment(document, selection([0, 0, 0], 4), fragment, ctx).operations);
    const list = after.children[0] as { children: unknown[] };
    expect(list.children).toHaveLength(3);
    expect(JSON.stringify(after)).toContain("new-item-0");
    expect(JSON.stringify(after)).toContain("new-item-1");
  });
});
