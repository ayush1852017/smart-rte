import { createNodeId, isTextNode } from "../identity.js";
import type { SmartElementNode } from "../types.js";
import type { GridCell, OccupancyGrid, Rect, TableGeometryIssue } from "./types.js";

const positiveInt = (value: unknown) => Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1;
const role = (node: SmartElementNode, wanted: string) => node.type === wanted;
const rowsOf = (table: SmartElementNode) => (table.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && role(node, "table_row"));
const cellsOf = (row: SmartElementNode) => (row.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && role(node, "table_cell"));
const intersects = (cell: GridCell, rect: Rect) => cell.top < rect.bottom && cell.bottom > rect.top && cell.left < rect.right && cell.right > rect.left;
const contained = (cell: GridCell, rect: Rect) => cell.top >= rect.top && cell.bottom <= rect.bottom && cell.left >= rect.left && cell.right <= rect.right;

const cache = new WeakMap<SmartElementNode, OccupancyGrid>();

export const occupancyGridFor = (table: SmartElementNode): OccupancyGrid => {
  const cached = cache.get(table);
  if (cached) return cached;
  const rows = rowsOf(table);
  const slots: Array<Array<GridCell | undefined>> = Array.from({ length: rows.length }, () => []);
  const anchors: GridCell[] = [];
  rows.forEach((row, rowIndex) => {
    let column = 0;
    cellsOf(row).forEach((node, childIndex) => {
      while (slots[rowIndex]?.[column]) column += 1;
      const rowspan = positiveInt(node.attrs?.rowspan);
      const colspan = positiveInt(node.attrs?.colspan);
      const cell: GridCell = {
        cellId: node.id, top: rowIndex, left: column,
        bottom: rowIndex + rowspan, right: column + colspan,
        isAnchor: true, rowIndex, childIndex, node,
      };
      anchors.push(cell);
      for (let r = cell.top; r < cell.bottom; r += 1) {
        slots[r] ||= [];
        for (let c = cell.left; c < cell.right; c += 1) if (!slots[r][c]) slots[r][c] = r === cell.top && c === cell.left
          ? cell
          : { ...cell, isAnchor: false };
      }
      column += colspan;
    });
  });
  const columns = slots.reduce((width, row) => Math.max(width, row.length), 0);
  const grid: OccupancyGrid = Object.freeze({
    tableId: table.id,
    rows: rows.length,
    columns,
    anchors: Object.freeze(anchors),
    at: (row: number, col: number) => slots[row]?.[col] || null,
    anchorsIn: (rect: Rect) => anchors.filter((cell) => contained(cell, rect)),
    coveredIn: (rect: Rect) => anchors.filter((cell) => intersects(cell, rect) && !contained(cell, rect)),
    isRectangular: (rect: Rect) => {
      if (rect.top < 0 || rect.left < 0 || rect.bottom > rows.length || rect.right > columns || rect.top >= rect.bottom || rect.left >= rect.right) return false;
      for (let row = rect.top; row < rect.bottom; row += 1) for (let col = rect.left; col < rect.right; col += 1) {
        const cell = slots[row]?.[col];
        if (!cell || !contained(cell, rect)) return false;
      }
      return true;
    },
  });
  cache.set(table, grid);
  return grid;
};

export const validateTableGeometry = (table: SmartElementNode): TableGeometryIssue[] => {
  const issues: TableGeometryIssue[] = [];
  const rows = rowsOf(table);
  const slots: Array<Array<string | undefined>> = Array.from({ length: rows.length }, () => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    cellsOf(row).forEach((cell) => {
      while (slots[rowIndex]?.[column]) column += 1;
      const rowspan = positiveInt(cell.attrs?.rowspan);
      const colspan = positiveInt(cell.attrs?.colspan);
      if (rowIndex + rowspan > rows.length) issues.push({ code: "overhang", row: rowIndex, column, cellId: cell.id, message: "Cell rowspan extends beyond the table." });
      for (let r = rowIndex; r < Math.min(rows.length, rowIndex + rowspan); r += 1) for (let c = column; c < column + colspan; c += 1) {
        if (slots[r]?.[c]) issues.push({ code: "overlap", row: r, column: c, cellId: cell.id, message: "Two cells claim one logical coordinate." });
        else slots[r][c] = cell.id;
      }
      column += colspan;
    });
  });
  const width = slots.reduce((max, row) => Math.max(max, row.length), 0);
  slots.forEach((row, rowIndex) => {
    if (row.length !== width) issues.push({ code: "unequal-width", row: rowIndex, message: "Rows do not materialize the same logical width." });
    for (let col = 0; col < width; col += 1) if (!row[col]) issues.push({ code: "hole", row: rowIndex, column: col, message: "Logical coordinate is unclaimed." });
  });
  const grid = occupancyGridFor(table);
  let leadingHeaderRows = 0;
  while (leadingHeaderRows < grid.rows && Array.from({ length: grid.columns }, (_, col) => grid.at(leadingHeaderRows, col)?.node.attrs?.header === true).every(Boolean)) leadingHeaderRows += 1;
  let leadingHeaderColumns = 0;
  while (leadingHeaderColumns < grid.columns && Array.from({ length: grid.rows }, (_, row) => grid.at(row, leadingHeaderColumns)?.node.attrs?.header === true).every(Boolean)) leadingHeaderColumns += 1;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.columns; col += 1) {
      const header = grid.at(row, col)?.node.attrs?.header === true;
      const expected = row < leadingHeaderRows || col < leadingHeaderColumns;
      if (header !== expected) issues.push({ code: "noncontiguous-header", row, column: col, cellId: grid.at(row, col)?.cellId, message: "Header cells must be the union of contiguous leading rows and columns." });
    }
  }
  return issues;
};

const emptyCell = (cellId = createNodeId(), paragraphId = createNodeId()): SmartElementNode => ({
  type: "table_cell", id: cellId, attrs: { colspan: 1, rowspan: 1, header: false },
  children: [{ type: "paragraph", id: paragraphId, children: [] }],
});

export const repairTableGeometry = (table: SmartElementNode): { table: SmartElementNode; repairs: TableGeometryIssue[] } => {
  const repairs = validateTableGeometry(table);
  if (!repairs.length) return { table, repairs };
  const sourceRows = rowsOf(table);
  const slots: Array<Array<SmartElementNode | undefined>> = Array.from({ length: sourceRows.length }, () => []);
  const placements: Array<{ row: number; column: number; rowspan: number; colspan: number; cell: SmartElementNode }> = [];
  sourceRows.forEach((row, rowIndex) => {
    let column = 0;
    cellsOf(row).forEach((cell) => {
      const rowspan = Math.min(positiveInt(cell.attrs?.rowspan), sourceRows.length - rowIndex);
      const colspan = positiveInt(cell.attrs?.colspan);
      const fits = (left: number) => {
        for (let r = rowIndex; r < rowIndex + rowspan; r += 1) for (let c = left; c < left + colspan; c += 1) if (slots[r]?.[c]) return false;
        return true;
      };
      while (!fits(column)) column += 1;
      const normalized = { ...cell, attrs: { ...(cell.attrs || {}), rowspan, colspan, header: cell.attrs?.header === true } };
      placements.push({ row: rowIndex, column, rowspan, colspan, cell: normalized });
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) for (let c = column; c < column + colspan; c += 1) slots[r][c] = normalized;
      column += colspan;
    });
  });
  let width = slots.reduce((max, row) => Math.max(max, row.length), 0);
  for (let row = 0; row < sourceRows.length; row += 1) for (let col = 0; col < width; col += 1) if (!slots[row][col]) {
    const cell = emptyCell();
    placements.push({ row, column: col, rowspan: 1, colspan: 1, cell });
    slots[row][col] = cell;
  }
  width = slots.reduce((max, row) => Math.max(max, row.length), width);
  // Preserve only header cells that already form complete leading rows or
  // columns. A stray Word header in the middle is demoted; promoting all rows
  // before it changes document semantics and surprises screen-reader users.
  let headerRows = 0;
  while (headerRows < sourceRows.length && Array.from(
    { length: width },
    (_, col) => slots[headerRows]?.[col]?.attrs?.header === true,
  ).every(Boolean)) headerRows += 1;
  let headerColumns = 0;
  while (headerColumns < width && Array.from(
    { length: sourceRows.length },
    (_, row) => slots[row]?.[headerColumns]?.attrs?.header === true,
  ).every(Boolean)) headerColumns += 1;
  const keepHeader = new Set<string>();
  for (let row = 0; row < sourceRows.length; row += 1) for (let col = 0; col < width; col += 1) {
    const owner = slots[row]?.[col];
    if (owner?.attrs?.header === true && (row < headerRows || col < headerColumns)) keepHeader.add(owner.id);
  }
  const rows = sourceRows.map((row, rowIndex) => ({
    ...row,
    children: placements.filter((placement) => placement.row === rowIndex).sort((a, b) => a.column - b.column).map(({ cell, rowspan, colspan }) => ({
      ...cell,
      attrs: { ...(cell.attrs || {}), rowspan, colspan, header: keepHeader.has(cell.id) },
    })),
  }));
  return { table: { ...table, children: rows }, repairs };
};
