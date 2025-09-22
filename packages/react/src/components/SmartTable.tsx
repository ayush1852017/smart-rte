import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

type TableNode = {
  rows: Array<{ cells: Array<any> }>;
  column_widths?: number[];
  freeze_header?: boolean;
  freeze_first_col?: boolean;
};

type Props = {
  editor: any;
  tableNode: TableNode;
  tableIdx: number;
  onChange?: () => void;
  onCaretUpdate?: (ctx: {
    tableIdx: number;
    r: number;
    c: number;
    offset: number;
  }) => void;
};

export function SmartTable({
  editor,
  tableNode,
  tableIdx,
  onChange,
  onCaretUpdate,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const suppressNextClickClearRef = useRef(false);
  const dragStartCellRef = useRef<{ r: number; c: number } | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState<{ r: number; c: number } | null>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingCaret = useRef<{ r: number; c: number; offset: number } | null>(
    null
  );
  const debounceTimer = useRef<number | null>(null);
  const [selection, setSelection] = useState<{
    start: { r: number; c: number } | null;
    end: { r: number; c: number } | null;
    active: boolean;
  }>({ start: null, end: null, active: false });
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    r: number;
    c: number;
  } | null>(null);

  const normSel = useMemo(() => {
    if (!selection.start || !selection.end) return null;
    const sr = Math.min(selection.start.r, selection.end.r);
    const sc = Math.min(selection.start.c, selection.end.c);
    const er = Math.max(selection.start.r, selection.end.r);
    const ec = Math.max(selection.start.c, selection.end.c);
    return { sr, sc, er, ec };
  }, [selection]);

  const clearMenu = useCallback(() => setMenu(null), []);

  const onCellEdit = useCallback(
    (r: number, c: number, text: string) => {
      if (
        r < 0 ||
        r >= tableNode.rows.length ||
        c < 0 ||
        c >= (tableNode.rows[r]?.cells?.length ?? 0)
      ) {
        console.warn("Invalid cell index onCellEdit", { tableIdx, r, c });
        return;
      }
      if (typeof editor.set_cell_text_at === "function") {
        editor.set_cell_text_at(tableIdx, r, c, text);
      } else {
        editor.set_cell_text(r, c, text);
      }
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
      debounceTimer.current = window.setTimeout(() => {
        onChange && onChange();
        debounceTimer.current = null;
      }, 150);
    },
    [editor, onChange, tableIdx]
  );

  const onResizeCol = useCallback(
    (c: number, delta: number) => {
      const current = tableNode.column_widths?.[c] ?? 120;
      if (typeof editor.set_column_width_at === "function") {
        editor.set_column_width_at(tableIdx, c, Math.max(60, current + delta));
      } else {
        editor.set_column_width(c, Math.max(60, current + delta));
      }
      onChange && onChange();
    },
    [editor, tableNode, onChange, tableIdx]
  );

  const onResizeRow = useCallback(
    (r: number, delta: number) => {
      const tr = containerRef.current?.querySelector(
        `tr[data-r='${r}']`
      ) as HTMLTableRowElement | null;
      const current = tr?.getBoundingClientRect().height || 24;
      if (typeof editor.set_row_height_specific === "function") {
        editor.set_row_height_specific(
          tableIdx,
          r,
          Math.max(18, Math.round(current + delta))
        );
      } else {
        editor.set_row_height(r, Math.max(18, Math.round(current + delta)));
      }
      onChange && onChange();
    },
    [editor, onChange, tableIdx]
  );

  const isSelected = useCallback(
    (r: number, c: number) => {
      if (!normSel) return false;
      return (
        r >= normSel.sr && r <= normSel.er && c >= normSel.sc && c <= normSel.ec
      );
    },
    [normSel]
  );

  const openContextMenu = useCallback(
    (e: React.MouseEvent, r: number, c: number) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      let x = e.clientX - (rect?.left ?? 0);
      let y = e.clientY - (rect?.top ?? 0);
      const viewportW = rect?.width ?? window.innerWidth;
      const viewportH = rect?.height ?? window.innerHeight;
      const menuW = 240;
      const menuH = 260;
      if (x + menuW > viewportW) x = Math.max(0, viewportW - menuW - 8);
      if (y + menuH > viewportH) y = Math.max(0, viewportH - menuH - 8);
      // If right-click is outside current selection, move selection to the clicked cell
      const inside = !!(
        normSel &&
        r >= normSel.sr &&
        r <= normSel.er &&
        c >= normSel.sc &&
        c <= normSel.ec
      );
      if (!inside) {
        setSelection({ start: { r, c }, end: { r, c }, active: false });
      }
      setMenu({ x, y, r, c });
    },
    [normSel]
  );

  const onMouseDownCell = useCallback(
    (e: React.MouseEvent, r: number, c: number) => {
      // Only start drag-selection on left click
      if (e.button !== 0) return;
      // Shift+click extends selection to here
      if (e.shiftKey && selection.start) {
        setSelection((s) => ({ start: s.start, end: { r, c }, active: false }));
        return;
      }
      draggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartCellRef.current = { r, c };
      dragStartPointRef.current = { x: e.clientX, y: e.clientY };
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const start = dragStartPointRef.current;
        if (!start) return;
        const dx = Math.abs(ev.clientX - start.x);
        const dy = Math.abs(ev.clientY - start.y);
        const moved = dx + dy > 3; // small threshold to differentiate click vs drag
        if (!hasDraggedRef.current && moved) {
          hasDraggedRef.current = true;
          const startCell = dragStartCellRef.current || { r, c };
          setSelection({
            start: { r: startCell.r, c: startCell.c },
            end: { r: startCell.r, c: startCell.c },
            active: true,
          });
        }
        const target = ev.target as HTMLElement;
        const td = target.closest("td[data-r][data-c]") as HTMLElement | null;
        if (td) {
          const rr = parseInt(td.dataset.r || "0", 10);
          const cc = parseInt(td.dataset.c || "0", 10);
          if (hasDraggedRef.current) {
            setSelection((s) => ({ ...s, end: { r: rr, c: cc } }));
          }
        }
      };
      const onUp = () => {
        draggingRef.current = false;
        setSelection((s) =>
          s && s.start && s.end ? { ...s, active: false } : s
        );
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // If it was just a simple click (no drag), clear selection
        if (!hasDraggedRef.current) {
          setSelection({ start: null as any, end: null as any, active: false });
        } else {
          // A drag selection occurred; avoid container onClick clearing it
          suppressNextClickClearRef.current = true;
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [selection.start]
  );

  // Clear selection when clicking anywhere outside the table container
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      if (!container.contains(e.target as Node)) {
        setSelection({ start: null as any, end: null as any, active: false });
      }
    };
    document.addEventListener("mousedown", onDocMouseDown, true);
    return () =>
      document.removeEventListener("mousedown", onDocMouseDown, true);
  }, []);

  const applyBackground = useCallback(
    (hex: string) => {
      if (!normSel) return;
      for (let r = normSel.sr; r <= normSel.er; r++) {
        for (let c = normSel.sc; c <= normSel.ec; c++) {
          if (typeof editor.set_cell_style_at === "function") {
            editor.set_cell_style_at(
              tableIdx,
              r,
              c,
              JSON.stringify({ background: hex })
            );
          } else {
            editor.set_cell_style(r, c, JSON.stringify({ background: hex }));
          }
        }
      }
      clearMenu();
      onChange && onChange();
    },
    [editor, normSel, clearMenu, tableIdx]
  );

  const toggleBorder = useCallback(() => {
    if (!normSel) return;
    for (let r = normSel.sr; r <= normSel.er; r++) {
      for (let c = normSel.sc; c <= normSel.ec; c++) {
        if (typeof editor.set_cell_style_at === "function") {
          editor.set_cell_style_at(
            tableIdx,
            r,
            c,
            JSON.stringify({ border: { color: "#000", width_px: 1 } })
          );
        } else {
          editor.set_cell_style(
            r,
            c,
            JSON.stringify({ border: { color: "#000", width_px: 1 } })
          );
        }
      }
    }
    clearMenu();
    onChange && onChange();
  }, [editor, normSel, clearMenu, tableIdx]);

  const mergeSelected = useCallback(() => {
    if (!normSel) return;
    if (typeof editor.merge_cells_at === "function") {
      editor.merge_cells_at(
        tableIdx,
        normSel.sr,
        normSel.sc,
        normSel.er,
        normSel.ec
      );
    } else {
      editor.merge_cells(normSel.sr, normSel.sc, normSel.er, normSel.ec);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, normSel, clearMenu, tableIdx]);

  const splitCell = useCallback(() => {
    if (!menu) return;
    if (typeof editor.split_cell_at === "function") {
      editor.split_cell_at(tableIdx, menu.r, menu.c);
    } else {
      editor.split_cell(menu.r, menu.c);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, clearMenu, tableIdx]);

  const insertRowAbove = useCallback(() => {
    if (!menu) return;
    if (typeof editor.add_row_at === "function") {
      editor.add_row_at(tableIdx, menu.r);
    } else {
      editor.add_row(menu.r);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const insertRowBelow = useCallback(() => {
    if (!menu) return;
    if (typeof editor.add_row_at === "function") {
      editor.add_row_at(tableIdx, menu.r + 1);
    } else {
      editor.add_row(menu.r + 1);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const insertColLeft = useCallback(() => {
    if (!menu) return;
    if (typeof editor.add_col_at === "function") {
      editor.add_col_at(tableIdx, menu.c);
    } else {
      editor.add_col(menu.c);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const insertColRight = useCallback(() => {
    if (!menu) return;
    if (typeof editor.add_col_at === "function") {
      editor.add_col_at(tableIdx, menu.c + 1);
    } else {
      editor.add_col(menu.c + 1);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const deleteRow = useCallback(() => {
    if (!menu) return;
    if (typeof editor.delete_row_at === "function") {
      editor.delete_row_at(tableIdx, menu.r);
    } else {
      editor.delete_row(menu.r);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const deleteCol = useCallback(() => {
    if (!menu) return;
    if (typeof editor.delete_col_at === "function") {
      editor.delete_col_at(tableIdx, menu.c);
    } else {
      editor.delete_col(menu.c);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, menu, onChange, tableIdx]);

  const toggleFreezeHeader = useCallback(() => {
    const next = !tableNode.freeze_header;
    if (typeof editor.set_freeze_at === "function") {
      editor.set_freeze_at(tableIdx, next, !!tableNode.freeze_first_col);
    } else {
      editor.set_freeze(next, !!tableNode.freeze_first_col);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, tableNode, onChange, tableIdx]);

  const toggleFreezeFirstCol = useCallback(() => {
    const next = !tableNode.freeze_first_col;
    if (typeof editor.set_freeze_at === "function") {
      editor.set_freeze_at(tableIdx, !!tableNode.freeze_header, next);
    } else {
      editor.set_freeze(!!tableNode.freeze_header, next);
    }
    clearMenu();
    onChange && onChange();
  }, [editor, tableNode, onChange, tableIdx]);

  const pivot = useMemo(() => {
    if (selection.start) return selection.start;
    if (focused) return focused;
    return { r: 0, c: 0 };
  }, [selection.start, focused]);

  const applyTextStyleToSelection = useCallback(
    (style: any) => {
      if (!normSel) return;
      for (let r = normSel.sr; r <= normSel.er; r++) {
        for (let c = normSel.sc; c <= normSel.ec; c++) {
          const t = tableNode.rows[r]?.cells?.[c]?.text || "";
          if (typeof editor.set_cell_text_style_at === "function") {
            editor.set_cell_text_style_at(
              tableIdx,
              r,
              c,
              0,
              t.length,
              JSON.stringify(style)
            );
          } else {
            editor.set_cell_text_style(
              r,
              c,
              0,
              t.length,
              JSON.stringify(style)
            );
          }
        }
      }
      onChange && onChange();
    },
    [editor, normSel, onChange, tableNode, tableIdx]
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        overflow: "auto",
        border: "1px solid #ccc",
        margin: "8px 0",
      }}
      onClick={(e) => {
        clearMenu();
        if (suppressNextClickClearRef.current) {
          suppressNextClickClearRef.current = false;
          return;
        }
        const target = e.target as HTMLElement;
        // If clicking outside any td/cell content, clear selection as well
        if (!target.closest("td[data-r][data-c]")) {
          setSelection({ start: null as any, end: null as any, active: false });
        }
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#fff",
          zIndex: 6,
          display: "flex",
          gap: 8,
          padding: 6,
          borderBottom: "1px solid #eee",
        }}
      >
        <button onClick={mergeSelected} disabled={!normSel}>
          Merge
        </button>
        <button onClick={splitCell} disabled={!normSel}>
          Split
        </button>
        <button onClick={() => insertRowAbove()} disabled={!pivot}>
          + Row ↑
        </button>
        <button onClick={() => insertRowBelow()} disabled={!pivot}>
          + Row ↓
        </button>
        <button onClick={() => insertColLeft()} disabled={!pivot}>
          + Col ←
        </button>
        <button onClick={() => insertColRight()} disabled={!pivot}>
          + Col →
        </button>
        <button onClick={() => deleteRow()} disabled={!pivot}>
          − Row
        </button>
        <button onClick={() => deleteCol()} disabled={!pivot}>
          − Col
        </button>
        <button onClick={toggleFreezeHeader}>
          {tableNode.freeze_header ? "Unfreeze header" : "Freeze header"}
        </button>
        <button onClick={toggleFreezeFirstCol}>
          {tableNode.freeze_first_col ? "Unfreeze 1st col" : "Freeze 1st col"}
        </button>
        <span style={{ width: 1, background: "#eee", margin: "0 4px" }} />
        <button onClick={() => applyTextStyleToSelection({ bold: true })}>
          B
        </button>
        <button onClick={() => applyTextStyleToSelection({ italic: true })}>
          I
        </button>
        <button onClick={() => applyTextStyleToSelection({ underline: true })}>
          U
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          A
          <input
            type="color"
            onChange={(e) =>
              applyTextStyleToSelection({ color: e.target.value })
            }
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          ⌧
          <input
            type="color"
            onChange={(e) => applyBackground(e.target.value)}
          />
        </label>
        <select
          defaultValue={14}
          onChange={(e) =>
            applyTextStyleToSelection({ font_size_px: Number(e.target.value) })
          }
          title="Font size"
        >
          <option value={12}>12</option>
          <option value={14}>14</option>
          <option value={16}>16</option>
          <option value={18}>18</option>
          <option value={24}>24</option>
        </select>
      </div>
      {/* Close/remove table button */}
      <button
        aria-label="Remove table"
        onClick={(e) => {
          e.stopPropagation();
          try {
            editor.delete_node?.(tableIdx);
          } catch {}
          onChange && onChange();
        }}
        style={{
          position: "absolute",
          right: 6,
          top: 6,
          width: 20,
          height: 20,
          borderRadius: 10,
          border: "1px solid #ccc",
          background: "#fff",
          cursor: "pointer",
          lineHeight: "18px",
          textAlign: "center",
          zIndex: 5,
        }}
        title="Remove table"
      >
        ×
      </button>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {tableNode.rows.map((row: any, rIdx: number) => (
            <tr key={rIdx} data-r={rIdx} style={{ height: row.height_px }}>
              {row.cells.map((cell: any, cIdx: number) => {
                if (cell.placeholder) return null;
                const width = tableNode.column_widths?.[cIdx] ?? 120;
                const selected = isSelected(rIdx, cIdx);
                return (
                  <td
                    key={cIdx}
                    data-r={rIdx}
                    data-c={cIdx}
                    colSpan={cell.colspan}
                    rowSpan={cell.rowspan}
                    style={{
                      minWidth: width,
                      border: "1px solid #ddd",
                      padding: "6px",
                      background: cell.style?.background || "white",
                      position: "relative",
                      color: cell.style?.color || "black",
                      userSelect: selection.active ? "none" : undefined,
                    }}
                    onMouseDown={(e) => onMouseDownCell(e, rIdx, cIdx)}
                    onContextMenu={(e) => openContextMenu(e, rIdx, cIdx)}
                  >
                    {/* Editable content isolated in its own div to avoid React DOM conflicts */}
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      style={{
                        outline: "none",
                        minHeight: 20,
                        whiteSpace: "pre-wrap",
                        direction: "ltr",
                        unicodeBidi: "plaintext",
                        textAlign: "left",
                      }}
                      ref={(el) => {
                        (cellRefs.current as any)[`${rIdx}:${cIdx}`] = el;
                      }}
                      onFocus={(e) => {
                        setFocused({ r: rIdx, c: cIdx });
                        // Normalize the live DOM to model value when entering focus
                        const currentDom = e.currentTarget.innerText || "";
                        const modelText = cell.text || "";
                        if (currentDom !== modelText) {
                          e.currentTarget.innerText = modelText;
                        }
                        const sel = window.getSelection();
                        const off =
                          (sel &&
                            sel.anchorNode &&
                            (e.currentTarget.contains(sel.anchorNode)
                              ? sel.anchorOffset
                              : (e.currentTarget.textContent || "").length)) ||
                          0;
                        onCaretUpdate &&
                          onCaretUpdate({
                            tableIdx,
                            r: rIdx,
                            c: cIdx,
                            offset: off,
                          });
                      }}
                      onBlur={(e) => {
                        // Persist latest text and release focus state
                        const latest = e.currentTarget.innerText || "";
                        onCellEdit(rIdx, cIdx, latest);
                        setFocused((f) =>
                          f && f.r === rIdx && f.c === cIdx ? null : f
                        );
                        // Clear pending caret; allow focus to move to the new cell naturally
                        pendingCaret.current = null;
                      }}
                      // Reduce state churn while typing; caret context is captured on focus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (e.shiftKey) {
                            // newline inside cell
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                              rIdx < 0 ||
                              rIdx >= tableNode.rows.length ||
                              cIdx < 0 ||
                              cIdx >= (tableNode.rows[rIdx]?.cells?.length ?? 0)
                            ) {
                              console.warn("Invalid cell index", {
                                tableIdx,
                                rIdx,
                                cIdx,
                              });
                              return;
                            }
                            const el = e.currentTarget as HTMLDivElement;
                            const text = el.innerText || "";
                            const selection = window.getSelection();
                            const rawCaret =
                              selection &&
                              selection.anchorNode &&
                              el.contains(selection.anchorNode)
                                ? selection.anchorOffset ?? text.length
                                : text.length;
                            const safeCaret = Math.min(
                              Math.max(0, rawCaret),
                              text.length
                            );
                            const next =
                              text.slice(0, safeCaret) +
                              "\n" +
                              text.slice(safeCaret);
                            try {
                              // Reflect the change in the live DOM so the newline is visible immediately
                              el.innerText = next;
                              // Move caret after the inserted newline
                              const textNode = el.firstChild as Text | null;
                              const desiredOffset = Math.min(
                                safeCaret + 1,
                                textNode?.textContent?.length ?? next.length
                              );
                              if (textNode) {
                                const range = document.createRange();
                                range.setStart(textNode, desiredOffset);
                                range.collapse(true);
                                const sel = window.getSelection();
                                sel?.removeAllRanges();
                                sel?.addRange(range);
                              }
                              pendingCaret.current = {
                                r: rIdx,
                                c: cIdx,
                                offset: desiredOffset,
                              };
                              onCaretUpdate &&
                                onCaretUpdate({
                                  tableIdx,
                                  r: rIdx,
                                  c: cIdx,
                                  offset: desiredOffset,
                                });
                              // Persist via debounced path so we don't fight React re-renders
                              onCellEdit(rIdx, cIdx, next);
                            } catch (err) {
                              console.error("Failed to set_cell_text", {
                                tableIdx,
                                rIdx,
                                cIdx,
                                next,
                                err,
                              });
                            }
                          } else {
                            // move to below cell
                            e.preventDefault();
                            if (rIdx < tableNode.rows.length - 1) {
                              onCaretUpdate({
                                tableIdx,
                                r: rIdx + 1,
                                c: cIdx,
                                offset: 0,
                              });
                            } else {
                              editor.insert_table_row(
                                tableIdx,
                                tableNode.rows.length
                              );
                              onCaretUpdate({
                                tableIdx,
                                r: rIdx + 1,
                                c: cIdx,
                                offset: 0,
                              });
                              onChange();
                            }
                          }
                        }
                      }}
                      onInput={(e) => {
                        const sel = window.getSelection();
                        const off =
                          sel &&
                          sel.anchorNode &&
                          e.currentTarget.contains(sel.anchorNode)
                            ? sel.anchorOffset || 0
                            : (e.currentTarget.textContent || "").length;
                        pendingCaret.current = {
                          r: rIdx,
                          c: cIdx,
                          offset: off,
                        };
                        // Emit caret context upwards so formula insertion knows table cell context
                        onCaretUpdate &&
                          onCaretUpdate({
                            tableIdx,
                            r: rIdx,
                            c: cIdx,
                            offset: off,
                          });
                      }}
                    >
                      {focused && focused.r === rIdx && focused.c === cIdx
                        ? null
                        : cell.text}
                    </div>
                    {selected && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(30, 144, 255, 0.2)",
                          pointerEvents: "none",
                          outline: "2px solid #1e90ff",
                          outlineOffset: -2,
                        }}
                      />
                    )}
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: 6,
                        cursor: "col-resize",
                      }}
                      onMouseDown={(e) => {
                        const startX = e.clientX;
                        const onMove = (ev: MouseEvent) => {
                          const delta = ev.clientX - startX;
                          onResizeCol(cIdx, delta);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                    />
                    {/* Row resize handle at bottom */}
                    {cIdx === row.cells.length - 1 && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: -3,
                          height: 6,
                          cursor: "row-resize",
                        }}
                        onMouseDown={(e) => {
                          const startY = e.clientY;
                          const onMove = (ev: MouseEvent) => {
                            const delta = ev.clientY - startY;
                            onResizeRow(rIdx, delta);
                          };
                          const onUp = () => {
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", onUp);
                          };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {menu && (
        <div
          style={{
            position: "absolute",
            left: menu.x,
            top: menu.y,
            background: "#fff",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            borderRadius: 8,
            padding: 10,
            zIndex: 50,
            width: 240,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            Cell actions
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              "#ffffff",
              "#fff2cc",
              "#d9ead3",
              "#cfe2f3",
              "#f4cccc",
              "#ead1dc",
              "#d0e0e3",
            ].map((hex) => (
              <button
                key={hex}
                title={hex}
                style={{
                  width: 22,
                  height: 22,
                  background: hex,
                  border: "1px solid #ccc",
                }}
                onClick={() => applyBackground(hex)}
              />
            ))}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <button onClick={toggleBorder}>Toggle border</button>
            <button onClick={mergeSelected} disabled={!normSel}>
              Merge selected
            </button>
            <button onClick={splitCell}>Split cell</button>
            <hr />
            <button onClick={insertRowAbove}>Insert row above</button>
            <button onClick={insertRowBelow}>Insert row below</button>
            <button onClick={insertColLeft}>Insert column left</button>
            <button onClick={insertColRight}>Insert column right</button>
            <button onClick={deleteRow}>Delete row</button>
            <button onClick={deleteCol}>Delete column</button>
            <hr />
            <button onClick={toggleFreezeHeader}>
              {tableNode.freeze_header
                ? "Unfreeze header row"
                : "Freeze header row"}
            </button>
            <button onClick={toggleFreezeFirstCol}>
              {tableNode.freeze_first_col
                ? "Unfreeze first column"
                : "Freeze first column"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
