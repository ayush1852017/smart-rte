import React, { useCallback, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { SmartTable } from "./SmartTable";
import { useEditorSync } from "../hooks/useEditorSync";
import { FormulaEditor } from "./FormulaEditor";
import { DiagramEditor } from "./DiagramEditor";
import {
  initSmartRTE,
  createEditor,
  createEditorFromJSON,
} from "@smartrte/core-wasm";

type EditorFormat = "json" | "html" | "markdown";

export function SmartEditor({
  value,
  onChange,
  format = "json",
  autofocus = true,
  allowImages = true,
  maxHeight = 500,
  minHeight = 200,
  editor: editorProp,
}: {
  value?: string;
  onChange?: (val: string) => void;
  format?: EditorFormat;
  autofocus?: boolean;
  allowImages?: boolean;
  maxHeight?: number | string;
  minHeight?: number | string;
  editor?: any; // optional escape hatch: pass a pre-created wasm editor
}) {
  // Create/load editor instance if not provided
  const [editor, setEditor] = React.useState<any>(editorProp || null);
  const lastEmittedRef = React.useRef<string | null>(null);
  const lastPropValueRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const ensure = async () => {
      if (editorProp) {
        setEditor(editorProp);
        return;
      }
      await initSmartRTE();
      const initial =
        value && format === "json"
          ? createEditorFromJSON(value)
          : createEditor();
      if (!cancelled) setEditor(initial);
    };
    ensure();
    return () => {
      cancelled = true;
    };
  }, [editorProp]);

  // If parent value changes and diverges from current model, recreate from JSON (supported path)
  React.useEffect(() => {
    if (!editor || !value) return;
    if (format !== "json") return; // Only safe round-trip; HTML/MD are export-only right now
    if (lastPropValueRef.current === value) return;
    try {
      const current = editor.to_json?.();
      if (typeof current === "string" && current !== value) {
        const next = createEditorFromJSON(value);
        setEditor(next);
      }
    } catch {}
    lastPropValueRef.current = value;
  }, [editor, value, format]);
  const { doc, sync } = useEditorSync(editor);
  const [showInsert, setShowInsert] = useState(false);
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [showFormula, setShowFormula] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [formulaInlineMode, setFormulaInlineMode] = useState(true);
  const [lastParagraphIndex, setLastParagraphIndex] = useState<number | null>(
    null
  );
  const [lastTableCaret, setLastTableCaret] = useState<{
    tableIdx: number;
    r: number;
    c: number;
    offset: number;
  } | null>(null);
  const [lastParagraphCaret, setLastParagraphCaret] = useState<number | null>(
    null
  );
  const [needsCaretRestore, setNeedsCaretRestore] = useState(false);
  const paraRefs = React.useRef<Record<number, HTMLParagraphElement | null>>(
    {}
  );
  const lastInsertTsRef = React.useRef<number>(0);
  const [imageSizes, setImageSizes] = useState<
    Record<number, { width: number }>
  >({});
  const insertAnchorRef = React.useRef<{ idx: number; caret: number } | null>(
    null
  );
  const [editingParaIndex, setEditingParaIndex] = useState<number | null>(null);
  const focusRequestRef = React.useRef<number | null>(null);
  const hasAutoFocusedRef = React.useRef(false);

  // Direct call helper: perform a single synchronous mutation and then sync
  const apply = useCallback((fn: () => void) => {
    try {
      fn();
    } catch {}
  }, []);

  const isEditorValid = useCallback(() => {
    try {
      if (!editor) return false;
      const ptr = (editor as any).__wbg_ptr;
      return typeof ptr === "number" ? ptr !== 0 : true;
    } catch {
      return !!editor;
    }
  }, [editor]);

  const syncTimer = React.useRef<number | null>(null);
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      sync();
      syncTimer.current = null;
    }, 150);
  }, [sync]);

  // Helper to compute caret offset within a paragraph element
  const getCaretOffsetIn = useCallback((el: HTMLElement): number | null => {
    try {
      const sel = window.getSelection();
      if (!sel || !el.contains(sel.anchorNode)) return null;
      const baseLen = (el.innerText || "").length;
      const off = Math.min(sel.anchorOffset || 0, baseLen);
      return off;
    } catch {
      return null;
    }
  }, []);

  const lastActionTsRef = React.useRef<number>(0);
  const insertTable = useCallback(() => {
    if (!isEditorValid()) return;
    const now = Date.now();
    if (now - (lastActionTsRef.current || 0) < 300) return;
    lastActionTsRef.current = now;
    // Simplified: never split paragraphs. Insert table node after the current paragraph if any; otherwise append.
    const anchor = insertAnchorRef.current;
    if (anchor && typeof anchor.idx === "number") {
      const idx = anchor.idx;
      apply(() => editor.insert_table_at(idx + 1, rows, cols));
      setLastParagraphIndex(idx + 2);
      setLastParagraphCaret(0);
      setNeedsCaretRestore(true);
    } else {
      apply(() => editor.insert_table(rows, cols));
    }
    setShowInsert(false);
    sync();
  }, [
    editor,
    rows,
    cols,
    sync,
    isEditorValid,
    apply,
    lastParagraphIndex,
    lastParagraphCaret,
    doc?.nodes,
  ]);

  React.useEffect(() => {
    if (!doc || !doc.nodes) return;
    if (!editor || !isEditorValid()) return;
    if (doc.nodes.length === 0) {
      try {
        editor.insert_paragraph(0, "");
      } catch {}
      sync();
    }
  }, [doc, editor, sync, isEditorValid]);

  // Ensure there is always at least one paragraph to type into, even if the doc
  // contains only non-paragraph nodes (tables, images, formulas)
  React.useEffect(() => {
    if (!doc || !Array.isArray(doc.nodes)) return;
    if (!editor || !isEditorValid()) return;
    const hasParagraph = doc.nodes.some((n: any) => n.type === "Paragraph");
    if (!hasParagraph) {
      try {
        const insertAt = doc.nodes.length;
        editor.insert_paragraph(insertAt, "");
      } catch {}
      sync();
    }
  }, [doc, editor, isEditorValid, sync]);

  // After initial content exists, autofocus first paragraph so caret is visible and typing works
  React.useEffect(() => {
    if (!autofocus) return;
    if (!doc || !Array.isArray(doc.nodes) || doc.nodes.length === 0) return;
    const firstIdx = doc.nodes.findIndex((n: any) => n.type === "Paragraph");
    if (firstIdx < 0) return;
    // Only set once when nothing is being edited
    if (editingParaIndex != null) return;
    if (hasAutoFocusedRef.current) return;
    setEditingParaIndex(firstIdx);
    setLastParagraphIndex(firstIdx);
    focusRequestRef.current = firstIdx;
    // Place caret at end on next tick
    setTimeout(() => {
      // rAF ensures the editable <p> is mounted and ref is attached
      requestAnimationFrame(() => {
        const el = paraRefs.current[firstIdx];
        try {
          el?.focus?.();
          const textContent =
            el?.innerText || doc?.nodes?.[firstIdx]?.text || "";
          const range = document.createRange();
          const node = el?.lastChild as Text | null;
          if (node && node.nodeType === Node.TEXT_NODE) {
            const len = Math.min(textContent.length, node.length);
            range.setStart(node, len);
          } else if (el) {
            range.selectNodeContents(el);
            range.collapse(false);
          }
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          setLastParagraphCaret((textContent || "").length);
          hasAutoFocusedRef.current = true;
        } catch {}
      });
    }, 0);
  }, [doc, autofocus, editingParaIndex]);

  // When a paragraph is toggled into editing mode, focus it and restore caret
  React.useEffect(() => {
    const idx = focusRequestRef.current;
    if (idx == null) return;
    const el = paraRefs.current[idx];
    if (!el) return;
    try {
      el.focus();
      const textContent = el.innerText || doc?.nodes?.[idx]?.text || "";
      const range = document.createRange();
      const node = el.lastChild as Text | null;
      const caret = Math.min(
        lastParagraphCaret ?? textContent.length,
        textContent.length
      );
      if (node && node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, Math.min(caret, node.length));
      } else {
        range.selectNodeContents(el);
        range.collapse(false);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
    focusRequestRef.current = null;
  }, [editingParaIndex, lastParagraphCaret, doc]);

  React.useEffect(() => {
    if (needsCaretRestore && lastParagraphIndex != null) {
      try {
        const el = paraRefs.current[lastParagraphIndex];
        if (!el) return;
        const text = el.textContent || "";
        const desired = Math.min(
          lastParagraphCaret ?? text.length,
          text.length
        );
        const range = document.createRange();
        let placed = false;
        // Try last text node first
        const lastChild = el.lastChild;
        if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
          const txt = lastChild as Text;
          const pos = Math.min(desired, txt.length);
          range.setStart(txt, pos);
          placed = true;
        }
        if (!placed) {
          // Fallback: place at end of element
          range.selectNodeContents(el);
          range.collapse(false);
        }
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {}
      setNeedsCaretRestore(false);
    }
  }, [doc, needsCaretRestore, lastParagraphIndex, lastParagraphCaret]);

  // Emit value to parent on every sync in requested format
  React.useEffect(() => {
    if (!editor || !onChange) return;
    try {
      let out = "";
      if (format === "json") out = editor.to_json?.() || "";
      else if (format === "html") out = editor.to_html?.() || "";
      else if (format === "markdown") out = editor.to_markdown?.() || "";
      if (out && out !== lastEmittedRef.current) {
        lastEmittedRef.current = out;
        onChange(out);
      }
    } catch {}
  }, [doc, editor, onChange, format]);

  return (
    <div style={{ border: "1px solid #ddd", padding: 12 }}>
      {/* Toolbar */}
      <div
        style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <button
          onClick={() => {
            // Capture insertion anchor (paragraph index + caret) before dialog opens
            const idx =
              lastParagraphIndex ??
              doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
              null;
            if (idx != null && idx >= 0) {
              const el = paraRefs.current[idx] as HTMLElement | null;
              const text = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const caret =
                lastParagraphCaret ??
                (el ? getCaretOffsetIn(el) ?? text.length : text.length);
              insertAnchorRef.current = { idx, caret };
            } else {
              insertAnchorRef.current = null;
            }
            setShowInsert(true);
          }}
        >
          + Table
        </button>
        <button onClick={() => setShowFormula(true)}>
          + {formulaInlineMode ? "Inline" : "Block"} Formula
        </button>
        <button onClick={() => setShowDiagram(true)} disabled={!allowImages}>
          + Diagram
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={formulaInlineMode}
            onChange={(e) => setFormulaInlineMode(e.target.checked)}
          />
          Inline formula
        </label>
        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <span>𝛴</span>
          {[
            { t: "\\frac{a}{b}" },
            { t: "\\sqrt{x}" },
            { t: "\\int_a^b" },
            { t: "\\sum_{i=1}^n" },
            { t: "x^{2}" },
            { t: "x_{i}" },
          ].map((it) => (
            <button
              key={it.t}
              title={it.t}
              onClick={() => {
                try {
                  if (lastParagraphIndex != null) {
                    const idx = lastParagraphIndex;
                    const el = paraRefs.current[idx] as HTMLElement | null;
                    const paraText = (el?.innerText ??
                      (doc?.nodes?.[idx]?.text || "")) as string;
                    const caret =
                      lastParagraphCaret ??
                      getCaretOffsetIn(el || document.createElement("div")) ??
                      paraText.length;
                    const before = paraText.slice(0, caret);
                    const after = paraText.slice(caret);
                    const injected = formulaInlineMode
                      ? ` $${it.t}$ `
                      : `\n$$${it.t}$$\n`;
                    apply(() =>
                      editor.set_paragraph_text(idx, before + injected + after)
                    );
                  } else {
                    const newIndex = doc?.nodes?.length || 0;
                    const content = formulaInlineMode
                      ? ` $${it.t}$ `
                      : `\n$$${it.t}$$\n`;
                    apply(() => editor.insert_paragraph(newIndex, content));
                  }
                  scheduleSync();
                } catch {}
              }}
            >
              {it.t}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            try {
              const idx =
                lastParagraphIndex ??
                doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                0;
              const el = paraRefs.current[idx] as HTMLElement | null;
              const text = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const sel = window.getSelection();
              let start = 0;
              let end = text.length;
              if (
                sel &&
                el &&
                el.contains(sel.anchorNode) &&
                el.contains(sel.focusNode)
              ) {
                start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
              }
              editor.set_text_style(
                idx,
                start,
                end,
                JSON.stringify({ bold: true })
              );
              scheduleSync();
            } catch {}
          }}
          title="Bold"
        >
          B
        </button>
        <button
          onClick={() => {
            try {
              const idx =
                lastParagraphIndex ??
                doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                0;
              const el = paraRefs.current[idx] as HTMLElement | null;
              const text = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const sel = window.getSelection();
              let start = 0;
              let end = text.length;
              if (
                sel &&
                el &&
                el.contains(sel.anchorNode) &&
                el.contains(sel.focusNode)
              ) {
                start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
              }
              editor.set_text_style(
                idx,
                start,
                end,
                JSON.stringify({ italic: true })
              );
              scheduleSync();
            } catch {}
          }}
          title="Italic"
        >
          I
        </button>
        <button
          onClick={() => {
            try {
              const idx =
                lastParagraphIndex ??
                doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                0;
              const el = paraRefs.current[idx] as HTMLElement | null;
              const text = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const sel = window.getSelection();
              let start = 0;
              let end = text.length;
              if (
                sel &&
                el &&
                el.contains(sel.anchorNode) &&
                el.contains(sel.focusNode)
              ) {
                start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
              }
              editor.set_text_style(
                idx,
                start,
                end,
                JSON.stringify({ underline: true })
              );
              scheduleSync();
            } catch {}
          }}
          title="Underline"
        >
          U
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          Color
          <input
            type="color"
            onChange={(e) => {
              try {
                const idx =
                  lastParagraphIndex ??
                  doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                  0;
                const el = paraRefs.current[idx] as HTMLElement | null;
                const text = (el?.innerText ??
                  (doc?.nodes?.[idx]?.text || "")) as string;
                const sel = window.getSelection();
                let start = 0;
                let end = text.length;
                if (
                  sel &&
                  el &&
                  el.contains(sel.anchorNode) &&
                  el.contains(sel.focusNode)
                ) {
                  start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                  end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
                }
                editor.set_text_style(
                  idx,
                  start,
                  end,
                  JSON.stringify({ color: e.target.value })
                );
                scheduleSync();
              } catch {}
            }}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          Highlight
          <input
            type="color"
            onChange={(e) => {
              try {
                const idx =
                  lastParagraphIndex ??
                  doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                  0;
                const el = paraRefs.current[idx] as HTMLElement | null;
                const text = (el?.innerText ??
                  (doc?.nodes?.[idx]?.text || "")) as string;
                const sel = window.getSelection();
                let start = 0;
                let end = text.length;
                if (
                  sel &&
                  el &&
                  el.contains(sel.anchorNode) &&
                  el.contains(sel.focusNode)
                ) {
                  start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                  end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
                }
                editor.set_text_style(
                  idx,
                  start,
                  end,
                  JSON.stringify({ highlight: e.target.value })
                );
                scheduleSync();
              } catch {}
            }}
          />
        </label>
        <select
          onChange={(e) => {
            const px = Number(e.target.value);
            try {
              const idx =
                lastParagraphIndex ??
                doc?.nodes?.findIndex((n: any) => n.type === "Paragraph") ??
                0;
              const el = paraRefs.current[idx] as HTMLElement | null;
              const text = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const sel = window.getSelection();
              let start = 0;
              let end = text.length;
              if (
                sel &&
                el &&
                el.contains(sel.anchorNode) &&
                el.contains(sel.focusNode)
              ) {
                start = Math.min(sel.anchorOffset || 0, sel.focusOffset || 0);
                end = Math.max(sel.anchorOffset || 0, sel.focusOffset || 0);
              }
              editor.set_text_style(
                idx,
                start,
                end,
                JSON.stringify({ font_size_px: px })
              );
              scheduleSync();
            } catch {}
          }}
          defaultValue={14}
          title="Font size"
        >
          <option value={12}>12</option>
          <option value={14}>14</option>
          <option value={16}>16</option>
          <option value={18}>18</option>
          <option value={24}>24</option>
        </select>
        <button
          onClick={() => {
            try {
              if (isEditorValid()) editor.undo();
            } catch {}
            sync();
          }}
        >
          Undo
        </button>
        <button
          onClick={() => {
            try {
              if (isEditorValid()) editor.redo();
            } catch {}
            sync();
          }}
        >
          Redo
        </button>
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => {
              try {
                const json =
                  editor?.to_json?.() ?? JSON.stringify(doc ?? {}, null, 2);
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "document.json";
                a.click();
                URL.revokeObjectURL(url);
              } catch {}
            }}
            title="Export JSON"
          >
            Export JSON
          </button>
          <button
            onClick={() => {
              try {
                const md = editor?.to_markdown?.() ?? "";
                const blob = new Blob([md], { type: "text/markdown" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "document.md";
                a.click();
                URL.revokeObjectURL(url);
              } catch {}
            }}
            title="Export Markdown"
          >
            Export MD
          </button>
          <button
            onClick={() => {
              try {
                const html =
                  editor?.to_html?.() ?? "<pre>HTML export unavailable</pre>";
                const blob = new Blob([html], { type: "text/html" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "document.html";
                a.click();
                URL.revokeObjectURL(url);
              } catch {}
            }}
            title="Export HTML"
          >
            Export HTML
          </button>
        </div>
      </div>

      {showInsert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowInsert(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 320,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Insert table</div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <label>Rows</label>
              <input
                type="number"
                min={1}
                max={50}
                value={rows}
                onChange={(e) =>
                  setRows(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  )
                }
              />
              <label>Cols</label>
              <input
                type="number"
                min={1}
                max={50}
                value={cols}
                onChange={(e) =>
                  setCols(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1))
                  )
                }
              />
            </div>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button onClick={() => setShowInsert(false)}>Cancel</button>
              <button onClick={insertTable}>Insert</button>
            </div>
          </div>
        </div>
      )}

      <FormulaEditor
        open={showFormula}
        onClose={() => setShowFormula(false)}
        onInsert={(tex, block) => {
          if (lastTableCaret) {
            // Insert inside table cell at caret or marker
            const t =
              doc?.nodes?.[lastTableCaret.tableIdx]?.rows?.[lastTableCaret.r]
                ?.cells?.[lastTableCaret.c]?.text || "";
            const injected = block ? `\n$$${tex}$$\n` : ` $${tex}$ `;
            const marker = "#Here#";
            if (t.includes(marker)) {
              const nextText = t.replace(marker, injected);
              apply(() =>
                editor.set_cell_text(
                  lastTableCaret.r,
                  lastTableCaret.c,
                  nextText
                )
              );
            } else {
              // Also support legacy pair markers '## ... ##'
              const pair = Array.from(t.matchAll(/##/g)).map((m: any) =>
                (m as any).index == null ? -1 : (m as any).index
              );
              if (pair.length >= 2) {
                const leftIdx = pair[0];
                const rightIdx = pair[1];
                const before = t.slice(0, leftIdx + 2);
                const after = t.slice(rightIdx);
                const cleaned =
                  before.replace(/##$/, "") +
                  injected +
                  after.replace(/^##/, "");
                apply(() =>
                  editor.set_cell_text(
                    lastTableCaret.r,
                    lastTableCaret.c,
                    cleaned
                  )
                );
              } else {
                const before = t.slice(0, lastTableCaret.offset);
                const after = t.slice(lastTableCaret.offset);
                apply(() =>
                  editor.set_cell_text(
                    lastTableCaret.r,
                    lastTableCaret.c,
                    before + injected + after
                  )
                );
              }
            }
          } else if (lastParagraphIndex != null) {
            const idx = lastParagraphIndex;
            const el = paraRefs.current[idx] as HTMLElement | null;
            const paraText = (el?.innerText ??
              (doc?.nodes?.[idx]?.text || "")) as string;
            const marker = "#Here#";
            // Prefer explicit marker if present; otherwise use caret
            const markerIdx = paraText.indexOf(marker);
            const pair = Array.from(paraText.matchAll(/##/g)).map((m: any) =>
              (m as any).index == null ? -1 : (m as any).index
            );
            let splitIndex: number;
            let before = "";
            let after = "";
            if (markerIdx >= 0) {
              splitIndex = markerIdx;
              before = paraText.slice(0, splitIndex);
              after = paraText.slice(splitIndex + marker.length);
            } else if (pair.length >= 2) {
              const leftIdx = pair[0];
              const rightIdx = pair[1];
              before = paraText.slice(0, leftIdx + 2).replace(/##$/, "");
              after = paraText.slice(rightIdx).replace(/^##/, "");
            } else {
              const caret =
                lastParagraphCaret ??
                getCaretOffsetIn(el || document.createElement("div")) ??
                paraText.length;
              before = paraText.slice(0, caret);
              after = paraText.slice(caret);
            }
            const injected = block ? `\n$$${tex}$$\n` : ` $${tex}$ `;
            apply(() =>
              editor.set_paragraph_text(idx, before + injected + after)
            );
          } else {
            const newIndex = doc?.nodes?.length || 0;
            const injected = block ? `\n$$${tex}$$\n` : ` $${tex}$ `;
            apply(() => editor.insert_paragraph(newIndex, injected));
          }
          setShowFormula(false);
          scheduleSync();
        }}
      />

      {allowImages && (
        <DiagramEditor
          open={showDiagram}
          onClose={() => setShowDiagram(false)}
          onInsert={(dataUrl) => {
            const idx = lastParagraphIndex ?? 0;
            setShowDiagram(false);
            if (lastParagraphIndex != null) {
              const el = paraRefs.current[idx] as HTMLElement | null;
              const paraText = (el?.innerText ??
                (doc?.nodes?.[idx]?.text || "")) as string;
              const caret =
                lastParagraphCaret ??
                getCaretOffsetIn(el || document.createElement("div")) ??
                paraText.length;
              const before = paraText.slice(0, caret);
              const after = paraText.slice(caret);
              // Insert image as standalone node after current paragraph
              apply(() => editor.set_paragraph_text(idx, before + after));
              apply(() => editor.insert_image_at(idx + 1, dataUrl, "image"));
            } else {
              apply(() => editor.insert_image_at(idx, dataUrl, "image"));
            }
            scheduleSync();
          }}
        />
      )}

      {/* Document rendering */}
      {!doc ? (
        <div>Loading…</div>
      ) : (
        <div
          onKeyDown={(e) => {
            // Ctrl+A / Cmd+A → select only inside editor
            if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(e.currentTarget);
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
            // Prevent bubbling
            if (
              [
                "Backspace",
                "Delete",
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
              ].includes(e.key) ||
              e.metaKey ||
              e.ctrlKey
            ) {
              e.stopPropagation();
            }
          }}
          onMouseDown={(e) => {
            const clickedEditable = (e.target as HTMLElement).closest(
              '[contenteditable="true"]'
            );
            const clickedParagraph = (e.target as HTMLElement).closest(
              'p[data-paragraph="true"]'
            );
            if (clickedEditable || clickedParagraph) return;
            // Compute anchor paragraph based on click position
            const y = e.clientY;
            const entries = Object.entries(paraRefs.current);
            let anchor = -1;
            let lastBottom = 0;
            for (const [key, el] of entries) {
              if (!el) continue;
              const rect = el.getBoundingClientRect();
              lastBottom = Math.max(lastBottom, rect.bottom);
              if (y >= rect.top && y <= rect.bottom) {
                anchor = Number(key);
                break;
              }
              if (y > rect.bottom) anchor = Number(key);
            }
            if (anchor >= 0) {
              setLastParagraphIndex(anchor);
              return;
            }
            if (y > lastBottom + 12) {
              const newIndex = doc?.nodes?.length || 0;
              setLastParagraphIndex(newIndex);
              apply(() => editor.insert_paragraph(newIndex, ""));
              scheduleSync();
            }
          }}
          style={{
            cursor: "text",
            minHeight:
              typeof minHeight === "number" ? `${minHeight}px` : minHeight,
            maxHeight:
              typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
            overflowY: "auto",
          }}
        >
          {doc.nodes.map((node: any, idx: number) => {
            if (node.type === "Paragraph") {
              const isEditing = editingParaIndex === idx || !!node.spans;
              if (isEditing) {
                return (
                  <p
                    key={idx}
                    data-paragraph="true"
                    contentEditable
                    suppressContentEditableWarning
                    dir="ltr"
                    onKeyDown={(e) => {
                      const el = e.currentTarget as HTMLElement;

                      // 1) Handle Backspace at start on empty paragraph (your existing behavior)
                      if (e.key === "Backspace") {
                        const sel = window.getSelection();
                        if (!sel || !el.contains(sel.anchorNode)) return;
                        const atStart = (sel.anchorOffset || 0) === 0;
                        const text = el.innerText || "";
                        if (atStart && text.trim().length === 0) {
                          e.preventDefault();
                          // Remove this empty paragraph so caret moves to previous node
                          apply(() => editor.delete_node(idx));
                          scheduleSync();
                        }
                        return;
                      }

                      if (e.key === "Enter") {
                        e.preventDefault();
                        const caret =
                          getCaretOffsetIn(el) ?? (el.innerText || "").length;
                        const current = doc?.nodes?.[idx]?.text || "";
                        const head = current.slice(0, caret);
                        const tail = current.slice(caret);

                        apply(() => {
                          editor.set_paragraph_text(idx, head);
                          editor.insert_paragraph(idx + 1, tail);
                        });

                        setLastParagraphIndex(idx + 1);
                        setLastParagraphCaret(0);
                        scheduleSync();
                        return;
                      }
                    }}
                    onFocus={() => setLastParagraphIndex(idx)}
                    onClick={(e) => {
                      setLastParagraphIndex(idx);
                      const off = getCaretOffsetIn(e.currentTarget);
                      if (off != null) setLastParagraphCaret(off);
                    }}
                    onInput={(e) => {
                      // Keep uncontrolled while typing; only track caret and avoid forced restore
                      const off = getCaretOffsetIn(e.currentTarget);
                      if (off != null) setLastParagraphCaret(off);
                    }}
                    onKeyUp={(e) => {
                      const off = getCaretOffsetIn(e.currentTarget);
                      if (off != null) setLastParagraphCaret(off);
                    }}
                    onMouseUp={(e) => {
                      const off = getCaretOffsetIn(e.currentTarget);
                      if (off != null) setLastParagraphCaret(off);
                    }}
                    onBlur={(e) => {
                      const n = doc?.nodes?.[idx] as any;
                      if (n && n.spans) {
                        // Preserve styled content managed by core; skip plain text overwrite
                        setEditingParaIndex((v) => (v === idx ? null : v));
                        return;
                      }
                      const raw = (e.target as HTMLElement).innerText;
                      const cleaned = raw.replace(/^\n+/, "");
                      apply(() => editor.set_paragraph_text(idx, cleaned));
                      scheduleSync();
                      setEditingParaIndex((v) => (v === idx ? null : v));
                    }}
                    style={{
                      direction: "ltr",
                      unicodeBidi: "plaintext" as any,
                      textAlign: "left",
                      whiteSpace: "pre-wrap",
                      margin: 0,
                      outline: "none",
                    }}
                    ref={(el) => (paraRefs.current[idx] = el)}
                    onFocusCapture={(e) => {
                      // Normalize DOM to model value when entering focus
                      const currentDom = e.currentTarget.innerText || "";
                      const modelText = (doc?.nodes?.[idx]?.text ||
                        "") as string;
                      if (currentDom !== modelText) {
                        e.currentTarget.innerText = modelText;
                      }
                    }}
                  >
                    {null}
                  </p>
                );
              }
              // Display: render inline formulas for $...$
              const s: string = node.text || "";
              const parts: Array<{ t: "text" | "formula"; v: string }> = [];
              let i = 0;
              while (i < s.length) {
                const start = s.indexOf("$", i);
                if (start < 0) {
                  parts.push({ t: "text", v: s.slice(i) });
                  break;
                }
                if (start > i) parts.push({ t: "text", v: s.slice(i, start) });
                const end = s.indexOf("$", start + 1);
                if (end < 0) {
                  parts.push({ t: "text", v: s.slice(start) });
                  break;
                }
                const tex = s.slice(start + 1, end);
                parts.push({ t: "formula", v: tex });
                i = end + 1;
              }
              return (
                <p
                  key={idx}
                  data-paragraph="true"
                  dir="ltr"
                  style={{
                    direction: "ltr",
                    textAlign: "left",
                    whiteSpace: "pre-wrap",
                    margin: 0,
                  }}
                  onMouseDown={() => {
                    setEditingParaIndex(idx);
                    setLastParagraphIndex(idx);
                    focusRequestRef.current = idx;
                  }}
                  ref={(el) => (paraRefs.current[idx] = el)}
                >
                  {parts.map((p, k) =>
                    p.t === "text" ? (
                      <span key={k}>{p.v}</span>
                    ) : (
                      <span
                        key={k}
                        className="formula-inline"
                        dangerouslySetInnerHTML={{
                          __html: (() => {
                            try {
                              return katex.renderToString(p.v, {
                                throwOnError: false,
                                displayMode: false,
                              });
                            } catch {
                              return `$${p.v}$`;
                            }
                          })(),
                        }}
                        style={{ padding: "0 2px" }}
                      />
                    )
                  )}
                </p>
              );
            }
            // MCQ and InfoBox are intentionally not supported in this build
            if (node.type === "Heading") {
              const Tag = `h${node.level}` as any;
              return <Tag key={idx}>{node.text}</Tag>;
            }
            if (node.type === "Table") {
              return (
                <SmartTable
                  key={idx}
                  editor={editor}
                  tableNode={node}
                  tableIdx={idx}
                  onChange={scheduleSync}
                  onCaretUpdate={(ctx) => setLastTableCaret(ctx)}
                />
              );
            }
            if (node.type === "Image") {
              const handleResize =
                (side: "left" | "right") => (e: React.MouseEvent) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const el =
                    (e.currentTarget.parentElement?.querySelector(
                      "img"
                    ) as HTMLImageElement) || null;
                  const startWidth =
                    imageSizes[idx]?.width ||
                    el?.getBoundingClientRect().width ||
                    480;
                  const onMove = (ev: MouseEvent) => {
                    const delta = ev.clientX - startX;
                    const next = Math.max(
                      120,
                      Math.round(
                        side === "right"
                          ? startWidth + delta
                          : startWidth - delta
                      )
                    );
                    setImageSizes((m) => ({ ...m, [idx]: { width: next } }));
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                };
              const widthPx = imageSizes[idx]?.width ?? 480;
              return (
                <div
                  key={idx}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    maxWidth: "100%",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") {
                      e.preventDefault();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }
                  }}
                  tabIndex={0}
                >
                  {/* Image */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={node.src}
                    alt={node.alt}
                    style={{
                      width: widthPx,
                      maxWidth: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />
                  {/* Left handle */}
                  <div
                    title="Resize"
                    onMouseDown={handleResize("left")}
                    style={{
                      position: "absolute",
                      left: -6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 8,
                      height: 24,
                      background: "#bbb",
                      borderRadius: 2,
                      cursor: "ew-resize",
                    }}
                  />
                  {/* Right handle */}
                  <div
                    title="Resize"
                    onMouseDown={handleResize("right")}
                    style={{
                      position: "absolute",
                      right: -6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 8,
                      height: 24,
                      background: "#bbb",
                      borderRadius: 2,
                      cursor: "ew-resize",
                    }}
                  />
                  {/* Remove image button */}
                  <button
                    aria-label="Remove image"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }}
                    style={{
                      position: "absolute",
                      right: -6,
                      top: -6,
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      border: "1px solid #ccc",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              );
            }
            if (node.type === "FormulaInline") {
              return (
                <span
                  key={idx}
                  style={{
                    fontFamily: "serif",
                    padding: "2px 4px",
                    borderRadius: 4,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") {
                      e.preventDefault();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }
                    if (
                      (!e.shiftKey && e.key === "Enter") ||
                      e.key === "ArrowDown" ||
                      e.key === "ArrowRight"
                    ) {
                      e.preventDefault();
                      const nextIsPara =
                        doc?.nodes?.[idx + 1]?.type === "Paragraph";
                      if (!nextIsPara)
                        apply(() => editor.insert_paragraph(idx + 1, ""));
                      setLastParagraphIndex(idx + 1);
                      setLastParagraphCaret(0);
                      scheduleSync();
                    }
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const prevIsPara =
                        doc?.nodes?.[idx - 1]?.type === "Paragraph";
                      if (!prevIsPara)
                        apply(() =>
                          editor.insert_paragraph(Math.max(0, idx), "")
                        );
                      setLastParagraphIndex(Math.max(0, idx));
                      setLastParagraphCaret(
                        (paraRefs.current[Math.max(0, idx)]?.innerText || "")
                          .length
                      );
                      scheduleSync();
                    }
                  }}
                  tabIndex={0}
                  onClick={() => {
                    const nextIsPara =
                      doc?.nodes?.[idx + 1]?.type === "Paragraph";
                    if (!nextIsPara)
                      apply(() => editor.insert_paragraph(idx + 1, ""));
                    setLastParagraphIndex(idx + 1);
                    setLastParagraphCaret(0);
                    scheduleSync();
                  }}
                >
                  $ {node.tex} $
                  <button
                    aria-label="Remove formula"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }}
                    style={{
                      marginLeft: 6,
                      padding: "0 4px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                    title="Remove formula"
                  >
                    ×
                  </button>
                </span>
              );
            }
            if (node.type === "FormulaBlock") {
              return (
                <div
                  key={idx}
                  style={{
                    padding: 8,
                    background: "#f8fafc",
                    borderRadius: 4,
                    margin: "8px 0",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).focus();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" || e.key === "Delete") {
                      e.preventDefault();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }
                    if (
                      (!e.shiftKey && e.key === "Enter") ||
                      e.key === "ArrowDown" ||
                      e.key === "ArrowRight"
                    ) {
                      e.preventDefault();
                      const nextIsPara =
                        doc?.nodes?.[idx + 1]?.type === "Paragraph";
                      if (!nextIsPara)
                        apply(() => editor.insert_paragraph(idx + 1, ""));
                      setLastParagraphIndex(idx + 1);
                      setLastParagraphCaret(0);
                      scheduleSync();
                    }
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const prevIsPara =
                        doc?.nodes?.[idx - 1]?.type === "Paragraph";
                      if (!prevIsPara)
                        apply(() =>
                          editor.insert_paragraph(Math.max(0, idx), "")
                        );
                      setLastParagraphIndex(Math.max(0, idx));
                      setLastParagraphCaret(
                        (paraRefs.current[Math.max(0, idx)]?.innerText || "")
                          .length
                      );
                      scheduleSync();
                    }
                  }}
                  tabIndex={0}
                  onClick={() => {
                    const nextIsPara =
                      doc?.nodes?.[idx + 1]?.type === "Paragraph";
                    if (!nextIsPara)
                      apply(() => editor.insert_paragraph(idx + 1, ""));
                    setLastParagraphIndex(idx + 1);
                    setLastParagraphCaret(0);
                    scheduleSync();
                  }}
                >
                  $${node.tex}$$
                  <button
                    aria-label="Remove formula"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply(() => editor.delete_node(idx));
                      scheduleSync();
                    }}
                    style={{
                      marginLeft: 8,
                      padding: "2px 6px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                    title="Remove formula"
                  >
                    Remove
                  </button>
                </div>
              );
            }
            // Ignore MCQ/InfoBox nodes in this editor build
            return null;
          })}
          {/* No trailing textbox; click empty canvas to insert a paragraph */}
        </div>
      )}

      {/* JSON debug panel removed per requirements */}
    </div>
  );
}
