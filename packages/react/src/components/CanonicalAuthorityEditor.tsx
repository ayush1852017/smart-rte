import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  atomDeclarations,
  continueListNumbering,
  createList,
  createNodeId,
  deleteAtom,
  executeMarkTool,
  indentList,
  inlineToolDeclarations,
  isTextNode,
  insertAtom,
  insertTableColumnCommand,
  insertTableCommand,
  insertTableRowCommand,
  mergeTableCellsCommand,
  moveListItems,
  moveTableColumnCommand,
  moveTableRowCommand,
  parseCanonicalListHtml,
  parseCanonicalListMarkdown,
  removeTableColumnCommand,
  removeTableCommand,
  removeTableRowCommand,
  resizeAtom,
  restartListNumbering,
  serializeCanonicalListHtml,
  serializeCanonicalListMarkdown,
  setListChecked,
  setListStyle,
  setTableHeaderCommand,
  setBlockAttributes,
  setBlockTypeCommand,
  splitTableCellCommand,
  unwrapList,
  updateAtom,
  outdentList,
  type PersistedEditorDocument,
  type ClipboardDiagnosticReport,
  type SmartOperation,
  type ResolvedScope,
  type SmartElementNode,
  type SmartNode,
} from "smartrte-core/foundation";
import { ensureStyleSheet } from "../theme.js";
import {
  CanonicalEditorRuntime,
  type SmartEditorChange,
  type SmartEditorHandle,
} from "../canonicalEditorRuntime.js";

export interface CanonicalAuthorityEditorProps {
  /** Initial value only. Later replacements must use SmartEditorHandle.replaceValue. */
  defaultValue?: string | PersistedEditorDocument;
  onChange?: (change: SmartEditorChange) => void;
  /** Transitional serialization callback for hosts that still persist HTML. */
  onHtmlChange?: (html: string) => void;
  onClipboardDiagnostic?: (report: ClipboardDiagnosticReport) => void;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
  className?: string;
  /** Test/diagnostic hook; not part of the editing contract. */
  onRuntime?: (runtime: CanonicalEditorRuntime) => void;
}

const labels: Record<string, string> = {
  bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough",
  inlineCode: "Inline code", superscript: "Superscript", subscript: "Subscript",
};

const findNode = (root: SmartNode, id: string): SmartElementNode | null => {
  if (isTextNode(root)) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
};

const downloadText = (ownerDocument: Document, name: string, type: string, value: string) => {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = ownerDocument.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const CanonicalAuthorityEditor = forwardRef<SmartEditorHandle, CanonicalAuthorityEditorProps>(function CanonicalAuthorityEditor({
  defaultValue,
  onChange,
  onHtmlChange,
  onClipboardDiagnostic,
  placeholder = "Type here…",
  minHeight = 200,
  maxHeight = 500,
  readOnly = false,
  className,
  onRuntime,
}, forwardedRef) {
  ensureStyleSheet();
  const rootRef = useRef<HTMLDivElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const runtimeRef = useRef<CanonicalEditorRuntime>();
  if (!runtimeRef.current) runtimeRef.current = new CanonicalEditorRuntime({ initialValue: defaultValue, onChange, onHtmlChange, onClipboardDiagnostic });
  const runtime = runtimeRef.current;
  runtime.setCallbacks(onChange, onHtmlChange);
  useImperativeHandle(forwardedRef, () => runtime, [runtime]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    runtime.mount(root);
    onRuntime?.(runtime);
    return () => runtime.unmount();
  }, [runtime, onRuntime]);

  const transactBlock = (operations: SmartOperation[]) => {
    runtime.executeOperations(operations);
  };
  const blockScope = () => runtime.editor.resolveScope({ want: "block-range" }) as ResolvedScope;
  const blockContext = () => ({ schema: runtime.editor.schema, positions: runtime.editor.positions });
  const listScope = () => runtime.editor.resolveScope({ want: "list-selection" }) as ResolvedScope;
  const tableScope = () => runtime.editor.resolveScope({ want: "table-grid" }) as ResolvedScope;
  const atomScope = () => runtime.editor.resolveScope({ want: "atomic-node" }) as ResolvedScope;
  const ids = (count: number) => Array.from({ length: count }, () => createNodeId());

  const toggleList = (style: string, checkable = false) => {
    const selectedList = listScope();
    const context = blockContext();
    if (selectedList.kind === "list-selection") {
      runtime.executeOperations(unwrapList(runtime.editor.document, selectedList, { splitListIds: ids(4) }, context));
      return;
    }
    const selectedBlocks = blockScope();
    const count = selectedBlocks.kind === "block-range" ? selectedBlocks.blockIds.length : 1;
    runtime.executeOperations(createList(runtime.editor.document, selectedBlocks, {
      listIds: ids(Math.max(1, count)), itemIds: ids(Math.max(1, count)), style, checkable,
    }, context));
  };

  const runList = (action: "indent" | "outdent" | "up" | "down") => {
    const scope = listScope();
    const context = blockContext();
    const operations = action === "indent" ? indentList(runtime.editor.document, scope, { nestedListIds: ids(8) }, context)
      : action === "outdent" ? outdentList(runtime.editor.document, scope, { splitListIds: ids(8) }, context)
        : moveListItems(runtime.editor.document, scope, { direction: action }, context);
    runtime.executeOperations(operations);
  };

  const insertTable = () => runtime.executeOperations(insertTableCommand(runtime.editor.document, blockScope(), {
    rows: 2, columns: 2, placement: "after",
    ids: { tableId: createNodeId(), rowIds: ids(2), cellIds: ids(4), paragraphIds: ids(4) },
  }, blockContext()));

  const runTable = (action: string) => {
    const scope = tableScope();
    const context = blockContext();
    const many = ids(128);
    const operations = action === "remove" ? removeTableCommand(runtime.editor.document, scope, {}, context)
      : action === "row+" ? insertTableRowCommand(runtime.editor.document, scope, { position: "after", rowId: createNodeId(), cellIds: many, paragraphIds: ids(128) }, context)
        : action === "row-" ? removeTableRowCommand(runtime.editor.document, scope, {}, context)
          : action === "column+" ? insertTableColumnCommand(runtime.editor.document, scope, { position: "after", cellIds: many, paragraphIds: ids(128) }, context)
            : action === "column-" ? removeTableColumnCommand(runtime.editor.document, scope, {}, context)
              : action === "merge" ? mergeTableCellsCommand(runtime.editor.document, scope, {}, context)
                : action === "split" ? splitTableCellCommand(runtime.editor.document, scope, { cellIds: many, paragraphIds: ids(128) }, context)
                  : action === "header" ? setTableHeaderCommand(runtime.editor.document, scope, { target: "row" }, context)
                    : action === "row-up" || action === "row-down" ? moveTableRowCommand(runtime.editor.document, scope, { direction: action === "row-up" ? "up" : "down" }, context)
                      : moveTableColumnCommand(runtime.editor.document, scope, { direction: action === "column-left" ? "left" : "right" }, context);
    runtime.executeOperations(operations);
  };

  const insertInlineFormula = () => {
    const source = window.prompt("Formula (LaTeX)", "E=mc^2");
    if (!source) return;
    const declaration = atomDeclarations.find((entry) => entry.type === "formula")!;
    const resolved = runtime.editor.resolve({ pos: runtime.editor.selection.head });
    runtime.executeOperations(insertAtom(runtime.editor.document, atomScope(), {
      declaration, nodeId: createNodeId(), ownerId: resolved.nodeId, offset: runtime.editor.selection.head.offset,
      attrs: { source, notation: "latex" },
    }, blockContext()));
  };

  const insertBlockAtom = (type: "block_image" | "video" | "audio") => {
    const src = window.prompt(type === "block_image" ? "Image URL" : `${type} URL`);
    if (!src) return;
    const declaration = atomDeclarations.find((entry) => entry.type === type)!;
    const owner = runtime.editor.resolve({ pos: runtime.editor.selection.head });
    const location = runtime.editor.positions.positionOf(owner.nodeId);
    if (!location) return;
    runtime.executeOperations(insertAtom(runtime.editor.document, atomScope(), {
      declaration, nodeId: createNodeId(), parentId: location.parent.id, index: location.pos.offset + 1,
      attrs: type === "block_image" ? { src, alt: window.prompt("Alt text") || "", decorative: false, status: "ready" } : { src, status: "ready" },
    }, blockContext()));
  };

  const editSelectedAtom = (resizeBy?: number) => {
    const scope = atomScope();
    if (scope.kind !== "atomic-node") return;
    const node = findNode(runtime.editor.document, scope.nodeId);
    if (!node) return;
    const operations = resizeBy === undefined
      ? updateAtom(runtime.editor.document, scope, node.type.includes("formula")
        ? { attrs: { source: window.prompt("Formula source", String(node.attrs?.source || "")) || node.attrs?.source } }
        : { attrs: { alt: window.prompt("Alt text", String(node.attrs?.alt || "")) ?? node.attrs?.alt } }, blockContext())
      : resizeAtom(runtime.editor.document, scope, {
        width: Math.max(16, Number(node.attrs?.width || 160) + resizeBy),
        height: Math.max(16, Number(node.attrs?.height || 90) + resizeBy),
      }, blockContext());
    runtime.executeOperations(operations, resizeBy === undefined ? {} : { historyGroup: `resize-${scope.nodeId}` });
  };

  const runImport = async (file: File) => {
    const text = await file.text();
    const document = /\.md(?:own)?$/i.test(file.name) ? parseCanonicalListMarkdown(text) : parseCanonicalListHtml(text);
    runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.getRevision() + 1, document });
    runtime.focus();
  };

  const runExport = (format: "html" | "markdown" | "native") => {
    const envelope = runtime.getValue();
    if (format === "native") return downloadText(rootRef.current!.ownerDocument, "smart-rte.json", "application/json", JSON.stringify(envelope, null, 2));
    if (format === "markdown") return downloadText(rootRef.current!.ownerDocument, "smart-rte.md", "text/markdown", serializeCanonicalListMarkdown(envelope.document));
    return downloadText(rootRef.current!.ownerDocument, "smart-rte.html", "text/html", serializeCanonicalListHtml(envelope.document, { clean: true }));
  };

  return <section className={`srte-root srte-canonical-authority${className ? ` ${className}` : ""}`} data-smart-authority="canonical">
    <div className="srte-toolbar" role="toolbar" aria-label="Formatting toolbar">
      {inlineToolDeclarations.filter((tool) => labels[tool.id]).map((tool) => <button
        type="button"
        key={tool.id}
        className="srte-tool-button"
        aria-label={labels[tool.id]}
        title={labels[tool.id]}
        disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { executeMarkTool(runtime.editor, tool, "toggle"); runtime.focus(); }}
      >{labels[tool.id]}</button>)}
      <select
        aria-label="Block type"
        disabled={readOnly}
        defaultValue="paragraph"
        onChange={(event) => transactBlock(setBlockTypeCommand(runtime.editor.document, blockScope(), {
          type: event.target.value === "paragraph" ? "paragraph" : event.target.value === "code_block" ? "code_block" : "heading",
          attrs: event.target.value.startsWith("heading-") ? { level: Number(event.target.value.slice(8)) } : {},
        }, blockContext()))}
      >
        <option value="paragraph">Paragraph</option>
        {Array.from({ length: 6 }, (_, index) => <option key={index + 1} value={`heading-${index + 1}`}>Heading {index + 1}</option>)}
        <option value="code_block">Code block</option>
      </select>
      {(["left", "center", "right", "justify"] as const).map((align) => <button
        key={align}
        type="button"
        className="srte-tool-button"
        aria-label={`Align ${align}`}
        disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align } }, blockContext()))}
      >{align}</button>)}
      <button type="button" className="srte-tool-button" aria-label="Insert or edit link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const href = window.prompt("Link URL", "https://");
        const tool = inlineToolDeclarations.find((entry) => entry.id === "link");
        if (href && tool) { executeMarkTool(runtime.editor, tool, "apply", { href }); runtime.focus(); }
      }}>Link</button>
      <button type="button" className="srte-tool-button" aria-label="Remove link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const tool = inlineToolDeclarations.find((entry) => entry.id === "link");
        if (tool) { executeMarkTool(runtime.editor, tool, "remove"); runtime.focus(); }
      }}>Unlink</button>
      <button type="button" className="srte-tool-button" aria-label="Bulleted list" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("disc")}>Bullets</button>
      <button type="button" className="srte-tool-button" aria-label="Numbered list" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("decimal")}>Numbering</button>
      <button type="button" className="srte-tool-button" aria-label="Checklist" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("disc", true)}>Checklist</button>
      <button type="button" className="srte-tool-button" aria-label="Check selected items" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(setListChecked(runtime.editor.document, listScope(), { checked: true }, blockContext()))}>Check</button>
      <button type="button" className="srte-tool-button" aria-label="Indent list item" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("indent")}>Indent</button>
      <button type="button" className="srte-tool-button" aria-label="Outdent list item" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("outdent")}>Outdent</button>
      <button type="button" className="srte-tool-button" aria-label="Move item up" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("up")}>Item ↑</button>
      <button type="button" className="srte-tool-button" aria-label="Move item down" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("down")}>Item ↓</button>
      <button type="button" className="srte-tool-button" aria-label="Restart numbering" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(restartListNumbering(runtime.editor.document, listScope(), { start: 1 }, blockContext()))}>Restart 1</button>
      <button type="button" className="srte-tool-button" aria-label="Continue numbering" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(continueListNumbering(runtime.editor.document, listScope(), {}, blockContext()))}>Continue</button>
      <button type="button" className="srte-tool-button" aria-label="Insert table" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={insertTable}>Table 2×2</button>
      {([["row+", "Add row"], ["row-", "Remove row"], ["column+", "Add column"], ["column-", "Remove column"], ["merge", "Merge cells"], ["split", "Split cell"], ["header", "Header row"], ["row-up", "Move row up"], ["row-down", "Move row down"], ["column-left", "Move column left"], ["column-right", "Move column right"], ["remove", "Remove table"]] as const).map(([action, label]) => <button
        key={action} type="button" className="srte-tool-button" aria-label={label} disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()} onClick={() => runTable(action)}
      >{label}</button>)}
      <button type="button" className="srte-tool-button" aria-label="Insert image" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlockAtom("block_image")}>Image</button>
      <button type="button" className="srte-tool-button" aria-label="Insert video" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlockAtom("video")}>Video</button>
      <button type="button" className="srte-tool-button" aria-label="Insert audio" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlockAtom("audio")}>Audio</button>
      <button type="button" className="srte-tool-button" aria-label="Insert formula" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={insertInlineFormula}>Formula</button>
      <button type="button" className="srte-tool-button" aria-label="Edit selected atom" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom()}>Edit media</button>
      <button type="button" className="srte-tool-button" aria-label="Grow selected atom" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom(20)}>Resize +</button>
      <button type="button" className="srte-tool-button" aria-label="Shrink selected atom" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom(-20)}>Resize −</button>
      <button type="button" className="srte-tool-button" aria-label="Delete selected atom" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(deleteAtom(runtime.editor.document, atomScope(), {}, blockContext()))}>Delete media</button>
      <input ref={importRef} type="file" accept=".html,.htm,.md,.markdown,text/html,text/markdown" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void runImport(file);
        event.currentTarget.value = "";
      }} />
      <button type="button" className="srte-tool-button" aria-label="Import document" disabled={readOnly} onClick={() => importRef.current?.click()}>Import</button>
      <button type="button" className="srte-tool-button" aria-label="Export HTML" onClick={() => runExport("html")}>Export HTML</button>
      <button type="button" className="srte-tool-button" aria-label="Export Markdown" onClick={() => runExport("markdown")}>Export Markdown</button>
      <button type="button" className="srte-tool-button" aria-label="Export native document" onClick={() => runExport("native")}>Export Native</button>
      <button type="button" className="srte-tool-button" aria-label="Undo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.undo(); runtime.focus(); }}>Undo</button>
      <button type="button" className="srte-tool-button" aria-label="Redo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.redo(); runtime.focus(); }}>Redo</button>
    </div>
    <div
      ref={rootRef}
      className="srte-editor"
      data-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Smart RTE editing surface"
      aria-multiline="true"
      style={{ minHeight, maxHeight, overflow: "auto" }}
    />
  </section>;
});
