import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface ColorPickerPopoverProps {
  x: number;
  y: number;
  label: string;
  initialValue?: string;
  /**
   * Continuous live-preview callback, fired on every native color input
   * drag frame (its `input` event, which is what React's own `onChange`
   * already maps to for this element type - see the native-input `onChange`
   * handler below) - distinct from `onApply`, which only fires once, on a
   * genuine, deliberate commit.
   */
  onPreview?: (hex: string) => void;
  /** Small MRU row of previously-committed colors for this same picker context, most-recent first. Optional/omittable - an empty or absent list simply renders no row. */
  recentColors?: readonly string[];
  onApply: (hex: string) => void;
  onCancel: () => void;
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  boxSizing: "border-box",
  marginTop: 5,
  padding: "0 10px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  outline: "none",
  background: "var(--srte-input-bg)",
  color: "var(--srte-input-text)",
  font: "inherit",
};

const buttonStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "0 11px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  background: "var(--srte-input-bg)",
  color: "var(--srte-menu-text)",
  cursor: "pointer",
  fontWeight: 500,
};

/**
 * Phase 11.5 §2.4: replaces window.prompt("#000000") for textColor/
 * backgroundColor with a real picker, following LinkEditorPopover's
 * positioning/keyboard-dismiss pattern for consistency. No command-layer
 * change - both still resolve to the same applyAttributedMark({value: hex})
 * call CanonicalAuthorityEditor already makes.
 *
 * Post-batch-2: the preset swatch grid was removed per explicit request
 * ("remove color options ... only keep color picker") - a native
 * <input type="color"> is now the primary picker, with the hex input for
 * typing an exact value. The native input's onChange only stages the
 * value (setHex) rather than calling apply() directly - apply() calls
 * onApply, which closes this popover (setColorPopover(null) in
 * CanonicalAuthorityEditor), and some browsers fire onChange on the very
 * first interaction with the native picker (opening it, or an
 * intermediate drag step), not only on a final commit - auto-applying on
 * every such event closed the popover before the user could actually
 * finish picking a color. The explicit Apply button (already existed for
 * the hex input) is now the single, unambiguous commit action.
 */
export function ColorPickerPopover({ x, y, label, initialValue = "#000000", recentColors, onPreview, onApply, onCancel }: ColorPickerPopoverProps) {
  const [hex, setHex] = useState(initialValue);
  const [error, setError] = useState("");
  const hexRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const errorId = useId();
  // The 40-swatch grid (up from 12) made this popover tall enough that a
  // fixed height estimate for the position clamp went stale immediately -
  // the same real-measure-then-position fix ContextMenu.tsx uses, rather
  // than tuning another magic number that will just go stale again next
  // time the content changes.
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  // CanonicalAuthorityEditor passes a fresh onCancel closure on every
  // render - reading it through a ref (rather than depending on it
  // directly) keeps the outside-click listener mounted exactly once for
  // this popover's lifetime, the same fix ContextMenu.tsx's own
  // outside-click listener needed (see docs/bugs/
  // context-menu-outside-click-dismiss-untested.md) rather than a fresh
  // teardown/reattach on every parent re-render.
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
    setPlacement({ left: clampedLeft, top: clampedTop, maxHeight: viewportHeight - clampedTop - margin });
  }, [x, y]);

  useEffect(() => {
    if (!placement) return;
    hexRef.current?.focus();
    hexRef.current?.select();
  }, [placement]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onCancelRef.current();
    };
    // Both pointerdown and mousedown, same defense-in-depth reasoning as
    // ContextMenu.tsx: pointerdown is the primary signal, mousedown covers
    // any embedding context that isn't guaranteed to dispatch PointerEvents.
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, []);

  const apply = (value: string) => {
    if (!HEX_PATTERN.test(value)) {
      setError("Enter a valid hex color, e.g. #336699.");
      return;
    }
    onApply(value);
  };

  return (
    <div
      ref={rootRef}
      data-srte-color-popover="true"
      role="dialog"
      aria-labelledby={titleId}
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 70,
        width: 224,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: placement ? placement.maxHeight : "calc(100vh - 16px)",
        overflowY: "auto",
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          apply(hex);
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div id={titleId} style={{ fontWeight: 650 }}>{label}</div>
        <button
          type="button"
          aria-label="Close color picker"
          title="Close"
          onClick={onCancel}
          style={{ ...buttonStyle, minWidth: 28, minHeight: 28, padding: 0, border: 0, background: "transparent", fontSize: 18 }}
        >
          ×
        </button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, fontSize: 12, fontWeight: 600 }}>
        <input
          type="color"
          data-srte-color-native-input="true"
          aria-label="Pick a colour"
          value={HEX_PATTERN.test(hex) && hex.length === 7 ? hex : "#000000"}
          onChange={(event) => {
            // React's onChange for an <input> fires on the native `input`
            // event, not `change` - this already fires continuously during
            // a drag inside the native picker (see docs/bugs/
            // color-popover-closes-on-first-native-picker-interaction.md,
            // which is exactly why that bug happened: an earlier version of
            // this handler called onApply directly here). Live-preview the
            // value as it changes; deliberately never auto-commits from
            // here or from any native event on this input - only the
            // explicit Apply button (or Enter in the hex field) commits and
            // closes the popover, exactly as that fix established. Some
            // browsers/OSes fire a "final" native event well before the
            // user is actually done choosing (the same root cause the
            // linked bug had), so nothing native-event-driven can be
            // trusted as "the user is finished."
            const target = event.currentTarget;
            setHex(target.value);
            onPreview?.(target.value);
            // onPreview synchronously re-renders the live document (a real,
            // non-history model update, so a multi-node mark selection
            // previews correctly - not a DOM-only style hack). Syncing that
            // render's selection into the contenteditable surface is itself
            // what steals focus here: setting a native Selection range
            // inside a focusable contenteditable element focuses it as a
            // browser-intrinsic side effect, independent of any explicit
            // .focus() call in this codebase. Reclaiming focus immediately
            // afterward, still within this same synchronous handler, undoes
            // that before the browser paints or the user notices - without
            // this, every drag frame silently kicks focus back to the main
            // editor, breaking Escape-to-cancel and interrupting the drag.
            target.focus();
          }}
          style={{
            width: 48, height: 48, padding: 0, border: "1px solid var(--srte-input-border)",
            borderRadius: 8, background: "none", cursor: "pointer",
          }}
        />
        <span>Drag to pick a colour, or type an exact hex value below.</span>
      </label>

      <label style={{ display: "block", marginBottom: error ? 6 : 12, fontSize: 12, fontWeight: 600 }}>
        Custom hex
        <input
          ref={hexRef}
          data-srte-color-hex-input="true"
          value={hex}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="#336699"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setHex(event.target.value);
            setError("");
          }}
          style={{ ...inputStyle, borderColor: error ? "var(--srte-danger)" : "var(--srte-input-border)" }}
        />
      </label>

      {error && (
        <div id={errorId} data-srte-color-error="true" role="alert" style={{ color: "var(--srte-danger)", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {recentColors && recentColors.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Recently used</div>
          <div data-srte-recent-colors="true" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {recentColors.map((swatch) => (
              <button
                key={swatch}
                type="button"
                data-srte-recent-color={swatch}
                aria-label={`Recently used colour ${swatch}`}
                title={swatch}
                // A recent swatch is a single, complete, deliberate choice -
                // the same reasoning the removed preset grid used to apply
                // (see this file's module doc comment) - so it stages and
                // commits in one click via the same `apply` the hex input's
                // Enter/Apply button already uses, rather than only staging.
                onClick={() => apply(swatch)}
                style={{
                  width: 24, height: 24, padding: 0, borderRadius: 6,
                  border: "1px solid var(--srte-input-border)",
                  background: swatch, cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
        <button type="button" onClick={onCancel} style={buttonStyle}>Cancel</button>
        <button
          type="button"
          onClick={() => apply(hex)}
          style={{ ...buttonStyle, borderColor: "var(--srte-primary)", background: "var(--srte-primary)", color: "var(--srte-on-primary)" }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
