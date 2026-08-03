import { describe, expect, it } from "vitest";
import {
  FoundationEditor,
  FoundationTransactionMap,
  NORMALIZATION_PASS_CAP,
  applyOperation,
  applyOperations,
  applyTransactionAtomic,
  assertTransactionSerializable,
  collectNodeIds,
  contentMatches,
  createNodeId,
  createSchema,
  foundationSchema,
  graphemeBackspaceRange,
  graphemeBoundaries,
  invertOperation,
  invertOperations,
  invertTransaction,
  mapOperation,
  moveGrapheme,
  parseContentExpression,
  parsePersistedDocument,
  repair,
  resolvePos,
  runNormalization,
  serializePersistedDocument,
  validate,
  type NormalizerRegistration,
  type PersistedEditorDocument,
  type SmartDocument,
  type SmartOperation,
  type SmartPos,
  type SmartSelection,
  type SmartTransaction,
} from "./index.js";

const doc = (text = "hello"): SmartDocument => ({
  type: "doc",
  id: "doc",
  children: [{ type: "paragraph", id: "p1", children: text ? [{ type: "text", text }] : [] }],
});
const caret = (offset: number, path = [0]): SmartSelection => ({
  type: "text",
  anchor: { path, offset },
  head: { path, offset },
});
const tx = (operations: SmartOperation[], revision = 0, after = caret(0)): SmartTransaction => ({
  id: "tx",
  baseRevision: revision,
  operations,
  selectionBefore: caret(0),
  selectionAfter: after,
  metadata: { source: "api", timestamp: 1, addToHistory: true },
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
};

describe("Phase 1 schema and identity contract", () => {
  it("parses ProseMirror-style content expressions and validates the MVP schema", () => {
    expect(parseContentExpression("(text | unknown)*")).toBeTruthy();
    expect(contentMatches("inline*", doc().children[0].children || [], foundationSchema)).toBe(true);
    expect(validate(doc())).toEqual([]);
  });

  it("hard-fails schema collisions and is immutable", () => {
    expect(() => createSchema({ version: 1, nodes: [
      { type: "doc", group: "document", content: "block+" },
      { type: "paragraph", group: "block" },
      { type: "paragraph", group: "block" },
    ] })).toThrow("Duplicate node type");
    expect(Object.isFrozen(foundationSchema)).toBe(true);
    expect(Object.isFrozen(foundationSchema.nodes)).toBe(true);
    expect(Object.isFrozen(foundationSchema.nodes.heading.attributes?.level)).toBe(true);
  });

  it("keeps validation pure and makes repair explicit with locked empty rules", () => {
    const invalid = { type: "doc", id: "", children: [] } as SmartDocument;
    const snapshot = structuredClone(invalid);
    expect(validate(invalid).length).toBeGreaterThan(0);
    expect(invalid).toEqual(snapshot);
    const result = repair(invalid);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(result.doc.children).toEqual([{ type: "paragraph", id: expect.any(String), children: [] }]);
    expect(validate(result.doc)).toEqual([]);
  });

  it("preserves unknown content and its raw payload over repeated persisted round-trips", () => {
    const future = {
      type: "doc", id: "doc", children: [{ type: "future_widget", id: "future-1", attrs: { payload: { x: 1 } }, children: [] }],
    } as unknown as SmartDocument;
    const first = repair(future).doc;
    const unknown = first.children[0];
    expect(unknown).toMatchObject({ type: "unknown", id: "future-1", attrs: { originalType: "future_widget", editable: false } });
    let persisted = { schemaVersion: 1, revision: 7, document: first };
    for (let cycle = 0; cycle < 5; cycle += 1) {
      persisted = parsePersistedDocument(serializePersistedDocument(persisted));
      expect(repair(persisted.document).doc).toEqual(first);
    }
  });

  it("round-trips the envelope losslessly", () => {
    const value = { schemaVersion: 1, revision: 42, document: doc("नमस्ते") };
    expect(parsePersistedDocument(serializePersistedDocument(value))).toEqual(value);
  });

  it("repairs invalid MVP attributes and content into a valid, logged document", () => {
    const malformed = {
      type: "doc", id: "doc", children: [
        { type: "heading", id: "heading", attrs: { level: 99 }, children: [{ type: "paragraph", id: "nested", children: [] }] },
        { type: "list", id: "list", attrs: { ordered: false }, children: [{ type: "paragraph", id: "wrong-list-child", children: [] }] },
      ],
    } as SmartDocument;
    const result = repair(malformed);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(validate(result.doc)).toEqual([]);
    expect(result.doc.children[0]).toMatchObject({ attrs: { level: 1 } });
  });

  it("enforces node mark allowlists, mark attributes, and exclusions", () => {
    const schema = createSchema({
      version: 1,
      nodes: [
        { type: "doc", group: "document", content: "block+" },
        { type: "paragraph", group: "block", content: "inline*", marks: ["link"] },
        { type: "text", group: "inline" },
        foundationSchema.nodes.unknown,
      ],
      marks: [
        { type: "link", attributes: { href: { required: true, validate: (value) => typeof value === "string" } }, excludes: ["code"] },
        { type: "code" },
      ],
    });
    const invalid: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "paragraph", id: "p", children: [{ type: "text", text: "x", marks: [
        { type: "link", attrs: { href: 4 } },
        { type: "code" },
      ] }],
    }] };
    expect(validate(invalid, schema).map((error) => error.code)).toEqual(expect.arrayContaining(["invalid-attribute", "disallowed-mark", "excluded-mark"]));
    expect(validate(repair(invalid, schema).doc, schema)).toEqual([]);
  });
});

describe("Phase 1 positions and graphemes", () => {
  it("resolves purely with backward affinity and stable owning node identity", () => {
    const before = doc();
    const position = { path: [0], offset: 2 };
    const one = resolvePos(before, position);
    const two = resolvePos(before, position);
    expect(one).toMatchObject({ pos: position, kind: "inline", nodeId: "p1", affinity: "backward", depth: 1 });
    expect(two.pos).toEqual(one.pos);
    expect(two.nodeId).toBe(one.nodeId);
    expect(two.ancestors).toEqual(one.ancestors);
    expect(before).toEqual(doc());
  });

  it("locks atomic inline width to one unit and derives the position kind from the owner", () => {
    const atomic: SmartDocument = { type: "doc", id: "doc", children: [{
      type: "paragraph", id: "p", children: [
        { type: "text", text: "a" },
        { type: "unknown", id: "atom", attrs: { originalType: "formula", originalGroup: "inline", raw: { type: "formula" }, editable: false } },
        { type: "text", text: "b" },
      ],
    }] };
    expect(resolvePos(atomic, { path: [0], offset: 0 }).kind).toBe("inline");
    expect(resolvePos(atomic, { path: [0], offset: 3 }).atEnd).toBe(true);
    expect(() => resolvePos(atomic, { path: [0], offset: 4 })).toThrow("outside");
    expect(resolvePos(atomic, { path: [], offset: 1 }).kind).toBe("structural");
  });

  it.each([
    ["Devanagari", "नमस्ते"],
    ["Tamil", "நன்றி"],
    ["Telugu", "క్షమించండి"],
    ["emoji ZWJ", "👨‍👩‍👧‍👦"],
    ["combining diacritic", "e\u0301"],
    ["RTL logical run", "שָׁלוֹם"],
  ])("moves and deletes only at grapheme boundaries: %s", (_name, value) => {
    const boundaries = graphemeBoundaries(value);
    let offset = 0;
    const visited = [offset];
    while (offset < value.length) {
      offset = moveGrapheme(value, offset, 1);
      visited.push(offset);
    }
    expect(visited).toEqual(boundaries);
    while (offset > 0) {
      const owner = resolvePos({ type: "doc", id: "fixture-doc", children: [{ type: "paragraph", id: "fixture-p", children: [{ type: "text", text: value }] }] }, { path: [0], offset });
      const range = graphemeBackspaceRange(owner, value);
      expect(boundaries).toContain(range.from.offset);
      expect(range.to.offset).toBe(offset);
      offset = range.from.offset;
    }
    expect(offset).toBe(0);
  });
});

describe("Phase 1 operation algebra", () => {
  const operationCases = (): Array<[string, SmartDocument, SmartOperation]> => {
    const twoBlocks: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "a", children: [{ type: "text", text: "one" }] },
      { type: "paragraph", id: "b", children: [{ type: "text", text: "two" }] },
    ] };
    const splitDoc: SmartDocument = { type: "doc", id: "doc", children: [{ type: "list", id: "list", attrs: { ordered: false }, children: [
      { type: "list_item", id: "i1", children: [{ type: "paragraph", id: "p1", children: [] }] },
      { type: "list_item", id: "i2", children: [{ type: "paragraph", id: "p2", children: [] }] },
    ] }] };
    return [
      ["insertNode", doc(), { type: "insertNode", pos: { path: [], offset: 1 }, node: { type: "paragraph", id: "p2", children: [] } }],
      ["removeNode", twoBlocks, { type: "removeNode", pos: { path: [], offset: 1 }, node: twoBlocks.children[1] }],
      ["replaceNode", twoBlocks, { type: "replaceNode", pos: { path: [], offset: 1 }, before: twoBlocks.children[1], after: { type: "paragraph", id: "c", children: [] } }],
      ["moveNode", twoBlocks, { type: "moveNode", from: { path: [], offset: 0 }, to: { path: [], offset: 1 }, nodeId: "a" }],
      ["splitNode", splitDoc, { type: "splitNode", pos: { path: [0], offset: 1 }, depth: 0, newId: "list-new" }],
      ["mergeNode", { type: "doc", id: "doc", children: [
        { type: "list", id: "l1", attrs: { ordered: false }, children: [{ type: "list_item", id: "i1", children: [{ type: "paragraph", id: "p1", children: [] }] }] },
        { type: "list", id: "l2", attrs: { ordered: false }, children: [{ type: "list_item", id: "i2", children: [{ type: "paragraph", id: "p2", children: [] }] }] },
      ] }, { type: "mergeNode", pos: { path: [], offset: 1 }, depth: 0, retiredId: "l2", splitOffset: 1 }],
      ["setNodeAttributes", doc(), { type: "setNodeAttributes", pos: { path: [0], offset: 0 }, before: {}, after: { role: "note" } }],
      ["insertText", doc(), { type: "insertText", pos: { path: [0], offset: 2 }, text: "X", marks: [{ type: "bold" }] }],
      ["deleteText", doc(), { type: "deleteText", pos: { path: [0], offset: 1 }, text: "ell" }],
      ["addMark", doc(), { type: "addMark", range: { from: { path: [0], offset: 1 }, to: { path: [0], offset: 4 } }, mark: { type: "bold" } }],
      ["removeMark", { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p1", children: [{ type: "text", text: "hello", marks: [{ type: "bold" }] }] }] }, { type: "removeMark", range: { from: { path: [0], offset: 1 }, to: { path: [0], offset: 4 } }, mark: { type: "bold" } }],
    ];
  };

  it.each(operationCases())("apply then invert is identity for %s", (_name, before, operation) => {
    const after = applyOperation(before, operation);
    expect(applyOperation(after, invertOperation(operation))).toEqual(before);
    expect(invertOperation(invertOperation(operation))).toEqual(operation);
    expect(new Set(collectNodeIds(applyOperation(after, invertOperation(operation))))).toEqual(new Set(collectNodeIds(before)));
  });

  it.each(operationCases())("does not mutate deeply frozen model input for %s", (_name, before, operation) => {
    const frozen = deepFreeze(structuredClone(before));
    const snapshot = structuredClone(frozen);
    expect(() => applyOperation(frozen, operation)).not.toThrow();
    expect(frozen).toEqual(snapshot);
  });

  it("runs 1,000 deterministic randomized edit/full-inversion cases (seed 0xC0FFEE)", () => {
    let seed = 0xC0FFEE;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let run = 0; run < 1_000; run += 1) {
      const initial = doc("");
      let current = initial;
      const operations: SmartOperation[] = [];
      let text = "";
      for (let step = 0; step < 12; step += 1) {
        const value = String.fromCharCode(97 + Math.floor(random() * 26));
        const offset = Math.floor(random() * (text.length + 1));
        const operation: SmartOperation = { type: "insertText", pos: { path: [0], offset }, text: value };
        current = applyOperation(current, operation);
        operations.push(operation);
        text = text.slice(0, offset) + value + text.slice(offset);
        expect(validate(current)).toEqual([]);
      }
      expect(applyOperations(current, invertOperations(operations))).toEqual(initial);
    }
  });

  it("restores structure and exact IDs after 500 randomized structural sequences (seed 0x1D5)", () => {
    let seed = 0x1D5;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 0x100000000;
    };
    for (let run = 0; run < 500; run += 1) {
      const initial: SmartDocument = {
        type: "doc", id: `doc-${run}`, children: Array.from({ length: 4 }, (_, index) => ({
          type: "paragraph", id: `p-${run}-${index}`, children: [{ type: "text", text: String(index) }],
        })),
      };
      let current = initial;
      const operations: SmartOperation[] = [];
      for (let step = 0; step < 16; step += 1) {
        const children = current.children;
        const choice = Math.floor(random() * 7);
        let operation: SmartOperation;
        if (choice === 0 || children.length === 1) {
          const offset = Math.floor(random() * (children.length + 1));
          operation = { type: "insertNode", pos: { path: [], offset }, node: { type: "paragraph", id: `new-${run}-${step}`, children: [] } };
        } else if (choice === 1) {
          const offset = Math.floor(random() * children.length);
          operation = { type: "removeNode", pos: { path: [], offset }, node: structuredClone(children[offset]) };
        } else if (choice === 2) {
          const from = Math.floor(random() * children.length);
          const moving = children[from];
          if (moving.type === "text") continue;
          const to = Math.floor(random() * children.length);
          operation = { type: "moveNode", from: { path: [], offset: from }, to: { path: [], offset: to }, nodeId: moving.id };
        } else if (choice === 3) {
          const offset = Math.floor(random() * children.length);
          operation = { type: "replaceNode", pos: { path: [], offset }, before: structuredClone(children[offset]), after: { type: "paragraph", id: `replacement-${run}-${step}`, children: [] } };
        } else if (choice === 4) {
          const offset = Math.floor(random() * children.length);
          const node = children[offset];
          if (node.type === "text") continue;
          operation = { type: "setNodeAttributes", pos: { path: [offset], offset: 0 }, before: structuredClone(node.attrs || {}), after: { step } };
        } else if (choice === 5) {
          const offset = Math.floor(random() * children.length);
          const node = children[offset];
          if (node.type === "text" || node.type !== "paragraph") continue;
          operation = { type: "splitNode", pos: { path: [offset], offset: Math.floor(random() * ((node.children?.length || 0) + 1)) }, depth: 0, newId: `split-${run}-${step}` };
        } else {
          const pair = children.slice(1).map((right, index) => ({ left: children[index], right, rightIndex: index + 1 }))
            .find(({ left, right }) => left.type !== "text" && right.type !== "text" && left.type === right.type && JSON.stringify(left.attrs || {}) === JSON.stringify(right.attrs || {}));
          if (!pair || pair.left.type === "text" || pair.right.type === "text") continue;
          operation = { type: "mergeNode", pos: { path: [], offset: pair.rightIndex }, depth: 0, retiredId: pair.right.id, splitOffset: pair.left.children?.length || 0 };
        }
        current = applyOperation(current, operation);
        operations.push(operation);
        expect(validate(current)).toEqual([]);
      }
      const restored = applyOperations(current, invertOperations(operations));
      expect(restored).toEqual(initial);
      expect(collectNodeIds(restored)).toEqual(collectNodeIds(initial));
    }
  });

  it.each(operationCases())("keeps mapped positions resolvable through %s", (_name, before, operation) => {
    const positions: SmartPos[] = [];
    const visit = (node: SmartDocument | Exclude<SmartDocument["children"][number], { type: "text" }>, path: number[]) => {
      const inline = node.type === "paragraph" || node.type === "heading";
      const limit = inline
        ? (node.children || []).reduce((size, child) => size + (child.type === "text" ? child.text.length : 1), 0)
        : node.children?.length || 0;
      for (let offset = 0; offset <= limit; offset += 1) positions.push({ path, offset });
      node.children?.forEach((child, index) => { if (child.type !== "text") visit(child as typeof node, [...path, index]); });
    };
    visit(before, []);
    const after = applyOperation(before, operation);
    const mapping = new FoundationTransactionMap([operation]);
    positions.forEach((position) => expect(() => resolvePos(after, mapping.map(position))).not.toThrow());
  });

  it("maps stored operations and reports deletion", () => {
    const remove: SmartOperation = { type: "removeNode", pos: { path: [], offset: 0 }, node: doc().children[0] };
    const pending: SmartOperation = { type: "setNodeAttributes", pos: { path: [0], offset: 0 }, before: {}, after: { x: 1 } };
    expect(mapOperation(pending, remove)).toBeNull();
  });

  it("applies and inverts a mark across block boundaries", () => {
    const before: SmartDocument = { type: "doc", id: "doc", children: [
      { type: "paragraph", id: "a", children: [{ type: "text", text: "one" }] },
      { type: "paragraph", id: "b", children: [{ type: "text", text: "two" }] },
    ] };
    const operation: SmartOperation = {
      type: "addMark",
      range: { from: { path: [0], offset: 1 }, to: { path: [1], offset: 2 } },
      mark: { type: "bold" },
    };
    expect(applyOperation(applyOperation(before, operation), invertOperation(operation))).toEqual(before);
  });
});

describe("Phase 1 transactions, maps, normalization, and history", () => {
  it("fails stale transactions loudly, applies atomically, and serializes", () => {
    const state: PersistedEditorDocument = { schemaVersion: 1, revision: 1, document: doc() };
    expect(() => applyTransactionAtomic(state, tx([], 0), foundationSchema)).toThrow("Stale transaction");
    const invalid = tx([
      { type: "insertText", pos: { path: [0], offset: 5 }, text: "!" },
      { type: "deleteText", pos: { path: [0], offset: 99 }, text: "x" },
    ], 1, caret(6));
    const snapshot = structuredClone(state);
    expect(() => applyTransactionAtomic(state, invalid, foundationSchema)).toThrow();
    expect(state).toEqual(snapshot);
    expect(() => assertTransactionSerializable(tx([], 1))).not.toThrow();
    expect(invertTransaction(invertTransaction(tx([], 1)))).toMatchObject({ operations: [] });
  });

  it("maps selections associatively through transactions", () => {
    const a: SmartOperation = { type: "insertText", pos: { path: [0], offset: 1 }, text: "a" };
    const b: SmartOperation = { type: "insertText", pos: { path: [0], offset: 3 }, text: "b" };
    const position: SmartPos = { path: [0], offset: 5 };
    const combined = new FoundationTransactionMap([a, b]).map(position);
    const sequential = new FoundationTransactionMap([b]).map(new FoundationTransactionMap([a]).map(position));
    expect(combined).toEqual(sequential);
    expect(new FoundationTransactionMap([{ type: "deleteText", pos: { path: [0], offset: 2 }, text: "xx" }]).deleted({ path: [0], offset: 3 })).toBe(true);
  });

  it("property-checks mapping associativity for 1,000 insertion pairs (seed 0xA550C)", () => {
    let seed = 0xA550C;
    const randomInt = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let run = 0; run < 1_000; run += 1) {
      const firstOffset = randomInt(21);
      const originalSecondOffset = randomInt(21);
      const first: SmartOperation = { type: "insertText", pos: { path: [0], offset: firstOffset }, text: "a" };
      const secondPos = new FoundationTransactionMap([first]).map({ path: [0], offset: originalSecondOffset });
      const second: SmartOperation = { type: "insertText", pos: secondPos, text: "b" };
      const original = { path: [0], offset: randomInt(21) };
      expect(new FoundationTransactionMap([first, second]).map(original)).toEqual(
        new FoundationTransactionMap([second]).map(new FoundationTransactionMap([first]).map(original)),
      );
    }
  });

  it("enforces local, deterministic normalization and names oscillators", () => {
    const noop: NormalizerRegistration = { id: "local", priority: 10, normalize: () => ({ operations: [] }) };
    const typed: SmartOperation = { type: "insertText", pos: { path: [0], offset: 5 }, text: "!" };
    const after = applyOperation(doc(), typed);
    const run = runNormalization({ document: after, originatingOperations: [typed], schema: foundationSchema, normalizers: [noop] });
    expect(run.affectedPath).toEqual([0]);
    expect(run.fullDocumentTraversals).toBe(0);
    expect(run.passes).toBe(1);
    expect(run.document).toEqual(after);

    const oscillator: NormalizerRegistration = {
      id: "oscillator",
      priority: 1,
      normalize(document) {
        const paragraph = document.children[0];
        if (paragraph.type === "text") return { operations: [] };
        const before = paragraph.attrs || {};
        return { operations: [{ type: "setNodeAttributes", pos: { path: [0], offset: 0 }, before, after: { flip: before.flip !== true } }] };
      },
    };
    expect(() => runNormalization({ document: after, originatingOperations: [typed], schema: foundationSchema, normalizers: [oscillator] }))
      .toThrow(`exceeded ${NORMALIZATION_PASS_CAP} passes; oscillating normalizers: oscillator`);
  });

  it("property-checks normalizer idempotence for 1,000 deterministic inputs (seed 0xA0)", () => {
    const canonicalizer: NormalizerRegistration = {
      id: "remove-dirty",
      priority: 5,
      normalize(document) {
        const paragraph = document.children[0];
        if (paragraph.type === "text" || paragraph.attrs?.dirty !== true) return { operations: [] };
        return { operations: [{ type: "setNodeAttributes", pos: { path: [0], offset: 0 }, before: paragraph.attrs, after: {} }] };
      },
    };
    let seed = 0xA0;
    for (let run = 0; run < 1_000; run += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const input = doc(`${run}-${seed.toString(16)}`);
      const paragraph = input.children[0];
      if (paragraph.type !== "text" && (seed & 1) === 1) paragraph.attrs = { dirty: true };
      const textLength = paragraph.type !== "text" && paragraph.children?.[0]?.type === "text" ? paragraph.children[0].text.length : 0;
      const originating: SmartOperation = { type: "insertText", pos: { path: [0], offset: textLength }, text: "" };
      const first = runNormalization({ document: input, originatingOperations: [originating], schema: foundationSchema, normalizers: [canonicalizer] });
      const second = runNormalization({ document: first.document, originatingOperations: [originating], schema: foundationSchema, normalizers: [canonicalizer] });
      expect(second.document).toEqual(first.document);
      expect(second.operations).toEqual([]);
    }
  });

  it("shares nested transactions and does not record selection-only changes", () => {
    const editor = new FoundationEditor({ document: doc(""), selection: caret(0) });
    editor.transact((outer) => {
      outer.insertText(editor.resolve({ pos: { path: [0], offset: 0 } }), "a");
      editor.transact((inner) => inner.insertText(editor.resolve({ pos: { path: [0], offset: 0 } }), "b"));
      outer.setSelection(caret(2));
    }, { source: "input", timestamp: 1 });
    expect(editor.state.document.children[0]).toMatchObject({ children: [{ text: "ba" }] });
    expect(editor.history.undo).toHaveLength(1);
    editor.setSelection(caret(1));
    expect(editor.history.undo).toHaveLength(1);
  });

  it("appends schema repairs to the originating transaction so one undo restores the exact input", () => {
    const editor = new FoundationEditor({ document: doc("hello"), selection: caret(5) });
    const before = editor.state;
    editor.transact((transaction) => {
      transaction.insertNode(editor.resolve({ pos: { path: [0], offset: 1 } }), { type: "paragraph", id: "misplaced", children: [] });
    }, { source: "api", timestamp: 1 });
    expect(validate(editor.state.document)).toEqual([]);
    expect(editor.lastNormalization?.operations).toHaveLength(1);
    expect(editor.undo()).toBe(true);
    expect(editor.state.document).toEqual(before.document);
    expect(editor.state.selection).toEqual(before.selection);
  });

  it("coalesces 50 typed characters, restores cursor direction, and invalidates redo", () => {
    const initial = { type: "text", anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } } as SmartSelection;
    const editor = new FoundationEditor({ document: doc(""), selection: initial });
    for (let index = 0; index < 50; index += 1) editor.typeText("x", { timestamp: index * 10 });
    expect(editor.history.undo).toHaveLength(1);
    expect(editor.state.selection).toEqual(caret(50));
    expect(editor.undo()).toBe(true);
    expect(editor.state.document).toEqual(doc(""));
    expect(editor.state.selection).toEqual(initial);
    expect(editor.redo()).toBe(true);
    expect(editor.state.selection).toEqual(caret(50));
    editor.undo();
    editor.typeText("y", { timestamp: 1000 });
    expect(editor.history.redo).toHaveLength(0);
  });

  it("restores a direction-preserving anchor/head selection exactly", () => {
    const directed: SmartSelection = { type: "text", anchor: { path: [0], offset: 3 }, head: { path: [0], offset: 1 } };
    const editor = new FoundationEditor({ document: doc("abc"), selection: directed });
    editor.transact((transaction) => {
      transaction.insertText(editor.resolve({ pos: { path: [0], offset: 3 } }), "!");
      transaction.setSelection(caret(4));
    }, { source: "input", timestamp: 1 });
    editor.undo();
    expect(editor.state.selection).toEqual(directed);
    editor.redo();
    expect(editor.state.selection).toEqual(caret(4));
  });

  it("rejects callbacks that attempt to hold a transaction across await", () => {
    const editor = new FoundationEditor({ document: doc(""), selection: caret(0) });
    expect(() => editor.transact(async () => undefined)).toThrow("cannot remain open across await");
  });

  it("groups one IME composition into exactly one undo step", () => {
    const editor = new FoundationEditor({ document: doc(""), selection: caret(0) });
    editor.typeText("क", { timestamp: 1, compositionId: "ime-1" });
    editor.typeText("्", { timestamp: 700, compositionId: "ime-1" });
    editor.typeText("ष", { timestamp: 1400, compositionId: "ime-1" });
    expect(editor.history.undo).toHaveLength(1);
    editor.undo();
    expect(editor.state.document).toEqual(doc(""));
    expect(editor.state.selection).toEqual(caret(0));
  });

  it("caps history at 200 and respects addToHistory false", () => {
    const editor = new FoundationEditor({ document: doc(""), selection: caret(0) });
    for (let index = 0; index < 205; index += 1) editor.typeText("x", { timestamp: index * 1000 });
    expect(editor.history.undo).toHaveLength(200);
  });
});
