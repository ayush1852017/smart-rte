import { describe, expect, it } from "vitest";
import {
  applyOperations,
  continueListNumbering,
  createList,
  createScopeIndex,
  foundationSchema,
  indentList,
  insertListFragment,
  moveListItems,
  outdentList,
  restartListNumbering,
  setListChecked,
  setListPreset,
  setListStyle,
  unwrapList,
  validate,
  type CommandContext,
  type ListSelectionScope,
  type SmartDocument,
  type SmartElementNode,
} from "../index.js";

const p = (id: string, text: string): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const item = (id: string, text: string, children: SmartElementNode[] = []): SmartElementNode => ({
  type: "list_item", id, children: [p(`${id}-p`, text), ...children],
});
const list = (id: string, children: SmartElementNode[], attrs: Record<string, unknown> = { style: "disc" }): SmartElementNode => ({
  type: "list", id, attrs, children,
});
const doc = (...children: SmartElementNode[]): SmartDocument => ({ type: "doc", id: "doc", children });
const ctxFor = (document: SmartDocument): CommandContext => ({
  schema: foundationSchema,
  positions: createScopeIndex().positions(document, foundationSchema),
});
const scope = (listId: string, ids: string[], depths: number[] = ids.map(() => 0)): ListSelectionScope => ({
  kind: "list-selection",
  listId,
  items: ids.map((itemId, index) => ({ itemId, depth: depths[index], hasChildList: false })),
  partialSubtree: false,
  promotedFromPartial: false,
  range: { from: { path: [], offset: 0 }, to: { path: [], offset: 1 } },
  isolatingAncestorId: null,
  clamped: false,
});
const frozen = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
};

describe("Phase 3 pure list commands", () => {
  it("creates a list from blocks without an editor instance", () => {
    const before = frozen(doc(p("a", "A"), p("b", "B"), p("c", "C")));
    const operations = createList(before, {
      kind: "block-range", blockIds: ["a", "b"], promotedFromPartial: true, commonParentId: "doc",
      range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } }, isolatingAncestorId: null, clamped: false,
    }, { listIds: ["l"], itemIds: ["i-a", "i-b"], preset: "bullet-disc" }, ctxFor(before));
    const after = applyOperations(before, operations);
    expect(after.children).toMatchObject([{ type: "list", id: "l", children: [
      { type: "list_item", id: "i-a", children: [{ id: "a" }] },
      { type: "list_item", id: "i-b", children: [{ id: "b" }] },
    ] }, { id: "c" }]);
    expect(validate(after, foundationSchema)).toEqual([]);
  });

  it("unwraps a middle run and splits the list deterministically", () => {
    const before = frozen(doc(list("l", [item("a", "A"), item("b", "B"), item("c", "C")])));
    const operations = unwrapList(before, scope("l", ["b"]), { splitListIds: ["l-after"] }, ctxFor(before));
    const after = applyOperations(before, operations);
    expect(after.children).toMatchObject([
      { type: "list", id: "l", children: [{ id: "a" }] },
      { type: "paragraph", id: "b-p" },
      { type: "list", id: "l-after", children: [{ id: "c" }] },
    ]);
  });

  it("indents a whole subtree and outdents it back", () => {
    const child = list("child", [item("b-child", "BC")], { style: "circle" });
    const before = frozen(doc(list("l", [item("a", "A"), item("b", "B", [child]), item("c", "C")])));
    const indentedOps = indentList(before, scope("l", ["b"]), { nestedListIds: ["nested"] }, ctxFor(before));
    const indented = applyOperations(before, indentedOps);
    expect(indented.children[0]).toMatchObject({ children: [
      { id: "a", children: [{ id: "a-p" }, { type: "list", id: "nested", children: [{ id: "b", children: [{ id: "b-p" }, { id: "child" }] }] }] },
      { id: "c" },
    ] });
    const nestedScope = scope("nested", ["b"], [1]);
    const outdented = applyOperations(indented, outdentList(indented, nestedScope, {}, ctxFor(indented)));
    expect(outdented).toEqual(before);
  });

  it("does not indent the first item", () => {
    const before = doc(list("l", [item("a", "A"), item("b", "B")]));
    expect(indentList(before, scope("l", ["a"]), { nestedListIds: ["nested"] }, ctxFor(before))).toEqual([]);
  });

  it("moves a contiguous item run by one sibling and preserves complete subtrees", () => {
    const nested = list("nested", [item("nested-a", "Nested")]);
    const before = frozen(doc(list("l", [item("a", "A"), item("b", "B", [nested]), item("c", "C"), item("d", "D")])));
    const movedUp = applyOperations(before, moveListItems(before, scope("l", ["b", "c"]), { direction: "up" }, ctxFor(before)));
    expect((movedUp.children[0] as SmartElementNode).children?.map((node) => "id" in node ? node.id : "text")).toEqual(["b", "c", "a", "d"]);
    expect(((movedUp.children[0] as SmartElementNode).children?.[0] as SmartElementNode).children)
      .toMatchObject([{ id: "b-p" }, { id: "nested" }]);

    const movedDown = applyOperations(movedUp, moveListItems(movedUp, scope("l", ["b", "c"]), { direction: "down" }, ctxFor(movedUp)));
    expect(movedDown).toEqual(before);
    expect(moveListItems(before, scope("l", ["a"]), { direction: "up" }, ctxFor(before))).toEqual([]);
    expect(moveListItems(before, scope("l", ["d"]), { direction: "down" }, ctxFor(before))).toEqual([]);
  });

  it("applies preset/style precedence, check state without cascade, and numbering", () => {
    const nested = list("nested", [item("child", "child", [])]);
    let model = doc(list("l", [item("a", "A", [nested]), item("b", "B")], { checkable: true, style: "square" }));
    model = applyOperations(model, setListPreset(model, scope("l", ["a", "b"]), { preset: "ordered-outline" }, ctxFor(model)));
    expect((model.children[0] as SmartElementNode).attrs).toEqual({ checkable: true, preset: "ordered-outline" });
    model = applyOperations(model, setListStyle(model, scope("l", ["a", "b"]), { style: "upper-roman" }, ctxFor(model)));
    model = applyOperations(model, setListChecked(model, scope("l", ["a"]), { checked: true }, ctxFor(model)));
    expect(model.children[0]).toMatchObject({ attrs: { preset: "ordered-outline", style: "upper-roman" }, children: [
      { id: "a", attrs: { checked: true }, children: [{}, { id: "nested", children: [{ id: "child" }] }] },
      { id: "b" },
    ] });
    const top = model.children[0] as SmartElementNode;
    const childItem = ((top.children?.[0] as SmartElementNode).children?.[1] as SmartElementNode).children?.[0] as SmartElementNode;
    expect(childItem.attrs?.checked).toBeUndefined();
    model = applyOperations(model, restartListNumbering(model, scope("l", ["a"]), { start: 7 }, ctxFor(model)));
    expect((model.children[0] as SmartElementNode).attrs?.start).toBe(7);
    model = applyOperations(model, continueListNumbering(model, scope("l", ["a"]), {}, ctxFor(model)));
    expect((model.children[0] as SmartElementNode).attrs?.start).toBeUndefined();
    expect(validate(model, foundationSchema)).toEqual([]);
  });

  it("keeps mixed-scope create and indent policies explicit", () => {
    const before = doc(p("plain", "P"), list("l", [item("a", "A"), item("b", "B")]));
    const mixed = {
      kind: "mixed" as const,
      parts: [
        { kind: "block-range" as const, blockIds: ["plain"], promotedFromPartial: true, commonParentId: "doc", range: { from: { path: [], offset: 0 }, to: { path: [], offset: 1 } }, isolatingAncestorId: null, clamped: false },
        scope("l", ["b"]),
      ],
      range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } }, isolatingAncestorId: null, clamped: false,
    };
    expect(createList(before, mixed, { listIds: ["new-list"], itemIds: ["new-item"], style: "disc" }, ctxFor(before))).toHaveLength(1);
    expect(indentList(before, mixed, { nestedListIds: ["nested"] }, ctxFor(before))).toHaveLength(1);
  });

  it("inserts canonical fragments at every list boundary without parsing clipboard data", () => {
    const base = doc(list("l", [item("a", "A"), item("b", "B")]));
    const listFragment = doc(list("fragment-list", [item("inserted", "I")]));
    const plainFragment = doc(p("plain", "P"));
    const cases = [
      { position: "start" as const, expected: ["inserted", "a", "b"] },
      { position: "before" as const, expected: ["a", "inserted", "b"] },
      { position: "after" as const, expected: ["a", "b", "inserted"] },
      { position: "end" as const, expected: ["a", "b", "inserted"] },
    ];
    cases.forEach(({ position, expected }) => {
      const target = position === "before" || position === "after" ? scope("l", ["b"]) : scope("l", ["a"]);
      const after = applyOperations(base, insertListFragment(base, target, { fragment: listFragment, position }, ctxFor(base)));
      expect((after.children[0] as SmartElementNode).children?.map((node) => "id" in node ? node.id : "text")).toEqual(expected);
    });
    const withPlain = applyOperations(base, insertListFragment(base, scope("l", ["a"]), {
      fragment: plainFragment, position: "after", itemIds: ["plain-item"],
    }, ctxFor(base)));
    expect(withPlain.children[0]).toMatchObject({ children: [{ id: "a" }, { id: "plain-item", children: [{ id: "plain" }] }, { id: "b" }] });
  });
});
