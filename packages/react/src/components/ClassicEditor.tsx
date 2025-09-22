import React, { useEffect, useRef, useState } from "react";

type ClassicEditorProps = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
};

export function ClassicEditor({
  value,
  onChange,
  placeholder = "Type here…",
  minHeight = 200,
  maxHeight = 500,
  readOnly = false,
}: ClassicEditorProps) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");
  const isComposingRef = useRef(false);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [tableMenu, setTableMenu] = useState<{
    x: number;
    y: number;
    cell: HTMLTableCellElement;
  } | null>(null);
  const selectionRef = useRef<{
    tbody: HTMLTableSectionElement;
    sr: number;
    sc: number;
    er: number;
    ec: number;
  } | null>(null);
  const selectingRef = useRef<{
    tbody: HTMLTableSectionElement;
    start: HTMLTableCellElement;
  } | null>(null);

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    // Initialize with provided HTML only when externally controlled value changes
    if (typeof value === "string" && value !== el.innerHTML) {
      el.innerHTML = value || "";
    }
    // Suppress native context menu inside table cells at capture phase
    const onCtx = (evt: Event) => {
      const target = evt.target as Node | null;
      const cell = getClosestCell(target);
      if (cell) {
        evt.preventDefault();
      }
    };
    el.addEventListener("contextmenu", onCtx, { capture: true });
    return () => {
      el.removeEventListener("contextmenu", onCtx, { capture: true } as any);
    };
  }, [value]);

  const exec = (command: string, valueArg?: string) => {
    try {
      document.execCommand(command, false, valueArg);
      // Emit after command
      const el = editableRef.current;
      if (el && onChange) {
        const html = el.innerHTML;
        if (html !== lastEmittedRef.current) {
          lastEmittedRef.current = html;
          onChange(html);
        }
      }
    } catch {}
  };

  const applyFormatBlock = (blockName: string) => {
    exec("formatBlock", blockName);
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const insertImage = () => {
    const url = window.prompt("Image URL", "https://");
    if (!url) return;
    exec("insertImage", url);
  };

  const handleInput = () => {
    if (isComposingRef.current) return;
    const el = editableRef.current;
    if (!el || !onChange) return;
    const html = el.innerHTML;
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  };

  const buildTableHTML = (rows: number, cols: number) => {
    const safeRows = Math.max(1, Math.min(50, Math.floor(rows) || 1));
    const safeCols = Math.max(1, Math.min(20, Math.floor(cols) || 1));
    let html = '<table style="border-collapse:collapse;width:100%;"><tbody>';
    for (let r = 0; r < safeRows; r++) {
      html += "<tr>";
      for (let c = 0; c < safeCols; c++) {
        html +=
          '<td style="border:1px solid #ddd;padding:6px;min-width:60px;">&nbsp;</td>';
      }
      html += "</tr>";
    }
    html += "</tbody></table>";
    return html;
  };

  const insertTable = () => {
    try {
      const el = editableRef.current;
      if (!el) return;
      // Ensure editor is focused and selection is inside
      el.focus();
      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !el.contains(range.commonAncestorContainer)) {
        // Place caret at end of editor
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      const html = buildTableHTML(tableRows, tableCols);
      // Insert via Range for broader support
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const node = wrapper.firstChild as HTMLElement | null;
      if (!node || !range) return;
      range.insertNode(node);
      // Move caret into first cell
      const firstCell = node.querySelector(
        "td,th"
      ) as HTMLTableCellElement | null;
      if (firstCell) moveCaretToCell(firstCell, false);
      handleInput();
    } catch {}
  };

  const getClosestCell = (node: Node | null): HTMLTableCellElement | null => {
    let el = node as HTMLElement | null;
    while (el && el !== editableRef.current) {
      if (el.nodeName === "TD" || el.nodeName === "TH") {
        return el as HTMLTableCellElement;
      }
      el = el.parentElement as any;
    }
    return null;
  };

  const moveCaretToCell = (cell: HTMLTableCellElement, atEnd: boolean) => {
    try {
      const range = document.createRange();
      // Ensure the cell has at least one text node
      if (!cell.firstChild) {
        const text = document.createTextNode("\u00A0");
        cell.appendChild(text);
      }
      const textNode = cell.firstChild as ChildNode;
      const len = (textNode.textContent || "").length;
      range.setStart(textNode, atEnd ? len : 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  };

  const getCellPosition = (cell: HTMLTableCellElement) => {
    const row = cell.parentElement as HTMLTableRowElement | null;
    const tbody = row?.parentElement as HTMLTableSectionElement | null;
    const table = tbody?.parentElement as HTMLTableElement | null;
    if (!row || !tbody || !table) return null;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const rIdx = rows.indexOf(row);
    const cells = Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    );
    const cIdx = cells.indexOf(cell);
    return { row, tbody, table, rIdx, cIdx };
  };

  const cellsOfRow = (row: HTMLTableRowElement) =>
    Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    ) as HTMLTableCellElement[];

  const clearSelectionDecor = () => {
    const sel = selectionRef.current;
    if (!sel) return;
    const { tbody, sr, sc, er, ec } = sel;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        if ((cell as any).__rtePrevBg != null) {
          cell.style.background = (cell as any).__rtePrevBg;
          delete (cell as any).__rtePrevBg;
        }
        cell.style.outline = "";
        cell.style.outlineOffset = "";
      }
    }
    selectionRef.current = null;
  };

  const updateSelectionDecor = (
    tbody: HTMLTableSectionElement,
    sr: number,
    sc: number,
    er: number,
    ec: number
  ) => {
    clearSelectionDecor();
    selectionRef.current = { tbody, sr, sc, er, ec };
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        (cell as any).__rtePrevBg =
          (cell as HTMLElement).style.background || "";
        cell.style.background = "rgba(30,144,255,0.15)";
        cell.style.outline = "2px solid #1e90ff";
        cell.style.outlineOffset = "-2px";
      }
    }
  };

  const canMergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return false;
    return sel.sr !== sel.er || sel.sc !== sel.ec;
  };

  const mergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return;
    const { tbody, sr, sc, er, ec } = sel;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const anchorRow = rows[sr];
    const anchor = cellsOfRow(anchorRow)[sc];
    if (!anchor) return;
    // Collect content and remove other cells
    const contents: string[] = [];
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        if (r === sr && c === sc) continue;
        const html = cell.innerHTML.trim();
        if (html) contents.push(html);
      }
    }
    if (contents.length) {
      anchor.innerHTML = (anchor.innerHTML || "") + " " + contents.join(" ");
    }
    // Set spans
    anchor.colSpan = ec - sc + 1;
    anchor.rowSpan = er - sr + 1;
    // Remove other cells
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = ec; c >= sc; c--) {
        const cell = cells[c];
        if (!cell) continue;
        if (r === sr && c === sc) continue;
        cell.remove();
      }
    }
    moveCaretToCell(anchor, false);
    clearSelectionDecor();
    handleInput();
  };

  const addRow = (cell: HTMLTableCellElement, dir: "above" | "below") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { row, tbody, rIdx } = pos;
    const newRow = document.createElement("tr");
    const numCols = Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    ).length;
    for (let i = 0; i < numCols; i++) {
      const td = document.createElement("td");
      td.style.border = "1px solid #ddd";
      td.style.padding = "6px";
      td.style.minWidth = "60px";
      td.innerHTML = "&nbsp;";
      newRow.appendChild(td);
    }
    const insertIndex = dir === "above" ? rIdx : rIdx + 1;
    const refRow = tbody.children[insertIndex] || null;
    tbody.insertBefore(newRow, refRow);
  };

  const deleteRow = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { row, tbody, table } = pos;
    tbody.removeChild(row);
    if (tbody.querySelectorAll("tr").length === 0) {
      table.parentElement?.removeChild(table);
    }
  };

  const addCol = (cell: HTMLTableCellElement, dir: "left" | "right") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { tbody, cIdx } = pos;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const insertIndex = dir === "left" ? cIdx : cIdx + 1;
    for (const r of rows) {
      const cells = Array.from(r.children).filter((c) =>
        ["TD", "TH"].includes((c as HTMLElement).tagName)
      );
      const td = document.createElement("td");
      td.style.border = "1px solid #ddd";
      td.style.padding = "6px";
      td.style.minWidth = "60px";
      td.innerHTML = "&nbsp;";
      const ref = (cells[insertIndex] as HTMLElement) || null;
      if (ref) r.insertBefore(td, ref);
      else r.appendChild(td);
    }
  };

  const deleteCol = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { tbody, table, cIdx } = pos;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (const r of rows) {
      const cells = Array.from(r.children).filter((c) =>
        ["TD", "TH"].includes((c as HTMLElement).tagName)
      );
      const target = cells[cIdx] as HTMLElement | undefined;
      if (target) r.removeChild(target);
    }
    // If table has no columns left, remove it
    const hasAnyCell = table.querySelector("td,th");
    if (!hasAnyCell) table.parentElement?.removeChild(table);
  };

  const toggleHeaderCell = (cell: HTMLTableCellElement) => {
    const isTh = cell.tagName === "TH";
    const replacement = document.createElement(isTh ? "td" : "th");
    replacement.innerHTML = cell.innerHTML || "&nbsp;";
    replacement.style.border =
      (cell as HTMLElement).style.border || "1px solid #ddd";
    replacement.style.padding = (cell as HTMLElement).style.padding || "6px";
    replacement.style.minWidth = (cell as HTMLElement).style.minWidth || "60px";
    cell.parentElement?.replaceChild(replacement, cell);
  };

  const deleteTable = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { table } = pos;
    table.parentElement?.removeChild(table);
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          padding: 8,
          borderBottom: "1px solid #eee",
          background: "#fafafa",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <select
          defaultValue="p"
          onChange={(e) => {
            const val = e.target.value;
            if (val === "p") applyFormatBlock("<p>");
            else if (val === "h1") applyFormatBlock("<h1>");
            else if (val === "h2") applyFormatBlock("<h2>");
            else if (val === "h3") applyFormatBlock("<h3>");
          }}
          title="Paragraph/Heading"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <button onClick={() => exec("bold")}>B</button>
        <button onClick={() => exec("italic")}>I</button>
        <button onClick={() => exec("underline")}>U</button>
        <button onClick={() => exec("strikeThrough")}>S</button>
        <button onClick={() => exec("insertUnorderedList")}>• List</button>
        <button onClick={() => exec("insertOrderedList")}>1. List</button>
        <button onClick={() => exec("formatBlock", "<blockquote>")}>❝</button>
        <button onClick={() => exec("formatBlock", "<pre>")}>{"< />"}</button>
        <button onClick={insertLink}>Link</button>
        <button onClick={() => exec("unlink")}>Unlink</button>
        <button onClick={insertImage}>Image</button>
        <button onClick={() => setShowTableDialog(true)}>+ Table</button>
        <button onClick={() => exec("undo")}>Undo</button>
        <button onClick={() => exec("redo")}>Redo</button>
      </div>
      {showTableDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowTableDialog(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 280,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Insert table</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label>Rows</label>
              <input
                type="number"
                min={1}
                max={50}
                value={tableRows}
                onChange={(e) =>
                  setTableRows(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  )
                }
              />
              <label>Cols</label>
              <input
                type="number"
                min={1}
                max={20}
                value={tableCols}
                onChange={(e) =>
                  setTableCols(
                    Math.max(1, Math.min(20, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "end",
                marginTop: 12,
              }}
            >
              <button onClick={() => setShowTableDialog(false)}>Cancel</button>
              <button
                onClick={() => {
                  insertTable();
                  setShowTableDialog(false);
                }}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={editableRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => (isComposingRef.current = true)}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          handleInput();
        }}
        style={{
          padding: 12,
          minHeight:
            typeof minHeight === "number" ? `${minHeight}px` : minHeight,
          maxHeight:
            typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          overflowY: "auto",
          outline: "none",
          lineHeight: 1.6,
        }}
        data-placeholder={placeholder}
        onFocus={(e) => {
          // Ensure the editor has at least one paragraph to type into
          const el = e.currentTarget;
          if (!el.innerHTML || el.innerHTML === "<br>") {
            el.innerHTML = "<p><br></p>";
          }
        }}
        onKeyDown={(e) => {
          // Keep Tab for indentation in lists; otherwise insert 2 spaces
          if (e.key === "Tab") {
            e.preventDefault();
            if (
              document.queryCommandState("insertUnorderedList") ||
              document.queryCommandState("insertOrderedList")
            ) {
              exec(e.shiftKey ? "outdent" : "indent");
            } else {
              document.execCommand("insertText", false, "  ");
            }
          }
          // Table navigation with arrows inside cells
          if (
            ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
          ) {
            const sel = window.getSelection();
            const cell = getClosestCell(sel?.anchorNode || null);
            if (
              cell &&
              cell.parentElement &&
              cell.parentElement.parentElement
            ) {
              const row = cell.parentElement as HTMLTableRowElement;
              const tbody = row.parentElement as HTMLTableSectionElement;
              const cells = Array.from(row.children).filter(
                (c) =>
                  (c as HTMLElement).tagName === "TD" ||
                  (c as HTMLElement).tagName === "TH"
              );
              const rows = Array.from(tbody.children) as HTMLTableRowElement[];
              const rIdx = rows.indexOf(row);
              const cIdx = cells.indexOf(cell);
              const atStart = (sel?.anchorOffset || 0) === 0;
              const cellTextLen = (cell.textContent || "").length;
              const atEnd = (sel?.anchorOffset || 0) >= cellTextLen;
              let target: HTMLTableCellElement | null = null;
              if (e.key === "ArrowLeft" && atStart && cIdx > 0) {
                target = row.children[cIdx - 1] as HTMLTableCellElement;
              } else if (
                e.key === "ArrowRight" &&
                atEnd &&
                cIdx < row.children.length - 1
              ) {
                target = row.children[cIdx + 1] as HTMLTableCellElement;
              } else if (e.key === "ArrowUp" && rIdx > 0 && atStart) {
                target = rows[rIdx - 1].children[cIdx] as HTMLTableCellElement;
              } else if (
                e.key === "ArrowDown" &&
                rIdx < rows.length - 1 &&
                atEnd
              ) {
                target = rows[rIdx + 1].children[cIdx] as HTMLTableCellElement;
              }
              if (target) {
                e.preventDefault();
                moveCaretToCell(
                  target,
                  e.key === "ArrowRight" || e.key === "ArrowDown"
                );
              }
            }
          }
        }}
        onMouseDown={(e) => {
          const cell = getClosestCell(e.target as Node);
          if (!cell) {
            clearSelectionDecor();
            return;
          }
          const pos = getCellPosition(cell);
          if (!pos) return;
          selectingRef.current = { tbody: pos.tbody, start: cell };
          const onMove = (ev: MouseEvent) => {
            const under = document.elementFromPoint(ev.clientX, ev.clientY);
            const overCell = getClosestCell(under);
            const startInfo = selectingRef.current;
            if (!overCell || !startInfo) return;
            const a = getCellPosition(startInfo.start);
            const b = getCellPosition(overCell);
            if (!a || !b || a.tbody !== b.tbody) return;
            const sr = Math.min(a.rIdx, b.rIdx);
            const sc = Math.min(a.cIdx, b.cIdx);
            const er = Math.max(a.rIdx, b.rIdx);
            const ec = Math.max(a.cIdx, b.cIdx);
            updateSelectionDecor(a.tbody, sr, sc, er, ec);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            selectingRef.current = null;
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        }}
        onContextMenu={(e) => {
          const cell = getClosestCell(e.target as Node);
          if (cell) {
            e.preventDefault();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const menuW = 220;
            const menuH = 300;
            const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
            const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
            setTableMenu({ x, y, cell });
          } else {
            setTableMenu(null);
          }
        }}
        dangerouslySetInnerHTML={{ __html: value || "" }}
      />
      {tableMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
          }}
          onClick={() => setTableMenu(null)}
          onContextMenu={(e) => {
            // Prevent native menu while overlay is shown and reposition our menu
            e.preventDefault();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const menuW = 220;
            const menuH = 300;
            const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
            const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
            // Temporarily hide overlay to detect underlying cell
            const overlay = e.currentTarget as HTMLElement;
            const prev = overlay.style.display;
            overlay.style.display = "none";
            const under = document.elementFromPoint(e.clientX, e.clientY);
            overlay.style.display = prev;
            const cell = getClosestCell(under as Node);
            if (cell) setTableMenu({ x, y, cell });
          }}
        >
          <div
            style={{
              position: "fixed",
              left: tableMenu.x,
              top: tableMenu.y,
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 6,
              width: 200,
              maxHeight: 260,
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, fontSize: 11, margin: "2px 6px 6px" }}
            >
              Table
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => setShowTableDialog(true)}
              >
                <span>➕</span>
                <span>Insert table…</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                disabled={!canMergeSelection()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  opacity: canMergeSelection() ? 1 : 0.5,
                  cursor: canMergeSelection() ? "pointer" : "default",
                }}
                onClick={() => {
                  mergeSelection();
                  setTableMenu(null);
                }}
              >
                <span>⇄</span>
                <span>Merge cells</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  addRow(tableMenu.cell, "above");
                  setTableMenu(null);
                }}
              >
                <span>↥</span>
                <span>Row above</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  addRow(tableMenu.cell, "below");
                  setTableMenu(null);
                }}
              >
                <span>↧</span>
                <span>Row below</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  addCol(tableMenu.cell, "left");
                  setTableMenu(null);
                }}
              >
                <span>←</span>
                <span>Column left</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  addCol(tableMenu.cell, "right");
                  setTableMenu(null);
                }}
              >
                <span>→</span>
                <span>Column right</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  deleteRow(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>✖</span>
                <span>Delete row</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  deleteCol(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>✖</span>
                <span>Delete column</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  toggleHeaderCell(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>H</span>
                <span>Toggle header</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  deleteTable(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>🗑</span>
                <span>Delete table</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
