import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onDismiss: () => void;
}

// A fixed cap, not just "whatever fits below the click point" - the menu's
// item count has grown considerably (marks, table, media, cell colour,
// link actions can all stack for one click), and a height that changes
// with click position made the scroll behavior feel inconsistent. Still
// clamped against the real available viewport space too (see placement
// below), so it never overflows a genuinely short viewport.
const MAX_MENU_HEIGHT = 400;

const itemStyle = (danger: boolean | undefined): React.CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: danger ? "var(--srte-danger)" : "var(--srte-menu-text)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
});

/**
 * Phase 11.5 §2.3: a generic right-click menu, position-at-cursor and
 * keyboard-dismissible following LinkEditorPopover/ColorPickerPopover's
 * pattern - plus click-outside-to-close, which those two don't have but a
 * native-context-menu-replacement genuinely needs (an accidental click
 * elsewhere shouldn't leave it stuck open). Items are supplied by the
 * caller (CanonicalAuthorityEditor's resolveContextMenuItems), which
 * resolves the applicable plugin registry `contextMenu` contributions for
 * the current scope - this component has no knowledge of commands/scopes.
 */
export function ContextMenu({ x, y, items, onDismiss }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Null until measured: the menu's real width/height depends on its
  // content (item label lengths), not a fixed guess, so the final position
  // - including whether to flip left/up to stay in the viewport - can only
  // be computed after a first, invisible render exposes the real
  // getBoundingClientRect(). Fixes both the viewport-overflow bug (the
  // previous clamp math assumed a hardcoded 220px width that real labels
  // like "Insert column right" can exceed) and gives scroll a real
  // available-height number to clamp against.
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  // CanonicalAuthorityEditor passes a fresh onDismiss closure on every
  // render (it re-renders on every editor subscribe tick, i.e. on every
  // document/selection change - possible even while this menu is open, if
  // the triggering right-click itself moved the caret). Reading through a
  // ref - rather than depending on `onDismiss` in the effect below - keeps
  // the outside-click listener mounted exactly once for this menu's
  // lifetime, so a re-render can't create a window where the listener has
  // been torn down and not yet reattached.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Open leftward (menu's right edge at the click point) instead of the
    // default rightward open when the default would overflow the right
    // edge - never silently overflow.
    const overflowsRight = x + width > viewportWidth - margin;
    const left = overflowsRight ? x - width : x;
    const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - width - margin));

    // Same flip for the bottom edge.
    const overflowsBottom = y + height > viewportHeight - margin;
    const top = overflowsBottom ? y - height : y;
    const clampedTop = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - margin));

    // The smaller of the fixed cap and whatever space actually remains
    // below wherever the menu opens - a menu taller than that scrolls
    // internally instead of extending past the viewport OR growing
    // without bound on a tall screen.
    const maxHeight = Math.min(MAX_MENU_HEIGHT, viewportHeight - clampedTop - margin);

    setPlacement({ left: clampedLeft, top: clampedTop, maxHeight });
  }, [x, y, items.length]);

  useEffect(() => {
    if (!placement) return;
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    buttons?.[0]?.focus();
  }, [placement]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onDismissRef.current();
    };
    // Both pointerdown and mousedown: pointerdown is the primary signal,
    // but not every input path is guaranteed to dispatch PointerEvents in
    // every embedding context - mousedown is the same "was this outside"
    // check as a defense-in-depth fallback, not a second independent path.
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      data-srte-context-menu="true"
      role="menu"
      aria-label="Editor actions"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        // Hidden (not unrendered) until the real size is measured and a
        // final, in-viewport position is computed - unrendered would mean
        // getBoundingClientRect() has nothing to measure; visible-but-
        // unpositioned would flash at the wrong spot for a frame first.
        visibility: placement ? "visible" : "hidden",
        zIndex: 80,
        minWidth: 200,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: placement ? placement.maxHeight : "calc(100vh - 16px)",
        overflowY: "auto",
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 10,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 6,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || []);
        if (!buttons.length) return;
        const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.key === "ArrowDown"
          ? (currentIndex + 1) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }}
    >
      {items.length === 0 && (
        <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--srte-menu-text)", opacity: 0.6 }}>No actions here</div>
      )}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-srte-context-menu-item={item.id}
          onClick={() => { item.onSelect(); onDismiss(); }}
          style={itemStyle(item.danger)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
