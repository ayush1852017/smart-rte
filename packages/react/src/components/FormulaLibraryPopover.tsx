import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
// Registers \ce{...} for this popover's own chemistry-entry previews - see
// the matching import's comment in core's surface/renderer.ts for why this
// is needed once per katex module instance.
import "katex/contrib/mhchem";
import { FORMULA_DOMAINS, FORMULA_LIBRARY, type FormulaDomain, type FormulaLibraryEntry } from "../formulaLibrary.js";

export interface FormulaLibraryPopoverProps {
  x: number;
  y: number;
  onInsert: (entry: FormulaLibraryEntry) => void;
  onCancel: () => void;
}

const renderPreview = (latex: string): string => {
  try {
    return katex.renderToString(latex, { trust: false, strict: "error", throwOnError: true });
  } catch {
    return latex;
  }
};

/**
 * Formula library popover ("Small" scope, 55 entries across 6 domains -
 * see formulaLibrary.ts's own doc comment). Browsable by domain tab and
 * searchable by name; each entry renders a real KaTeX preview (the same
 * renderer the document itself uses) so the user sees exactly what they're
 * about to insert, not a name they have to guess the shape of.
 */
export function FormulaLibraryPopover({ x, y, onInsert, onCancel }: FormulaLibraryPopoverProps) {
  const [domain, setDomain] = useState<FormulaDomain | "all">("all");
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FORMULA_LIBRARY.filter((entry) =>
      (domain === "all" || entry.domain === domain) && (!needle || entry.name.toLowerCase().includes(needle)));
  }, [domain, query]);

  return (
    <div
      ref={rootRef}
      data-srte-formula-library="true"
      role="dialog"
      aria-label="Formula library"
      style={{
        position: "fixed",
        left: placement?.left ?? x,
        top: placement?.top ?? y,
        visibility: placement ? "visible" : "hidden",
        zIndex: 70,
        width: 420,
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
          data-srte-formula-search="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search formulas… (e.g. “quadratic”)"
          aria-label="Search formulas"
          autoComplete="off"
          style={{
            width: "100%", height: 34, boxSizing: "border-box", padding: "0 10px",
            border: "1px solid var(--srte-input-border)", borderRadius: 8, outline: "none",
            background: "var(--srte-input-bg)", color: "var(--srte-input-text)", font: "inherit", fontSize: 13.5,
          }}
        />
        <div role="tablist" aria-label="Formula domain" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
          <button
            type="button" role="tab" aria-selected={domain === "all"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setDomain("all")}
            style={tabStyle(domain === "all")}
          >All</button>
          {FORMULA_DOMAINS.map((entry) => (
            <button
              key={entry.id} type="button" role="tab" aria-selected={domain === entry.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setDomain(entry.id)}
              style={tabStyle(domain === entry.id)}
            >{entry.label}</button>
          ))}
        </div>
      </div>
      <div
        data-srte-formula-grid="true"
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8,
          padding: 12, overflowY: "auto",
        }}
      >
        {filtered.length === 0 && (
          <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--srte-menu-text)", opacity: 0.7, padding: "12px 4px" }}>
            No formulas match “{query}”.
          </div>
        )}
        {filtered.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-srte-formula-entry={entry.id}
            aria-label={`Insert ${entry.name}`}
            title={entry.name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onInsert(entry)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              border: "1px solid var(--srte-input-border)", borderRadius: 10, padding: "10px 8px",
              background: "var(--srte-input-bg)", cursor: "pointer", minHeight: 76,
            }}
          >
            <span
              aria-hidden="true"
              style={{ fontSize: 14, lineHeight: 1.2, minHeight: 22, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", maxWidth: "100%" }}
              dangerouslySetInnerHTML={{ __html: renderPreview(entry.latex) }}
            />
            <span style={{ fontSize: 11, color: "var(--srte-menu-text)", opacity: 0.75, textAlign: "center" }}>{entry.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 7, cursor: "pointer",
  border: "1px solid " + (active ? "var(--srte-primary)" : "transparent"),
  background: active ? "var(--srte-accent-bg)" : "transparent",
  color: active ? "var(--srte-primary)" : "var(--srte-menu-text)",
});
