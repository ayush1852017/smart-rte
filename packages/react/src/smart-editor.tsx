import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type SmartEditorProps = {
  editor?: any;
  storage?: any;
  onChange?: (json: string) => void;
  math?: { katexCSSHref?: string };
  mathOptions?: any;
  table?: { freezeHeader?: boolean; freezeFirstCol?: boolean };
  initialDoc?: Doc;
};

// Minimal doc model aligned with Rust core draft
type CellStyle = {
  background?: string;
  border?: { color: string; width_px: number };
};
type TableCell = {
  text: string;
  colspan: number;
  rowspan: number;
  style: CellStyle;
  placeholder?: boolean;
};
type TableRow = { cells: TableCell[] };
type TableNode = {
  type: "Table";
  rows: TableRow[];
  freeze_header: boolean;
  freeze_first_col: boolean;
  column_widths?: number[];
};
type ParagraphNode = { type: "Paragraph"; text: string };
type HeadingNode = { type: "Heading"; level: 1 | 2 | 3; text: string };
type ImageNode = {
  type: "Image";
  src: string;
  alt?: string;
  width?: number;
  height?: number;
};
type FormulaNode = { type: "Formula"; latex: string; displayMode?: boolean };
type Node = ParagraphNode | TableNode | HeadingNode | ImageNode | FormulaNode;
export type Doc = { nodes: Node[] };

function createEmptyDoc(): Doc {
  return { nodes: [{ type: "Paragraph", text: "" }] };
}

function createTable(
  rows: number,
  cols: number,
  freezeHeader = false,
  freezeFirstCol = false
): TableNode {
  return {
    type: "Table",
    freeze_header: freezeHeader,
    freeze_first_col: freezeFirstCol,
    rows: Array.from({ length: rows }, () => ({
      cells: Array.from({ length: cols }, () => ({
        text: "",
        colspan: 1,
        rowspan: 1,
        style: {},
      })),
    })),
  };
}

function normalizeLatex(src: string, isBlock: boolean): string {
  try {
    const hasLinebreak = /\\\\/.test(src);
    if (isBlock) {
      const alreadyAligned = /\\begin\{aligned\}[\s\S]*\\end\{aligned\}/.test(src);
      if (hasLinebreak && !alreadyAligned) {
        return `\\begin{aligned}\n${src}\n\\end{aligned}`;
      }
      return src;
    } else {
      if (hasLinebreak) {
        return src.replace(/\\\\/g, `\\newline`);
      }
      return src;
    }
  } catch {
    return src;
  }
}

export function SmartEditor(props: SmartEditorProps) {
  const { onChange } = props;
  const [doc, setDoc] = useState<Doc>(() => createEmptyDoc());
  const tableConfig = props.table ?? {};
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showJson, setShowJson] = useState<boolean>(true);
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);
  const [selection, setSelection] = useState<
    | { tableIdx: number; sr: number; sc: number; er: number; ec: number }
    | null
  >(null);
  const resizeRef = useRef<{
    active: boolean;
    tableIdx: number;
    colIdx: number;
    startX: number;
  } | null>(null);
  const moveColRef = useRef<{
    active: boolean;
    tableIdx: number;
    from: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; tableIdx: number; r: number; c: number; open: boolean }
    | null
  >(null);
  const cellImageInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFormula, setSelectedFormula] = useState<string>(String.raw`E=mc^2`);
  const [formulaDisplay, setFormulaDisplay] = useState<boolean>(true);
  

  const syncDocFromCore = useCallback(() => {
    try {
      if (props.editor && typeof props.editor.to_json === "function") {
        const json = props.editor.to_json();
        const parsed = JSON.parse(json);
        if (parsed && parsed.nodes) setDoc(parsed);
      }
    } catch {
      // ignore sync errors; UI state already updated
    }
  }, [props.editor]);

  // Initialize from provided editor if any; otherwise from initialDoc if provided
  useEffect(() => {
    try {
      if (props.editor && typeof props.editor.to_json === "function") {
        const json = props.editor.to_json();
        const parsed = JSON.parse(json);
        if (parsed && parsed.nodes) setDoc(parsed);
        return;
      }
    } catch {
      // ignore
    }
    if (props.initialDoc) {
      setDoc(props.initialDoc);
    }
  }, [props.editor]);

  // Emit changes
  useEffect(() => {
    onChange?.(JSON.stringify(doc));
  }, [doc, onChange]);

  const insertTable = useCallback(
    (r: number, c: number) => {
      // Try core op then mirror in local doc
      try {
        props.editor?.insert_table?.(r, c);
        syncDocFromCore();
        return;
      } catch {}
      setDoc((prev) => ({
        nodes: [
          ...prev.nodes,
          createTable(
            r,
            c,
            !!tableConfig.freezeHeader,
            !!tableConfig.freezeFirstCol
          ),
        ],
      }));
    },
    [
      props.editor,
      tableConfig.freezeFirstCol,
      tableConfig.freezeHeader,
      syncDocFromCore,
    ]
  );

  const insertParagraph = useCallback(() => {
    setDoc((prev) => ({
      nodes: [...prev.nodes, { type: "Paragraph", text: "" }],
    }));
  }, []);

  const insertHeading = useCallback((level: 1 | 2 | 3) => {
    setDoc((prev) => ({
      nodes: [
        ...prev.nodes,
        { type: "Heading", level, text: `Heading ${level}` },
      ],
    }));
  }, []);

  const toggleFreezeHeader = useCallback(() => {
    const hasTable = doc.nodes.some((n) => n.type === "Table");
    let newHeader = true;
    let currentFirst = false;
    if (hasTable) {
      const firstTable = doc.nodes.find((n) => n.type === "Table") as TableNode;
      newHeader = !firstTable.freeze_header;
      currentFirst = firstTable.freeze_first_col;
    }
    try {
      props.editor?.set_freeze?.(newHeader, currentFirst);
      syncDocFromCore();
      return;
    } catch {}
    setDoc((prev) => ({
      nodes: prev.nodes.map((n) =>
        n.type === "Table"
          ? ({ ...n, freeze_header: !n.freeze_header } as TableNode)
          : n
      ),
    }));
  }, [doc.nodes, props.editor, syncDocFromCore]);

  const toggleFreezeFirstCol = useCallback(() => {
    const hasTable = doc.nodes.some((n) => n.type === "Table");
    let newFirst = true;
    let currentHeader = false;
    if (hasTable) {
      const firstTable = doc.nodes.find((n) => n.type === "Table") as TableNode;
      newFirst = !firstTable.freeze_first_col;
      currentHeader = firstTable.freeze_header;
    }
    try {
      props.editor?.set_freeze?.(currentHeader, newFirst);
      syncDocFromCore();
      return;
    } catch {}
    setDoc((prev) => ({
      nodes: prev.nodes.map((n) =>
        n.type === "Table"
          ? ({ ...n, freeze_first_col: !n.freeze_first_col } as TableNode)
          : n
      ),
    }));
  }, [doc.nodes, props.editor, syncDocFromCore]);

  const updateCell = useCallback(
    (tableIdx: number, rowIdx: number, colIdx: number, text: string) => {
      setDoc((prev) => {
        const nodes = prev.nodes.slice();
        const t = nodes[tableIdx] as TableNode;
        const rows = t.rows.slice();
        const row = { ...rows[rowIdx] };
        const cells = row.cells.slice();
        cells[colIdx] = { ...cells[colIdx], text };
        row.cells = cells;
        rows[rowIdx] = row;
        nodes[tableIdx] = { ...t, rows };
        return { nodes };
      });
    },
    []
  );

  const onClickInsertImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const insertFormula = useCallback(() => {
    const defaultLatex = String.raw`E=mc^2`;
    setDoc((prev) => ({
      nodes: [
        ...prev.nodes,
        {
          type: "Formula",
          latex: defaultLatex,
          displayMode: true,
        } as FormulaNode,
      ],
    }));
  }, []);

  // Selection helpers for tables
  const startCellSelection = useCallback(
    (tableIdx: number, r: number, c: number) => {
      setIsMouseDown(true);
      setSelection({ tableIdx, sr: r, sc: c, er: r, ec: c });
    },
    []
  );
  const extendCellSelection = useCallback(
    (tableIdx: number, r: number, c: number) => {
      setSelection((prev) => {
        if (!prev || prev.tableIdx !== tableIdx) return prev;
        return { ...prev, er: r, ec: c };
      });
    },
    []
  );

  const onFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const contentType = file.type || "application/octet-stream";
        const safeName = file.name.replace(/\s+/g, "_");
        const key = `uploads/${Date.now()}-${safeName}`;
        let publicUrl = "";
        if (props.storage?.presignUpload) {
          const { url } = await props.storage.presignUpload({
            key,
            contentType,
          });
          const putRes = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: file,
          });
          if (!putRes.ok) throw new Error("Upload failed");
          const u = new URL(url);
          u.search = "";
          publicUrl = u.toString();
        } else {
          publicUrl = URL.createObjectURL(file);
        }
        setDoc((prev) => ({
          nodes: [
            ...prev.nodes,
            {
              type: "Image",
              src: publicUrl,
              alt: file.name,
              width: undefined,
              height: undefined,
            } as ImageNode,
          ],
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        alert("Image upload failed");
      } finally {
        e.target.value = "";
      }
    },
    [props.storage]
  );

  const tableIndices = useMemo(
    () =>
      doc.nodes
        .map((n, i) => ({ n, i }))
        .filter((x): x is { n: TableNode; i: number } => x.n.type === "Table"),
    [doc.nodes]
  );

  return (
    <div
      style={{
        border: "1px solid #ddd",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Menubar */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          borderBottom: "1px solid #eee",
          paddingBottom: 6,
          userSelect: "none",
        }}
      >
        {/* File */}
        <details>
          <summary style={{ cursor: "default" }}>File</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(doc, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "document.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export JSON
            </button>
            <button
              onClick={() => {
                try {
                  const html =
                    props.editor?.to_html?.() ??
                    "<pre>HTML not available</pre>";
                  const blob = new Blob([html], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "document.html";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  alert("HTML export failed");
                }
              }}
            >
              Export HTML
            </button>
            <button
              onClick={() => {
                try {
                  const md =
                    props.editor?.to_markdown?.() ?? "Markdown not available";
                  const blob = new Blob([md], { type: "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "document.md";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  alert("Markdown export failed");
                }
              }}
            >
              Export Markdown
            </button>
          </div>
        </details>

        {/* Edit */}
        <details>
          <summary style={{ cursor: "default" }}>Edit</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => {
                try {
                  props.editor?.undo?.();
                  syncDocFromCore();
                } catch {}
              }}
            >
              Undo
            </button>
            <button
              onClick={() => {
                try {
                  props.editor?.redo?.();
                  syncDocFromCore();
                } catch {}
              }}
            >
              Redo
            </button>
          </div>
        </details>

        {/* View */}
        <details>
          <summary style={{ cursor: "default" }}>View</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showJson}
                onChange={(e) => setShowJson(e.target.checked)}
              />
              Show JSON Panel
            </label>
          </div>
        </details>

        {/* Insert */}
        <details>
          <summary style={{ cursor: "default" }}>Insert</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={() => insertHeading(1)}>Heading 1</button>
            <button onClick={() => insertHeading(2)}>Heading 2</button>
            <button onClick={() => insertHeading(3)}>Heading 3</button>
            <button onClick={insertParagraph}>Paragraph</button>
            <button onClick={() => insertTable(6, 8)}>Table 6×8</button>
            <button onClick={onClickInsertImage}>Image…</button>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={selectedFormula}
                onChange={(e) => setSelectedFormula(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value={String.raw`E=mc^2`}>E=mc^2 (inline)</option>
                <option value={String.raw`x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}`}>
                  Quadratic formula
                </option>
                <option value={String.raw`\\int_a^b f(x)\\,dx`}>Integral</option>
                <option value={String.raw`\\sum_{i=1}^{n} i^2`}>Sum</option>
                <option value={String.raw`\\prod_{k=1}^{n} k`}>Product</option>
                <option value={String.raw`\\lim_{x\\to 0} \\frac{\\sin x}{x}`}>
                  Limit
                </option>
                <option value={String.raw`\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}`}>
                  Matrix 2×2
                </option>
                <option value={String.raw`\\frac{a}{b}`}>Fraction</option>
              </select>
              <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                type="checkbox"
                checked={formulaDisplay}
                onChange={(e) => setFormulaDisplay(e.target.checked)}
                />
                Display
              </label>
              <button
                onClick={() => {
                  setDoc((prev) => ({
                    nodes: [
                      ...prev.nodes,
                      { type: "Formula", latex: selectedFormula, displayMode: formulaDisplay } as FormulaNode,
                    ],
                  }));
                }}
              >
                Insert formula
              </button>
            </div>
          </div>
        </details>

        {/* Format */}
        <details>
          <summary style={{ cursor: "default" }}>Format</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={toggleFreezeHeader}>Toggle Freeze Header</button>
            <button onClick={toggleFreezeFirstCol}>
              Toggle Freeze First Column
            </button>
            {tableIndices.length > 0 && (
              <>
                <button
                  onClick={() => {
                    try {
                      props.editor?.merge_cells?.(0, 0, 0, 1);
                      syncDocFromCore();
                    } catch {}
                  }}
                >
                  Merge (0,0)-(0,1)
                </button>
                <button
                  onClick={() => {
                    try {
                      props.editor?.split_cell?.(0, 0);
                      syncDocFromCore();
                    } catch {}
                  }}
                >
                  Split cell (0,0)
                </button>
                <button
                  onClick={() => {
                    try {
                      props.editor?.move_row?.(1, 2);
                      syncDocFromCore();
                    } catch {}
                  }}
                >
                  Move row 1 → 2
                </button>
                <button
                  onClick={() => {
                    try {
                      props.editor?.move_col?.(1, 2);
                      syncDocFromCore();
                    } catch {}
                  }}
                >
                  Move col 1 → 2
                </button>
              </>
            )}
          </div>
        </details>

        {/* Help */}
        <details>
          <summary style={{ cursor: "default" }}>Help</summary>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxWidth: 360,
            }}
          >
            <small>
              Use the menu to insert content, upload an image (S3 if
              configured), and export your document as JSON/HTML/Markdown. Table
              header/first column can be frozen for large tables.
            </small>
          </div>
        </details>
      </div>
      {contextMenu?.open && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            background: "#fff",
            border: "1px solid #ddd",
            boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
            padding: 8,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 180,
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <button
            onClick={() => {
              if (!selection) return;
              try {
                props.editor?.merge_cells?.(selection.sr, selection.sc, selection.er, selection.ec);
                syncDocFromCore();
              } catch {}
              setContextMenu(null);
            }}
          >
            Merge selected
          </button>
          <button
            onClick={() => {
              if (!contextMenu) return;
              try {
                props.editor?.split_cell?.(contextMenu.r, contextMenu.c);
                syncDocFromCore();
              } catch {}
              setContextMenu(null);
            }}
          >
            Split cell
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Background
            <input
              type="color"
              onChange={(e) => {
                const color = e.target.value;
                if (!contextMenu) return;
                const style = { background: color } as any;
                try {
                  props.editor?.set_cell_style?.(contextMenu.r, contextMenu.c, JSON.stringify(style));
                  syncDocFromCore();
                } catch {}
                setContextMenu(null);
              }}
            />
          </label>
          <button onClick={() => cellImageInputRef.current?.click()}>
            Insert image into cell…
          </button>
        </div>
      )}
      <input
        ref={cellImageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !contextMenu) return;
          try {
            const url = URL.createObjectURL(file);
            const { tableIdx, r, c } = contextMenu;
            setDoc((prev) => {
              const nodes = prev.nodes.slice();
              const t = nodes[tableIdx] as TableNode;
              const rows = t.rows.slice();
              const row = { ...rows[r] };
              const cells = row.cells.slice();
              cells[c] = { ...cells[c], text: `img:${url}` };
              row.cells = cells;
              rows[r] = row;
              nodes[tableIdx] = { ...(t as any), rows } as any;
              return { nodes } as Doc;
            });
          } finally {
            e.currentTarget.value = "";
            setContextMenu(null);
          }
        }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => {
            try {
              props.editor?.undo?.();
              syncDocFromCore();
            } catch {}
          }}
        >
          Undo
        </button>
        <button
          onClick={() => {
            try {
              props.editor?.redo?.();
              syncDocFromCore();
            } catch {}
          }}
        >
          Redo
        </button>
        <span style={{ borderLeft: "1px solid #eee" }} />
        <button onClick={insertParagraph}>Paragraph</button>
        <button onClick={() => insertHeading(1)}>H1</button>
        <button onClick={() => insertHeading(2)}>H2</button>
        <button onClick={() => insertHeading(3)}>H3</button>
        <span style={{ borderLeft: "1px solid #eee" }} />
        <button onClick={() => insertTable(6, 8)}>Insert 6×8 table</button>
        <button onClick={toggleFreezeHeader}>Toggle freeze header</button>
        <button onClick={toggleFreezeFirstCol}>Toggle freeze first col</button>
        {selection && (
          <>
            <button
              onClick={() => {
                try {
                  const s = selection;
                  props.editor?.merge_cells?.(s.sr, s.sc, s.er, s.ec);
                  syncDocFromCore();
                } catch {}
              }}
            >
              Merge selected
            </button>
            <button
              onClick={() => {
                try {
                  props.editor?.split_cell?.(selection.sr, selection.sc);
                  syncDocFromCore();
                } catch {}
              }}
            >
              Split selected
            </button>
          </>
        )}
        <span style={{ borderLeft: "1px solid #eee" }} />
        <button onClick={onClickInsertImage}>Insert image</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onFileSelected}
        />
      </div>
      <div
        style={{ minHeight: 200 }}
        onMouseUp={() => setIsMouseDown(false)}
        onMouseLeave={() => setIsMouseDown(false)}
        onContextMenu={(e) => {
          if (contextMenu?.open) {
            e.preventDefault();
            setContextMenu(null);
          }
        }}
      >
        {doc.nodes.map((node, idx) => {
          if (node.type === "Paragraph") {
            return (
              <p
                key={idx}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  const text = (e.target as HTMLElement).innerText;
                  setDoc((prev) => {
                    const nodes = prev.nodes.slice();
                    nodes[idx] = { type: "Paragraph", text };
                    return { nodes };
                  });
                }}
              >
                {node.text}
              </p>
            );
          }
          if (node.type === "Heading") {
            const Tag =
              `h${node.level}` as unknown as keyof JSX.IntrinsicElements;
            return (
              <Tag
                key={idx}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => {
                  const text = (e.target as HTMLElement).innerText;
                  setDoc((prev) => {
                    const nodes = prev.nodes.slice();
                    nodes[idx] = {
                      type: "Heading",
                      level: node.level,
                      text,
                    } as HeadingNode;
                    return { nodes };
                  });
                }}
                style={{ margin: "0.5em 0" }}
              >
                {node.text}
              </Tag>
            );
          }
          if (node.type === "Table") {
            const t = node;
            const tableIdx = idx;
            return (
              <div
                key={idx}
                style={{ overflow: "auto", border: "1px solid #ccc" }}
              >
                <table
                  style={{
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    width: "max-content",
                  }}
                >
                  <tbody>
                    {t.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.cells.map((cell, cIdx) => {
                          const isHeaderRow = t.freeze_header && rIdx === 0;
                          const isFirstCol = t.freeze_first_col && cIdx === 0;
                          const stickyStyle: React.CSSProperties = {};
                          if (isHeaderRow) {
                            stickyStyle.position = "sticky";
                            stickyStyle.top = 0;
                            stickyStyle.zIndex = 2;
                            stickyStyle.background = "#fafafa";
                          }
                          if (isFirstCol) {
                            stickyStyle.position = "sticky";
                            stickyStyle.left = 0;
                            stickyStyle.zIndex = 1;
                            stickyStyle.background =
                              stickyStyle.background || "#fafafa";
                          }
                          const inSel =
                            !!selection &&
                            selection.tableIdx === tableIdx &&
                            rIdx >= Math.min(selection.sr, selection.er) &&
                            rIdx <= Math.max(selection.sr, selection.er) &&
                            cIdx >= Math.min(selection.sc, selection.ec) &&
                            cIdx <= Math.max(selection.sc, selection.ec);
                          if (cell.placeholder) {
                            return null;
                          }
                          const width = node.column_widths?.[cIdx];
                          return (
                            <td
                              key={cIdx}
                              style={{
                                minWidth: width ?? 80,
                                padding: 6,
                                border: "1px solid #ddd",
                                position: "relative",
                                background: inSel
                                  ? "rgba(51, 136, 255, 0.15)"
                                  : cell.style.background,
                                ...stickyStyle,
                              }}
                              colSpan={cell.colspan || 1}
                              rowSpan={cell.rowspan || 1}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                startCellSelection(tableIdx, rIdx, cIdx);
                              }}
                              onMouseEnter={() => {
                                if (!isMouseDown) return;
                                extendCellSelection(tableIdx, rIdx, cIdx);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, tableIdx, r: rIdx, c: cIdx, open: true });
                              }}
                              onDoubleClick={() => {
                                // Simple demo: double-click to increase column width via core
                                try {
                                  props.editor?.set_column_width?.(cIdx, 160);
                                  syncDocFromCore();
                                } catch {}
                              }}
                            >
                              {cell.text?.startsWith("img:") ? (
                                <img src={cell.text.slice(4)} alt="" style={{ maxWidth: "100%", display: "block" }} />
                              ) : (
                                <div
                                  contentEditable
                                  suppressContentEditableWarning
                                  onInput={(e) =>
                                    updateCell(
                                      tableIdx,
                                      rIdx,
                                      cIdx,
                                      (e.target as HTMLElement).innerText
                                    )
                                  }
                                  style={{ outline: "none" }}
                                >
                                  {cell.text}
                                </div>
                              )}
                              {rIdx === 0 && (
                                <div
                                  style={{
                                    position: "absolute",
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 6,
                                    cursor: "col-resize",
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    resizeRef.current = {
                                      active: true,
                                      tableIdx,
                                      colIdx: cIdx,
                                      startX: e.clientX,
                                    };
                                    const onMove = (ev: MouseEvent) => {
                                      const delta = ev.clientX - (resizeRef.current?.startX ?? e.clientX);
                                      const base = node.column_widths?.[cIdx] ?? 80;
                                      const next = Math.max(60, base + delta);
                                      setDoc((prev) => {
                                        const nodes = prev.nodes.slice();
                                        const tnode = nodes[tableIdx] as TableNode;
                                        const widths = (tnode.column_widths || []).slice();
                                        while (widths.length < (tnode.rows[0]?.cells.length || 0)) widths.push(80);
                                        widths[cIdx] = Math.round(next);
                                        (nodes[tableIdx] as any) = { ...tnode, column_widths: widths } as TableNode;
                                        return { nodes } as Doc;
                                      });
                                    };
                                    const onUp = (ev: MouseEvent) => {
                                      window.removeEventListener("mouseup", onUp);
                                      window.removeEventListener("mousemove", onMove);
                                      const startX =
                                        resizeRef.current?.startX ?? e.clientX;
                                      const delta = ev.clientX - startX;
                                      const base = node.column_widths?.[cIdx] ?? 80;
                                      const next = Math.max(60, base + delta);
                                      try {
                                        props.editor?.set_column_width?.(
                                          cIdx,
                                          Math.round(next)
                                        );
                                        syncDocFromCore();
                                      } catch {}
                                      resizeRef.current = null;
                                    };
                                    window.addEventListener("mousemove", onMove);
                                    window.addEventListener("mouseup", onUp);
                                  }}
                                />
                              )}
                              {rIdx === 0 && (
                                <div
                                  style={{
                                    position: "absolute",
                                    left: 6,
                                    top: 6,
                                    width: 10,
                                    height: 10,
                                    background: "#ddd",
                                    borderRadius: 2,
                                    cursor: "grab",
                                  }}
                                  title="Drag to move column"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    moveColRef.current = {
                                      active: true,
                                      tableIdx,
                                      from: cIdx,
                                    };
                                    const startX = e.clientX;
                                    const onUp = (ev: MouseEvent) => {
                                      window.removeEventListener("mouseup", onUp);
                                      const from = moveColRef.current?.from ?? cIdx;
                                      let to = from;
                                      if (ev.clientX - startX > 30) to = from + 1;
                                      if (ev.clientX - startX < -30) to = from - 1;
                                      try {
                                        props.editor?.move_col?.(from, Math.max(0, to));
                                        syncDocFromCore();
                                      } catch {}
                                      moveColRef.current = null;
                                    };
                                    window.addEventListener("mouseup", onUp);
                                  }}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          if (node.type === "Formula") {
            return (
              <div
                key={idx}
                contentEditable={false}
                style={{ margin: "8px 0" }}
              >
                {/* Render via KaTeX if available on window */}
                <span
                  ref={(el) => {
                    if (!el) return;
                    try {
                      // @ts-ignore
                      const katex = (window as any).katex;
                      if (katex && typeof katex.render === "function") {
                        el.innerHTML = "";
                        const opts = {
                          displayMode: !!node.displayMode,
                          throwOnError: false,
                          strict: "ignore",
                          ...(props.mathOptions || {}),
                        };
                        const normalized = normalizeLatex(node.latex, !!node.displayMode);
                        katex.render(normalized, el, opts as any);
                      } else {
                        const normalized = normalizeLatex(node.latex, !!node.displayMode);
                        el.textContent = node.displayMode ? `$$${normalized}$$` : `$${normalized}$`;
                      }
                    } catch (err) {
                      const fallback = normalizeLatex(node.latex, !!node.displayMode);
                      el.textContent = node.displayMode ? `$$${fallback}$$` : `$${fallback}$`;
                    }
                  }}
                />
              </div>
            );
          }
          if (node.type === "Image") {
            return (
              <div key={idx} style={{ margin: "8px 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={node.src}
                  alt={node.alt || ""}
                  style={{ maxWidth: "100%", height: "auto", display: "block" }}
                />
              </div>
            );
          }
          return null;
        })}
      </div>
      {showJson && (
        <details open>
          <summary>JSON</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(doc, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
