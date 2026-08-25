import React, { useCallback, useEffect, useRef, useState } from "react";

export interface TableResizeHandlesProps {
  tableElement: HTMLTableElement;
  /**
   * `currentWidths` is every column's real, currently-rendered width (not
   * just the dragged one) - see the handleUp comment below for why the
   * caller needs this, not just the one changed index.
   */
  onResizeColumn: (index: number, width: number, currentWidths: readonly number[]) => void;
  onResizeRow: (index: number, height: number, adjacent?: { index: number; height: number }) => void;
}

interface Boundary {
  index: number;
  /** Position in viewport coordinates, matching the handle's own fixed positioning. */
  position: number;
  length: number;
  start: number;
  size: number;
}

const HANDLE_THICKNESS = 6;
const MIN_SIZE = 20;

/**
 * Phase 11.5 §2.2: column-width/row-height drag handles calling the
 * existing setTableColumnWidthCommand/setTableRowHeightCommand (row/column
 * reorder already had toolbar buttons - "Move row up/down"/"Move column
 * left/right" - wired since before this phase; resize had no UI at all).
 * Commit-on-release, not a live preview during drag - a deliberately
 * bounded scope for the first pass. Recomputes handle geometry from the
 * live table's actual rendered cell rects on every table layout change via
 * ResizeObserver, since table content (and therefore column/row sizes)
 * changes independently of resize actions.
 */
export function TableResizeHandles({ tableElement, onResizeColumn, onResizeRow }: TableResizeHandlesProps) {
  const [columns, setColumns] = useState<Boundary[]>([]);
  const [rows, setRows] = useState<Boundary[]>([]);
  // `nextStartSize`/`nextIndex` are null for the last row/column's own
  // outer-edge handle - that one still grows/shrinks the table's overall
  // size (no neighbor to redistribute with); every other handle has a
  // real neighbor and redistributes between the two instead.
  const dragRef = useRef<{
    kind: "column" | "row"; index: number; startClient: number; startSize: number;
    nextIndex: number | null; nextStartSize: number | null;
  } | null>(null);
  const [dragging, setDragging] = useState<{ kind: "column" | "row"; index: number; position: number } | null>(null);
  // handleUp (below) is defined inside an effect that doesn't depend on
  // `columns`/`rows` (to avoid tearing down the pointer listeners on every
  // ResizeObserver tick) - these refs keep it reading the latest measured
  // sizes anyway, without that staleness risk.
  const columnsRef = useRef<Boundary[]>([]);
  columnsRef.current = columns;
  const rowsRef = useRef<Boundary[]>([]);
  rowsRef.current = rows;

  // Shared by the passive observers below (structural/layout changes that
  // happen outside a drag) and by handleMove during an active drag (see
  // that effect for why an active drag can't just wait for these
  // observers to notice).
  const recompute = useCallback(() => {
    const tableRect = tableElement.getBoundingClientRect();
    const firstRowCells = [...tableElement.querySelectorAll<HTMLElement>("tr")[0]?.children || []];
    const colBoundaries: Boundary[] = [];
    firstRowCells.forEach((cell, index) => {
      const rect = cell.getBoundingClientRect();
      colBoundaries.push({ index, position: rect.right, length: tableRect.height, start: tableRect.top, size: rect.width });
    });
    const rowElements = [...tableElement.querySelectorAll<HTMLElement>(":scope > tr, :scope > tbody > tr")];
    const rowBoundaries: Boundary[] = [];
    rowElements.forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      rowBoundaries.push({ index, position: rect.bottom, length: tableRect.width, start: tableRect.left, size: rect.height });
    });
    setColumns(colBoundaries);
    setRows(rowBoundaries);
  }, [tableElement]);

  useEffect(() => {
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(tableElement);
    // ResizeObserver only fires when tableElement's own box size changes -
    // inserting/removing a row or column into a table that stays the same
    // overall width (the common case: width:100%, or a pinned literal
    // width unaffected by redistributing space across one more/fewer
    // column) never changes that box size, so it never fires. Handles
    // then stay stale: wrong count, wrong position, wrong `boundary.size`
    // for whatever column/row the model now has at that index - dragging
    // one computed a wildly wrong new width from a stale start size. A
    // MutationObserver on the table's own structure (row/cell add/remove/
    // reorder) catches exactly the class of change ResizeObserver misses.
    const mutationObserver = new MutationObserver(recompute);
    mutationObserver.observe(tableElement, { childList: true, subtree: true });
    const ownerWindow = tableElement.ownerDocument.defaultView;
    ownerWindow?.addEventListener("scroll", recompute, true);
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      ownerWindow?.removeEventListener("scroll", recompute, true);
    };
  }, [tableElement, recompute]);

  useEffect(() => {
    const ownerWindow = tableElement.ownerDocument.defaultView;
    if (!ownerWindow) return;
    // For an internal boundary (a real neighbor exists), clamp the raw
    // pointer delta so neither side ever goes below MIN_SIZE, then apply
    // the *same* clamped delta with opposite signs to both sides - their
    // sum is therefore always exactly startSize + nextStartSize, whatever
    // the clamp did. That invariant is what makes "the border just moves"
    // true: the table's own total size never has to change for these.
    //
    // Rows can't use this arithmetic-only approach: a <tr>'s rendered
    // height can never go below what its own cell content needs (an
    // explicit row height behaves as a minimum, not a hard cap, in table
    // layout) - unlike a column's width under table-layout:fixed, which
    // genuinely can be squeezed below its content's natural width. Naively
    // clamping to a fixed MIN_SIZE the way columns do would, the instant a
    // row's *real* content floor was higher than that, still hand the
    // *other* row the full requested delta anyway - the total table
    // height would silently grow instead of staying constant, and the row
    // actually being dragged would appear frozen while its neighbor
    // visibly ballooned (this is what "resize rows... move cursor up
    // then it is effecting below row height" was - see docs/bugs/
    // row-resize-drag-up-only-grows-the-row-below.md). Measuring the real
    // DOM after attempting a shrink, and handing the other row only what
    // was actually ceded, keeps that same invariant true regardless of
    // where a row's real floor turns out to be.
    const resolveSizes = (drag: NonNullable<typeof dragRef.current>, event: PointerEvent) => {
      const rawDelta = drag.kind === "column" ? event.clientX - drag.startClient : event.clientY - drag.startClient;
      if (drag.kind === "column") {
        if (drag.nextStartSize === null) {
          return { size: Math.max(MIN_SIZE, Math.round(drag.startSize + rawDelta)), nextSize: null };
        }
        const minDelta = -(drag.startSize - MIN_SIZE);
        const maxDelta = drag.nextStartSize - MIN_SIZE;
        const delta = Math.min(Math.max(rawDelta, minDelta), maxDelta);
        return { size: Math.round(drag.startSize + delta), nextSize: Math.round(drag.nextStartSize - delta) };
      }
      const rowElements = [...tableElement.querySelectorAll<HTMLElement>(":scope > tr, :scope > tbody > tr")];
      if (drag.nextStartSize === null || drag.nextIndex === null) {
        const target = Math.max(MIN_SIZE, Math.round(drag.startSize + rawDelta));
        const rowElement = rowElements[drag.index];
        if (rowElement) rowElement.style.height = `${target}px`;
        const actual = rowElement ? Math.round(rowElement.getBoundingClientRect().height) : target;
        return { size: actual, nextSize: null };
      }
      const rowElement = rowElements[drag.index];
      const nextRowElement = rowElements[drag.nextIndex];
      if (rawDelta <= 0) {
        // The dragged (above) row is the one shrinking; the row below
        // only grows by however much the above row actually gave up.
        // There's no equivalent fallback for the dragged row itself here -
        // a row that can't shrink just can't, full stop, no matter how
        // flexible the table's total height is willing to be.
        const target = Math.max(MIN_SIZE, Math.round(drag.startSize + rawDelta));
        if (rowElement) rowElement.style.height = `${target}px`;
        const actualSize = rowElement ? Math.round(rowElement.getBoundingClientRect().height) : target;
        return { size: actualSize, nextSize: Math.round(drag.nextStartSize - (actualSize - drag.startSize)) };
      }
      // Dragging down: the row below is asked to shrink to pay for the
      // dragged row's growth, exactly like the mirror case above - but
      // unlike a row shrinking, a row *growing* is never floor-limited (a
      // <tr>'s content only ever imposes a minimum, never a maximum), so
      // there's no symmetric "the dragged row just can't grow" outcome to
      // fall back to here. Making the dragged row's growth conditional on
      // the neighbor actually having room to give (the way the shrink
      // case correctly is) meant that on a table where every row already
      // sits at its own content floor - true of almost any freshly
      // created or pasted table with short cell text - internal
      // row-boundary dragging did *nothing at all* in either direction:
      // shrinking had nowhere to go, and growing was blocked because the
      // neighbor had nowhere to give either. See docs/bugs/
      // row-resize-blocked-when-every-row-is-at-its-floor.md. Grow the
      // dragged row by the full requested amount unconditionally, and let
      // the neighbor give up only what it actually can; if that's less
      // than what was asked, the shortfall becomes real table growth -
      // the only place that space could possibly come from - rather than
      // silently refusing the drag altogether.
      const size = Math.max(MIN_SIZE, Math.round(drag.startSize + rawDelta));
      if (rowElement) rowElement.style.height = `${size}px`;
      const target = Math.max(MIN_SIZE, Math.round(drag.nextStartSize - rawDelta));
      if (nextRowElement) nextRowElement.style.height = `${target}px`;
      const nextSize = nextRowElement ? Math.round(nextRowElement.getBoundingClientRect().height) : target;
      return { size, nextSize };
    };
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setDragging({ kind: drag.kind, index: drag.index, position: drag.kind === "column" ? event.clientX : event.clientY });
      // Live preview: mutate the real <col>/<tr> directly during the drag
      // (commit-on-release still only touches the model, via onResizeColumn/
      // onResizeRow below) - previously nothing rendered until pointerup, so
      // the drag looked frozen until it suddenly jumped to the final size.
      // Undoing this on the next real render is automatic: committing
      // triggers the renderer's own re-render from authoritative model
      // state, which overwrites whatever this loop wrote.
      const { size: liveSize, nextSize: liveNextSize } = resolveSizes(drag, event);
      if (drag.kind === "column") {
        const cols = [...(tableElement.querySelector("colgroup")?.children || [])] as HTMLElement[];
        const col = cols[drag.index];
        if (col) col.style.width = `${liveSize}px`;
        if (liveNextSize !== null && drag.nextIndex !== null) {
          const nextCol = cols[drag.nextIndex];
          if (nextCol) nextCol.style.width = `${liveNextSize}px`;
        }
        // The stylesheet's `table-layout: fixed` + `width: 100%` treats
        // <col> widths as proportions of the table's own rendered width,
        // not literal pixels, unless the table's own width matches their
        // sum (see surface/renderer.ts's table-width fix) - keep that sum
        // live too, or every other column visibly compresses for the
        // duration of the drag even though the fix restores them on
        // release. Redistributing between two columns (liveNextSize !==
        // null) never changes this sum by construction, so only the
        // last column's own resize (liveNextSize === null) needs this.
        if (liveNextSize === null) {
          const total = cols.reduce((sum, candidate, index) => sum + (index === drag.index ? liveSize : (parseFloat(candidate.style.width) || 0)), 0);
          if (total > 0) tableElement.style.width = `${total}px`;
        }
      } else {
        const rowElements = [...tableElement.querySelectorAll<HTMLElement>(":scope > tr, :scope > tbody > tr")];
        const rowElement = rowElements[drag.index];
        if (rowElement) rowElement.style.height = `${liveSize}px`;
        if (liveNextSize !== null && drag.nextIndex !== null) {
          const nextRow = rowElements[drag.nextIndex];
          if (nextRow) nextRow.style.height = `${liveNextSize}px`;
        }
      }
      // The handles' own on-screen position/length come from `columns`/
      // `rows` state, which the effect above only refreshes via
      // ResizeObserver/MutationObserver/scroll - none of which reliably
      // fire here. Column drags happen to nudge the table's own rendered
      // width by sub-pixel rounding (table-layout: fixed redistributing a
      // stray pixel), which incidentally retriggers ResizeObserver; an
      // internal row-boundary drag keeps the table's total height exactly
      // constant by construction (see resolveSizes above), so it never
      // does. Left alone, the row handle (and the blue line it renders)
      // stays frozen at its pre-drag position while the real row border
      // moves live underneath it - reported as a misplaced, "very slow"
      // blue line that overflows past the table/editor as the gap between
      // the frozen handle and the actual, now-taller table grows. Forcing
      // a synchronous re-measure after every live style mutation (a
      // getBoundingClientRect read right after a style write forces the
      // browser to flush layout first, so this always reflects the
      // mutation just above, not a stale value) keeps both column and row
      // handles tracking the real border on every pointermove instead of
      // waiting on an observer that may not fire at all.
      recompute();
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const { size, nextSize } = resolveSizes(drag, event);
      if (drag.kind === "column") {
        // A table pasted/created with no columnWidths yet (natural,
        // stretched rendering - see docs/bugs/table-shrinks-after-paste.md)
        // has no real per-column data for the command layer to fall back
        // on; without this, setTableColumnWidthCommand's own fallback
        // (Array(columns).fill(120)) would silently reset every OTHER
        // column to a fabricated 120px default the instant any one column
        // was resized, shrinking the whole table - passing the real,
        // currently-measured width of every column lets the caller seed a
        // complete, accurate columnWidths array instead of guessing.
        const currentWidths = columnsRef.current.map((boundary) => boundary.size);
        if (nextSize !== null && drag.nextIndex !== null) currentWidths[drag.nextIndex] = nextSize;
        onResizeColumn(drag.index, size, currentWidths);
      } else if (nextSize !== null && drag.nextIndex !== null) {
        onResizeRow(drag.index, size, { index: drag.nextIndex, height: nextSize });
      } else onResizeRow(drag.index, size);
      dragRef.current = null;
      setDragging(null);
    };
    ownerWindow.addEventListener("pointermove", handleMove);
    ownerWindow.addEventListener("pointerup", handleUp);
    return () => {
      ownerWindow.removeEventListener("pointermove", handleMove);
      ownerWindow.removeEventListener("pointerup", handleUp);
    };
  }, [tableElement, onResizeColumn, onResizeRow, recompute]);

  const startDrag = (kind: "column" | "row", boundary: Boundary) => (event: React.PointerEvent) => {
    event.preventDefault();
    const siblings = kind === "column" ? columnsRef.current : rowsRef.current;
    const next = siblings[boundary.index + 1] ?? null;
    dragRef.current = {
      kind, index: boundary.index, startClient: kind === "column" ? event.clientX : event.clientY, startSize: boundary.size,
      nextIndex: next?.index ?? null, nextStartSize: next?.size ?? null,
    };
    setDragging({ kind, index: boundary.index, position: kind === "column" ? event.clientX : event.clientY });
  };

  return (
    <div data-srte-table-resize-handles="true" style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 60 }}>
      {/*
        Row handles paint first, column handles second: a column handle
        spans the table's full height and a row handle spans its full
        width, so they cross at every row/column boundary intersection -
        with no z-index difference, later-in-DOM wins pointer hit-testing
        at an exact overlap. Found live-preview-testing a small table
        where the row-0/row-1 boundary happened to cross right through a
        column handle's own vertical midpoint, silently starting a row
        drag instead of the intended column drag. Column handles win the
        tie since a column-width drag is the more common gesture.
      */}
      {rows.map((boundary) => (
        <div
          key={`row-${boundary.index}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize row ${boundary.index + 1}`}
          data-srte-row-resize-handle={boundary.index}
          onPointerDown={startDrag("row", boundary)}
          style={{
            position: "fixed",
            left: boundary.start,
            top: boundary.position - HANDLE_THICKNESS / 2,
            width: boundary.length,
            height: HANDLE_THICKNESS,
            cursor: "row-resize",
            pointerEvents: "auto",
            background: dragging?.kind === "row" && dragging.index === boundary.index ? "var(--srte-primary)" : "transparent",
          }}
        />
      ))}
      {columns.map((boundary) => (
        <div
          key={`col-${boundary.index}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${boundary.index + 1}`}
          data-srte-column-resize-handle={boundary.index}
          onPointerDown={startDrag("column", boundary)}
          style={{
            position: "fixed",
            left: boundary.position - HANDLE_THICKNESS / 2,
            top: boundary.start,
            width: HANDLE_THICKNESS,
            height: boundary.length,
            cursor: "col-resize",
            pointerEvents: "auto",
            background: dragging?.kind === "column" && dragging.index === boundary.index ? "var(--srte-primary)" : "transparent",
          }}
        />
      ))}
    </div>
  );
}
