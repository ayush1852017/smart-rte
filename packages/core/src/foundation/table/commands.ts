import { cloneNode, isTextNode } from "../identity.js";
import { moveContiguousSiblings } from "../structural/move.js";
import type { BlockRangeScope, ResolvedScope, TableGridScope } from "../scope/types.js";
import type { Attrs, SmartDocument, SmartElementNode, SmartOperation, SmartPos } from "../types.js";
import { occupancyGridFor } from "./grid.js";
import type {
  CellAttributesParams, ColumnParams, ColumnWidthParams, HeaderParams, InsertTableParams,
  MoveTableAxisParams, RowHeightParams, RowParams, SplitCellParams, TableCommand,
  TableCommandContext,
} from "./types.js";

interface Placement { row: number; column: number; rowspan: number; colspan: number; cell: SmartElementNode }

const tableScope = (scope: ResolvedScope): TableGridScope | null => scope.kind === "table-grid" ? scope : null;
const blockScope = (scope: ResolvedScope): BlockRangeScope | null => scope.kind === "block-range" ? scope : null;
const cleanAttrs = (attrs: Attrs): Attrs => Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined));
const spanAttrs = (cell: SmartElementNode, rowspan: number, colspan: number): SmartElementNode => ({
  ...cell,
  attrs: cleanAttrs({ ...(cell.attrs || {}), rowspan, colspan }),
});
const emptyCell = (cellId: string, paragraphId: string, header = false): SmartElementNode => ({
  type: "table_cell", id: cellId, attrs: { rowspan: 1, colspan: 1, header },
  children: [{ type: "paragraph", id: paragraphId, children: [] }],
});

const locateNode = (nodeId: string, ctx: TableCommandContext) => {
  const resolved = ctx.positions.positionOf(nodeId);
  const node = resolved?.parent.children?.[resolved.pos.offset];
  if (!resolved || !node || isTextNode(node) || node.id !== nodeId) throw new Error(`Unknown or stale node ID "${nodeId}".`);
  return { node, parentPos: { path: [...resolved.pos.path], offset: resolved.pos.offset } as SmartPos };
};

const locateTable = (scope: ResolvedScope, ctx: TableCommandContext) => {
  const selected = tableScope(scope);
  if (!selected) return null;
  const located = locateNode(selected.tableId, ctx);
  if (located.node.type !== "table") return null;
  return { scope: selected, table: located.node, parentPos: located.parentPos };
};

const placementsOf = (table: SmartElementNode): Placement[] => occupancyGridFor(table).anchors.map((cell) => ({
  row: cell.top, column: cell.left, rowspan: cell.bottom - cell.top, colspan: cell.right - cell.left, cell: cell.node,
}));

const tableFromPlacements = (table: SmartElementNode, rowCount: number, placements: readonly Placement[], rowIds?: readonly string[]): SmartElementNode => {
  const oldRows = (table.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type === "table_row");
  return {
    ...table,
    children: Array.from({ length: rowCount }, (_, row) => ({
      type: "table_row",
      id: rowIds?.[row] || oldRows[row]?.id || (() => { throw new Error(`Missing caller-provided row ID for row ${row}.`); })(),
      ...(oldRows[row]?.attrs ? { attrs: oldRows[row].attrs } : {}),
      children: placements.filter((placement) => placement.row === row).sort((a, b) => a.column - b.column)
        .map((placement) => spanAttrs(placement.cell, placement.rowspan, placement.colspan)),
    })),
  };
};

const replaceTable = (before: SmartElementNode, after: SmartElementNode, parentPos: SmartPos): SmartOperation[] =>
  JSON.stringify(before) === JSON.stringify(after) ? [] : [{
    type: "replaceNode", pos: { path: [...parentPos.path], offset: parentPos.offset }, before, after,
  }];

const consumeEmptyCells = (cellIds: readonly string[] | undefined, paragraphIds: readonly string[] | undefined, count: number, header = false) => {
  if ((cellIds?.length || 0) < count || (paragraphIds?.length || 0) < count) throw new Error(`Table command requires ${count} caller-provided cell and paragraph IDs.`);
  return Array.from({ length: count }, (_, index) => emptyCell(cellIds![index], paragraphIds![index], header));
};

export const insertTableCommand: TableCommand<InsertTableParams> = (_document, scope, params, ctx) => {
  const selected = blockScope(scope);
  const firstId = selected?.blockIds[0];
  if (!firstId || params.rows < 1 || params.columns < 1) return [];
  const target = locateNode(firstId, ctx);
  const total = params.rows * params.columns;
  if (params.ids.rowIds.length < params.rows || params.ids.cellIds.length < total || params.ids.paragraphIds.length < total) {
    throw new Error("table.insert requires caller-provided IDs for every row, cell, and paragraph.");
  }
  let cellIndex = 0;
  const table: SmartElementNode = {
    type: "table", id: params.ids.tableId, attrs: { columnWidths: Array(params.columns).fill(120), layout: "fixed" },
    children: Array.from({ length: params.rows }, (_, row) => ({
      type: "table_row", id: params.ids.rowIds[row], children: Array.from({ length: params.columns }, () => {
        const current = cellIndex++;
        return emptyCell(params.ids.cellIds[current], params.ids.paragraphIds[current], Boolean(params.withHeader && row === 0));
      }),
    })),
  };
  return [{ type: "insertNode", pos: target.parentPos, node: table }];
};

export const removeTableCommand: TableCommand<Record<string, never>> = (_document, scope, _params, ctx) => {
  const target = locateTable(scope, ctx);
  return target ? [{ type: "removeNode", pos: target.parentPos, node: target.table }] : [];
};

export const insertTableRowCommand: TableCommand<RowParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const base = params.rowIndex ?? (params.position === "before" ? target.scope.rect.top : target.scope.rect.bottom + 1);
  const index = Math.max(0, Math.min(grid.rows, base));
  const crossing = new Set(grid.anchors.filter((cell) => cell.top < index && cell.bottom > index));
  const placements = placementsOf(target.table).map((placement) => {
    const match = grid.anchors.find((cell) => cell.cellId === placement.cell.id)!;
    return { ...placement, row: placement.row >= index ? placement.row + 1 : placement.row, rowspan: placement.rowspan + (crossing.has(match) ? 1 : 0) };
  });
  const covered = new Set<number>();
  crossing.forEach((cell) => { for (let col = cell.left; col < cell.right; col += 1) covered.add(col); });
  const needed = grid.columns - covered.size;
  const cells = consumeEmptyCells(params.cellIds, params.paragraphIds, needed, index === 0 && grid.anchors.filter((cell) => cell.top === 0).every((cell) => cell.node.attrs?.header === true));
  let cursor = 0;
  for (let column = 0; column < grid.columns; column += 1) if (!covered.has(column)) placements.push({ row: index, column, rowspan: 1, colspan: 1, cell: cells[cursor++] });
  const oldRows = (target.table.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type === "table_row");
  if (!params.rowId) throw new Error("table.insertRow requires a caller-provided row ID.");
  const rowIds = [...oldRows.map((row) => row.id)]; rowIds.splice(index, 0, params.rowId);
  return replaceTable(target.table, tableFromPlacements(target.table, grid.rows + 1, placements, rowIds), target.parentPos);
};

export const removeTableRowCommand: TableCommand<RowParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const index = params.rowIndex ?? target.scope.rect.top;
  if (index < 0 || index >= grid.rows) return [];
  if (grid.rows === 1) return [{ type: "removeNode", pos: target.parentPos, node: target.table }];
  const placements = placementsOf(target.table).flatMap((placement): Placement[] => {
    const bottom = placement.row + placement.rowspan;
    if (placement.row === index && placement.rowspan === 1) return [];
    const affected = placement.row <= index && bottom > index;
    return [{ ...placement, row: placement.row > index ? placement.row - 1 : placement.row, rowspan: placement.rowspan - (affected ? 1 : 0) }];
  });
  const rowIds = (target.table.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && node.type === "table_row").map((row) => row.id).filter((_, row) => row !== index);
  return replaceTable(target.table, tableFromPlacements(target.table, grid.rows - 1, placements, rowIds), target.parentPos);
};

export const insertTableColumnCommand: TableCommand<ColumnParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const base = params.columnIndex ?? (params.position === "before" ? target.scope.rect.left : target.scope.rect.right + 1);
  const index = Math.max(0, Math.min(grid.columns, base));
  const crossing = new Set(grid.anchors.filter((cell) => cell.left < index && cell.right > index).map((cell) => cell.cellId));
  const placements = placementsOf(target.table).map((placement) => {
    const match = grid.anchors.find((cell) => cell.cellId === placement.cell.id)!;
    return { ...placement, column: placement.column >= index ? placement.column + 1 : placement.column, colspan: placement.colspan + (crossing.has(match.cellId) ? 1 : 0) };
  });
  const rowsNeedingCell = Array.from({ length: grid.rows }, (_, row) => row).filter((row) => {
    const occupant = grid.at(row, Math.min(index, Math.max(0, grid.columns - 1)));
    return !(occupant && crossing.has(occupant.cellId));
  });
  const cells = consumeEmptyCells(params.cellIds, params.paragraphIds, rowsNeedingCell.length);
  rowsNeedingCell.forEach((row, cellIndex) => placements.push({ row, column: index, rowspan: 1, colspan: 1, cell: cells[cellIndex] }));
  const widths = Array.isArray(target.table.attrs?.columnWidths) ? [...target.table.attrs.columnWidths as number[]] : Array(grid.columns).fill(120);
  widths.splice(index, 0, widths[Math.max(0, index - 1)] || 120);
  const after = tableFromPlacements({ ...target.table, attrs: { ...(target.table.attrs || {}), columnWidths: widths } }, grid.rows, placements);
  return replaceTable(target.table, after, target.parentPos);
};

export const removeTableColumnCommand: TableCommand<ColumnParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const index = params.columnIndex ?? target.scope.rect.left;
  if (index < 0 || index >= grid.columns) return [];
  if (grid.columns === 1) return [{ type: "removeNode", pos: target.parentPos, node: target.table }];
  const placements = placementsOf(target.table).flatMap((placement): Placement[] => {
    if (index >= placement.column && index < placement.column + placement.colspan) {
      return placement.colspan === 1 ? [] : [{ ...placement, colspan: placement.colspan - 1 }];
    }
    return [{ ...placement, column: placement.column > index ? placement.column - 1 : placement.column }];
  });
  const widths = Array.isArray(target.table.attrs?.columnWidths) ? (target.table.attrs.columnWidths as number[]).filter((_, column) => column !== index) : undefined;
  const after = tableFromPlacements({ ...target.table, attrs: cleanAttrs({ ...(target.table.attrs || {}), columnWidths: widths }) }, grid.rows, placements);
  return replaceTable(target.table, after, target.parentPos);
};

export const mergeTableCellsCommand: TableCommand<Record<string, never>> = (_document, scope, _params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !target.scope.rectangular) return [];
  const rect = { top: target.scope.rect.top, left: target.scope.rect.left, bottom: target.scope.rect.bottom + 1, right: target.scope.rect.right + 1 };
  const grid = occupancyGridFor(target.table);
  if (!grid.isRectangular(rect) || rect.bottom - rect.top === 1 && rect.right - rect.left === 1) return [];
  const selected = grid.anchorsIn(rect).sort((a, b) => a.top - b.top || a.left - b.left);
  const headers = new Set(selected.map((cell) => cell.node.attrs?.header === true));
  if (headers.size > 1) return [];
  const anchor = grid.at(rect.top, rect.left);
  if (!anchor || anchor.top !== rect.top || anchor.left !== rect.left) return [];
  const ids = new Set(selected.map((cell) => cell.cellId));
  const merged: SmartElementNode = {
    ...anchor.node,
    attrs: { ...(anchor.node.attrs || {}), rowspan: rect.bottom - rect.top, colspan: rect.right - rect.left },
    children: selected.flatMap((cell) => (cell.node.children || []).map(cloneNode)),
  };
  const placements = placementsOf(target.table).flatMap((placement): Placement[] => {
    if (!ids.has(placement.cell.id)) return [placement];
    return placement.cell.id === anchor.cellId ? [{ row: rect.top, column: rect.left, rowspan: rect.bottom - rect.top, colspan: rect.right - rect.left, cell: merged }] : [];
  });
  return replaceTable(target.table, tableFromPlacements(target.table, grid.rows, placements), target.parentPos);
};

export const splitTableCellCommand: TableCommand<SplitCellParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const anchor = grid.at(target.scope.rect.top, target.scope.rect.left);
  if (!anchor || anchor.bottom - anchor.top === 1 && anchor.right - anchor.left === 1) return [];
  const count = (anchor.bottom - anchor.top) * (anchor.right - anchor.left) - 1;
  const cells = consumeEmptyCells(params.cellIds, params.paragraphIds, count, anchor.node.attrs?.header === true);
  let cursor = 0;
  const replacement: Placement[] = [];
  for (let row = anchor.top; row < anchor.bottom; row += 1) for (let column = anchor.left; column < anchor.right; column += 1) replacement.push({
    row, column, rowspan: 1, colspan: 1,
    cell: row === anchor.top && column === anchor.left ? spanAttrs(anchor.node, 1, 1) : cells[cursor++],
  });
  const placements = placementsOf(target.table).filter((placement) => placement.cell.id !== anchor.cellId).concat(replacement);
  return replaceTable(target.table, tableFromPlacements(target.table, grid.rows, placements), target.parentPos);
};

export const setTableHeaderCommand: TableCommand<HeaderParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const grid = occupancyGridFor(target.table);
  const placements = placementsOf(target.table).map((placement) => {
    const inRows = placement.row <= target.scope.rect.bottom;
    const inColumns = placement.column <= target.scope.rect.right;
    const header = params.target === "none" ? false : params.target === "row" ? inRows : params.target === "column" ? inColumns : inRows || inColumns;
    return { ...placement, cell: { ...placement.cell, attrs: { ...(placement.cell.attrs || {}), header } } };
  });
  return replaceTable(target.table, tableFromPlacements(target.table, grid.rows, placements), target.parentPos);
};

export const setTableCellAttributesCommand: TableCommand<CellAttributesParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target) return [];
  const ids = new Set(target.scope.cellIds);
  const placements = placementsOf(target.table).map((placement) => ids.has(placement.cell.id)
    ? { ...placement, cell: { ...placement.cell, attrs: cleanAttrs({ ...(placement.cell.attrs || {}), ...params.attrs }) } }
    : placement);
  return replaceTable(target.table, tableFromPlacements(target.table, occupancyGridFor(target.table).rows, placements), target.parentPos);
};

export const setTableColumnWidthCommand: TableCommand<ColumnWidthParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !Number.isFinite(params.width) || params.width < 20) return [];
  const grid = occupancyGridFor(target.table);
  if (params.index < 0 || params.index >= grid.columns) return [];
  const widths = Array.isArray(target.table.attrs?.columnWidths) ? [...target.table.attrs.columnWidths as number[]] : Array(grid.columns).fill(120);
  widths[params.index] = params.width;
  return replaceTable(target.table, { ...target.table, attrs: { ...(target.table.attrs || {}), columnWidths: widths } }, target.parentPos);
};

export const setTableRowHeightCommand: TableCommand<RowHeightParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !Number.isFinite(params.height) || params.height < 20) return [];
  const rows = (target.table.children || []).map((row, index) => !isTextNode(row) && index === params.index
    ? { ...row, attrs: { ...(row.attrs || {}), height: params.height } } : row);
  return replaceTable(target.table, { ...target.table, children: rows }, target.parentPos);
};

export const moveTableRowCommand: TableCommand<MoveTableAxisParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !["up", "down"].includes(params.direction)) return [];
  const rows = (target.table.children || []).filter((row): row is SmartElementNode => !isTextNode(row) && row.type === "table_row");
  const index = params.index ?? target.scope.rect.top;
  const row = rows[index];
  return row ? moveContiguousSiblings([row.id], params.direction as "up" | "down", ctx) : [];
};

export const moveTableColumnCommand: TableCommand<MoveTableAxisParams> = (_document, scope, params, ctx) => {
  const target = locateTable(scope, ctx);
  if (!target || !["left", "right"].includes(params.direction)) return [];
  const grid = occupancyGridFor(target.table);
  const from = params.index ?? target.scope.rect.left;
  const to = from + (params.direction === "left" ? -1 : 1);
  if (to < 0 || to >= grid.columns) return [];
  if (grid.anchors.some((cell) => (cell.left <= from && cell.right > from + 1) || (cell.left <= to && cell.right > to + 1))) return [];
  const placements = placementsOf(target.table).map((placement) => ({ ...placement, column: placement.column === from ? to : placement.column === to ? from : placement.column }));
  const widths = Array.isArray(target.table.attrs?.columnWidths) ? [...target.table.attrs.columnWidths as number[]] : Array(grid.columns).fill(120);
  [widths[from], widths[to]] = [widths[to], widths[from]];
  const after = tableFromPlacements({ ...target.table, attrs: { ...(target.table.attrs || {}), columnWidths: widths } }, grid.rows, placements);
  return replaceTable(target.table, after, target.parentPos);
};

export const tableCommands = {
  "table.insert": insertTableCommand,
  "table.remove": removeTableCommand,
  "table.insertRow": insertTableRowCommand,
  "table.removeRow": removeTableRowCommand,
  "table.insertColumn": insertTableColumnCommand,
  "table.removeColumn": removeTableColumnCommand,
  "table.mergeCells": mergeTableCellsCommand,
  "table.splitCell": splitTableCellCommand,
  "table.setHeader": setTableHeaderCommand,
  "table.setCellAttributes": setTableCellAttributesCommand,
  "table.setColumnWidth": setTableColumnWidthCommand,
  "table.setRowHeight": setTableRowHeightCommand,
  "table.moveRow": moveTableRowCommand,
  "table.moveColumn": moveTableColumnCommand,
} as const;
