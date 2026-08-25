import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MediaOverlayProps {
  atomElement: HTMLElement;
  alt: string;
  width?: number;
  height?: number;
  src?: string;
  onEdit: () => void;
  onResize: (by: number) => void;
  onResizeTo: (width: number, height: number) => void;
  onDelete: () => void;
  onDismiss: () => void;
}

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

const HANDLE_SIZE = 12;
const MIN_ATOM_SIZE = 24;

/**
 * Context menu scope reduction: media no longer gets a generic right-click
 * menu - it gets this dedicated overlay, anchored to the atom's own live
 * element rect (the same ResizeObserver/scroll-tracking pattern
 * TableResizeHandles.tsx already uses for anchoring UI to a live element,
 * per §1's investigation) instead of click coordinates, appearing whenever
 * an atom is selected. The caller controls visibility by conditionally
 * rendering this component based on atomSelected - when the selection
 * moves off the atom, the component unmounts on its own, which is the
 * "dismiss when selection moves away" requirement with no extra logic
 * needed here.
 *
 * Post-batch follow-up ("images doesn't have a resizer"): the Resize +/-
 * buttons were the only resize affordance - no direct drag handle existed
 * for atoms, unlike tables. Added a corner drag handle at the atom's own
 * bottom-right corner, reusing TableResizeHandles.tsx's exact live-preview-
 * during-drag / commit-on-release pattern (mutate the real element's style
 * directly while dragging for immediate feedback, commit via a real command
 * only on release) rather than inventing a different interaction model for
 * the second resizable-thing in this codebase.
 */
export function MediaOverlay({ atomElement, alt, width, height, src, onEdit, onResize, onResizeTo, onDelete, onDismiss }: MediaOverlayProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const [handlePosition, setHandlePosition] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startWidth: number; startHeight: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const recompute = () => {
      const rect = atomElement.getBoundingClientRect();
      const margin = 8;
      const viewportWidth = atomElement.ownerDocument.defaultView?.innerWidth ?? 0;
      const viewportHeight = atomElement.ownerDocument.defaultView?.innerHeight ?? 0;
      const panelWidth = rootRef.current?.getBoundingClientRect().width ?? 260;
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - panelWidth - margin));
      const overflowsBottom = rect.bottom + 6 + 120 > viewportHeight - margin;
      const top = overflowsBottom ? Math.max(margin, rect.top - 6 - 120) : rect.bottom + 6;
      setPlacement({ left, top });
      setHandlePosition({ left: rect.right - HANDLE_SIZE / 2, top: rect.bottom - HANDLE_SIZE / 2 });
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(atomElement);
    const ownerWindow = atomElement.ownerDocument.defaultView;
    ownerWindow?.addEventListener("scroll", recompute, true);
    return () => {
      observer.disconnect();
      ownerWindow?.removeEventListener("scroll", recompute, true);
    };
  }, [atomElement]);

  useEffect(() => {
    const ownerWindow = atomElement.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = Math.max(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
      const liveWidth = Math.max(MIN_ATOM_SIZE, Math.round(drag.startWidth + delta));
      const liveHeight = Math.max(MIN_ATOM_SIZE, Math.round(drag.startHeight + (delta * drag.startHeight) / drag.startWidth));
      atomElement.style.width = `${liveWidth}px`;
      atomElement.style.height = `${liveHeight}px`;
      if (handleRef.current) {
        const rect = atomElement.getBoundingClientRect();
        handleRef.current.style.left = `${rect.right - HANDLE_SIZE / 2}px`;
        handleRef.current.style.top = `${rect.bottom - HANDLE_SIZE / 2}px`;
      }
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = Math.max(event.clientX - drag.startClientX, event.clientY - drag.startClientY);
      const finalWidth = Math.max(MIN_ATOM_SIZE, Math.round(drag.startWidth + delta));
      const finalHeight = Math.max(MIN_ATOM_SIZE, Math.round(drag.startHeight + (delta * drag.startHeight) / drag.startWidth));
      dragRef.current = null;
      setDragging(false);
      // Committing triggers the renderer's own re-render from authoritative
      // model state, which overwrites the live-preview inline style above -
      // same reasoning as TableResizeHandles.tsx's commit-on-release.
      onResizeTo(finalWidth, finalHeight);
    };
    ownerWindow.addEventListener("pointermove", handleMove);
    ownerWindow.addEventListener("pointerup", handleUp);
    return () => {
      ownerWindow.removeEventListener("pointermove", handleMove);
      ownerWindow.removeEventListener("pointerup", handleUp);
    };
  }, [atomElement, onResizeTo]);

  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      const target = event.target as Node;
      if (dragRef.current) return;
      if (rootRef.current && !rootRef.current.contains(target) && !atomElement.contains(target) && target !== handleRef.current) onDismissRef.current();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, [atomElement]);

  return (
    <>
      <div
        ref={handleRef}
        data-srte-media-resize-handle="true"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize media"
        onPointerDown={(event) => {
          event.preventDefault();
          const rect = atomElement.getBoundingClientRect();
          dragRef.current = { startClientX: event.clientX, startClientY: event.clientY, startWidth: rect.width, startHeight: rect.height };
          setDragging(true);
        }}
        style={{
          position: "fixed",
          left: handlePosition?.left ?? 0,
          top: handlePosition?.top ?? 0,
          visibility: handlePosition ? "visible" : "hidden",
          width: HANDLE_SIZE,
          height: HANDLE_SIZE,
          borderRadius: "50%",
          background: dragging ? "var(--srte-primary)" : "var(--srte-menu-bg)",
          border: "2px solid var(--srte-primary)",
          cursor: "nwse-resize",
          zIndex: 71,
          touchAction: "none",
        }}
      />
      <div
        ref={rootRef}
        data-srte-media-overlay="true"
        role="dialog"
        aria-label="Media actions"
        style={{
          position: "fixed",
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          visibility: placement ? "visible" : "hidden",
          zIndex: 70,
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
          <button type="button" style={buttonStyle} onClick={() => onResize(20)}>Resize +</button>
          <button type="button" style={buttonStyle} onClick={() => onResize(-20)}>Resize βˆ’</button>
          <button type="button" style={{ ...buttonStyle, color: "var(--srte-danger)", marginLeft: "auto" }} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </>
  );
}
