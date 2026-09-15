import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ColorPickerPopover } from "./ColorPickerPopover.js";
import { getFixedPositioningOrigin, getPositioningBounds } from "./fixedPositioning.js";
import { BORDER_WIDTH_PRESETS, type BorderStyle } from "./TableBorderPopover.js";

export interface BlockquoteBorderDraft { style: BorderStyle; widthPx: number; hex: string }

export interface BlockquoteBorderPopoverProps {
  x: number;
  y: number;
  initial: BlockquoteBorderDraft;
  /** Up to 4 previously-committed border colours, most-recent first - same pattern as the other colour buckets. */
  recentColors?: readonly string[];
  /** Fires on every change (style/width picked, or a colour drag frame) - the caller live-previews it on the real blockquote. */
  onPreview: (draft: BlockquoteBorderDraft) => void;
  /** Fires once, only from the explicit Apply button - matches TableBorderPopover's own reasoning (a composite dialog commits on a deliberate action, not on any dismissal). */
  onApply: (draft: BlockquoteBorderDraft) => void;
  /** Fires from Cancel, Escape, or an outside click - reverts to `initial`. */
  onCancel: () => void;
}

const STYLE_OPTIONS: readonly BorderStyle[] = ["solid", "dashed", "dotted"];

const buttonStyle: React.CSSProperties = {
  minHeight: 32, padding: "0 10px", border: "1px solid var(--srte-input-border)", borderRadius: 8,
  background: "var(--srte-input-bg)", color: "var(--srte-menu-text)", cursor: "pointer", fontWeight: 500, fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  width: "100%", height: 32, boxSizing: "border-box", padding: "0 8px", borderRadius: 8,
  border: "1px solid var(--srte-input-border)", background: "var(--srte-input-bg)", color: "var(--srte-input-text)",
  font: "inherit", fontSize: 13, cursor: "pointer",
};
const fieldLabelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.7, marginBottom: 4 };

/**
 * "Blockquote border options" - style/width/colour for the one border a
 * blockquote ever shows (its left border). Deliberately not
 * TableBorderPopover with a "sides" toggle locked to left-only: there is
 * only ever one side here, so the whole sides-diagram/"All sides"/"No
 * border" UI that control exists for has nothing to select between -
 * dropping it entirely rather than threading a single-side mode through
 * the table-specific component keeps each popover's UI matching what it
 * actually controls.
 */
export function BlockquoteBorderPopover({ x, y, initial, recentColors, onPreview, onApply, onCancel }: BlockquoteBorderPopoverProps) {
  const [draft, setDraft] = useState<BlockquoteBorderDraft>(initial);
  const [colorPickerAnchor, setColorPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  const hexBeforeNestedPickerRef = useRef(initial.hex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const margin = 8;
    const { width, height } = el.getBoundingClientRect();
    const bounds = getPositioningBounds(el);
    const overflowsRight = x + width > bounds.right - margin;
    const left = overflowsRight ? x - width : x;
    const clampedLeft = Math.min(Math.max(bounds.left + margin, left), Math.max(bounds.left + margin, bounds.right - width - margin));
    const overflowsBottom = y + height > bounds.bottom - margin;
    const top = overflowsBottom ? y - height : y;
    const clampedTop = Math.min(Math.max(bounds.top + margin, top), Math.max(bounds.top + margin, bounds.bottom - margin));
    const origin = getFixedPositioningOrigin(el);
    setPlacement({ left: clampedLeft - origin.left, top: clampedTop - origin.top });
  }, [x, y]);

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // The nested colour picker is a DOM sibling (both are position:fixed
      // overlays), not a descendant of rootRef - without this, clicking
      // inside it would look like an "outside" click on this popover.
      if (colorPickerAnchor && document.querySelector('[data-srte-color-popover="true"]')?.contains(target)) return;
      onCancelRef.current();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
  }, [colorPickerAnchor]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // While the nested colour picker is open, let its own Escape handler
      // commit/dismiss just that picker first - a second Escape closes this
      // whole dialog.
      if (colorPickerAnchor) return;
      onCancelRef.current();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [colorPickerAnchor]);

  const update = (patch: Partial<BlockquoteBorderDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onPreviewRef.current(next);
  };

  return (
    <div
      ref={rootRef}
      data-srte-blockquote-border-popover="true"
      role="dialog"
      aria-label="Blockquote border options"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 70,
        width: 240,
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 650 }}>Blockquote border options</div>

      <div>
        <div style={fieldLabelStyle}>Style</div>
        <select aria-label="Border style" value={draft.style} onChange={(event) => update({ style: event.target.value as BorderStyle })} style={selectStyle}>
          {STYLE_OPTIONS.map((style) => <option key={style} value={style}>{style[0].toUpperCase()}{style.slice(1)}</option>)}
        </select>
      </div>

      <div>
        <div style={fieldLabelStyle}>Width</div>
        <select
          aria-label="Border width"
          value={BORDER_WIDTH_PRESETS.find((preset) => preset.px === draft.widthPx)?.id ?? BORDER_WIDTH_PRESETS[0].id}
          onChange={(event) => { const preset = BORDER_WIDTH_PRESETS.find((entry) => entry.id === event.target.value); if (preset) update({ widthPx: preset.px }); }}
          style={selectStyle}
        >
          {BORDER_WIDTH_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </div>

      <div>
        <div style={fieldLabelStyle}>Colour</div>
        <button
          ref={swatchRef}
          type="button"
          aria-label="Border colour"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            hexBeforeNestedPickerRef.current = draft.hex;
            const rect = swatchRef.current?.getBoundingClientRect();
            setColorPickerAnchor({ x: rect?.left ?? x, y: (rect?.bottom ?? y) + 4 });
          }}
          style={{ ...buttonStyle, width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start" }}
        >
          <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid var(--srte-input-border)", background: draft.hex }} aria-hidden="true" />
          {draft.hex}
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={onCancel}>Cancel</button>
        <button type="button" onClick={() => onApply(draft)}
          style={{ ...buttonStyle, borderColor: "var(--srte-primary)", background: "var(--srte-primary)", color: "var(--srte-on-primary)" }}>
          Apply
        </button>
      </div>

      {colorPickerAnchor && <ColorPickerPopover
        x={colorPickerAnchor.x}
        y={colorPickerAnchor.y}
        label="Border colour"
        initialValue={draft.hex}
        recentColors={recentColors}
        onPreview={(hex) => update({ hex })}
        onApply={(hex) => { update({ hex }); setColorPickerAnchor(null); }}
        onCancel={() => { update({ hex: hexBeforeNestedPickerRef.current }); setColorPickerAnchor(null); }}
      />}
    </div>
  );
}
