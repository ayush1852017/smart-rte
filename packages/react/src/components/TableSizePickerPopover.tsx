import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TableSizePickerPopoverProps {
  x: number;
  y: number;
  onInsert: (rows: number, columns: number) => void;
  onCancel: () => void;
}

const MAX_GRID = 8;

const buttonStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "0 10px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  background: "var(--srte-input-bg)",
  color: "var(--srte-menu-text)",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: 48,
  height: 32,
  boxSizing: "border-box",
  padding: "0 8px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  outline: "none",
  background: "var(--srte-input-bg)",
  color: "var(--srte-input-text)",
  font: "inherit",
  textAlign: "center",
};

/**
 * "Insert table" size picker - CKEditor's own pattern: hover an N×M grid to
 * preview the size, click a cell to insert immediately (one decisive click,
 * no separate Apply/Confirm step, since a grid cell click is already a
 * single deliberate choice - the same reasoning ColorPickerPopover's
 * recent-swatch buttons and the removed preset grid used). A numeric
 * fallback below covers sizes past the grid's cap without capping what the
 * tool can actually do.
 */
export function TableSizePickerPopover({ x, y, onInsert, onCancel }: TableSizePickerPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLInputElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);
  const [customRows, setCustomRows] = useState("2");
  const [customColumns, setCustomColumns] = useState("2");
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const overflowsRight = x + width > viewportWidth - margin;
    const left = overflowsRight ? x - width : x;
    const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - width - margin));
    const overflowsBottom = y + height > viewportHeight - margin;
    const top = overflowsBottom ? y - height : y;
    const clampedTop = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - margin));
    setPlacement({ left: clampedLeft, top: clampedTop });
  }, [x, y]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onCancelRef.current();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, []);

  // Escape must dismiss regardless of focus - unlike LinkEditorPopover/
  // ColorPickerPopover, nothing here is autofocused on open (the grid is
  // meant to be hovered, not tabbed into first), so focus stays wherever it
  // was (typically the "Insert table" toolbar button) and the div's own
  // onKeyDown below would never see the keypress.
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  const insertCustom = () => {
    const rows = Math.min(50, Math.max(1, Math.round(Number(customRows)) || 0));
    const columns = Math.min(50, Math.max(1, Math.round(Number(customColumns)) || 0));
    if (!rows || !columns) return;
    onInsert(rows, columns);
  };

  return (
    <div
      ref={rootRef}
      data-srte-table-size-popover="true"
      role="dialog"
      aria-label="Insert table"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 70,
        width: 232,
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 650, marginBottom: 10 }}>Insert table</div>
      <div
        data-srte-table-size-grid="true"
        style={{ display: "grid", gridTemplateColumns: `repeat(${MAX_GRID}, 1fr)`, gap: 3, marginBottom: 8 }}
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: MAX_GRID * MAX_GRID }, (_, index) => {
          const row = Math.floor(index / MAX_GRID);
          const column = index % MAX_GRID;
          const active = hover ? row <= hover.row && column <= hover.column : false;
          return (
            <button
              key={index}
              type="button"
              data-srte-table-size-cell={`${row + 1}x${column + 1}`}
              aria-label={`Insert a ${row + 1} by ${column + 1} table`}
              onMouseEnter={() => setHover({ row, column })}
              onFocus={() => setHover({ row, column })}
              onClick={() => onInsert(row + 1, column + 1)}
              style={{
                width: 20, height: 20, padding: 0, boxSizing: "border-box",
                border: `1px solid ${active ? "var(--srte-primary)" : "var(--srte-input-border)"}`,
                borderRadius: 3,
                background: active ? "var(--srte-primary)" : "var(--srte-input-bg)",
                cursor: "pointer",
              }}
            />
          );
        })}
      </div>
      <div data-srte-table-size-label="true" style={{ fontSize: 12, marginBottom: 12, minHeight: 16 }}>
        {hover ? `${hover.row + 1} × ${hover.column + 1} table` : "Hover to choose a size"}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Custom size</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <input
          ref={rowsRef}
          type="number"
          min={1}
          max={50}
          aria-label="Rows"
          value={customRows}
          onChange={(event) => setCustomRows(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertCustom(); } }}
          style={inputStyle}
        />
        <span>×</span>
        <input
          type="number"
          min={1}
          max={50}
          aria-label="Columns"
          value={customColumns}
          onChange={(event) => setCustomColumns(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertCustom(); } }}
          style={inputStyle}
        />
        <button type="button" onClick={insertCustom} style={{ ...buttonStyle, marginLeft: "auto", borderColor: "var(--srte-primary)", background: "var(--srte-primary)", color: "var(--srte-on-primary)" }}>
          Insert
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={buttonStyle}>Cancel</button>
      </div>
    </div>
  );
}
