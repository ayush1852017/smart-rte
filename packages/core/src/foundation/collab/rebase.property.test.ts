import { describe, expect, it } from "vitest";
import { applyOperations } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { foundationSchema } from "../schema.js";
import type { SmartDocument, SmartElementNode, SmartOperation, SmartSelection, SmartTransaction } from "../types.js";
import type { TableGridScope } from "../scope/types.js";
import { insertTableRowCommand, mergeTableCellsCommand, occupancyGridFor, removeTableColumnCommand } from "../table/index.js";
import { rebaseTransaction } from "./rebase.js";

const noSelection: SmartSelection = { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } };
const tx = (operations: readonly SmartOperation[], authorId: string, baseRevision = 0): SmartTransaction => ({
  id: `tx-${authorId}-${Math.random()}`,
  baseRevision,
  operations: [...operations],
  selectionBefore: noSelection,
  selectionAfter: noSelection,
  metadata: { source: "api", timestamp: 0, addToHistory: true, authorId },
});

/**
 * TP1: applying A then (B rebased through [A]) must produce the same
 * document as applying B then (A rebased through [B]) - the formal OT
 * convergence guarantee this whole phase exists to establish. Both
 * `rebaseTransaction` calls use `newBaseRevision: 1` since either ordering
 * only ever applies one prior transaction (revision 0 -> 1).
 */
const assertConverges = (base: SmartDocument, a: SmartTransaction, b: SmartTransaction): { leftDoc: SmartDocument; rightDoc: SmartDocument; leftResult: ReturnType<typeof rebaseTransaction>; rightResult: ReturnType<typeof rebaseTransaction> } => {
  const leftResult = rebaseTransaction(b, [a], 1);
  const rightResult = rebaseTransaction(a, [b], 1);
  const leftDoc = leftResult.kind === "ok"
    ? applyOperations(applyOperations(base, a.operations), leftResult.transaction.operations)
    : applyOperations(base, a.operations);
  const rightDoc = rightResult.kind === "ok"
    ? applyOperations(applyOperations(base, b.operations), rightResult.transaction.operations)
    : applyOperations(base, b.operations);
  return { leftDoc, rightDoc, leftResult, rightResult };
};

const flatDoc = (n: number): SmartDocument => ({
  type: "doc", id: "doc",
  children: Array.from({ length: n }, (_, index) => ({ type: "paragraph", id: `p${index}`, children: [{ type: "text", text: `t${index}` }] })),
});

describe("Phase 12b-client TP1 property: generic operations", () => {
  it("random concurrent insertNode/removeNode/moveNode pairs converge in 1,000 cases (seed 0xC0FFEE)", () => {
    let state = 0xc0ffee;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const N = 8;
    let conflicts = 0;
    let dropped = 0;
    for (let run = 0; run < 1000; run += 1) {
      const base = flatDoc(N);
      const randomOp = (tag: string): SmartOperation => {
        const kind = Math.floor(random() * 3);
        if (kind === 0) return { type: "insertNode", pos: { path: [], offset: Math.floor(random() * (N + 1)) }, node: { type: "paragraph", id: `new-${tag}`, children: [{ type: "text", text: tag }] } };
        if (kind === 1) {
          const offset = Math.floor(random() * N);
          return { type: "removeNode", pos: { path: [], offset }, node: base.children[offset] };
        }
        const from = Math.floor(random() * N);
        const to = Math.floor(random() * N);
        return { type: "moveNode", from: { path: [], offset: from }, to: { path: [], offset: to }, nodeId: base.children[from].id };
      };
      const a = tx([randomOp(`a${run}`)], "author-a");
      const b = tx([randomOp(`b${run}`)], "author-b");
      const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, a, b);
      if (leftResult.kind === "conflict" || rightResult.kind === "conflict") { conflicts += 1; continue; }
      if (leftResult.kind === "dropped" && rightResult.kind === "dropped") { dropped += 1; continue; }
      expect(leftDoc).toEqual(rightDoc);
    }
    console.log(`generic sweep: ${conflicts} conflicts, ${dropped} both-dropped, out of 1000`);
    expect(conflicts).toBeGreaterThan(0); // moveNode-vs-moveNode-of-different-node conflicts are expected and exercised by this same sweep
  });

  it("random concurrent insertText/deleteText pairs on the same paragraph converge in 1,000 cases (seed 0x5EED7EA)", () => {
    let state = 0x5eed7ea;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const source = "0123456789";
    for (let run = 0; run < 1000; run += 1) {
      const base: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: source }] }] };
      const randomOp = (tag: string): SmartOperation => {
        const offset = Math.floor(random() * source.length);
        if (random() < 0.5) return { type: "insertText", pos: { path: [0], offset }, text: tag };
        const length = 1 + Math.floor(random() * Math.min(2, source.length - offset));
        return { type: "deleteText", pos: { path: [0], offset }, text: source.slice(offset, offset + length) };
      };
      const a = tx([randomOp("A")], "author-a");
      const b = tx([randomOp("B")], "author-b");
      const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, a, b);
      if (leftResult.kind !== "ok" || rightResult.kind !== "ok") continue;
      expect(leftDoc).toEqual(rightDoc);
    }
  });
});

describe("Phase 12b-client TP1 property: table operations", () => {
  const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
  const cell = (id: string, text: string): SmartElementNode => ({ type: "table_cell", id, children: [p(`${id}-p`, text)] });
  const row = (id: string, cells: SmartElementNode[]): SmartElementNode => ({ type: "table_row", id, children: cells });
  const buildTable = (): SmartElementNode => ({ type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
    row("r0", [cell("a", "A"), cell("b", "B")]),
    row("r1", [cell("c", "C"), cell("d", "D")]),
  ] });
  const tableDoc = (value: SmartElementNode = buildTable()): SmartDocument => ({ type: "doc", id: "doc", children: [value] });
  const ctx = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
  const gridScope = (value: SmartElementNode, top: number, left: number, bottom: number, right: number): TableGridScope => {
    const grid = occupancyGridFor(value);
    const rect = { top, left, bottom, right };
    const ids = grid.anchors.filter((entry) => entry.top <= bottom && entry.left <= right && entry.bottom - 1 >= top && entry.right - 1 >= left).map((entry) => entry.cellId);
    return {
      kind: "table-grid", tableId: value.id, rect, cellIds: ids, coveredCellIds: [],
      rectangular: grid.isRectangular({ top, left, bottom: bottom + 1, right: right + 1 }),
      range: { from: { path: [0, 0, 0, 0], offset: 0 }, to: { path: [0, 1, 0, 0], offset: 0 } },
      isolatingAncestorId: null, clamped: false,
    };
  };

  it("concurrent row-insert vs. column-remove on the same table converge", () => {
    const base = tableDoc();
    const table = base.children[0] as SmartElementNode;
    const rowOps = insertTableRowCommand(base, gridScope(table, 0, 0, 0, 0), { rowId: "new-row", cellIds: ["new-a", "new-b"], paragraphIds: ["new-a-p", "new-b-p"], position: "after" }, ctx(base));
    const colOps = removeTableColumnCommand(base, gridScope(table, 0, 1, 1, 1), {}, ctx(base));
    const a = tx(rowOps, "author-a");
    const b = tx(colOps, "author-b");
    const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, a, b);
    expect(leftResult.kind).toBe("ok");
    expect(rightResult.kind).toBe("ok");
    expect(leftDoc).toEqual(rightDoc);
  });

  it("concurrent edit inside a cell that a real mergeTableCellsCommand absorbs is flagged as a conflict, not silently dropped or corrupted", () => {
    const base = tableDoc();
    const table = base.children[0] as SmartElementNode;
    // Merge cell "a" and "b" (row r0) into one anchored cell.
    const mergeOps = mergeTableCellsCommand(base, gridScope(table, 0, 0, 0, 1), {}, ctx(base));
    expect(mergeOps.some((operation) => operation.type === "removeNode" && operation.mergedInto)).toBe(true);
    // Concurrent: someone typed into cell "b" (the one about to be absorbed) before seeing the merge.
    const concurrentEdit: SmartOperation = { type: "insertText", pos: { path: [0, 0, 1, 0], offset: 1 }, text: "!" };
    const merge = tx(mergeOps, "author-a");
    const edit = tx([concurrentEdit], "author-b");
    const result = rebaseTransaction(edit, [merge], 1);
    expect(result.kind).toBe("conflict");
    // The reverse direction (rebasing the merge through the edit) must also
    // refuse rather than silently applying the merge on top of content the
    // merge's own captured "before" snapshot no longer matches.
    const reverse = rebaseTransaction(merge, [edit], 1);
    expect(reverse.kind === "conflict" || reverse.kind === "dropped").toBe(true);
  });
});

describe("Phase 12b-client TP1 property: suggestion marks", () => {
  it("concurrent suggestion-mark insertions on disjoint ranges converge", () => {
    let state = 0x59665e57;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
    for (let run = 0; run < 500; run += 1) {
      const base: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "0123456789" }] }] };
      const range = (start: number, end: number) => ({ from: { path: [0], offset: start }, to: { path: [0], offset: end } });
      const suggestA: SmartOperation = { type: "addMark", range: range(0, 3), mark: { type: "suggestion", attrs: { kind: "insert", authorId: "author-a", suggestionId: `s-a-${run}` } } };
      // Offset 3..7: includes the exact mark-end boundary (offset 3), fixed
      // by the addMark bias correction below (see the dedicated boundary
      // test) - no longer needs excluding from general random coverage.
      const insertB: SmartOperation = { type: "insertText", pos: { path: [0], offset: 3 + Math.floor(random() * 5) }, text: "X" };
      const a = tx([suggestA], "author-a");
      const b = tx([insertB], "author-b");
      const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, a, b);
      expect(leftResult.kind).toBe("ok");
      expect(rightResult.kind).toBe("ok");
      expect(leftDoc).toEqual(rightDoc);
    }
  });

  /**
   * Fixed (2026-08-28): a concurrent plain-text insertion landing *exactly*
   * at a mark's own end boundary used to diverge depending on transform
   * order - `mapOperation`'s addMark/removeMark `to` endpoint hardcoded
   * bias=+1 ("grow to include an insertion exactly at this boundary"),
   * which disagreed with `insertText`'s own, independently-established
   * ground truth inside `applyToSession` (splitInlineAt: a plain,
   * marks-less insertion at an exact run boundary lands on the *following*
   * side, never absorbing the preceding run's marks). This test's own seed
   * exposed the divergence via a direct TP1 check (apply-A-then-rebased-B
   * vs. apply-B-then-rebased-A did not produce the same document) before
   * any fix existed - confirmed via `docs/bugs/
   * addmark-boundary-bias-inconsistent-with-inserttext.md`. Fixed by
   * changing `to`'s hardcoded bias from 1 to -1 in `mapOperation`
   * (operations.ts), matching insertText's resolution rather than
   * inventing a new one. Not caught by the general seeded sweep above on
   * its own (that sweep never happened to land exactly on the boundary
   * offset until this exact case was added and the sweep's own range was
   * widened to include it) - the reason this needs to be a permanent,
   * named case, not just generic random coverage.
   */
  it("a concurrent insertion exactly at a mark's end boundary now converges (was a known, disclosed divergence)", () => {
    const base: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "0123456789" }] }] };
    const range = (start: number, end: number) => ({ from: { path: [0], offset: start }, to: { path: [0], offset: end } });
    const suggestA: SmartOperation = { type: "addMark", range: range(0, 3), mark: { type: "suggestion", attrs: { kind: "insert", authorId: "author-a", suggestionId: "s-a" } } };
    const insertB: SmartOperation = { type: "insertText", pos: { path: [0], offset: 3 }, text: "X" };
    const a = tx([suggestA], "author-a");
    const b = tx([insertB], "author-b");
    const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, a, b);
    expect(leftResult.kind).toBe("ok");
    expect(rightResult.kind).toBe("ok");
    expect(leftDoc).toEqual(rightDoc);
    // Pin the actual resolution, not just "they agree with each other":
    // the inserted "X" must land on the *following*, unmarked side, per
    // insertText's own ground truth - not merely that both orders agree on
    // *some* answer.
    const paragraph = leftDoc.children[0] as SmartElementNode;
    expect(paragraph.children?.map((child) => ("text" in child ? { text: child.text, marks: child.marks } : null))).toEqual([
      { text: "012", marks: [{ type: "suggestion", attrs: { kind: "insert", authorId: "author-a", suggestionId: "s-a" } }] },
      { text: "X3456789", marks: undefined },
    ]);
  });

  it("two concurrent insertions at the identical position converge via authorId tie-break, regardless of transform direction", () => {
    const base: SmartDocument = { type: "doc", id: "doc", children: [{ type: "paragraph", id: "p", children: [{ type: "text", text: "" }] }] };
    const insertLow: SmartOperation = { type: "insertText", pos: { path: [0], offset: 0 }, text: "LOW" };
    const insertHigh: SmartOperation = { type: "insertText", pos: { path: [0], offset: 0 }, text: "HIGH" };
    const low = tx([insertLow], "aaa-author"); // lexicographically smaller authorId
    const high = tx([insertHigh], "zzz-author");
    const { leftDoc, rightDoc, leftResult, rightResult } = assertConverges(base, low, high);
    expect(leftResult.kind).toBe("ok");
    expect(rightResult.kind).toBe("ok");
    expect(leftDoc).toEqual(rightDoc);
    // The deterministic order must actually be author-order, not incidental:
    // "aaa-author" sorts first, so its text ("LOW") must land before "HIGH".
    const text = (leftDoc.children[0] as SmartElementNode).children?.[0];
    expect(text && "text" in text ? text.text : null).toBe("LOWHIGH");
  });
});
