import {
  createSmartEditor,
  tablePlugin,
  type MergeTableCellsInput,
  type SetTableCellStyleInput,
  type SetTableColumnWidthInput,
  type SetTableRowHeightInput,
  type TableHeaderInput,
  type SplitTableCellInput,
  type TableColumnInput,
  type TableRowInput,
  type ToggleTableCellBorderInput,
} from "smartrte-core/legacy";
import { serializeSmartDocument, smartDocumentFromHtml } from "./domSmartDocument.js";

export type DomTableCommand =
  | { id: "table.row.add" | "table.row.remove"; input: Omit<TableRowInput, "tablePath"> }
  | { id: "table.column.add" | "table.column.remove"; input: Omit<TableColumnInput, "tablePath"> }
  | { id: "table.cell.merge"; input: Omit<MergeTableCellsInput, "tablePath"> }
  | { id: "table.cell.split"; input: Omit<SplitTableCellInput, "tablePath"> }
  | {
      id: "table.header.cell.toggle" | "table.header.row.toggle" | "table.header.column.toggle";
      input: Omit<TableHeaderInput, "tablePath">;
    }
  | { id: "table.cell.style.set"; input: Omit<SetTableCellStyleInput, "tablePath"> }
  | { id: "table.column.width.set"; input: Omit<SetTableColumnWidthInput, "tablePath"> }
  | { id: "table.row.height.set"; input: Omit<SetTableRowHeightInput, "tablePath"> }
  | { id: "table.cell.border.toggle"; input: Omit<ToggleTableCellBorderInput, "tablePath"> };

const cellsOf = (row: HTMLTableRowElement) =>
  Array.from(row.children).filter((node): node is HTMLTableCellElement =>
    node instanceof HTMLTableCellElement);

const cellGrid = (table: HTMLTableElement) => {
  const rows = Array.from(table.rows);
  const grid: (HTMLTableCellElement | undefined)[][] = [];
  rows.forEach((row, rowIndex) => {
    grid[rowIndex] ||= [];
    let column = 0;
    cellsOf(row).forEach((cell) => {
      while (grid[rowIndex][column]) column += 1;
      const rowspan = Math.max(1, cell.rowSpan || 1);
      const colspan = Math.max(1, cell.colSpan || 1);
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          grid[rowIndex + rowOffset][column + columnOffset] = cell;
        }
      }
      column += colspan;
    });
  });
  return grid;
};

const copyVisualAttributes = (from: HTMLElement, to: HTMLElement) => {
  const style = from.getAttribute("style");
  const className = from.getAttribute("class");
  if (style) to.setAttribute("style", style);
  if (className) to.setAttribute("class", className);
};

const reconcileHeaderStyle = (from: HTMLTableCellElement, to: HTMLTableCellElement) => {
  if (from.tagName === to.tagName) return;
  if (to.tagName === "TH") {
    to.style.fontWeight = "700";
    to.style.background = to.style.background || "#f3f4f6";
    to.style.textAlign = to.style.textAlign || "left";
    return;
  }
  if (to.style.fontWeight === "700" || to.style.fontWeight === "bold") to.style.fontWeight = "";
  if (to.style.background === "rgb(243, 244, 246)" || to.style.background === "#f3f4f6") {
    to.style.background = "";
  }
};

/**
 * Executes a core table command while replacing only the affected table.
 * Visual table/cell attributes are transferred by logical grid position.
 */
export const executeDomTableCommand = (
  table: HTMLTableElement,
  command: DomTableCommand,
): HTMLTableElement | null => {
  const document = smartDocumentFromHtml(table.outerHTML, table.ownerDocument);
  if (document.children.length !== 1 || document.children[0].type !== "table") return null;
  const editor = createSmartEditor({
    state: { document, selection: { type: "node", path: [0] } },
    plugins: [tablePlugin],
  });
  if (!editor.execute(command.id, { ...command.input, tablePath: [0] })) return null;

  if (command.id === "table.column.width.set") {
    let group = table.querySelector(":scope > colgroup");
    if (!group) {
      group = table.ownerDocument.createElement("colgroup");
      table.insertBefore(group, table.firstChild);
    }
    const logicalWidth = Math.max(...cellGrid(table).map((row) => row.length));
    while (group.children.length < logicalWidth) {
      group.appendChild(table.ownerDocument.createElement("col"));
    }
    const column = group.children[command.input.index] as HTMLElement | undefined;
    if (!column) return null;
    column.style.width = `${command.input.widthPx}px`;
    const seen = new Set<HTMLTableCellElement>();
    cellGrid(table).forEach((row) => {
      const target = row[command.input.index];
      if (!target || seen.has(target)) return;
      seen.add(target);
      target.style.width = `${command.input.widthPx}px`;
      target.style.minWidth = `${command.input.widthPx}px`;
      target.style.maxWidth = `${command.input.widthPx}px`;
    });
    return table;
  }

  if (command.id === "table.row.height.set") {
    const row = table.rows[command.input.index];
    if (!row) return null;
    row.style.height = `${command.input.heightPx}px`;
    cellsOf(row).forEach((target) => {
      target.style.height = `${command.input.heightPx}px`;
    });
    return table;
  }

  if (command.id === "table.cell.style.set") {
    const end = command.input.end || command.input.start;
    const top = Math.min(command.input.start.row, end.row);
    const bottom = Math.max(command.input.start.row, end.row);
    const left = Math.min(command.input.start.column, end.column);
    const right = Math.max(command.input.start.column, end.column);
    const grid = cellGrid(table);
    const targets = new Set<HTMLTableCellElement>();
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const target = grid[row]?.[column];
        if (target) targets.add(target);
      }
    }
    targets.forEach((target) => {
      if (command.input.backgroundColor !== undefined) {
        target.style.backgroundColor = command.input.backgroundColor || "";
      }
      if (command.input.textColor !== undefined) {
        target.style.color = command.input.textColor || "";
      }
    });
    return table;
  }

  if (command.id === "table.cell.border.toggle") {
    const end = command.input.end || command.input.start;
    const top = Math.min(command.input.start.row, end.row);
    const bottom = Math.max(command.input.start.row, end.row);
    const left = Math.min(command.input.start.column, end.column);
    const right = Math.max(command.input.start.column, end.column);
    const grid = cellGrid(table);
    const targets = new Set<HTMLTableCellElement>();
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const target = grid[row]?.[column];
        if (target) targets.add(target);
      }
    }
    targets.forEach((target) => {
      target.style.border = target.style.border && target.style.border !== "none"
        ? "none"
        : command.input.visibleBorder || "1px solid #d1d5db";
    });
    return table;
  }

  const container = table.ownerDocument.createElement("div");
  container.innerHTML = serializeSmartDocument(editor.state.document);
  const replacement = container.querySelector("table");
  if (!(replacement instanceof HTMLTableElement)) return null;

  copyVisualAttributes(table, replacement);
  const previousGrid = cellGrid(table);
  const nextGrid = cellGrid(replacement);
  const previousPosition = (row: number, column: number) => {
    if (command.id === "table.row.add") {
      if (row === command.input.index) return null;
      return { row: row > command.input.index ? row - 1 : row, column };
    }
    if (command.id === "table.row.remove") {
      return { row: row >= command.input.index ? row + 1 : row, column };
    }
    if (command.id === "table.column.add") {
      if (column === command.input.index) return null;
      return { row, column: column > command.input.index ? column - 1 : column };
    }
    if (command.id === "table.column.remove") {
      return { row, column: column >= command.input.index ? column + 1 : column };
    }
    return { row, column };
  };
  const copied = new Set<HTMLTableCellElement>();
  nextGrid.forEach((row, rowIndex) => row.forEach((nextCell, column) => {
    if (!nextCell || copied.has(nextCell)) return;
    const position = previousPosition(rowIndex, column);
    const previousCell = position ? previousGrid[position.row]?.[position.column] : undefined;
    if (previousCell) {
      copyVisualAttributes(previousCell, nextCell);
      reconcileHeaderStyle(previousCell, nextCell);
    }
    copied.add(nextCell);
  }));
  table.replaceWith(replacement);
  return replacement;
};

export const executeDomTableRemoval = (table: HTMLTableElement): boolean => {
  const document = smartDocumentFromHtml(table.outerHTML, table.ownerDocument);
  if (document.children.length !== 1 || document.children[0].type !== "table") return false;
  const editor = createSmartEditor({
    state: { document, selection: { type: "node", path: [0] } },
    plugins: [tablePlugin],
  });
  if (!editor.execute("table.remove", { tablePath: [0] })) return false;
  table.remove();
  return true;
};
