import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  atomDeclarations,
  continueListNumbering,
  createList,
  createNodeId,
  deleteAtom,
  executeMarkTool,
  indentBlockCommand,
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
  runAtomUpload,
  restartListNumbering,
  serializeCanonicalListHtml,
  serializeCanonicalListMarkdown,
  setListChecked,
  setListPreset,
  setListStyle,
  setTableHeaderCommand,
  setBlockAttributes,
  setBlockTypeCommand,
  moveBlockCommand,
  outdentBlockCommand,
  splitTableCellCommand,
  unwrapBlocks,
  wrapBlocks,
  unwrapList,
  updateAtom,
  outdentList,
  type PersistedEditorDocument,
  type ClipboardDiagnosticReport,
  type SmartOperation,
  type SmartPos,
  type ResolvedScope,
  type SmartElementNode,
  type SmartNode,
  type TableGridScope,
  type SelectionDescription,
} from "smartrte-core/foundation";
import { FOUNDATION_SMART_LIST_PRESETS as SMART_LIST_PRESETS } from "smartrte-core/foundation";
import { ensureStyleSheet } from "../theme.js";
import type { MediaKind, MediaProvider } from "../mediaProvider.js";
import { DefaultMediaPicker, type MediaPickerComponent } from "./MediaPicker.js";
import { exportDocxDocument, importStyledDocxDocument, importPdfDocument } from "smartrte-core/foundation";
import { printSmartDocumentAsPdf } from "../adapters/pdfPrint.js";
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
  /** Host-owned upload/search/remove boundary for canonical media insertion. */
  mediaProvider?: MediaProvider;
  /** Replaceable picker; the default only selects a local file. */
  mediaPicker?: MediaPickerComponent;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
  className?: string;
  /** Test/diagnostic hook; not part of the editing contract. */
  onRuntime?: (runtime: CanonicalEditorRuntime) => void;
}

const labels: Record<string, string> = {
  bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", strikethrough: "Strikethrough",
  inlineCode: "Inline code", superscript: "Superscript", subscript: "Subscript",
  textColor: "Text colour", backgroundColor: "Background colour",
  fontSize: "Font size", fontFamily: "Font family",
};

type ListSelectionPart = Extract<ResolvedScope, { kind: "list-selection" }>;

const listSelectionParts = (scope: ResolvedScope): ListSelectionPart[] => {
  if (scope.kind === "list-selection") return [scope];
  if (scope.kind !== "mixed") return [];
  return scope.parts.flatMap(listSelectionParts);
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

const downloadBlob = (ownerDocument: Document, name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
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
  mediaProvider,
  mediaPicker: MediaPicker = DefaultMediaPicker,
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
  const pendingMediaUploads = useRef(new Set<AbortController>());
  const [mediaKind, setMediaKind] = useState<MediaKind | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new CanonicalEditorRuntime({ initialValue: defaultValue, onChange, onHtmlChange, onClipboardDiagnostic });
  const runtime = runtimeRef.current;
  const [, setEditorTick] = useState(0);
  runtime.setCallbacks(onChange, onHtmlChange);
  useImperativeHandle(forwardedRef, () => runtime, [runtime]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    runtime.mount(root);
    onRuntime?.(runtime);
    return () => {
      pendingMediaUploads.current.forEach((controller) => controller.abort());
      pendingMediaUploads.current.clear();
      runtime.unmount();
    };
  }, [runtime, onRuntime]);

  useEffect(() => runtime.editor.subscribe(() => setEditorTick((value) => value + 1)), [runtime]);

  const transactBlock = (operations: SmartOperation[]) => {
    runtime.executeOperations(operations);
  };
  const blockScope = () => runtime.editor.resolveScope({ want: "block-range" }) as ResolvedScope;
  const blockContext = () => ({ schema: runtime.editor.schema, positions: runtime.editor.positions });
  const listScope = () => runtime.editor.resolveScope({ want: "list-selection" }) as ResolvedScope;
  const tableScope = () => runtime.editor.resolveScope({ want: "table-grid" }) as ResolvedScope;
  const atomScope = () => runtime.editor.resolveScope({ want: "atomic-node" }) as ResolvedScope;
  const ids = (count: number) => Array.from({ length: count }, () => createNodeId());
  // Style/preset changes are a decision about the whole list the user is
  // working in, not just the nested list segment nearest the cursor —
  // unlike indent/outdent/move, which deliberately stay scoped to the
  // nearest list and must not use this.
  const outermostListId = (listId: string): string => {
    let current = listId;
    for (;;) {
      const resolved = runtime.editor.positions.positionOf(current);
      if (!resolved || resolved.parent.type !== "list_item") return current;
      const itemResolved = runtime.editor.positions.positionOf(resolved.parent.id);
      if (!itemResolved || itemResolved.parent.type !== "list") return current;
      current = itemResolved.parent.id;
    }
  };

  const currentListScope = listScope();
  const currentListParts = listSelectionParts(currentListScope);
  const currentListStates = currentListParts.map((part) => {
    const list = findNode(runtime.editor.document, part.listId);
    const selectedIds = new Set(part.items.map((item) => item.itemId));
    const indexes = list?.children?.flatMap((child, index) =>
      !isTextNode(child) && selectedIds.has(child.id) ? [index] : []) || [];
    return { part, list, indexes };
  });
  // A mixed scope is intentionally supported by list commands: list parts are
  // transformed and plain-block parts are ignored. Keep the toolbar state in
  // sync with that same policy instead of treating mixed as universally inert.
  const currentList = currentListStates.length === 1 ? currentListStates[0].list : null;
  const rootList = currentListScope.kind === "list-selection"
    ? findNode(runtime.editor.document, outermostListId(currentListScope.listId))
    : null;
  const currentTableScope = tableScope();
  const currentAtomScope = atomScope();
  const currentListItems = currentListStates.length === 1 ? currentListStates[0].part.items : [];
  const orderedList = Boolean(currentList && /^(?:decimal|lower-|upper-|ordered)/.test(String(currentList.attrs?.style || currentList.attrs?.preset || "")));
  const canIndent = currentListStates.some(({ indexes }) => indexes.length > 0 && Math.min(...indexes) > 0);
  const canMoveUp = currentListStates.some(({ indexes }) => indexes.length > 0 && Math.min(...indexes) > 0);
  const canMoveDown = currentListStates.some(({ indexes, list }) => indexes.length > 0
    && Math.max(...indexes) < (list?.children?.length || 0) - 1);
  const tableSelected = currentTableScope.kind === "table-grid";
  const atomSelected = currentAtomScope.kind === "atomic-node";

  const blockTypeAt = (position: SmartPos): string => {
    let node: SmartNode = runtime.editor.document;
    for (let depth = 0; depth <= position.path.length; depth += 1) {
      if (!isTextNode(node) && node.type !== "doc" && runtime.editor.schema.nodes[node.type]?.group === "block") {
        // paragraph/heading/code_block are this dropdown's own options -
        // answer immediately. Everything else block-group is either a
        // container that holds further blocks (blockquote, list, list_item,
        // table/table_row/table_cell) - keep walking the path to find the
        // actual innermost block instead of answering for the wrapper - or
        // an atomic node with no dropdown answer of its own, which falls
        // through to the loop's own "paragraph" default below once it runs
        // out of path to follow.
        if (node.type === "code_block") return "code_block";
        if (node.type === "heading") return `heading-${Number(node.attrs?.level || 1)}`;
        if (node.type === "paragraph") return "paragraph";
      }
      if (depth === position.path.length || isTextNode(node)) break;
      const child = node.children?.[position.path[depth]];
      if (!child) break;
      node = child;
    }
    return "paragraph";
  };
  const currentBlockType = blockTypeAt(runtime.editor.selection.head);
  const currentListPreset = currentListParts.length === 1 && typeof rootList?.attrs?.preset === "string"
    ? rootList.attrs.preset
    : "";

  const toggleCheckedItems = () => {
    if (currentListScope.kind !== "list-selection" || currentList?.attrs?.checkable !== true) return;
    const selectedIds = new Set(currentListScope.items.map((item) => item.itemId));
    const selectedNodes = (currentList.children || []).filter((node): node is SmartElementNode => !isTextNode(node) && selectedIds.has(node.id));
    const checked = !selectedNodes.length || !selectedNodes.every((node) => node.attrs?.checked === true);
    runtime.executeOperations(setListChecked(runtime.editor.document, currentListScope, { checked }, blockContext()), { preserveSelectionById: true });
  };

  const restartNumbering = () => {
    if (currentListScope.kind !== "list-selection" || !orderedList) return;
    const value = window.prompt("Restart numbering at", String(currentList?.attrs?.start || 1));
    const start = Number(value);
    if (!Number.isInteger(start) || start < 1) return;
    runtime.executeOperations(restartListNumbering(runtime.editor.document, currentListScope, { start }, blockContext()), { preserveSelectionById: true });
  };

  // Shared by the toggle buttons' click handler and their aria-pressed state,
  // so "this button looks active" and "clicking it again removes the list"
  // can never drift apart. Checked against the outermost list (see
  // outermostListId) so a deeply nested cursor still reports the true
  // whole-list state, matching what applying a new type would change.
  const listStyleActive = (style: string, checkable = false) =>
    rootList?.attrs?.style === style && Boolean(rootList.attrs?.checkable) === checkable;

  const toggleList = (style: string, checkable = false) => {
    const selectedList = listScope();
    const context = blockContext();
    if (selectedList.kind === "list-selection") {
      const rootId = outermostListId(selectedList.listId);
      const list = findNode(runtime.editor.document, rootId);
      const sameStyle = list?.attrs?.style === style && Boolean(list.attrs?.checkable) === checkable;
      const operations = sameStyle
        // Toggling an already-active style off is deliberately scoped to just
        // the current item (selectedList), not the whole list.
        ? unwrapList(runtime.editor.document, selectedList, { splitListIds: ids(4) }, context)
        // Applying a genuinely different style/type is a whole-list decision
        // regardless of how deep the cursor is nested.
        : setListStyle(runtime.editor.document, { ...selectedList, listId: rootId }, { style, checkable }, context);
      runtime.executeOperations(operations, { preserveSelectionById: true });
      return;
    }
    const selectedBlocks = blockScope();
    const count = selectedBlocks.kind === "block-range" ? selectedBlocks.blockIds.length : 1;
    // Nesting reconstruction (see createList) can need up to one extra list
    // per block, on top of one list per originally-flat contiguous group —
    // over-provision generously rather than compute the exact worst case.
    runtime.executeOperations(createList(runtime.editor.document, selectedBlocks, {
      listIds: ids(Math.max(1, count * 2)), itemIds: ids(Math.max(1, count)), style, checkable,
    }, context), { preserveSelectionById: true });
  };

  const runList = (action: "indent" | "outdent" | "up" | "down") => {
    const scope = listScope();
    const context = blockContext();
    const operations = action === "indent" ? indentList(runtime.editor.document, scope, { nestedListIds: ids(8) }, context)
      : action === "outdent" ? outdentList(runtime.editor.document, scope, { splitListIds: ids(8) }, context)
        : moveListItems(runtime.editor.document, scope, { direction: action }, context);
    runtime.executeOperations(operations, { preserveSelectionById: true });
  };

  const applyAttributedMark = (id: string) => {
    const declaration = inlineToolDeclarations.find((tool) => tool.id === id);
    if (!declaration) return;
    const attrs = id === "textColor" || id === "backgroundColor"
      ? (() => {
        const value = window.prompt(id === "textColor" ? "Text colour" : "Background colour", "#000000");
        return value ? { value } : undefined;
      })()
      : id === "fontSize"
        ? (() => {
          const value = window.prompt("Font size (px)", "16");
          const valuePx = value === null ? undefined : Number(value);
          return Number.isFinite(valuePx) ? { valuePx } : undefined;
        })()
        : id === "fontFamily"
          ? (() => {
            const value = window.prompt("Font family", "system-ui");
            return value ? { value } : undefined;
          })()
          : undefined;
    if ((id === "textColor" || id === "backgroundColor" || id === "fontSize" || id === "fontFamily") && !attrs) return;
    try {
      executeMarkTool(runtime.editor, declaration, "apply", attrs);
      runtime.focus();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Invalid formatting value.");
    }
  };

  const toggleBlockquote = () => {
    const scope = blockScope();
    const resolved = runtime.editor.resolve({ pos: runtime.editor.selection.head });
    const ancestor = [...resolved.ancestors].reverse().find((node) => node.type === "blockquote");
    const context = blockContext();
    if (ancestor) {
      const quoteScope: ResolvedScope = {
        kind: "block-range",
        blockIds: [ancestor.id],
        promotedFromPartial: false,
        commonParentId: null,
        range: { from: resolved.pos, to: resolved.pos },
        isolatingAncestorId: null,
        clamped: false,
      };
      runtime.executeOperations(unwrapBlocks(runtime.editor.document, quoteScope, { type: "blockquote" }, context), { preserveSelectionById: true });
      return;
    }
    if (scope.kind !== "block-range" || !scope.blockIds.length) return;
    runtime.executeOperations(wrapBlocks(runtime.editor.document, scope, {
      type: "blockquote", wrapperIds: ids(scope.blockIds.length),
    }, context), { preserveSelectionById: true });
  };

  const runBlock = (action: "up" | "down" | "indent" | "outdent") => {
    const scope = blockScope();
    const context = blockContext();
    const operations = action === "up" || action === "down"
      ? moveBlockCommand(runtime.editor.document, scope, { direction: action }, context)
      : action === "indent"
        ? indentBlockCommand(runtime.editor.document, scope, {}, context)
        : outdentBlockCommand(runtime.editor.document, scope, {}, context);
    runtime.executeOperations(operations, { preserveSelectionById: true });
  };

  const insertTable = () => {
    const paragraphIds = ids(4);
    const selected = blockScope();
    const firstId = selected.kind === "block-range" ? selected.blockIds[0] : undefined;
    const target = firstId ? runtime.editor.positions.positionOf(firstId) : null;
    const operations = insertTableCommand(runtime.editor.document, selected, {
      rows: 2, columns: 2, placement: "after",
      ids: { tableId: createNodeId(), rowIds: ids(2), cellIds: ids(4), paragraphIds },
    }, blockContext());
    // Keep an editable block after a table inserted at the end of its
    // container. Without this, the browser has no legal caret position below
    // the table and clicking/arrowing past it appears to do nothing.
    if (target && target.parent.children && target.pos.offset === target.parent.children.length - 1) {
      operations.push({
        type: "insertNode",
        pos: { path: [...target.pos.path], offset: target.pos.offset + 2 },
        node: { type: "paragraph", id: createNodeId(), children: [] },
      });
    }
    runtime.executeOperations(operations, { selectionOwnerId: paragraphIds[0] });
  };

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
    runtime.executeOperations(operations, { preserveSelectionById: true });
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

  const insertBlockAtom = (type: "block_image" | "video" | "audio", attrs: Record<string, unknown>, nodeId: string): boolean => {
    const declaration = atomDeclarations.find((entry) => entry.type === type)!;
    const selection = runtime.editor.selection;
    let parentId: string | undefined;
    let index: number | undefined;
    const resolved = runtime.editor.resolve({ pos: selection.head });
    if (selection.type === "cell") {
      // A cell range resolves at the active cell's content boundary. Block
      // atoms belong inside that cell, never as invalid siblings of the row.
      parentId = resolved.nodeId;
      index = resolved.pos.offset;
    } else if (resolved.kind === "structural" && resolved.pos.path.length === selection.anchor.path.length
      && resolved.pos.path.every((part, pathIndex) => part === selection.anchor.path[pathIndex])) {
      // A browser may expose a clicked block atom as a structural text range
      // (the atom occupies one unit). Keep insertion in that same parent.
      parentId = resolved.parent.id;
      index = Math.max(selection.anchor.offset, selection.head.offset);
    } else if (selection.type === "node") {
      parentId = resolved.parent.id;
      index = resolved.pos.offset;
    } else {
      const location = runtime.editor.positions.positionOf(resolved.nodeId);
      parentId = location?.parent.id;
      index = location ? location.pos.offset + 1 : undefined;
    }
    if (!parentId || index === undefined) return false;
    const operations = insertAtom(runtime.editor.document, atomScope(), {
      declaration, nodeId, parentId, index, attrs,
    }, blockContext());
    if (!operations.length) return false;
    // Block atoms cannot contain a caret. Keep an editable paragraph after a
    // media node inserted at the end of its container (document root or table
    // cell), and place the caret there so the next keystroke has a legal owner.
    const parent = findNode(runtime.editor.document, parentId);
    const contentRange = runtime.editor.positions.contentRangeOf(parentId);
    let selectionOwnerId: string | undefined;
    if (parent?.children && index >= parent.children.length && contentRange) {
      selectionOwnerId = createNodeId();
      operations.push({
        type: "insertNode",
        pos: { path: [...contentRange.from.path], offset: index + 1 },
        node: { type: "paragraph", id: selectionOwnerId, children: [] },
      });
    }
    runtime.executeOperations(operations, selectionOwnerId ? { selectionOwnerId, selectionOffset: 0 } : {});
    return true;
  };

  const insertMediaFile = async (kind: MediaKind, file: File) => {
    setMediaKind(null);
    if (!mediaProvider) return;
    const type = kind === "image" ? "block_image" : kind;
    const nodeId = createNodeId();
    const preview = URL.createObjectURL(file);
    const attrs = kind === "image"
      ? { src: preview, alt: file.name || "Image", decorative: false, status: "pending", uploadId: nodeId }
      : { src: preview, status: "pending", uploadId: nodeId };
    if (!insertBlockAtom(type, attrs, nodeId)) {
      URL.revokeObjectURL(preview);
      return;
    }
    const controller = new AbortController();
    pendingMediaUploads.current.add(controller);
    try {
      await runAtomUpload(runtime.editor, nodeId, async () => {
        const result = await mediaProvider.upload(file, { signal: controller.signal });
        return { src: result.url, id: result.id };
      });
    } finally {
      pendingMediaUploads.current.delete(controller);
      URL.revokeObjectURL(preview);
    }
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

  const replaceCanonicalDocument = (document: ReturnType<typeof parseCanonicalListHtml>) => {
    runtime.replaceValue({ schemaVersion: runtime.editor.schema.version, revision: runtime.getRevision() + 1, document });
    runtime.focus();
  };

  const runImport = async (file: File) => {
    if (/\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await importStyledDocxDocument(await file.arrayBuffer());
      replaceCanonicalDocument(parseCanonicalListHtml(result.layoutHtml));
      return;
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const result = await importPdfDocument(await file.arrayBuffer());
      replaceCanonicalDocument(parseCanonicalListHtml(result.layoutHtml));
      return;
    }
    const text = await file.text();
    const document = /\.md(?:own)?$/i.test(file.name) ? parseCanonicalListMarkdown(text) : parseCanonicalListHtml(text);
    replaceCanonicalDocument(document);
  };

  const runExport = (format: "html" | "markdown" | "native") => {
    const envelope = runtime.getValue();
    if (format === "native") return downloadText(rootRef.current!.ownerDocument, "smart-rte.json", "application/json", JSON.stringify(envelope, null, 2));
    if (format === "markdown") return downloadText(rootRef.current!.ownerDocument, "smart-rte.md", "text/markdown", serializeCanonicalListMarkdown(envelope.document));
    return downloadText(rootRef.current!.ownerDocument, "smart-rte.html", "text/html", serializeCanonicalListHtml(envelope.document, { clean: true }));
  };

  const runDocxExport = async () => {
    if (!rootRef.current) return;
    const blob = await exportDocxDocument(runtime.editor.document);
    downloadBlob(rootRef.current.ownerDocument, "smart-rte.docx", blob);
  };

  const runPdfExport = () => {
    const view = rootRef.current?.ownerDocument.defaultView;
    if (view) printSmartDocumentAsPdf(runtime.editor.document, view);
  };

  return <section className={`srte-root srte-editor srte-canonical-authority${className ? ` ${className}` : ""}`} data-smart-authority="canonical">
    <div className="srte-toolbar" role="toolbar" aria-label="Formatting toolbar">
      {inlineToolDeclarations.filter((tool) => labels[tool.id]).map((tool) => <button
        type="button"
        key={tool.id}
        className="srte-tool-button"
        aria-label={labels[tool.id]}
        title={labels[tool.id]}
        disabled={readOnly}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (["textColor", "backgroundColor", "fontSize", "fontFamily"].includes(tool.id)) applyAttributedMark(tool.id);
          else { executeMarkTool(runtime.editor, tool, "toggle"); runtime.focus(); }
        }}
      >{labels[tool.id]}</button>)}
      <select
        aria-label="Block type"
        value={currentBlockType}
        disabled={readOnly}
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
      <button type="button" className="srte-tool-button" aria-label="Blockquote" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={toggleBlockquote}>Blockquote</button>
      <button type="button" className="srte-tool-button" aria-label="Move block up" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runBlock("up")}>Block ↑</button>
      <button type="button" className="srte-tool-button" aria-label="Move block down" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runBlock("down")}>Block ↓</button>
      <button type="button" className="srte-tool-button" aria-label="Indent block" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runBlock("indent")}>Block indent</button>
      <button type="button" className="srte-tool-button" aria-label="Outdent block" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => runBlock("outdent")}>Block outdent</button>
      <button type="button" className="srte-tool-button" aria-label="Insert or edit link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const href = window.prompt("Link URL", "https://");
        const tool = inlineToolDeclarations.find((entry) => entry.id === "link");
        const description = runtime.editor.resolveScope({ want: "describe" }) as SelectionDescription;
        const editingExisting = description.marks.some((entry) => entry.mark.type === "link");
        if (href && tool) { executeMarkTool(runtime.editor, tool, editingExisting ? "editLink" : "apply", { href }); runtime.focus(); }
      }}>Link</button>
      <button type="button" className="srte-tool-button" aria-label="Remove link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const tool = inlineToolDeclarations.find((entry) => entry.id === "link");
        if (tool) { executeMarkTool(runtime.editor, tool, "remove"); runtime.focus(); }
      }}>Unlink</button>
      <button type="button" className="srte-tool-button" aria-label="Bulleted list" aria-pressed={listStyleActive("disc")} disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("disc")}>Bullets</button>
      <button type="button" className="srte-tool-button" aria-label="Numbered list" aria-pressed={listStyleActive("decimal")} disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("decimal")}>Numbering</button>
      <button type="button" className="srte-tool-button" aria-label="Checklist" aria-pressed={listStyleActive("disc", true)} disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleList("disc", true)}>Checklist</button>
      <select aria-label="List preset" title="List type / preset" disabled={readOnly || currentListParts.length !== 1} value={currentListPreset} onChange={(event) => {
        const preset = event.target.value;
        if (!preset || currentListParts.length !== 1) return;
        // A preset choice applies to the whole list, regardless of how deep
        // the cursor is nested — see outermostListId.
        const rootId = outermostListId(currentListParts[0].listId);
        runtime.executeOperations(setListPreset(runtime.editor.document, { ...currentListParts[0], listId: rootId }, { preset }, blockContext()), { preserveSelectionById: true });
      }}>
        <option value="">List preset</option>
        {SMART_LIST_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>
          {preset.kind === "bullet" ? `Bullet · ${preset.label}` : `Number · ${preset.label}`}
        </option>)}
      </select>
      <button type="button" className="srte-tool-button" aria-label="Check selected items" aria-pressed={currentListScope.kind === "list-selection" && currentListScope.items.every((item) => findNode(runtime.editor.document, item.itemId)?.attrs?.checked === true)} disabled={readOnly || currentList?.attrs?.checkable !== true} onMouseDown={(event) => event.preventDefault()} onClick={toggleCheckedItems}>Check</button>
      <button type="button" className="srte-tool-button" aria-label="Indent list item" disabled={readOnly || !canIndent} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("indent")}>Indent</button>
      <button type="button" className="srte-tool-button" aria-label="Outdent list item" disabled={readOnly || currentListParts.length === 0} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("outdent")}>Outdent</button>
      <button type="button" className="srte-tool-button" aria-label="Move item up" disabled={readOnly || !canMoveUp} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("up")}>Item ↑</button>
      <button type="button" className="srte-tool-button" aria-label="Move item down" disabled={readOnly || !canMoveDown} onMouseDown={(event) => event.preventDefault()} onClick={() => runList("down")}>Item ↓</button>
      <button type="button" className="srte-tool-button" aria-label="Restart numbering" disabled={readOnly || !orderedList} onMouseDown={(event) => event.preventDefault()} onClick={restartNumbering}>Restart</button>
      <button type="button" className="srte-tool-button" aria-label="Continue numbering" disabled={readOnly || !orderedList} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(continueListNumbering(runtime.editor.document, currentListScope, {}, blockContext()), { preserveSelectionById: true })}>Continue</button>
      <button type="button" className="srte-tool-button" aria-label="Insert table" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={insertTable}>Table 2×2</button>
      {([["row+", "Add row"], ["row-", "Remove row"], ["column+", "Add column"], ["column-", "Remove column"], ["merge", "Merge cells"], ["split", "Split cell"], ["header", "Header row"], ["row-up", "Move row up"], ["row-down", "Move row down"], ["column-left", "Move column left"], ["column-right", "Move column right"], ["remove", "Remove table"]] as const).map(([action, label]) => <button
        key={action} type="button" className="srte-tool-button" aria-label={label} disabled={readOnly || !tableSelected
          || action === "merge" && (currentTableScope as TableGridScope).cellIds.length < 2
          || action === "row-up" && (currentTableScope as TableGridScope).rect.top === 0
          || action === "column-left" && (currentTableScope as TableGridScope).rect.left === 0}
        onMouseDown={(event) => event.preventDefault()} onClick={() => runTable(action)}
      >{label}</button>)}
      <button type="button" className="srte-tool-button" aria-label="Insert image" disabled={readOnly || !mediaProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setMediaKind("image")}>Image</button>
      <button type="button" className="srte-tool-button" aria-label="Insert video" disabled={readOnly || !mediaProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setMediaKind("video")}>Video</button>
      <button type="button" className="srte-tool-button" aria-label="Insert audio" disabled={readOnly || !mediaProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setMediaKind("audio")}>Audio</button>
      <button type="button" className="srte-tool-button" aria-label="Insert formula" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={insertInlineFormula}>Formula</button>
      <button type="button" className="srte-tool-button" aria-label="Edit selected atom" disabled={readOnly || !atomSelected} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom()}>Edit media</button>
      <button type="button" className="srte-tool-button" aria-label="Grow selected atom" disabled={readOnly || !atomSelected} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom(20)}>Resize +</button>
      <button type="button" className="srte-tool-button" aria-label="Shrink selected atom" disabled={readOnly || !atomSelected} onMouseDown={(event) => event.preventDefault()} onClick={() => editSelectedAtom(-20)}>Resize −</button>
      <button type="button" className="srte-tool-button" aria-label="Delete selected atom" disabled={readOnly || !atomSelected} onMouseDown={(event) => event.preventDefault()} onClick={() => runtime.executeOperations(deleteAtom(runtime.editor.document, atomScope(), {}, blockContext()))}>Delete media</button>
      <input ref={importRef} type="file" accept=".html,.htm,.md,.markdown,.docx,.pdf,text/html,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void runImport(file);
        event.currentTarget.value = "";
      }} />
      <button type="button" className="srte-tool-button" aria-label="Import document" disabled={readOnly} onClick={() => importRef.current?.click()}>Import</button>
      <button type="button" className="srte-tool-button" aria-label="Export HTML" onClick={() => runExport("html")}>Export HTML</button>
      <button type="button" className="srte-tool-button" aria-label="Export Markdown" onClick={() => runExport("markdown")}>Export Markdown</button>
      <button type="button" className="srte-tool-button" aria-label="Export DOCX" onClick={() => void runDocxExport()}>Export DOCX</button>
      <button type="button" className="srte-tool-button" aria-label="Export PDF" onClick={runPdfExport}>Export PDF</button>
      <button type="button" className="srte-tool-button" aria-label="Export native document" onClick={() => runExport("native")}>Export Native</button>
      <button type="button" className="srte-tool-button" aria-label="Undo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.undo(); runtime.focus(); }}>Undo</button>
      <button type="button" className="srte-tool-button" aria-label="Redo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.redo(); runtime.focus(); }}>Redo</button>
    </div>
    {mediaKind && mediaProvider && <MediaPicker kind={mediaKind} onPick={(file) => void insertMediaFile(mediaKind, file)} onCancel={() => setMediaKind(null)} />}
    <div
      ref={rootRef}
      className="srte-editor"
      data-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Smart RTE editing surface"
      aria-multiline="true"
      onClick={(event) => {
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        if (!anchor || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        window.open(anchor.href, "_blank", "noopener,noreferrer");
      }}
      style={{ minHeight, maxHeight, overflow: "auto" }}
    />
  </section>;
});
