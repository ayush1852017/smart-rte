import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SPECIAL_CHARACTERS, SPECIAL_CHARACTER_CATEGORIES, type SpecialCharacterCategory } from "../specialCharacters.js";

export interface SpecialCharacterPopoverProps {
  x: number;
  y: number;
  /** Up to 8 previously-inserted characters, most-recent first - same recency pattern as ColorPickerPopover's recent colors. */
  recentCharacters?: readonly string[];
  onInsert: (char: string) => void;
  onCancel: () => void;
}

const RECENT_ROW_LIMIT = 8;

/**
 * Special character picker: six standardized-Unicode-block categories
 * (~200 characters total - see specialCharacters.ts's own doc comment),
 * reusing the grid-with-hover-feedback shape already established by
 * ColorPickerPopover/TableSizePickerPopover rather than a new component
 * pattern. Insertion is immediate on click (a character, unlike a dragged
 * color, is already a single complete choice) via a real, page-owned text
 * insert - see `insertSpecialCharacter` in CanonicalAuthorityEditor.tsx.
 */
export function SpecialCharacterPopover({ x, y, recentCharacters, onInsert, onCancel }: SpecialCharacterPopoverProps) {
  const [category, setCategory] = useState<SpecialCharacterCategory>("greek");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
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

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  const needle = query.trim().toLowerCase();
  const entries = useMemo(() => {
    if (needle) return SPECIAL_CHARACTERS.filter((entry) => entry.name.toLowerCase().includes(needle));
    return SPECIAL_CHARACTERS.filter((entry) => entry.category === category);
  }, [category, needle]);

  return (
    <div
      ref={rootRef}
      data-srte-special-char-popover="true"
      role="dialog"
      aria-label="Special characters"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 70,
        width: 380,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: placement ? placement.maxHeight : "calc(100vh - 16px)",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        background: "var(--srte-menu-bg)",
        color: "var(--srte-menu-text)",
        border: "1px solid var(--srte-border)",
        borderRadius: 12,
        boxShadow: "var(--srte-menu-shadow)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 14px 8px", borderBottom: "1px solid var(--srte-border)" }}>
        <input
          data-srte-special-char-search="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name… (e.g. “alpha”)"
          aria-label="Search special characters"
          autoComplete="off"
          style={{
            width: "100%", height: 34, boxSizing: "border-box", padding: "0 10px",
            border: "1px solid var(--srte-input-border)", borderRadius: 8, outline: "none",
            background: "var(--srte-input-bg)", color: "var(--srte-input-text)", font: "inherit", fontSize: 13.5,
          }}
        />
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {!needle && (
          <div role="tablist" aria-label="Character category" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 8, borderRight: "1px solid var(--srte-border)", minWidth: 108 }}>
            {SPECIAL_CHARACTER_CATEGORIES.map((entry) => (
              <button
                key={entry.id} type="button" role="tab" aria-selected={category === entry.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setCategory(entry.id)}
                style={{
                  fontSize: 12.5, fontWeight: 600, textAlign: "left", padding: "7px 9px", borderRadius: 7,
                  border: "none", cursor: "pointer",
                  background: category === entry.id ? "var(--srte-accent-bg)" : "transparent",
                  color: category === entry.id ? "var(--srte-primary)" : "var(--srte-menu-text)",
                }}
              >{entry.label}</button>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div
            data-srte-special-char-grid="true"
            style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6, padding: 12 }}
          >
            {entries.map((entry) => (
              <button
                key={`${entry.category}-${entry.char}`}
                type="button"
                data-srte-special-char={entry.char}
                aria-label={entry.name}
                title={entry.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsert(entry.char)}
                style={{
                  aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16, border: "1px solid var(--srte-input-border)", borderRadius: 7,
                  background: "var(--srte-input-bg)", color: "var(--srte-input-text)", cursor: "pointer",
                }}
              >{entry.char}</button>
            ))}
            {entries.length === 0 && (
              <div style={{ gridColumn: "1 / -1", fontSize: 13, opacity: 0.7, padding: "8px 2px" }}>No characters match “{query}”.</div>
            )}
          </div>
        </div>
      </div>
      {recentCharacters && recentCharacters.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderTop: "1px solid var(--srte-border)" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--srte-menu-text)", opacity: 0.7, marginRight: 2 }}>Recent</span>
          {recentCharacters.slice(0, RECENT_ROW_LIMIT).map((char, index) => (
            <button
              key={`${char}-${index}`}
              type="button"
              data-srte-recent-special-char={char}
              aria-label={`Recently used ${char}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsert(char)}
              style={{
                width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, border: "1px solid var(--srte-input-border)", borderRadius: 6,
                background: "var(--srte-input-bg)", color: "var(--srte-input-text)", cursor: "pointer",
              }}
            >{char}</button>
          ))}
        </div>
      )}
    </div>
  );
}
