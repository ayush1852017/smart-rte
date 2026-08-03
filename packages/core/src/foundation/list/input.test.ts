import { describe, expect, it } from "vitest";
import {
  applyOperations,
  backspaceAtListItemStart,
  createScopeIndex,
  deleteAtListItemEnd,
  enterInList,
  foundationSchema,
  resolveFollowingContentTarget,
  resolvePrecedingContentTarget,
  validate,
  type CommandContext,
  type SmartDocument,
  type SmartElementNode,
  type SmartPos,
} from "../index.js";

const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const item = (id: string, text = "", extra: SmartElementNode[] = []): SmartElementNode => ({ type: "list_item", id, children: [p(`${id}-p`, text), ...extra] });
const list = (id: string, items: SmartElementNode[]): SmartElementNode => ({ type: "list", id, attrs: { style: "disc" }, children: items });
const doc = (...children: SmartElementNode[]): SmartDocument => ({ type: "doc", id: "doc", children });
const ctx = (document: SmartDocument): CommandContext => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
const enterIds = { itemId: "new-item", blockId: "new-block", emptyBlockId: "empty-block" };
const apply = (document: SmartDocument, result: { operations: Parameters<typeof applyOperations>[1] } | null) => {
  expect(result).not.toBeNull();
  const output = applyOperations(document, result!.operations);
  expect(validate(output, foundationSchema)).toEqual([]);
  return output;
};

describe("Phase 3 list Enter matrix", () => {
  it("splits mid-text and keeps nested descendants with the second half", () => {
    const nested = list("nested", [item("child", "child")]);
    const before = doc(list("root", [item("a", "abcd", [nested]), item("b", "B")]));
    const result = enterInList(before, { path: [0, 0, 0], offset: 2 }, enterIds, ctx(before));
    const after = apply(before, result);
    expect(after.children[0]).toMatchObject({ children: [
      { id: "a", children: [{ id: "a-p", children: [{ text: "ab" }] }] },
      { id: "new-item", children: [{ id: "new-block", children: [{ text: "cd" }] }, { id: "nested" }] },
      { id: "b" },
    ] });
    expect(result?.selectionTarget).toEqual({ ownerId: "new-block", offset: 0 });
  });

  it("creates an empty item before at item start while keeping the target with content", () => {
    const before = doc(list("root", [item("a", "A")]));
    const result = enterInList(before, { path: [0, 0, 0], offset: 0 }, enterIds, ctx(before));
    const after = apply(before, result);
    expect(after.children[0]).toMatchObject({ children: [
      { id: "new-item", children: [{ id: "empty-block" }] }, { id: "a" },
    ] });
    expect(result?.selectionTarget).toEqual({ ownerId: "a-p", offset: 0 });
  });

  it("creates an empty item after at item end", () => {
    const before = doc(list("root", [item("a", "A")]));
    const result = enterInList(before, { path: [0, 0, 0], offset: 1 }, enterIds, ctx(before));
    const after = apply(before, result);
    expect(after.children[0]).toMatchObject({ children: [{ id: "a" }, { id: "new-item", children: [{ id: "empty-block" }] }] });
    expect(result?.selectionTarget).toEqual({ ownerId: "empty-block", offset: 0 });
  });

  it("outdents an empty nested item and unwraps an empty depth-zero item", () => {
    const nested = list("nested", [item("empty")]);
    const nestedBefore = doc(list("root", [item("parent", "P", [nested]), item("after", "A")]));
    const nestedResult = enterInList(nestedBefore, { path: [0, 0, 1, 0, 0], offset: 0 }, enterIds, ctx(nestedBefore));
    expect(nestedResult?.intent).toBe("outdent");
    expect(apply(nestedBefore, nestedResult).children[0]).toMatchObject({ children: [{ id: "parent" }, { id: "empty" }, { id: "after" }] });

    const topBefore = doc(list("root", [item("empty")]), p("after", "A"));
    const topResult = enterInList(topBefore, { path: [0, 0, 0], offset: 0 }, enterIds, ctx(topBefore));
    expect(topResult?.intent).toBe("unwrap");
    expect(apply(topBefore, topResult).children).toMatchObject([{ id: "empty-p" }, { id: "after" }]);
  });
});

describe("Phase 3 cross-parent deletion matrix", () => {
  const tree = () => {
    const deepest = list("deep", [item("deep-a", "DA"), item("deep-b", "DB")]);
    const nested = list("nested", [item("nested-a", "NA", [deepest])]);
    return doc(list("root", [item("first", "F", [nested]), item("current", "C"), item("next", "N")]));
  };

  it("resolves Backspace to the deepest last descendant, not the sibling", () => {
    const before = tree();
    expect(resolvePrecedingContentTarget(before, "current", ctx(before))).toEqual({
      ownerId: "deep-b-p",
      lineage: [
        { nodeId: "first", type: "list_item" },
        { nodeId: "nested", type: "list" },
        { nodeId: "nested-a", type: "list_item" },
        { nodeId: "deep", type: "list" },
        { nodeId: "deep-b", type: "list_item" },
        { nodeId: "deep-b-p", type: "paragraph" },
      ],
    });
    const result = backspaceAtListItemStart(before, { path: [0, 1, 0], offset: 0 }, ctx(before));
    expect(result?.intent).toBe("merge-backward");
    const after = apply(before, result);
    expect(JSON.stringify(after)).not.toContain('"id":"current"');
    expect(after.children[0]).toMatchObject({ children: [{ id: "first", children: [{}, { id: "nested", children: [
      { id: "nested-a", children: [{}, { id: "deep", children: [
        { id: "deep-a" }, { id: "deep-b", children: [{ id: "deep-b-p", children: [{ text: "DBC" }] }] },
      ] }] },
    ] }] }, { id: "next" }] });
    expect(result?.selectionTarget).toEqual({ ownerId: "deep-b-p", offset: 2 });
  });

  it("outdents at nested depth and unwraps the first top-level item", () => {
    const nestedBefore = doc(list("root", [item("parent", "P", [list("nested", [item("child", "C")])])]));
    const outdent = backspaceAtListItemStart(nestedBefore, { path: [0, 0, 1, 0, 0], offset: 0 }, ctx(nestedBefore));
    expect(outdent?.intent).toBe("outdent");
    expect(apply(nestedBefore, outdent).children[0]).toMatchObject({ children: [{ id: "parent" }, { id: "child" }] });

    const topBefore = doc(list("root", [item("first", "F"), item("second", "S")]));
    const unwrap = backspaceAtListItemStart(topBefore, { path: [0, 0, 0], offset: 0 }, ctx(topBefore));
    expect(unwrap?.intent).toBe("unwrap");
    expect(apply(topBefore, unwrap).children).toMatchObject([{ id: "first-p" }, { id: "root", children: [{ id: "second" }] }]);
  });

  it("mirrors Delete into the first nested visible content", () => {
    const child = list("nested", [item("child-a", "A"), item("child-b", "B")]);
    const before = doc(list("root", [item("current", "C", [child]), item("after", "Z")]));
    expect(resolveFollowingContentTarget(before, "current", ctx(before))).toEqual({ itemId: "child-a", ownerId: "child-a-p" });
    const result = deleteAtListItemEnd(before, { path: [0, 0, 0], offset: 1 }, ctx(before));
    expect(result?.intent).toBe("merge-forward");
    const after = apply(before, result);
    expect(after.children[0]).toMatchObject({ children: [
      { id: "current", children: [{ id: "current-p", children: [{ text: "CA" }] }, { id: "nested", children: [{ id: "child-b" }] }] },
      { id: "after" },
    ] });
    expect(result?.selectionTarget).toEqual({ ownerId: "current-p", offset: 1 });
  });
});
