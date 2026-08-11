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

  it("continues ordered-list numbering across a middle unwrap split instead of restarting at 1", () => {
    const before = doc(list("ol", [item("a", "A"), item("b", "B"), item("c", "C"), item("d", "D")], { style: "decimal" }));
    const after = applyOperations(before, unwrapList(before, scope("ol", ["b"]), { splitListIds: ["ol-after"] }, ctxFor(before)));
    expect(after.children).toMatchObject([
      { type: "list", id: "ol", attrs: { style: "decimal" }, children: [{ id: "a" }] },
      { type: "paragraph", id: "b-p" },
      // "c" and "d" continue as items 3 and 4, not restart at 1 and 2.
      { type: "list", id: "ol-after", attrs: { style: "decimal", start: 3 }, children: [{ id: "c" }, { id: "d" }] },
    ]);
    expect(validate(after, foundationSchema)).toEqual([]);

    // Continuation composes with an already-restarted list, not just the default start of 1.
    const restarted = doc(list("ol2", [item("a", "A"), item("b", "B"), item("c", "C")], { style: "decimal", start: 10 }));
    const afterRestart = applyOperations(restarted, unwrapList(restarted, scope("ol2", ["b"]), { splitListIds: ["ol2-after"] }, ctxFor(restarted)));
    expect(afterRestart.children).toMatchObject([
      { type: "list", id: "ol2", attrs: { start: 10 }, children: [{ id: "a" }] },
      { type: "paragraph", id: "b-p" },
      { type: "list", id: "ol2-after", attrs: { start: 12 }, children: [{ id: "c" }] },
    ]);
  });

  it("preserves nested descendants when unwrapping a depth-zero item", () => {
    const nested = list("nested-descendants", [item("nested-child", "Child")]);
    const before = frozen(doc(list("unwrap-descendants", [
      item("before", "Before"),
      item("selected", "Selected", [nested]),
      item("after", "After"),
    ])));
    const operations = unwrapList(before, scope("unwrap-descendants", ["selected"]), { splitListIds: ["unwrap-after"] }, ctxFor(before));
    const after = applyOperations(before, operations);
    expect(after.children).toMatchObject([
      { type: "list", id: "unwrap-descendants", children: [{ id: "before" }] },
      { type: "paragraph", id: "selected-p" },
      { type: "list", id: "nested-descendants", children: [{ id: "nested-child" }] },
      { type: "list", id: "unwrap-after", children: [{ id: "after" }] },
    ]);
    expect(validate(after, foundationSchema)).toEqual([]);
  });

  it("preserves nesting depth across an unwrap-then-relist round trip", () => {
    const before = doc(list("outer", [
      item("a", "Parent", [list("inner", [item("b", "Child")])]),
    ]));
    // Unwrap just the depth-1 item — this is what the toolbar's toggle-off
    // button does for a single item, and the case withDepthStamp targets.
    const afterUnwrap = applyOperations(before, unwrapList(before, scope("inner", ["b"]), {}, ctxFor(before)));
    const parentItem = (afterUnwrap.children[0] as SmartElementNode).children?.[0] as SmartElementNode;
    expect(parentItem.children).toMatchObject([
      { id: "a-p" },
      { id: "b-p", attrs: { indentLevel: 1 } },
    ]);
    expect(validate(afterUnwrap, foundationSchema)).toEqual([]);

    // Re-select both now-sibling paragraphs and rebuild a list from them.
    const relistScope = {
      kind: "block-range" as const,
      blockIds: ["a-p", "b-p"],
      promotedFromPartial: true,
      commonParentId: "a",
      range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } },
      isolatingAncestorId: null,
      clamped: false,
    };
    const relisted = applyOperations(afterUnwrap, createList(afterUnwrap, relistScope, {
      listIds: ["new-outer", "new-inner", "spare"], itemIds: ["new-a", "new-b"], style: "disc",
    }, ctxFor(afterUnwrap)));
    const rebuiltParentItem = (relisted.children[0] as SmartElementNode).children?.[0] as SmartElementNode;
    expect(rebuiltParentItem.children).toMatchObject([{
      type: "list", children: [{
        type: "list_item", id: "new-a", children: [
          { id: "a-p" },
          { type: "list", children: [{ type: "list_item", id: "new-b", children: [{ id: "b-p" }] }] },
        ],
      }],
    }]);
    // Nesting depth came back; the reconstructed paragraph no longer carries
    // the transient indentLevel hint used to encode it.
    const rebuiltOuter = rebuiltParentItem.children?.[0] as SmartElementNode;
    const rebuiltInner = (rebuiltOuter.children?.[0] as SmartElementNode).children?.[1] as SmartElementNode;
    const rebuiltLeaf = (rebuiltInner.children?.[0] as SmartElementNode).children?.[0] as SmartElementNode;
    expect(rebuiltLeaf.attrs?.indentLevel).toBeUndefined();
    expect(validate(relisted, foundationSchema)).toEqual([]);
  });

  it("clamps a depth jump greater than one when rebuilding a list", () => {
    const before = doc(p("x", "Top"), p("y", "Deep"));
    const deep = { ...before.children[1] as SmartElementNode, attrs: { indentLevel: 5 } };
    const withIndent = { ...before, children: [before.children[0], deep] };
    const relistScope = {
      kind: "block-range" as const,
      blockIds: ["x", "y"],
      promotedFromPartial: true,
      commonParentId: "doc",
      range: { from: { path: [], offset: 0 }, to: { path: [], offset: 2 } },
      isolatingAncestorId: null,
      clamped: false,
    };
    const relisted = applyOperations(withIndent, createList(withIndent, relistScope, {
      listIds: ["l1", "l2", "l3"], itemIds: ["i-x", "i-y"], style: "disc",
    }, ctxFor(withIndent)));
    // "y" asked for depth 5 with no predecessor deeper than 0 — it can only
    // nest one level past "x", exactly like indentList's own predecessor rule.
    expect(relisted.children[0]).toMatchObject({ children: [{
      id: "i-x", children: [
        { id: "x" },
        { type: "list", children: [{ id: "i-y", children: [{ id: "y" }] }] },
      ],
    }] });
    expect(validate(relisted, foundationSchema)).toEqual([]);
  });

  it("indents only the selected line, hoisting its own nested children to siblings", () => {
    // Indent is a decision about the selected line, not its whole subtree: a
    // moved item's own nested list unwraps one level rather than moving
    // deeper along with it, so nested content doesn't silently end up one
    // level deeper than the user was working at.
    const child = list("child", [item("b-child", "BC")], { style: "circle" });
    const before = frozen(doc(list("l", [item("a", "A"), item("b", "B", [child]), item("c", "C")])));
    const indentedOps = indentList(before, scope("l", ["b"]), { nestedListIds: ["nested"] }, ctxFor(before));
    const indented = applyOperations(before, indentedOps);
    expect(indented.children[0]).toMatchObject({ children: [
      { id: "a", children: [{ id: "a-p" }, { type: "list", id: "nested", children: [
        { id: "b", children: [{ id: "b-p" }] },
        { id: "b-child", children: [{ id: "b-child-p" }] },
      ] }] },
      { id: "c" },
    ] });
    // "b" no longer carries its own nested list — it and "b-child" are now
    // independent siblings, matching the pre-indent flattened view.
    const bItem = (((indented.children[0] as SmartElementNode).children?.[0] as SmartElementNode)
      .children?.[1] as SmartElementNode).children?.[0] as SmartElementNode;
    expect(bItem.children).toHaveLength(1);
    expect(validate(indented, foundationSchema)).toEqual([]);

    // A child with its own nested structure keeps that structure intact when
    // hoisted — only the directly-indented item's own list unwraps.
    const grandchild = list("grandchild", [item("b-grandchild", "GC")], { style: "circle" });
    const deepChild = list("deep-child", [item("b-deep-child", "DC", [grandchild])], { style: "circle" });
    const deepBefore = doc(list("dl", [item("da", "A"), item("db", "B", [deepChild]), item("dc", "C")]));
    const deepIndented = applyOperations(deepBefore, indentList(deepBefore, scope("dl", ["db"]), { nestedListIds: ["deep-nested"] }, ctxFor(deepBefore)));
    expect(deepIndented.children[0]).toMatchObject({ children: [
      { id: "da", children: [{ id: "da-p" }, { type: "list", id: "deep-nested", children: [
        { id: "db", children: [{ id: "db-p" }] },
        { id: "b-deep-child", children: [{ id: "b-deep-child-p" }, { type: "list", id: "grandchild", children: [{ id: "b-grandchild" }] }] },
      ] }] },
      { id: "dc" },
    ] });
    expect(validate(deepIndented, foundationSchema)).toEqual([]);
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
    expect(model.children[0]).toMatchObject({ attrs: { checkable: true, style: "upper-roman" }, children: [
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

  it("replaces the active list marker across numbered, bulleted, checklist, and numbered transitions", () => {
    const before = doc(list("transition-list", [item("transition-item", "item")], { preset: "ordered-outline" }));
    let model = applyOperations(before, setListStyle(before, scope("transition-list", ["transition-item"]), { style: "disc", checkable: false }, ctxFor(before)));
    expect(model.children[0]).toMatchObject({ attrs: { style: "disc", checkable: false } });
    expect((model.children[0] as SmartElementNode).attrs?.preset).toBeUndefined();

    model = applyOperations(model, setListStyle(model, scope("transition-list", ["transition-item"]), { style: "disc", checkable: true }, ctxFor(model)));
    expect(model.children[0]).toMatchObject({ attrs: { style: "disc", checkable: true } });
    expect((model.children[0] as SmartElementNode).attrs?.preset).toBeUndefined();

    model = applyOperations(model, setListPreset(model, scope("transition-list", ["transition-item"]), { preset: "ordered-outline" }, ctxFor(model)));
    expect(model.children[0]).toMatchObject({ attrs: { preset: "ordered-outline" } });
    expect((model.children[0] as SmartElementNode).attrs?.style).toBeUndefined();
  });

  it("applies every canonical toolbar preset through the same pure command", () => {
    const presets = [
      "bullet-disc", "bullet-diamond", "bullet-square", "bullet-arrow", "bullet-star", "bullet-arrow-circle",
      "ordered-decimal", "ordered-decimal-paren", "ordered-outline", "ordered-upper-alpha", "ordered-upper-roman", "ordered-leading-zero",
    ] as const;
    presets.forEach((preset) => {
      const before = doc(list(`preset-${preset}`, [item(`item-${preset}`, "item")], { preset: "bullet-disc" }));
      const after = applyOperations(before, setListPreset(
        before,
        scope(`preset-${preset}`, [`item-${preset}`]),
        { preset },
        ctxFor(before),
      ));
      expect(after.children[0]).toMatchObject({ type: "list", attrs: { preset } });
      expect((after.children[0] as SmartElementNode).attrs?.style).toBeUndefined();
      expect(validate(after, foundationSchema)).toEqual([]);
    });
  });

  it("cascades preset and style changes into nested lists so their markers stay consistent", () => {
    const grandchild = list("grandchild", [item("gc-item", "gc")], { preset: "bullet-disc" });
    const child = list("child", [item("c-item", "c", [grandchild])], { preset: "bullet-disc" });
    const before = doc(list("l", [item("a", "A", [child])], { preset: "bullet-disc" }));

    const afterPreset = applyOperations(before, setListPreset(before, scope("l", ["a"]), { preset: "ordered-upper-roman" }, ctxFor(before)));
    const outerAfterPreset = afterPreset.children[0] as SmartElementNode;
    const childAfterPreset = (outerAfterPreset.children?.[0] as SmartElementNode).children?.[1] as SmartElementNode;
    const grandchildAfterPreset = (childAfterPreset.children?.[0] as SmartElementNode).children?.[1] as SmartElementNode;
    expect(outerAfterPreset.attrs).toMatchObject({ preset: "ordered-upper-roman" });
    expect(childAfterPreset.attrs).toMatchObject({ preset: "ordered-upper-roman" });
    expect(grandchildAfterPreset.attrs).toMatchObject({ preset: "ordered-upper-roman" });
    // Node identity survives the cascade; only attrs changed.
    expect(childAfterPreset.id).toBe("child");
    expect(grandchildAfterPreset.id).toBe("grandchild");
    expect(validate(afterPreset, foundationSchema)).toEqual([]);

    const afterStyle = applyOperations(before, setListStyle(before, scope("l", ["a"]), { style: "circle", checkable: true }, ctxFor(before)));
    const outerAfterStyle = afterStyle.children[0] as SmartElementNode;
    const childAfterStyle = (outerAfterStyle.children?.[0] as SmartElementNode).children?.[1] as SmartElementNode;
    expect(outerAfterStyle.attrs).toMatchObject({ style: "circle", checkable: true });
    expect(childAfterStyle.attrs).toMatchObject({ style: "circle" });
    // checkable is a semantic decision about the selected list, not a marker
    // — it must not silently make every nested sublist checkable too.
    expect(childAfterStyle.attrs?.checkable).toBeUndefined();
  });

  it("rejects a preset ID that is outside the canonical catalog", () => {
    const before = doc(list("invalid-preset-list", [item("invalid-preset-item", "item")], { style: "disc" }));
    expect(setListPreset(
      before,
      scope("invalid-preset-list", ["invalid-preset-item"]),
      { preset: "bullet-circle" },
      ctxFor(before),
    )).toEqual([]);
    const invalidDocument = doc(list("invalid-preset-list", [item("invalid-preset-item", "item")], { preset: "bullet-circle" }));
    expect(validate(invalidDocument, foundationSchema).some((issue) => issue.code === "invalid-attribute")).toBe(true);
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

  it("keeps outdent legal after indent reaches a nested list boundary", () => {
    const before = doc(list("l", [item("a", "A"), item("b", "B")]));
    const indented = applyOperations(before, indentList(before, scope("l", ["b"]), { nestedListIds: ["nested"] }, ctxFor(before)));
    const outer = indented.children[0] as SmartElementNode;
    const nested = (outer.children?.[0] as SmartElementNode).children?.find((node) => !("text" in node) && node.type === "list") as SmartElementNode;
    expect(nested?.children?.map((node) => "id" in node ? node.id : "text")).toEqual(["b"]);

    const outdentOperations = outdentList(indented, scope("nested", ["b"], [1]), { splitListIds: ["split"] }, ctxFor(indented));
    expect(outdentOperations).not.toHaveLength(0);
    const restored = applyOperations(indented, outdentOperations);
    expect(restored.children[0]).toMatchObject({ children: [{ id: "a" }, { id: "b" }] });
    expect(validate(restored, foundationSchema)).toEqual([]);
  });
});
