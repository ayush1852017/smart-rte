import { describe, expect, it } from "vitest";
import { applyOperation, applyOperations, invertOperation } from "../operations.js";
import { createScopeIndex } from "../scope/index.js";
import { createTransactionMap } from "../mapping.js";
import { foundationSchema, repair, validate } from "../schema.js";
import type { SmartDocument, SmartElementNode, SmartOperation } from "../types.js";
import type { TableGridScope } from "../scope/types.js";
import {
  insertTableColumnCommand, insertTableRowCommand, mergeTableCellsCommand,
  moveTableColumnCommand, occupancyGridFor, removeTableColumnCommand,
  removeTableRowCommand, repairTableGeometry, setTableHeaderCommand,
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
  it("measures 50x50 whole-table history payload against the 200-entry cap", () => {
    const size = 50;
    const large = doc({ type: "table", id: "large", children: Array.from({ length: size }, (_, rowIndex) => row(`large-r-${rowIndex}`, Array.from({ length: size }, (_, columnIndex) => cell(`large-c-${rowIndex}-${columnIndex}`, `${rowIndex}:${columnIndex}`)))) });
    const selected = { ...scope(currentTable(large)), tableId: "large" };
    const operations = insertTableRowCommand(large, selected, {
      rowIndex: 25, rowId: "large-new-row",
      cellIds: Array.from({ length: size }, (_, index) => `large-new-cell-${index}`),
      paragraphIds: Array.from({ length: size }, (_, index) => `large-new-p-${index}`),
    }, ctx(large));
    const bytes = JSON.stringify({ forward: operations, inverse: operations.map(invertOperation).reverse() }).length;
    console.log(`Phase 6 carry-forward: 50x50 table history entry=${bytes} bytes; 200-entry upper bound=${bytes * 200} bytes`);
    expect(bytes).toBeGreaterThan(100_000);
    expect(bytes * 200).toBeLessThan(1_000_000_000);
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
        const selected = { ...scope(value), tableId: value.id };
        const choice = random(4);
        const suffix = `${run}-${step}`;
        const ops = choice === 0
          ? insertTableRowCommand(model, selected, { rowIndex: random(occupancyGridFor(value).rows + 1), rowId: `nr-${suffix}`, cellIds: [`nc-${suffix}-0`, `nc-${suffix}-1`, `nc-${suffix}-2`, `nc-${suffix}-3`], paragraphIds: [`np-${suffix}-0`, `np-${suffix}-1`, `np-${suffix}-2`, `np-${suffix}-3`] }, ctx(model))
          : choice === 1
            ? removeTableRowCommand(model, selected, { rowIndex: random(occupancyGridFor(value).rows) }, ctx(model))
            : choice === 2
              ? insertTableColumnCommand(model, selected, { columnIndex: random(occupancyGridFor(value).columns + 1), cellIds: Array.from({ length: occupancyGridFor(value).rows }, (_, i) => `xc-${suffix}-${i}`), paragraphIds: Array.from({ length: occupancyGridFor(value).rows }, (_, i) => `xp-${suffix}-${i}`) }, ctx(model))
              : removeTableColumnCommand(model, selected, { columnIndex: random(occupancyGridFor(value).columns) }, ctx(model));
        if (!ops.length) continue;
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
});

const isText = (node: SmartElementNode | { type: "text"; text: string }): string => {
  if (node.type === "text") return node.text;
  return (node.children || []).map((child) => child.type === "text" ? child.text : isText(child)).join("");
};
