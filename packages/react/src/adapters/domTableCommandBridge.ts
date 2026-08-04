import {
  applyOperations, createNodeId, createScopeIndex, foundationSchema,
  insertTableColumnCommand, insertTableCommand, insertTableRowCommand, mergeTableCellsCommand,
  occupancyGridFor, parseCanonicalTableHtml, removeTableColumnCommand,
  removeTableRowCommand, removeTableCommand, repair, serializeCanonicalTableHtml,
  setTableCellAttributesCommand, setTableColumnWidthCommand, setTableHeaderCommand,
  setTableRowHeightCommand, splitTableCellCommand,
  type SmartDocument, type SmartElementNode, type TableGridScope,
} from "smartrte-core/foundation";

type Point = { row: number; column: number };
export type DomTableCommand =
  | { id: "table.row.add" | "table.row.remove"; input: { index: number } }
  | { id: "table.column.add" | "table.column.remove"; input: { index: number } }
  | { id: "table.cell.merge"; input: { start: Point; end: Point } }
  | { id: "table.cell.split"; input: Point }
  | { id: "table.header.cell.toggle" | "table.header.row.toggle" | "table.header.column.toggle"; input: Point }
  | { id: "table.cell.style.set"; input: { start: Point; end?: Point; backgroundColor?: string | null; textColor?: string | null } }
  | { id: "table.column.width.set"; input: { index: number; widthPx: number } }
  | { id: "table.row.height.set"; input: { index: number; heightPx: number } }
  | { id: "table.cell.border.toggle"; input: { start: Point; end?: Point; visibleBorder?: string } };

const canonicalTable = (element: HTMLTableElement): { document: SmartDocument; table: SmartElementNode } | null => {
  const repaired = repair(parseCanonicalTableHtml(element.outerHTML)).doc;
  const table = repaired.children[0];
  return table && table.type === "table" ? { document: repaired, table: table as SmartElementNode } : null;
};

const tableScope = (table: SmartElementNode, start: Point, end = start): TableGridScope => {
  const grid = occupancyGridFor(table);
  const top = Math.max(0, Math.min(start.row, end.row));
  const bottom = Math.min(grid.rows - 1, Math.max(start.row, end.row));
  const left = Math.max(0, Math.min(start.column, end.column));
  const right = Math.min(grid.columns - 1, Math.max(start.column, end.column));
  const exclusive = { top, left, bottom: bottom + 1, right: right + 1 };
  return {
    kind: "table-grid", tableId: table.id, rect: { top, left, bottom, right },
    cellIds: grid.anchors.filter((cell) => cell.top <= bottom && cell.bottom > top && cell.left <= right && cell.right > left).map((cell) => cell.cellId),
    coveredCellIds: grid.coveredIn(exclusive).map((cell) => cell.cellId),
    rectangular: grid.isRectangular(exclusive), range: { from: { path: [0], offset: 0 }, to: { path: [0], offset: 1 } },
    isolatingAncestorId: null, clamped: false,
  };
};

const commandContext = (document: SmartDocument) => ({ schema: foundationSchema, positions: createScopeIndex().positions(document, foundationSchema) });
const generated = (count: number, prefix: string) => Array.from({ length: count }, () => `${prefix}-${createNodeId()}`);

const domGrid = (table: HTMLTableElement) => {
  const slots: Array<Array<HTMLTableCellElement | undefined>> = [];
  Array.from(table.rows).forEach((row, rowIndex) => {
    slots[rowIndex] ||= [];
    let column = 0;
    Array.from(row.cells).forEach((cell) => {
      while (slots[rowIndex][column]) column += 1;
      for (let r = rowIndex; r < rowIndex + Math.max(1, cell.rowSpan); r += 1) {
        slots[r] ||= [];
        for (let c = column; c < column + Math.max(1, cell.colSpan); c += 1) slots[r][c] = cell;
      }
      column += Math.max(1, cell.colSpan);
    });
  });
  return slots;
};

const copyVisualAttributes = (from: HTMLElement, to: HTMLElement) => {
  if (from.className) to.className = from.className;
  const retained = from.getAttribute("style");
  if (retained) for (const declaration of retained.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator > 0) to.style.setProperty(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
  }
};

const projectAttributesInPlace = (element: HTMLTableElement, after: SmartDocument): HTMLTableElement => {
  const table = after.children[0] as SmartElementNode;
  const modelGrid = occupancyGridFor(table);
  const grid = domGrid(element);
  const widths = Array.isArray(table.attrs?.columnWidths) ? table.attrs.columnWidths as number[] : [];
  if (widths.length) {
    let group = element.querySelector(":scope > colgroup");
    if (!group) { group = element.ownerDocument.createElement("colgroup"); element.prepend(group); }
    while (group.children.length < widths.length) group.appendChild(element.ownerDocument.createElement("col"));
    while (group.children.length > widths.length) group.lastElementChild?.remove();
    widths.forEach((width, index) => { (group!.children[index] as HTMLElement).style.width = `${width}px`; });
  }
  (table.children || []).forEach((row, rowIndex) => {
    if (row.type !== "table_row") return;
    const height = Number(row.attrs?.height);
    if (Number.isFinite(height) && height > 0) element.rows[rowIndex].style.height = `${height}px`;
  });
  modelGrid.anchors.forEach((cell) => {
    const target = grid[cell.top]?.[cell.left];
    if (!target) return;
    target.style.background = cell.node.attrs?.background ? String(cell.node.attrs.background) : "";
    target.style.color = cell.node.attrs?.textColor ? String(cell.node.attrs.textColor) : "";
    target.style.border = cell.node.attrs?.borders ? String(cell.node.attrs.borders) : "";
    target.style.verticalAlign = cell.node.attrs?.verticalAlign ? String(cell.node.attrs.verticalAlign) : "";
    if (widths.length) {
      const width = widths.slice(cell.left, cell.right).reduce((sum, value) => sum + value, 0);
      target.style.width = `${width}px`; target.style.minWidth = `${width}px`; target.style.maxWidth = `${width}px`;
    }
    const rowHeight = Number((table.children?.[cell.top] as SmartElementNode | undefined)?.attrs?.height);
    if (Number.isFinite(rowHeight) && rowHeight > 0) target.style.height = `${rowHeight}px`;
  });
  return element;
};

const replaceDomTable = (table: HTMLTableElement, document: SmartDocument): HTMLTableElement | null => {
  const container = table.ownerDocument.createElement("div");
  container.innerHTML = serializeCanonicalTableHtml(document, { fragment: true });
  const replacement = container.querySelector("table");
  if (!(replacement instanceof HTMLTableElement)) return null;
  copyVisualAttributes(table, replacement);
  const beforeGrid = domGrid(table);
  const afterGrid = domGrid(replacement);
  const copied = new Set<HTMLTableCellElement>();
  afterGrid.forEach((row, rowIndex) => row.forEach((cell, column) => {
    if (!cell || copied.has(cell)) return;
    const source = beforeGrid[rowIndex]?.[column];
    if (source) copyVisualAttributes(source, cell);
    if (cell.tagName === "TH" && source?.tagName !== "TH") {
      cell.style.fontWeight = "700";
      cell.style.background = cell.style.background || "#f3f4f6";
      cell.style.textAlign = cell.style.textAlign || "left";
    } else if (cell.tagName === "TD" && source?.tagName === "TH") {
      if (["700", "bold"].includes(cell.style.fontWeight)) cell.style.fontWeight = "";
      if (["rgb(243, 244, 246)", "#f3f4f6"].includes(cell.style.background)) cell.style.background = "";
      if (cell.style.textAlign === "left") cell.style.textAlign = "";
    }
    copied.add(cell);
  }));
  table.replaceWith(replacement);
  return replacement;
};

export const executeDomTableCommand = (element: HTMLTableElement, command: DomTableCommand): HTMLTableElement | null => {
  const parsed = canonicalTable(element);
  if (!parsed) return null;
  const { document, table } = parsed;
  const grid = occupancyGridFor(table);
  const start = "start" in command.input ? command.input.start : "row" in command.input ? command.input : { row: "index" in command.input ? command.input.index : 0, column: 0 };
  const end = "end" in command.input && command.input.end ? command.input.end : start;
  const scope = tableScope(table, start, end);
  const ctx = commandContext(document);
  let operations = [] as ReturnType<typeof removeTableCommand>;

  if (command.id === "table.row.add") operations = insertTableRowCommand(document, scope, {
    rowIndex: command.input.index, rowId: `row-${createNodeId()}`,
    cellIds: generated(grid.columns, "cell"), paragraphIds: generated(grid.columns, "paragraph"),
  }, ctx);
  else if (command.id === "table.row.remove") operations = removeTableRowCommand(document, scope, { rowIndex: command.input.index }, ctx);
  else if (command.id === "table.column.add") operations = insertTableColumnCommand(document, scope, {
    columnIndex: command.input.index, cellIds: generated(grid.rows, "cell"), paragraphIds: generated(grid.rows, "paragraph"),
  }, ctx);
  else if (command.id === "table.column.remove") operations = removeTableColumnCommand(document, scope, { columnIndex: command.input.index }, ctx);
  else if (command.id === "table.cell.merge") operations = mergeTableCellsCommand(document, scope, {}, ctx);
  else if (command.id === "table.cell.split") {
    const target = grid.at(command.input.row, command.input.column);
    const count = target ? (target.bottom - target.top) * (target.right - target.left) - 1 : 0;
    operations = splitTableCellCommand(document, scope, { cellIds: generated(count, "cell"), paragraphIds: generated(count, "paragraph") }, ctx);
  } else if (command.id.startsWith("table.header.")) {
    const point = command.input as Point;
    const targetCells = command.id === "table.header.cell.toggle" ? [grid.at(point.row, point.column)].filter(Boolean)
      : command.id === "table.header.row.toggle" ? grid.anchors.filter((cell) => cell.top <= point.row && cell.bottom > point.row)
        : grid.anchors.filter((cell) => cell.left <= point.column && cell.right > point.column);
    const makeHeader = targetCells.some((cell) => cell?.node.attrs?.header !== true);
    if (command.id === "table.header.cell.toggle" && point.row > 0 && point.column > 0) return null;
    const headerScope = { ...scope, cellIds: targetCells.map((cell) => cell!.cellId) };
    operations = command.id === "table.header.cell.toggle"
      ? setTableCellAttributesCommand(document, headerScope, { attrs: { header: makeHeader } }, ctx)
      : setTableHeaderCommand(document, scope, { target: makeHeader ? command.id === "table.header.row.toggle" ? "row" : "column" : "none" }, ctx);
  } else if (command.id === "table.cell.style.set") operations = setTableCellAttributesCommand(document, scope, { attrs: {
    ...(command.input.backgroundColor !== undefined ? { background: command.input.backgroundColor || undefined } : {}),
    ...(command.input.textColor !== undefined ? { textColor: command.input.textColor || undefined } : {}),
  } }, ctx);
  else if (command.id === "table.cell.border.toggle") {
    const visible = scope.cellIds.some((id) => grid.anchors.find((cell) => cell.cellId === id)?.node.attrs?.borders && grid.anchors.find((cell) => cell.cellId === id)?.node.attrs?.borders !== "none");
    operations = setTableCellAttributesCommand(document, scope, { attrs: { borders: visible ? "none" : command.input.visibleBorder || "1px solid #d1d5db" } }, ctx);
  } else if (command.id === "table.column.width.set") operations = setTableColumnWidthCommand(document, scope, { index: command.input.index, width: command.input.widthPx }, ctx);
  else if (command.id === "table.row.height.set") operations = setTableRowHeightCommand(document, scope, { index: command.input.index, height: command.input.heightPx }, ctx);

  if (!operations.length) return null;
  const after = applyOperations(document, operations);
  if (["table.cell.style.set", "table.cell.border.toggle", "table.column.width.set", "table.row.height.set"].includes(command.id)) {
    return projectAttributesInPlace(element, after);
  }
  return replaceDomTable(element, after);
};

export const executeDomTableRemoval = (element: HTMLTableElement): boolean => {
  const parsed = canonicalTable(element);
  if (!parsed) return false;
  const scope = tableScope(parsed.table, { row: 0, column: 0 });
  if (!removeTableCommand(parsed.document, scope, {}, commandContext(parsed.document)).length) return false;
  element.remove();
  return true;
};

export const executeDomTableInsert = (root: HTMLElement, afterBlockIndex: number, rows: number, columns: number, withHeader = false): HTMLTableElement | null => {
  if (rows < 1 || columns < 1) return null;
  const document = repair(parseCanonicalTableHtml(root.innerHTML)).doc;
  const index = Math.max(0, Math.min(afterBlockIndex, document.children.length - 1));
  const target = document.children[index];
  if (!target || !("id" in target)) return null;
  const blockScope = {
    kind: "block-range" as const, blockIds: [target.id], promotedFromPartial: false,
    commonParentId: document.id, range: { from: { path: [], offset: index }, to: { path: [], offset: index + 1 } },
    isolatingAncestorId: null, clamped: false,
  };
  const total = rows * columns;
  const tableId = `table-${createNodeId()}`;
  const operations = insertTableCommand(document, blockScope, {
    rows, columns, withHeader, placement: "after",
    ids: { tableId, rowIds: generated(rows, "row"), cellIds: generated(total, "cell"), paragraphIds: generated(total, "paragraph") },
  }, commandContext(document));
  if (!operations.length) return null;
  root.innerHTML = serializeCanonicalTableHtml(applyOperations(document, operations), { fragment: true });
  return root.querySelector<HTMLTableElement>(`table[data-smart-id="${tableId}"]`);
};
