import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MediaOverlayProps {
  atomElement: HTMLElement;
  alt: string;
  width?: number;
  height?: number;
  src?: string;
  x?: number;
  y?: number;
  /** Render only the handles when the media details editor owns the interaction surface. */
  showMenu?: boolean;
  /** False for atoms with no width/height concept (e.g. formula, sized by KaTeX from source/font-size) - hides resize controls and handles, keeping Edit/Delete. */
  resizable?: boolean;
  onEdit: () => void;
  onResize: (by: number) => void;
  onResizeTo: (width: number, height: number) => void;
  onDelete: () => void;
  onDismiss: () => void;
}

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const RESIZE_DIRECTIONS: readonly ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const HANDLE_SIZE = 10;
const MIN_ATOM_SIZE = 24;

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

const cursorFor = (direction: ResizeDirection): React.CSSProperties["cursor"] => {
  if (direction === "n" || direction === "s") return "ns-resize";
  if (direction === "e" || direction === "w") return "ew-resize";
  return direction === "ne" || direction === "sw" ? "nesw-resize" : "nwse-resize";
};

const isCorner = (direction: ResizeDirection): boolean => direction.length === 2;

interface ResizeBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  direction: ResizeDirection;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
}

const visibleBoundsFor = (atomElement: HTMLElement, modelWidth?: number, modelHeight?: number): ResizeBounds | null => {
  const rect = atomElement.getBoundingClientRect();
  const editorElement = atomElement.closest<HTMLElement>(".srte-editor");
  const editorRect = editorElement?.getBoundingClientRect();
  const inset = HANDLE_SIZE / 2;
  // Broken or still-loading images can expose only a tiny fallback box.
  // Use the canonical dimensions for that case, but use the real rendered
  // dimensions whenever the image has a meaningful layout box.
  const imageWidth = rect.width >= MIN_ATOM_SIZE ? rect.width : modelWidth && modelWidth >= MIN_ATOM_SIZE ? modelWidth : rect.width;
  const imageHeight = rect.height >= MIN_ATOM_SIZE ? rect.height : modelHeight && modelHeight >= MIN_ATOM_SIZE ? modelHeight : rect.height;
  const left = Math.max(rect.left, editorRect ? editorRect.left + inset : rect.left);
  const top = Math.max(rect.top, editorRect ? editorRect.top + inset : rect.top);
  const right = Math.min(rect.left + imageWidth, editorRect ? editorRect.right - inset : rect.left + imageWidth);
  const bottom = Math.min(rect.top + imageHeight, editorRect ? editorRect.bottom - inset : rect.top + imageHeight);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
};

const dimensionsForDrag = (drag: DragState, clientX: number, clientY: number): { width: number; height: number } => {
  const deltaX = clientX - drag.startClientX;
  const deltaY = clientY - drag.startClientY;
  const widthDelta = drag.direction.includes("e") ? deltaX : drag.direction.includes("w") ? -deltaX : 0;
  const heightDelta = drag.direction.includes("s") ? deltaY : drag.direction.includes("n") ? -deltaY : 0;

  if (!isCorner(drag.direction)) {
    return {
      width: Math.max(MIN_ATOM_SIZE, Math.round(drag.startWidth + widthDelta)),
      height: Math.max(MIN_ATOM_SIZE, Math.round(drag.startHeight + heightDelta)),
    };
  }

  // Corner handles keep the same aspect ratio as the current image. Use the
  // axis with the larger proportional movement so dragging either diagonal
  // direction feels natural, including when one pointer axis barely moves.
  const widthScale = (drag.startWidth + widthDelta) / drag.startWidth;
  const heightScale = (drag.startHeight + heightDelta) / drag.startHeight;
  const scale = Math.max(
    MIN_ATOM_SIZE / drag.startWidth,
    MIN_ATOM_SIZE / drag.startHeight,
    Math.abs(widthDelta / drag.startWidth) >= Math.abs(heightDelta / drag.startHeight) ? widthScale : heightScale,
  );
  return {
    width: Math.max(MIN_ATOM_SIZE, Math.round(drag.startWidth * scale)),
    height: Math.max(MIN_ATOM_SIZE, Math.round(drag.startHeight * scale)),
  };
};

const boundsForDirection = (bounds: ResizeBounds, direction: ResizeDirection): React.CSSProperties => {
  const half = HANDLE_SIZE / 2;
  const centerX = bounds.left + bounds.width / 2 - half;
  const centerY = bounds.top + bounds.height / 2 - half;
  const right = bounds.left + bounds.width - half;
  const bottom = bounds.top + bounds.height - half;
  const left = direction.includes("w") ? bounds.left - half : direction.includes("e") ? right : centerX;
  const top = direction.includes("n") ? bounds.top - half : direction.includes("s") ? bottom : centerY;
  return { left, top };
};

/**
 * Media resize handles stay anchored to the selected media element and
 * preview size changes live, committing one canonical resize operation when
 * the pointer is released. The quick-action menu is optional because image
 * right-clicks use MediaDetailsPopover directly.
 */
export function MediaOverlay({ atomElement, alt, width, height, src, x, y, showMenu = true, resizable = true, onEdit, onResize, onResizeTo, onDelete, onDismiss }: MediaOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const [bounds, setBounds] = useState<ResizeBounds | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const recompute = () => {
      const rect = atomElement.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = atomElement.ownerDocument.defaultView?.innerWidth ?? 0;
      const viewportHeight = atomElement.ownerDocument.defaultView?.innerHeight ?? 0;
      const panelWidth = rootRef.current?.getBoundingClientRect().width ?? 260;
      const panelHeight = rootRef.current?.getBoundingClientRect().height ?? 160;
      const preferredLeft = x ?? rect.left;
      const preferredTop = y ?? rect.bottom + 6;
      const left = preferredLeft + panelWidth > viewportWidth - margin ? preferredLeft - panelWidth : preferredLeft;
      const top = preferredTop + panelHeight > viewportHeight - margin ? preferredTop - panelHeight : preferredTop;
      setPlacement({
        left: Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - panelWidth - margin)),
        top: Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - panelHeight - margin)),
      });
      // Handles are fixed siblings of the contenteditable surface, so they
      // do not inherit the editor's overflow clipping. Use the visible
      // intersection with the editor viewport to keep every handle inside
      // that boundary when a tall image extends below the scroll area.
      setBounds(visibleBoundsFor(atomElement, width, height));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(atomElement);
    const ownerWindow = atomElement.ownerDocument.defaultView;
    ownerWindow?.addEventListener("scroll", recompute, true);
    ownerWindow?.addEventListener("resize", recompute);
    return () => {
      observer.disconnect();
      ownerWindow?.removeEventListener("scroll", recompute, true);
      ownerWindow?.removeEventListener("resize", recompute);
    };
  }, [atomElement, height, width, x, y]);

  useEffect(() => {
    if (showMenu && placement) rootRef.current?.focus();
  }, [placement, showMenu]);

  useEffect(() => {
    const ownerWindow = atomElement.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dimensions = dimensionsForDrag(drag, event.clientX, event.clientY);
      atomElement.style.width = `${dimensions.width}px`;
      atomElement.style.height = `${dimensions.height}px`;
      setBounds(visibleBoundsFor(atomElement));
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dimensions = dimensionsForDrag(drag, event.clientX, event.clientY);
      dragRef.current = null;
      setDragging(false);
      // The model transaction below becomes authoritative. Clear the live
      // preview first so a stale inline style cannot override later updates.
      atomElement.style.removeProperty("width");
      atomElement.style.removeProperty("height");
      onResizeTo(dimensions.width, dimensions.height);
    };
    ownerWindow.addEventListener("pointermove", handleMove);
    ownerWindow.addEventListener("pointerup", handleUp);
    ownerWindow.addEventListener("pointercancel", handleUp);
    return () => {
      ownerWindow.removeEventListener("pointermove", handleMove);
      ownerWindow.removeEventListener("pointerup", handleUp);
      ownerWindow.removeEventListener("pointercancel", handleUp);
    };
  }, [atomElement, onResizeTo]);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (!showMenu) return;
    const dismissIfOutside = (event: Event) => {
      const target = event.target as Node;
      const elementTarget = target instanceof Element ? target : target.parentElement;
      const isResizeHandle = Boolean(elementTarget?.closest("[data-srte-media-resize-handle-direction]"));
      if (dragRef.current) return;
      if (rootRef.current && !rootRef.current.contains(target) && !atomElement.contains(target) && !isResizeHandle) onDismissRef.current();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, [atomElement, showMenu]);

  return (
    <>
      {resizable && bounds && RESIZE_DIRECTIONS.map((direction) => (
        <div
          key={direction}
          data-srte-media-resize-handle="true"
          data-srte-media-resize-handle-direction={direction}
          role="separator"
          aria-label={`Resize media ${direction}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const startWidth = width && width >= MIN_ATOM_SIZE ? width : bounds.width;
            const startHeight = height && height >= MIN_ATOM_SIZE ? height : bounds.height;
            dragRef.current = {
              direction,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startWidth,
              startHeight,
            };
            setDragging(true);
          }}
          style={{
            ...boundsForDirection(bounds, direction),
            position: "fixed",
            visibility: "visible",
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            boxSizing: "border-box",
            borderRadius: 3,
            background: dragging ? "var(--srte-primary)" : "var(--srte-menu-bg)",
            border: "2px solid var(--srte-primary)",
            cursor: cursorFor(direction),
            zIndex: 81,
            touchAction: "none",
          }}
        />
      ))}
      {showMenu && <div
        ref={rootRef}
        data-srte-media-overlay="true"
        role="dialog"
        aria-label="Media actions"
        tabIndex={-1}
        style={{
          position: "fixed",
          left: placement?.left ?? x ?? 0,
          top: placement?.top ?? y ?? 0,
          visibility: placement ? "visible" : "hidden",
          zIndex: 80,
          width: 260,
          maxWidth: "calc(100vw - 16px)",
          boxSizing: "border-box",
          background: "var(--srte-menu-bg)",
          color: "var(--srte-menu-text)",
          border: "1px solid var(--srte-border)",
          borderRadius: 10,
          boxShadow: "var(--srte-menu-shadow)",
          padding: 10,
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDismiss();
          }
        }}
      >
        <div style={{ fontSize: 12, marginBottom: 8, display: "grid", gap: 2, opacity: 0.85 }}>
          <div><strong>Alt text:</strong> {alt || "(none)"}</div>
          {width && height && <div><strong>Size:</strong> {Math.round(width)}×{Math.round(height)}</div>}
          {src && <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><strong>Source:</strong> {src}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={buttonStyle} onClick={onEdit}>Edit</button>
          {resizable && <button type="button" style={buttonStyle} onClick={() => onResize(20)}>Resize +</button>}
          {resizable && <button type="button" style={buttonStyle} onClick={() => onResize(-20)}>Resize βˆ’</button>}
          <button type="button" style={{ ...buttonStyle, color: "var(--srte-danger)", marginLeft: "auto" }} onClick={onDelete}>Delete</button>
        </div>
      </div>}
    </>
  );
}
