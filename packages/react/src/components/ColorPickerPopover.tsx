import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getFixedPositioningOrigin, getPositioningBounds } from "./fixedPositioning.js";

export interface ColorPickerPopoverProps {
  x: number;
  y: number;
  label: string;
  initialValue?: string;
  /**
   * Continuous live-preview callback, fired on every drag frame of the
   * saturation/value square or hue slider (and on every valid typed hex) -
   * distinct from `onApply`, which fires once, when the popover is actually
   * dismissed with a real change staged.
   */
  onPreview?: (hex: string) => void;
  /** Up to 4 previously-committed colors for this same picker context, most-recent first. */
  recentColors?: readonly string[];
  onApply: (hex: string) => void;
  /** Discard: revert to the color the popover opened with. The only way to *not* commit - every other dismissal (outside click, Escape, the close button) commits whatever is currently staged. */
  onCancel: () => void;
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const normalizeHex = (value: string): string | null => {
  if (!HEX_PATTERN.test(value)) return null;
  if (value.length === 4) return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  return value.toLowerCase();
};

const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
  const sf = s / 100, vf = v / 100;
  const c = vf * sf;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vf - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};

const rgbToHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}`;

const hexToRgb = (hex: string): [number, number, number] | null => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = Number.parseInt(normalized.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
};

const hexToHsv = (hex: string): [number, number, number] => {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(...rgb) : [0, 0, 0];
};

const buttonStyle: React.CSSProperties = {
  minHeight: 32,
  padding: "0 12px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  background: "var(--srte-input-bg)",
  color: "var(--srte-menu-text)",
  cursor: "pointer",
  fontWeight: 500,
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  boxSizing: "border-box",
  padding: "0 10px",
  border: "1px solid var(--srte-input-border)",
  borderRadius: 8,
  outline: "none",
  background: "var(--srte-input-bg)",
  color: "var(--srte-input-text)",
  font: "inherit",
};

/** Drives a square/slider from pointer drag - shared by the SV square and the hue strip below, differing only in how a client offset maps to a value. */
const useDrag = (onMove: (clientX: number, clientY: number, rect: DOMRect) => void) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMove(event.clientX, event.clientY, rect);
    const move = (moveEvent: PointerEvent) => onMove(moveEvent.clientX, moveEvent.clientY, rect);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { ref, onPointerDown };
};

/**
 * Phase 11.5 §2.4 originally shipped a native `<input type="color">` as the
 * primary picker (see git history) - reverted here in favor of a fully
 * in-page saturation/value square + hue strip, specifically so the drag
 * surface is visible on the very first click (a native color input needs a
 * *second* click to open its own OS-level dialog) and so every drag frame
 * is a real, page-owned pointer event this component fully controls -
 * sidestepping the whole "which native event means the user is actually
 * done" problem a native input can never answer reliably (see
 * docs/bugs/color-popover-closes-on-first-native-picker-interaction.md and
 * docs/bugs/color-preview-render-steals-focus-from-popover.md, both about
 * that exact native-event ambiguity).
 *
 * Commit model: there is no separate Apply button. Dragging (or typing a
 * valid hex, or clicking a recent swatch) stages a live preview via
 * `onPreview`; closing the popover *any* way other than the explicit
 * Discard button - outside click, Escape, the × button - commits whatever
 * is currently staged via `onApply`. Discard is the only way back to the
 * color the popover opened with.
 */
export function ColorPickerPopover({ x, y, label, initialValue = "#000000", recentColors, onPreview, onApply, onCancel }: ColorPickerPopoverProps) {
  const [hsv, setHsv] = useState(() => hexToHsv(initialValue));
  const hex = rgbToHex(...hsvToRgb(hsv[0], hsv[1], hsv[2]));
  const [hexText, setHexText] = useState(hex);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const errorId = useId();
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
  // Nothing has actually changed until a drag frame, a valid typed hex, or a
  // recent-swatch click stages one - closing without ever touching anything
  // must be a true no-op, not commit an identical "new" color as a fresh
  // history entry.
  const stagedRef = useRef(false);
  const hexRef = useRef(hex);
  hexRef.current = hex;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => { setHexText(hex); }, [hex]);

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

  const stage = (nextHsv: [number, number, number]) => {
    stagedRef.current = true;
    setHsv(nextHsv);
    onPreview?.(rgbToHex(...hsvToRgb(nextHsv[0], nextHsv[1], nextHsv[2])));
  };

  const svDrag = useDrag((clientX, clientY, rect) => {
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100;
    const v = 100 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) * 100;
    stage([hsv[0], s, v]);
  });
  const hueDrag = useDrag((clientX, _clientY, rect) => {
    const h = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 360;
    stage([h, hsv[1], hsv[2]]);
  });

  const commitAndClose = () => {
    if (stagedRef.current) onApplyRef.current(hexRef.current);
    else onCancelRef.current();
  };

  useEffect(() => {
    const dismissIfOutside = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) commitAndClose();
    };
    window.addEventListener("pointerdown", dismissIfOutside, true);
    window.addEventListener("mousedown", dismissIfOutside, true);
    return () => {
      window.removeEventListener("pointerdown", dismissIfOutside, true);
      window.removeEventListener("mousedown", dismissIfOutside, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") commitAndClose();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRecentColor = (swatch: string) => {
    const rgb = hexToRgb(swatch);
    if (!rgb) return;
    stage(rgbToHsv(...rgb));
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
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div id={titleId} style={{ fontWeight: 650 }}>{label}</div>
        <button
          type="button"
          aria-label="Close color picker"
          title="Close (keeps the current color)"
          onClick={commitAndClose}
          style={{ ...buttonStyle, minWidth: 28, minHeight: 28, padding: 0, border: 0, background: "transparent", fontSize: 18 }}
        >
          ×
        </button>
      </div>

      <div
        ref={svDrag.ref}
        data-srte-color-sv-square="true"
        role="slider"
        aria-label="Saturation and brightness"
        tabIndex={0}
        // Without this, clicking to drag focuses this div (it's a focusable
        // slider for keyboard access), which collapses the editor's own
        // native selection before the preview can apply a mark to it - the
        // same focus-stealing class of bug fixed for LinkEditorPopover
        // (docs/bugs/link-overlay-autofocus-steals-editor-focus-on-plain-click.md)
        // and the toolbar dropdowns (docs/bugs/toolbar-dropdown-summary-steals-editor-focus.md).
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={svDrag.onPointerDown}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === "ArrowRight") stage([hsv[0], Math.min(100, hsv[1] + step), hsv[2]]);
          else if (event.key === "ArrowLeft") stage([hsv[0], Math.max(0, hsv[1] - step), hsv[2]]);
          else if (event.key === "ArrowUp") stage([hsv[0], hsv[1], Math.min(100, hsv[2] + step)]);
          else if (event.key === "ArrowDown") stage([hsv[0], hsv[1], Math.max(0, hsv[2] - step)]);
          else return;
          event.preventDefault();
        }}
        style={{
          position: "relative",
          width: "100%",
          height: 130,
          borderRadius: 8,
          marginBottom: 10,
          cursor: "crosshair",
          touchAction: "none",
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]}, 100%, 50%))`,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${hsv[1]}%`, top: `${100 - hsv[2]}%`,
            width: 14, height: 14, borderRadius: "50%",
            border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            transform: "translate(-50%, -50%)",
            background: hex,
            pointerEvents: "none",
          }}
        />
      </div>

      <div
        ref={hueDrag.ref}
        data-srte-color-hue-slider="true"
        role="slider"
        aria-label="Hue"
        aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv[0])}
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={hueDrag.onPointerDown}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 15 : 3;
          if (event.key === "ArrowRight") stage([Math.min(360, hsv[0] + step), hsv[1], hsv[2]]);
          else if (event.key === "ArrowLeft") stage([Math.max(0, hsv[0] - step), hsv[1], hsv[2]]);
          else return;
          event.preventDefault();
        }}
        style={{
          position: "relative",
          width: "100%",
          height: 16,
          borderRadius: 8,
          marginBottom: 12,
          cursor: "pointer",
          touchAction: "none",
          background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${(hsv[0] / 360) * 100}%`, top: "50%",
            width: 16, height: 16, borderRadius: "50%",
            border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            transform: "translate(-50%, -50%)",
            background: `hsl(${hsv[0]}, 100%, 50%)`,
            pointerEvents: "none",
          }}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: error ? 6 : 12 }}>
        <div aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--srte-input-border)", background: hex, flexShrink: 0 }} />
        <input
          data-srte-color-hex-input="true"
          value={hexText}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="#336699"
          aria-label="Hex color"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setHexText(value);
            const normalized = normalizeHex(value);
            if (normalized) {
              setError("");
              const rgb = hexToRgb(normalized)!;
              stage(rgbToHsv(...rgb));
            } else if (value.length >= 4) {
              setError("Enter a valid hex color, e.g. #336699.");
            }
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
          <div data-srte-recent-colors="true" style={{ display: "flex", gap: 6 }}>
            {recentColors.slice(0, 4).map((swatch) => (
              <button
                key={swatch}
                type="button"
                data-srte-recent-color={swatch}
                aria-label={`Recently used colour ${swatch}`}
                title={swatch}
                onClick={() => applyRecentColor(swatch)}
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

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" data-srte-color-discard="true" onClick={onCancel} style={buttonStyle}>Discard</button>
      </div>
    </div>
  );
}
