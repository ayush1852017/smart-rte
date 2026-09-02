import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ColorPickerPopover } from "./ColorPickerPopover.js";
import { getFixedPositioningOrigin } from "./fixedPositioning.js";

export type BorderStyle = "solid" | "dashed" | "dotted";
export interface BorderSides { top: boolean; right: boolean; bottom: boolean; left: boolean }
export interface BorderDraft { sides: BorderSides; style: BorderStyle; widthPx: number; hex: string }

export interface TableBorderPopoverProps {
  x: number;
  y: number;
  initial: BorderDraft;
  /** Up to 4 previously-committed border colours, most-recent first - same pattern as the other colour buckets. */
  recentColors?: readonly string[];
  /** Fires on every change (a side toggled, style/width picked, or a colour drag frame) - the caller live-previews it on the real cell(s), same pattern as the plain colour picker's onPreview. */
  onPreview: (draft: BorderDraft) => void;
  /** Fires once, only from the explicit Apply button - unlike ColorPickerPopover, this composite dialog (four independent fields assembled together) commits on a deliberate action, not on any dismissal. */
  onApply: (draft: BorderDraft) => void;
  /** Fires from Cancel, Escape, or an outside click - reverts to `initial`. */
  onCancel: () => void;
}

// Widths start at 2px, not 1px - table_cell's border-collapse table (see
// theme.ts's th/td rule) already renders a 1px ambient default gridline on
// every cell. A custom border tied at 1px loses CSS border-collapse's
// conflict resolution on shared edges half the time (whichever side faces
// an earlier-in-table-order neighbor keeps the neighbor's default border,
// confirmed empirically: 1px, and even a fractional 1.5px, lost this way in
// every engine tested) - only a width strictly greater than the ambient
// default reliably wins on every side regardless of table position. 2px is
// the thinnest value that's actually renderable as a real, always-visible
// custom border under this constraint - see
// docs/bugs/table-cell-border-thin-preset-loses-border-collapse-tie.md.
export const BORDER_WIDTH_PRESETS = [
  { id: "thin", label: "Thin", px: 2 },
  { id: "medium", label: "Medium", px: 3 },
  { id: "thick", label: "Thick", px: 4 },
] as const;
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

const SIDE_BAR_LENGTH = 40;
const SIDE_BAR_THICKNESS = 8;
const SIDE_BOX = 64;

/**
 * "Border options" - one popover combining every dimension of a cell
 * border, replacing what used to be a separate toolbar-dropdown width
 * <select> and a standalone "Border colour" item. table_cell.attrs only
 * ever stored ONE uniform border for all four sides (`borders`) - "which
 * sides get a border" (per-cell top/right/bottom/left) needed new per-side
 * schema attrs (borderTop/Right/Bottom/Left), added specifically to back
 * this control (see docs/bugs/table-cell-border-color-width-no-ui.md's
 * addendum). One style/width/colour choice applies to whichever sides are
 * toggled on here, rather than letting all four vary independently - real
 * border dialogs (Word, Google Docs) default to this simpler mode too, and
 * a fully independent 4-way style/width/colour matrix wasn't asked for.
 *
 * The colour swatch opens the existing ColorPickerPopover completely
 * unmodified, as a nested popover anchored to the swatch - the dismiss/
 * Escape handling below explicitly accounts for it being a DOM sibling
 * (both are position:fixed overlays, so `rootRef.contains()` alone would
 * never recognize a click inside it as "inside" this popover).
 */
export function TableBorderPopover({ x, y, initial, recentColors, onPreview, onApply, onCancel }: TableBorderPopoverProps) {
  const [draft, setDraft] = useState<BorderDraft>(initial);
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
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const overflowsRight = x + width > viewportWidth - margin;
    const left = overflowsRight ? x - width : x;
    const clampedLeft = Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - width - margin));
    const overflowsBottom = y + height > viewportHeight - margin;
    const top = overflowsBottom ? y - height : y;
    const clampedTop = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - margin));
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

  const update = (patch: Partial<BorderDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onPreviewRef.current(next);
  };

  const toggleSide = (side: keyof BorderSides) => update({ sides: { ...draft.sides, [side]: !draft.sides[side] } });

  const edgeButton = (side: keyof BorderSides, style: React.CSSProperties, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={draft.sides[side]}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => toggleSide(side)}
      style={{
        position: "absolute", border: "none", borderRadius: 3, cursor: "pointer", padding: 0,
        background: draft.sides[side] ? "var(--srte-primary)" : "var(--srte-input-border)",
        ...style,
      }}
    />
  );

  return (
    <div
      ref={rootRef}
      data-srte-table-border-popover="true"
      role="dialog"
      aria-label="Border options"
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
      <div style={{ fontWeight: 650 }}>Border options</div>

      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div>
          <div style={fieldLabelStyle}>Sides</div>
          <div style={{ position: "relative", width: SIDE_BOX, height: SIDE_BOX, border: "1px dashed var(--srte-border)", borderRadius: 6 }}>
            {edgeButton("top", { top: -SIDE_BAR_THICKNESS / 2, left: (SIDE_BOX - SIDE_BAR_LENGTH) / 2, width: SIDE_BAR_LENGTH, height: SIDE_BAR_THICKNESS }, "Top border")}
            {edgeButton("bottom", { bottom: -SIDE_BAR_THICKNESS / 2, left: (SIDE_BOX - SIDE_BAR_LENGTH) / 2, width: SIDE_BAR_LENGTH, height: SIDE_BAR_THICKNESS }, "Bottom border")}
            {edgeButton("left", { left: -SIDE_BAR_THICKNESS / 2, top: (SIDE_BOX - SIDE_BAR_LENGTH) / 2, width: SIDE_BAR_THICKNESS, height: SIDE_BAR_LENGTH }, "Left border")}
            {edgeButton("right", { right: -SIDE_BAR_THICKNESS / 2, top: (SIDE_BOX - SIDE_BAR_LENGTH) / 2, width: SIDE_BAR_THICKNESS, height: SIDE_BAR_LENGTH }, "Right border")}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button type="button" style={buttonStyle} onMouseDown={(event) => event.preventDefault()}
            onClick={() => update({ sides: { top: true, right: true, bottom: true, left: true } })}>All sides</button>
          <button type="button" style={buttonStyle} onMouseDown={(event) => event.preventDefault()}
            onClick={() => update({ sides: { top: false, right: false, bottom: false, left: false } })}>No border</button>
        </div>
      </div>

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
