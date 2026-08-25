import { describe, expect, it } from "vitest";
import { applyOperation, applyOperations, invertOperation } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { createTransactionMap } from "../mapping.js";
import { foundationSchema, repair, validate } from "../schema.js";
import { applyTransactionAtomic } from "../transactions.js";
import type { PersistedEditorDocument, SmartDocument, SmartElementNode, SmartOperation, SmartTransaction } from "../types.js";
import type { TableGridScope } from "../scope/types.js";
import {
  insertTableColumnCommand, insertTableRowCommand, mergeTableCellsCommand,
  moveTableColumnCommand, occupancyGridFor, removeTableColumnCommand,
  removeTableRowCommand, repairTableGeometry, setTableColumnWidthCommand, setTableHeaderCommand,
  splitTableCellCommand, validateTableGeometry,
} from "./index.js";

const p = (id: string, text = ""): SmartElementNode => ({ type: "paragraph", id, children: text ? [{ type: "text", text }] : [] });
const cell = (id: string, text: string, attrs: Record<string, unknown> = {}): SmartElementNode => ({
  type: "table_cell", id, ...(Object.keys(attrs).length ? { attrs } : {}), children: [p(`${id}-p`, text)],
});
const row = (id: string, cells: SmartElementNode[]): SmartElementNode => ({ type: "table_row", id, children: cells });
const table = (): SmartElementNode => ({ type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
  row("r0", [cell("a", "A", { rowspan: 2 }), cell("b", "B")]),
  row("r1", [cell("c", "C")]),
] });
const doc = (value = table()): SmartDocument => ({ type: "doc", id: "doc", children: [value] });
const scope = (value: SmartElementNode, top = 0, left = 0, bottom = 1, right = 1): TableGridScope => {
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
const ctx = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
const currentTable = (document: SmartDocument) => document.children[0] as SmartElementNode;

describe("shared occupancy grid and table geometry", () => {
  it("caches by table reference and distinguishes anchors from covered coordinates", () => {
    const value = table();
    const first = occupancyGridFor(value);
    expect(occupancyGridFor(value)).toBe(first);
    expect(first.rows).toBe(2);
    expect(first.columns).toBe(2);
    expect(first.at(0, 0)?.cellId).toBe("a");
    expect(first.at(1, 0)?.cellId).toBe("a");
    expect(first.at(1, 0)?.isAnchor).toBe(false);
    expect(first.coveredIn({ top: 1, left: 0, bottom: 2, right: 1 }).map((entry) => entry.cellId)).toEqual(["a"]);
  });

  it("validates and deterministically repairs malformed widths and overhangs without dropping content", () => {
    const malformed: SmartElementNode = { type: "table", id: "bad", children: [
      row("bad-r0", [cell("bad-a", "alpha", { rowspan: 9 }), cell("bad-b", "beta")]),
      row("bad-r1", [cell("bad-c", "gamma")]),
      row("bad-r2", [cell("bad-d", "delta"), cell("bad-e", "epsilon"), cell("bad-f", "zeta")]),
    ] };
    expect(validateTableGeometry(malformed).map((issue) => issue.code)).toContain("overhang");
    const repaired = repairTableGeometry(malformed).table;
    expect(validateTableGeometry(repaired)).toEqual([]);
    expect(JSON.stringify(repaired)).toContain("alpha");
    expect(JSON.stringify(repaired)).toContain("zeta");
    const repairedTwice = repairTableGeometry(repaired).table;
    expect(repairedTwice).toBe(repaired);
    const schemaRepair = repair(doc(malformed));
    expect(validate(schemaRepair.doc)).toEqual([]);
  });
});

describe("pure table commands", () => {
  it("measures a 50x50 single-row-insert payload, now bounded independent of table size (Phase 8c)", () => {
    const size = 50;
    const large = doc({ type: "table", id: "large", children: Array.from({ length: size }, (_, rowIndex) => row(`large-r-${rowIndex}`, Array.from({ length: size }, (_, columnIndex) => cell(`large-c-${rowIndex}-${columnIndex}`, `${rowIndex}:${columnIndex}`)))) });
    const selected = { ...scope(currentTable(large)), tableId: "large" };
    const operations = insertTableRowCommand(large, selected, {
      rowIndex: 25, rowId: "large-new-row",
      cellIds: Array.from({ length: size }, (_, index) => `large-new-cell-${index}`),
      paragraphIds: Array.from({ length: size }, (_, index) => `large-new-p-${index}`),
    }, ctx(large));
    // Fine-grained row insert emits one insertNode for the new row (its own
    // 50 cells - irreducible, that is the actual edit) plus a handful of
    // setNodeAttributes ops for rowspan-crossing cells. It must never emit a
    // replaceNode of the whole 50x50 table, which is what made this payload
    // scale with table size before the Phase 8c table-operations conversion.
    expect(operations.every((operation) => operation.type !== "replaceNode")).toBe(true);
    const bytes = JSON.stringify({ forward: operations, inverse: operations.map(invertOperation).reverse() }).length;
    console.log(`Phase 8c: 50x50 table single-row-insert payload=${bytes} bytes; 200-entry bound=${bytes * 200} bytes`);
    expect(bytes).toBeLessThan(50_000);
    expect(bytes * 200).toBeLessThan(10_000_000);
  });
  it("maps a cursor in an untouched cell through whole-table replacement", () => {
    const model = doc();
    const operations = insertTableRowCommand(model, scope(currentTable(model)), { rowIndex: 1, rowId: "mapped-row", cellIds: ["mapped-cell"], paragraphIds: ["mapped-p"] }, ctx(model));
    const selection = { type: "text" as const, anchor: { path: [0, 1, 0, 0], offset: 1 }, head: { path: [0, 1, 0, 0], offset: 1 } };
    expect(createTransactionMap(operations).mapSelection(selection)).toEqual({
      type: "text", anchor: { path: [0, 2, 0, 0], offset: 1 }, head: { path: [0, 2, 0, 0], offset: 1 },
    });
  });
  it("handles span-aware row and column insertion/removal and removes the last axis", () => {
    let model = doc();
    let value = currentTable(model);
    let operations = insertTableRowCommand(model, scope(value), { rowIndex: 1, rowId: "r-new", cellIds: ["d"], paragraphIds: ["d-p"] }, ctx(model));
    model = applyOperations(model, operations);
    value = currentTable(model);
    expect(occupancyGridFor(value).rows).toBe(3);
    expect((value.children?.[0] as SmartElementNode).children?.[0]).toMatchObject({ id: "a", attrs: { rowspan: 3 } });
    operations = removeTableRowCommand(model, scope(value), { rowIndex: 0 }, ctx(model));
    model = applyOperations(model, operations);
    value = currentTable(model);
    expect((value.children?.[0] as SmartElementNode).children?.[0]).toMatchObject({ id: "a", attrs: { rowspan: 2 } });

    operations = insertTableColumnCommand(model, scope(value), { columnIndex: 1, cellIds: ["x", "y"], paragraphIds: ["x-p", "y-p"] }, ctx(model));
    model = applyOperations(model, operations);
    expect(occupancyGridFor(currentTable(model)).columns).toBe(3);
    operations = removeTableColumnCommand(model, scope(currentTable(model)), { columnIndex: 1 }, ctx(model));
    model = applyOperations(model, operations);
    expect(occupancyGridFor(currentTable(model)).columns).toBe(2);

    const one = doc({ type: "table", id: "one", children: [row("only-row", [cell("only", "keep")])] });
    expect(removeTableRowCommand(one, { ...scope(currentTable(one), 0, 0, 0, 0), tableId: "one" }, { rowIndex: 0 }, ctx(one))[0]?.type).toBe("removeNode");
    expect(removeTableColumnCommand(one, { ...scope(currentTable(one), 0, 0, 0, 0), tableId: "one" }, { columnIndex: 0 }, ctx(one))[0]?.type).toBe("removeNode");
  });

  it("merges in reading order, rejects a header boundary, and splits without pretending to invert merge", () => {
    const plain = doc({ type: "table", id: "plain", children: [
      row("pr0", [cell("pa", "A"), cell("pb", "B")]), row("pr1", [cell("pc", "C"), cell("pd", "D")]),
    ] });
    const whole = { ...scope(currentTable(plain)), tableId: "plain" };
    const merge = mergeTableCellsCommand(plain, whole, {}, ctx(plain));
    const merged = applyOperations(plain, merge);
    const anchor = occupancyGridFor(currentTable(merged)).at(0, 0)!;
    expect(anchor.node.children?.map((block) => isText(block)).join("")).toBe("ABCD");
    expect(anchor.node.id).toBe("pa");
    const split = splitTableCellCommand(merged, { ...whole, cellIds: ["pa"] }, { cellIds: ["s1", "s2", "s3"], paragraphIds: ["sp1", "sp2", "sp3"] }, ctx(merged));
    const splitModel = applyOperations(merged, split);
    expect(occupancyGridFor(currentTable(splitModel)).anchors).toHaveLength(4);
    expect(isText(occupancyGridFor(currentTable(splitModel)).at(0, 0)!.node)).toBe("ABCD");
    expect(splitModel).not.toEqual(plain);

    const headerModel = applyOperations(plain, setTableHeaderCommand(plain, { ...whole, rect: { top: 0, left: 0, bottom: 0, right: 1 } }, { target: "row" }, ctx(plain)));
    expect(mergeTableCellsCommand(headerModel, { ...whole, tableId: "plain" }, {}, ctx(headerModel))).toEqual([]);
  });

  /**
   * Phase 12a §2.1a: every absorbed cell's removeNode must carry
   * `mergedInto` pointing at the anchor cell's id, so `rebaseAnnotationRange`
   * can snap an annotation anchored to an absorbed cell to the surviving
   * one instead of silently orphaning it. Verified against the real
   * command output, not a hand-constructed operation - the standing bar
   * for this kind of "looks right in isolation" claim.
   */
  it("mergeTableCellsCommand marks every absorbed cell's removal as merged into the anchor", () => {
    const plain = doc({ type: "table", id: "plain", children: [
      row("pr0", [cell("pa", "A"), cell("pb", "B")]), row("pr1", [cell("pc", "C"), cell("pd", "D")]),
    ] });
    const whole = { ...scope(currentTable(plain)), tableId: "plain" };
    const merge = mergeTableCellsCommand(plain, whole, {}, ctx(plain));
    const removals = merge.filter((operation): operation is Extract<typeof operation, { type: "removeNode" }> => operation.type === "removeNode");
    expect(removals).toHaveLength(3);
    expect(removals.every((operation) => operation.mergedInto === "pa")).toBe(true);
    expect(removals.map((operation) => operation.node.id).sort()).toEqual(["pb", "pc", "pd"]);
  });

  it("does not stack placeholder paragraphs when merging empty cells", () => {
    const empty = doc({ type: "table", id: "empty", children: [
      row("empty-row", [cell("empty-a", ""), cell("empty-b", ""), cell("empty-c", "")]),
    ] });
    const tableValue = currentTable(empty);
    const selected = { ...scope(tableValue, 0, 0, 0, 2), tableId: tableValue.id };
    const merged = applyOperations(empty, mergeTableCellsCommand(empty, selected, {}, ctx(empty)));
    const anchor = occupancyGridFor(currentTable(merged)).at(0, 0)!;
    expect(anchor.node.children).toHaveLength(1);
    expect(isText(anchor.node.children![0] as SmartElementNode)).toBe("");
  });

  /**
   * A prior version of this command concatenated short single-paragraph
   * cells' content into one shared paragraph specifically to keep this
   * `attrs.height` unchanged after a merge - trading away a worse defect
   * (merging "1"/"2"/"3"/"4" cells silently read as the single run
   * "1234", mixing distinct cells' content with no separation) for a
   * cosmetic one. `attrs.height` staying a row-level property (not
   * multiplied, not touched by content assembly at all) is still correct
   * and still asserted below; a merged cell legitimately containing
   * multiple separate lines of real content is not a bug - see
   * docs/bugs/table-merge-concatenates-cell-content.md.
   */
  it("keeps row height a row-level property, and preserves each source cell's content as its own line, when merging two, three, or four one-line cells", () => {
    [2, 3, 4].forEach((count) => {
      const cells = Array.from({ length: count }, (_, index) => cell(`height-${count}-${index}`, String(index + 1)));
      const model = doc({ type: "table", id: `height-${count}`, children: [{ ...row(`height-row-${count}`, cells), attrs: { height: 48 } }] });
      const tableValue = currentTable(model);
      const selected = { ...scope(tableValue, 0, 0, 0, count - 1), tableId: tableValue.id };
      const merged = applyOperations(model, mergeTableCellsCommand(model, selected, {}, ctx(model)));
      const mergedTable = currentTable(merged);
      expect(mergedTable.children?.[0]).toMatchObject({ attrs: { height: 48 } });
      const anchor = occupancyGridFor(mergedTable).at(0, 0)!;
      expect(anchor.node.children).toHaveLength(count);
      expect(anchor.node.children!.map((block) => isText(block as SmartElementNode)))
        .toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
      expect(validateTableGeometry(mergedTable)).toEqual([]);
    });
  });

  it("keeps coordinated column movement valid and refuses to split a colspan implicitly", () => {
    const model = doc({ type: "table", id: "move", attrs: { columnWidths: [80, 120] }, children: [
      row("mr0", [cell("ma", "A"), cell("mb", "B")]), row("mr1", [cell("mc", "C"), cell("md", "D")]),
    ] });
    const moved = applyOperations(model, moveTableColumnCommand(model, { ...scope(currentTable(model)), tableId: "move" }, { direction: "right", index: 0 }, ctx(model)));
    expect(occupancyGridFor(currentTable(moved)).at(0, 0)?.cellId).toBe("mb");
    expect(currentTable(moved).attrs?.columnWidths).toEqual([120, 80]);
    const spanning = doc({ type: "table", id: "span-table", children: [row("span-row", [cell("span-cell", "A", { colspan: 2 })])] });
    expect(moveTableColumnCommand(spanning, { ...scope(currentTable(spanning)), tableId: "span-table" }, { direction: "right", index: 0 }, ctx(spanning))).toEqual([]);
  });

  it("preserves a valid single-claim grid and exact undo state across 1,000 generated sequences (seed 0x6A1D2026)", () => {
    let seed = 0x6A1D2026;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let run = 0; run < 1_000; run += 1) {
      let model = doc({ type: "table", id: `t-${run}`, children: [
        row(`r-${run}-0`, [cell(`c-${run}-0`, "A"), cell(`c-${run}-1`, "B")]),
        row(`r-${run}-1`, [cell(`c-${run}-2`, "C"), cell(`c-${run}-3`, "D")]),
      ] });
      const before = structuredClone(model);
      const all: SmartOperation[] = [];
      for (let step = 0; step < 8 && currentTable(model)?.type === "table"; step += 1) {
        const value = currentTable(model);
        const grid = occupancyGridFor(value);
        const selected = { ...scope(value), tableId: value.id };
        const choice = random(7);
        const suffix = `${run}-${step}`;
        const ops = choice === 0
          ? insertTableRowCommand(model, selected, { rowIndex: random(grid.rows + 1), rowId: `nr-${suffix}`, cellIds: Array.from({ length: grid.columns }, (_, i) => `nc-${suffix}-${i}`), paragraphIds: Array.from({ length: grid.columns }, (_, i) => `np-${suffix}-${i}`) }, ctx(model))
          : choice === 1
            ? removeTableRowCommand(model, selected, { rowIndex: random(grid.rows) }, ctx(model))
            : choice === 2
              ? insertTableColumnCommand(model, selected, { columnIndex: random(grid.columns + 1), cellIds: Array.from({ length: grid.rows }, (_, i) => `xc-${suffix}-${i}`), paragraphIds: Array.from({ length: grid.rows }, (_, i) => `xp-${suffix}-${i}`) }, ctx(model))
              : choice === 3
                ? removeTableColumnCommand(model, selected, { columnIndex: random(grid.columns) }, ctx(model))
                : choice === 4
                  ? moveTableColumnCommand(model, selected, { direction: random(2) === 0 ? "left" : "right", index: random(grid.columns) }, ctx(model))
                  : choice === 5
                    ? (() => {
                      const top = random(grid.rows); const left = random(grid.columns);
                      const bottom = Math.min(grid.rows - 1, top + random(2));
                      const right = Math.min(grid.columns - 1, left + random(2));
                      return mergeTableCellsCommand(model, { ...scope(value, top, left, bottom, right), tableId: value.id }, {}, ctx(model));
                    })()
                    : (() => {
                      const anchor = grid.at(random(grid.rows), random(grid.columns));
                      if (!anchor) return [];
                      return splitTableCellCommand(model, { ...scope(value, anchor.top, anchor.left, anchor.top, anchor.left), tableId: value.id },
                        { cellIds: Array.from({ length: 15 }, (_, i) => `sc-${suffix}-${i}`), paragraphIds: Array.from({ length: 15 }, (_, i) => `sp-${suffix}-${i}`) }, ctx(model));
                    })();
        if (!ops.length) continue;
        // No operation this fuzz loop generates should ever replace the whole
        // table - that is exactly the whole-table-replaceNode granularity
        // violation Phase 8c's table-operations conversion removes.
        ops.forEach((operation) => { if (operation.type === "replaceNode") expect(operation.before.type).not.toBe("table"); });
        all.push(...ops);
        model = applyOperations(model, ops);
        if (model.children[0]?.type === "table") {
          expect(validateTableGeometry(currentTable(model))).toEqual([]);
          expect(validate(model)).toEqual([]);
        }
      }
      for (const operation of [...all].reverse()) model = applyOperation(model, invertOperation(operation));
      expect(model).toEqual(before);
    }
  });

  /**
   * Post-Phase-11.5 bug batch, round 2: a table with no columnWidths yet
   * (natural/stretched rendering) shrank as soon as any one column was
   * resized. Root cause: without a real-widths seed, this command's own
   * fallback for a missing columnWidths array (`Array(columns).fill(120)`)
   * silently reset every OTHER column to a fabricated 120px the instant
   * one column changed - the command layer has no way to know a table's
   * real *rendered* widths on its own; only a caller that measured the
   * DOM (a resize-handle UI) does. `params.widths` lets that caller seed
   * the real values instead of letting the fallback guess.
   */
  it("setTableColumnWidthCommand seeds columnWidths from params.widths instead of fabricating 120 for other columns", () => {
    const noWidths: SmartElementNode = { type: "table", id: "table", attrs: {}, children: [
      row("r0", [cell("a", "A"), cell("b", "B"), cell("c", "C")]),
    ] };
    const document = doc(noWidths);
    const tableScope = scope(noWidths, 0, 0, 0, 2);

    // Without a seed: every column not being resized falls back to 120.
    const unseeded = setTableColumnWidthCommand(document, tableScope, { index: 2, width: 300 }, ctx(document));
    const unseededAfter = applyOperations(document, unseeded);
    expect(currentTable(unseededAfter).attrs?.columnWidths).toEqual([120, 120, 300]);

    // With a seed (what TableResizeHandles now passes - the real,
    // currently-measured width of every column): the other columns keep
    // their real values, not a fabricated default.
    const seeded = setTableColumnWidthCommand(document, tableScope, { index: 2, width: 300, widths: [526, 137, 533] }, ctx(document));
    const seededAfter = applyOperations(document, seeded);
    expect(currentTable(seededAfter).attrs?.columnWidths).toEqual([526, 137, 300]);
  });

  /**
   * Codex work order (3 confirmed table bugs): "Adding a column to a table
   * copied from Sootr shrinks the table". Same fabricated-fallback pattern
   * docs/bugs/table-resize-shrinks-table-with-no-prior-columnwidths.md
   * fixed for resize, found here in insertTableColumnCommand: a table with
   * no real columnWidths (e.g. pasted content with no real per-<col> pixel
   * width, correctly left unset per docs/bugs/table-shrinks-after-
   * paste.md) got a fabricated Array(columns).fill(120) the instant a
   * column was inserted, which the renderer then pins the table's width
   * to - shrinking a table that previously rendered at its natural width.
   */
  it("insertTableColumnCommand does not fabricate columnWidths for a table that never had any", () => {
    const noWidths: SmartElementNode = { type: "table", id: "table", attrs: {}, children: [
      row("r0", [cell("a", "A"), cell("b", "B")]),
    ] };
    const document = doc(noWidths);
    const operations = insertTableColumnCommand(document, scope(noWidths, 0, 0, 0, 1), { columnIndex: 1, cellIds: ["new"], paragraphIds: ["new-p"] }, ctx(document));
    const after = applyOperations(document, operations);
    expect(currentTable(after).attrs?.columnWidths).toBeUndefined();
  });

  it("insertTableColumnCommand still extends real columnWidths when the table already has them", () => {
    const withWidths: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [150, 250] }, children: [
      row("r0", [cell("a", "A"), cell("b", "B")]),
    ] };
    const document = doc(withWidths);
    const operations = insertTableColumnCommand(document, scope(withWidths, 0, 0, 0, 1), { columnIndex: 1, cellIds: ["new"], paragraphIds: ["new-p"] }, ctx(document));
    const after = applyOperations(document, operations);
    expect(currentTable(after).attrs?.columnWidths).toEqual([150, 150, 250]);
  });

  /**
   * Codex work order item 3: "Adding a row/column doesn't inherit the last
   * row/column's style". Confirmed current behaviour first: new cells were
   * always created via `emptyCell` with no style attrs at all - default/
   * blank unconditionally, not a broken inheritance attempt (there wasn't
   * one). New capability, not a bug fix: new row/column cells now inherit
   * background/borders/textColor/verticalAlign from the immediately
   * adjacent existing row/column (the one before the insertion point, or
   * after it if inserting at the very start).
   */
  it("insertTableRowCommand inherits the adjacent (preceding) row's cell style", () => {
    const styled: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
      row("r0", [cell("a", "A", { background: "#ff0000", verticalAlign: "top" }), cell("b", "B", { borders: "1px solid blue" })]),
    ] };
    const document = doc(styled);
    const operations = insertTableRowCommand(document, scope(styled, 0, 0, 0, 1), { rowId: "r1", cellIds: ["c", "d"], paragraphIds: ["c-p", "d-p"] }, ctx(document));
    const after = applyOperations(document, operations);
    const newRow = currentTable(after).children?.[1] as SmartElementNode;
    expect((newRow.children?.[0] as SmartElementNode).attrs).toMatchObject({ background: "#ff0000", verticalAlign: "top" });
    expect((newRow.children?.[1] as SmartElementNode).attrs).toMatchObject({ borders: "1px solid blue" });
    // Structural attrs stay fresh, not inherited.
    expect((newRow.children?.[0] as SmartElementNode).attrs).toMatchObject({ rowspan: 1, colspan: 1, header: false });
  });

  it("insertTableRowCommand inserted before every row inherits from what was originally the first row", () => {
    const styled: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100] }, children: [
      row("r0", [cell("a", "A", { background: "#00ff00" })]),
    ] };
    const document = doc(styled);
    const operations = insertTableRowCommand(document, scope(styled, 0, 0, 0, 0), { rowIndex: 0, rowId: "r-before", cellIds: ["z"], paragraphIds: ["z-p"] }, ctx(document));
    const after = applyOperations(document, operations);
    const newRow = currentTable(after).children?.[0] as SmartElementNode;
    expect((newRow.children?.[0] as SmartElementNode).attrs).toMatchObject({ background: "#00ff00" });
  });

  it("insertTableColumnCommand inherits the adjacent (preceding) column's cell style", () => {
    const styled: SmartElementNode = { type: "table", id: "table", attrs: { columnWidths: [100, 100] }, children: [
      row("r0", [cell("a", "A"), cell("b", "B", { background: "#0000ff", textColor: "#ffffff" })]),
      row("r1", [cell("c", "C"), cell("d", "D", { background: "#0000ff", textColor: "#ffffff" })]),
    ] };
    const document = doc(styled);
    const operations = insertTableColumnCommand(document, scope(styled, 0, 0, 1, 1), { columnIndex: 2, cellIds: ["x", "y"], paragraphIds: ["x-p", "y-p"] }, ctx(document));
    const after = applyOperations(document, operations);
    const grid = occupancyGridFor(currentTable(after));
    expect(grid.at(0, 2)?.node.attrs).toMatchObject({ background: "#0000ff", textColor: "#ffffff" });
    expect(grid.at(1, 2)?.node.attrs).toMatchObject({ background: "#0000ff", textColor: "#ffffff" });
  });
});

describe("per-transaction validity (Phase 8c item 1)", () => {
  it("lets a fine-grained row insert pass through an invalid intermediate op, valid only once the whole transaction commits", () => {
    const model = doc();
    const operations = insertTableRowCommand(model, scope(currentTable(model)), {
      rowIndex: 1, rowId: "row-1", cellIds: ["row-1-cell"], paragraphIds: ["row-1-cell-p"],
    }, ctx(model));
    // The crossing cell ("a", rowspan 2) needs its own setNodeAttributes op
    // in addition to the row insertNode - that is the multi-op shape this
    // test depends on to prove anything.
    expect(operations.length).toBeGreaterThan(1);
    expect(operations[0].type).toBe("insertNode");

    const partial = applyOperation(model, operations[0]);
    const partialErrors = validate(partial, foundationSchema);
    expect(partialErrors.some((error) => error.code === "table-hole")).toBe(true);

    const selection = { type: "node" as const, anchor: { path: [0], offset: 0 }, head: { path: [0], offset: 0 } };
    const transaction: SmartTransaction = {
      id: "tx-row-insert",
      baseRevision: 0,
      operations,
      selectionBefore: selection,
      selectionAfter: selection,
      metadata: { source: "api", timestamp: 1, addToHistory: true },
    };
    const state: PersistedEditorDocument = { schemaVersion: foundationSchema.version, revision: 0, document: model };
    const next = applyTransactionAtomic(state, transaction, foundationSchema);
    expect(validate(next.document, foundationSchema)).toEqual([]);
  });
});

const isText = (node: SmartElementNode | { type: "text"; text: string }): string => {
  if (node.type === "text") return node.text;
  return (node.children || []).map((child) => child.type === "text" ? child.text : isText(child)).join("");
};
