import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
  setTableCellAttributesCommand,
  setTableColumnWidthCommand,
  setTableRowHeightCommand,
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
  type SmartSelection,
  type TableGridScope,
  type SelectionDescription,
  type AnnotationRange,
  type CommentThread,
  type StructuralSuggestion,
  commentRangeFromSelection,
  rebaseCommentThreadsThroughTransaction,
  foundationSchema,
  resolvePos,
  suggestDeleteCommand,
  suggestInsertOperation,
  acceptSuggestionCommand,
  rejectSuggestionCommand,
  structuralSuggestionFromNode,
  acceptStructuralSuggestionCommand,
  rebaseStructuralSuggestionsThroughTransaction,
} from "smartrte-core/foundation";
import { FOUNDATION_SMART_LIST_PRESETS as SMART_LIST_PRESETS } from "smartrte-core/foundation";
import { ensureStyleSheet } from "../theme.js";
import type { MediaKind, MediaItem, MediaProvider } from "../mediaProvider.js";
import type { VersionProvider } from "../versionProvider.js";
import type { CommentProvider } from "../commentProvider.js";
import type { SuggestionProvider } from "../suggestionProvider.js";
import { VersionHistoryPanel } from "./VersionHistoryPanel.js";
import { CommentMarkers } from "./CommentMarkers.js";
import { CommentThreadPanel } from "./CommentThreadPanel.js";
import { StructuralSuggestionMarkers } from "./StructuralSuggestionMarkers.js";
import { SuggestionPanel } from "./SuggestionPanel.js";
import { DefaultMediaPicker, type MediaPickerComponent } from "./MediaPicker.js";
import { MediaManager } from "./MediaManager.js";
import { mediaManagerAdapterFrom } from "../mediaManagerAdapter.js";
import { LinkEditorPopover, type LinkEditorApplyValue } from "./LinkEditorPopover.js";
import { ColorPickerPopover } from "./ColorPickerPopover.js";
import { TableResizeHandles } from "./TableResizeHandles.js";
import { MediaOverlay } from "./MediaOverlay.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
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
  /** Replaceable picker; the default only selects a local file. Used for video/audio, and for images when mediaManager is false. */
  mediaPicker?: MediaPickerComponent;
  /**
   * Phase 11.5 §2.1: a library/search/duplicate-detection picker for
   * images, replacing the bare file-input default. Defaults to true
   * (MediaManager, adapted via mediaManagerAdapterFrom) whenever
   * mediaProvider is supplied; set to false to keep the simple mediaPicker
   * for images too.
   */
  mediaManager?: boolean;
  /** Host-owned save/list/load/remove boundary for document version history. Absent hides the version-history toolbar button entirely, mirroring mediaProvider's absent-disables-the-feature contract. */
  versionProvider?: VersionProvider;
  /** Host-owned save/list/remove boundary for comment threads. Absent hides the comment toolbar buttons and markers entirely, mirroring versionProvider's absent-disables-the-feature contract. */
  commentProvider?: CommentProvider;
  /**
   * Host-owned save/list/remove boundary for *structural* suggestions only
   * (see suggestionProvider.ts) - inline suggestions need no provider since
   * they are marks embedded in the document itself. Absent hides the
   * suggestion toolbar buttons, markers, and panel entirely.
   */
  suggestionProvider?: SuggestionProvider;
  /** Attributed to new comment replies and suggestions. Defaults to "anonymous" when absent. */
  authorId?: string;
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

const CONTEXT_MENU_DANGER_COMMANDS = new Set(["table.remove", "table.removeRow", "table.removeColumn", "atom.delete"]);

const isCollapsedTextSelection = (selection: SmartSelection): boolean =>
  selection.type === "text" && selection.anchor.offset === selection.head.offset
    && selection.anchor.path.length === selection.head.path.length
    && selection.anchor.path.every((part, index) => part === selection.head.path[index]);

export const CanonicalAuthorityEditor = forwardRef<SmartEditorHandle, CanonicalAuthorityEditorProps>(function CanonicalAuthorityEditor({
  defaultValue,
  onChange,
  onHtmlChange,
  onClipboardDiagnostic,
  mediaProvider,
  mediaPicker: MediaPicker = DefaultMediaPicker,
  mediaManager = true,
  versionProvider,
  commentProvider,
  suggestionProvider,
  authorId,
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
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [commentPanelOpen, setCommentPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pendingCommentRange, setPendingCommentRange] = useState<AnnotationRange | null>(null);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const beforeCommentDocumentRef = useRef<ReturnType<CanonicalEditorRuntime["getValue"]>["document"] | null>(null);
  const [structuralSuggestions, setStructuralSuggestions] = useState<StructuralSuggestion[]>([]);
  const [suggestionPanelOpen, setSuggestionPanelOpen] = useState(false);
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [pendingSuggestInsertAt, setPendingSuggestInsertAt] = useState<SmartPos | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const beforeSuggestionDocumentRef = useRef<ReturnType<CanonicalEditorRuntime["getValue"]>["document"] | null>(null);
  const [trackChangesEnabled, setTrackChangesEnabled] = useState(false);
  const mediaManagerAdapter = useMemo(() => mediaProvider ? mediaManagerAdapterFrom(mediaProvider) : null, [mediaProvider]);
  const [linkPopover, setLinkPopover] = useState<{
    x: number; y: number; editingExisting: boolean; href: string; openInNewTab: boolean; collapsed: boolean;
  } | null>(null);
  const [colorPopover, setColorPopover] = useState<{
    x: number; y: number;
    target: { kind: "mark"; markId: "textColor" | "backgroundColor" } | { kind: "cell"; attr: "background" | "textColor" };
    initialValue?: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // Tracks the exact caret position (path+offset) the link overlay was
  // last dismissed at (Escape/outside click) - suppresses an instant
  // re-popup while the caret hasn't moved, without needing a separate
  // "is this the same link" identity check. Cleared implicitly the moment
  // selection.head differs from this value.
  const [linkOverlayDismissedAt, setLinkOverlayDismissedAt] = useState<{ path: number[]; offset: number } | null>(null);
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

  useEffect(() => {
    if (!commentProvider) {
      setThreads([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await commentProvider.list();
        if (!cancelled) setThreads([...loaded]);
      } catch {
        // A host's initial load failing just means threads/markers start
        // empty - the same degraded-but-not-broken behaviour as when no
        // commentProvider is supplied at all.
      }
    })();
    return () => { cancelled = true; };
  }, [commentProvider]);

  // Replays each committed transaction's operations against the document
  // as it existed immediately before that transaction (tracked in this ref
  // across commits, exactly the `beforeDocument` rebaseCommentThreadsThroughTransaction
  // needs) so thread ranges stay anchored through structural edits.
  // Reference-identity is preserved for every thread the transaction didn't
  // actually touch (see annotations/range.ts's rebaseThroughMergedRemove),
  // so only genuinely-changed threads get persisted back to commentProvider.
  useEffect(() => {
    beforeCommentDocumentRef.current = runtime.editor.document;
    return runtime.editor.subscribe((transaction, state) => {
      const before = beforeCommentDocumentRef.current;
      beforeCommentDocumentRef.current = state.document;
      if (!before) return;
      setThreads((current) => {
        if (!current.length) return current;
        const rebased = rebaseCommentThreadsThroughTransaction(current, before, transaction, foundationSchema);
        if (rebased === current) return current;
        if (commentProvider) {
          rebased.forEach((thread, index) => {
            if (thread !== current[index]) void commentProvider.save(thread).catch(() => {});
          });
        }
        return [...rebased];
      });
    });
  }, [runtime, commentProvider]);

  useEffect(() => {
    if (!suggestionProvider) {
      setStructuralSuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loaded = await suggestionProvider.list();
        if (!cancelled) setStructuralSuggestions([...loaded]);
      } catch {
        // Degrades the same way an empty/absent provider does - see the
        // matching comment-load effect above.
      }
    })();
    return () => { cancelled = true; };
  }, [suggestionProvider]);

  // Mirrors the comment-rebase effect above exactly (same reasoning, same
  // reference-identity-preserving persistence), kept as an independent
  // effect/ref rather than merged into it, matching how the core layer
  // keeps comments/rebase.ts and suggestions/structural.ts as separate,
  // structurally-parallel modules instead of sharing code.
  useEffect(() => {
    beforeSuggestionDocumentRef.current = runtime.editor.document;
    return runtime.editor.subscribe((transaction, state) => {
      const before = beforeSuggestionDocumentRef.current;
      beforeSuggestionDocumentRef.current = state.document;
      if (!before) return;
      setStructuralSuggestions((current) => {
        if (!current.length) return current;
        const rebased = rebaseStructuralSuggestionsThroughTransaction(current, before, transaction, foundationSchema);
        if (rebased === current) return current;
        if (suggestionProvider) {
          rebased.forEach((suggestion, index) => {
            if (suggestion !== current[index]) void suggestionProvider.save(suggestion).catch(() => {});
          });
        }
        return [...rebased];
      });
    });
  }, [runtime, suggestionProvider]);

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
  const selectedTableElement = tableSelected
    ? runtime.surface.renderer?.mapping.nodeToDom((currentTableScope as TableGridScope).tableId) as HTMLTableElement | undefined
    : undefined;
  const atomSelected = currentAtomScope.kind === "atomic-node";
  const selectedAtomElement = atomSelected
    ? runtime.surface.renderer?.mapping.nodeToDom((currentAtomScope as { nodeId: string }).nodeId) as HTMLElement | undefined
    : undefined;
  const selectedAtomNode = atomSelected ? findNode(runtime.editor.document, (currentAtomScope as { nodeId: string }).nodeId) : null;
  // Context menu scope reduction: link no longer gets a right-click menu -
  // LinkEditorPopover (already built and wired for the toolbar's Link
  // button, per §1's investigation) auto-appears, anchored to the link's
  // own DOM bounds, whenever the caret is inside an existing link -
  // exactly the same description.marks lookup the toolbar button and the
  // old context-menu items already used to detect "is there a link here."
  const linkDescription = runtime.editor.resolveScope({ want: "describe" }) as SelectionDescription;
  const currentLinkEntry = linkDescription.marks?.find((entry) => entry.mark.type === "link");
  const selectionHead = runtime.editor.selection.head;
  const dismissedAtCurrentPosition = Boolean(linkOverlayDismissedAt)
    && linkOverlayDismissedAt!.offset === selectionHead.offset
    && linkOverlayDismissedAt!.path.length === selectionHead.path.length
    && linkOverlayDismissedAt!.path.every((part, index) => part === selectionHead.path[index]);
  const linkAnchorElement = currentLinkEntry && !linkPopover && !dismissedAtCurrentPosition
    ? (() => {
      const domPos = runtime.surface.renderer?.mapping.posToDom(selectionHead);
      const node = domPos?.node;
      const element = (node instanceof Element ? node : node?.parentElement) ?? null;
      return element?.closest<HTMLAnchorElement>("a[href]") ?? null;
    })()
    : null;

  useEffect(() => {
    if (!linkAnchorElement || !currentLinkEntry) return;
    const rect = linkAnchorElement.getBoundingClientRect();
    setLinkPopover({
      x: rect.left, y: rect.bottom + 6,
      editingExisting: true,
      href: typeof currentLinkEntry.mark.attrs?.href === "string" ? currentLinkEntry.mark.attrs.href : "",
      openInNewTab: currentLinkEntry.mark.attrs?.target === "_blank",
      collapsed: linkDescription.collapsed,
    });
    // Only the DOM element identity matters here - re-running for every
    // keystroke re-render while the caret stays inside the same link (same
    // element, new object each render otherwise) would fight the user
    // editing the popover's own fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkAnchorElement]);

  const hasLinkAtCursor = Boolean(currentLinkEntry);
  useEffect(() => {
    // Dismiss when the selection moves off the link the popover was opened
    // for - covers arrow-key navigation and any other selection change
    // that isn't itself a popover action (apply/remove/cancel already
    // clear linkPopover directly).
    if (linkPopover?.editingExisting && !hasLinkAtCursor) setLinkPopover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLinkAtCursor]);

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

  /** Shared by the prompt-based fontSize/fontFamily path and the popover-based color path below. */
  const applyMarkAttrs = (id: string, attrs: Record<string, unknown> | undefined) => {
    const declaration = inlineToolDeclarations.find((tool) => tool.id === id);
    if (!declaration || !attrs) return;
    try {
      executeMarkTool(runtime.editor, declaration, "apply", attrs);
      runtime.focus();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Invalid formatting value.");
    }
  };

  const applyAttributedMark = (id: string) => {
    const attrs = id === "fontSize"
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
    applyMarkAttrs(id, attrs);
  };

  /**
   * Phase 11.5 §2.4: ColorPickerPopover (swatch grid + hex input) replaces
   * window.prompt("#000000") for textColor/backgroundColor. Same
   * applyMarkAttrs call as before - no command-layer change. Post-batch:
   * the same popover also drives table_cell.attrs.background/textColor
   * ("cell style" the table context menu previously had none of) via
   * table.setCellAttributes instead of a mark - a different command, not
   * a different UI.
   */
  /**
   * The color picker previously always opened blank ("#000000") regardless
   * of the caret's or cell's actual current color - these compute what to
   * seed it with, read at the moment the popover opens (not re-derived
   * while it stays open, since the underlying selection/cell isn't
   * expected to change out from under an open picker).
   */
  const currentMarkColor = (markId: "textColor" | "backgroundColor"): string | undefined => {
    const description = runtime.editor.resolveScope({ want: "describe" }) as SelectionDescription;
    const value = description.marks.find((entry) => entry.mark.type === markId)?.mark.attrs?.value;
    return typeof value === "string" ? value : undefined;
  };

  const currentCellColor = (attr: "background" | "textColor"): string | undefined => {
    const scope = tableScope();
    if (!("kind" in scope) || scope.kind !== "table-grid" || !(scope as TableGridScope).cellIds.length) return undefined;
    const cell = findNode(runtime.editor.document, (scope as TableGridScope).cellIds[0]);
    const value = cell?.attrs?.[attr];
    return typeof value === "string" ? value : undefined;
  };

  const applyColor = (hex: string) => {
    if (!colorPopover) return;
    if (colorPopover.target.kind === "mark") {
      applyMarkAttrs(colorPopover.target.markId, { value: hex });
    } else {
      const attrKey = colorPopover.target.attr;
      runtime.executeOperations(
        setTableCellAttributesCommand(runtime.editor.document, tableScope(), { attrs: { [attrKey]: hex } }, blockContext()),
        { preserveSelectionById: true },
      );
      runtime.focus();
    }
    setColorPopover(null);
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

  /**
   * Phase 11.5 §2.2: drag-handle resize, calling the existing
   * setTableColumnWidthCommand/setTableRowHeightCommand - "Move row up/
   * down"/"Move column left/right" (runTable above) already had toolbar
   * buttons before this phase; resize had no UI at all. Uses the
   * currently-selected table's scope, not the boundary's own position,
   * since a resize handle can be dragged from anywhere in the table
   * without first re-selecting a specific cell.
   */
  const resizeTableColumn = (index: number, width: number, currentWidths: readonly number[]) => {
    runtime.executeOperations(
      setTableColumnWidthCommand(runtime.editor.document, tableScope(), { index, width, widths: currentWidths }, blockContext()),
      { preserveSelectionById: true },
    );
  };
  // Post-batch follow-up ("resizing a column/row disturbs the whole
  // table") - dragging an *internal* boundary now redistributes between
  // the two adjacent rows/columns (the border just moves, total table
  // size is unchanged) instead of only ever growing/shrinking the table's
  // own overall size; only the last row/column's own outer edge still
  // changes the table's total height/width. TableResizeHandles.tsx computes
  // both new sizes (clamped so neither side goes below its minimum) and
  // passes the second one here as `adjacent` - both commit as one
  // operation batch, one undo step.
  const resizeTableRow = (index: number, height: number, adjacent?: { index: number; height: number }) => {
    const context = blockContext();
    const operations = [
      ...setTableRowHeightCommand(runtime.editor.document, tableScope(), { index, height }, context),
      ...(adjacent ? setTableRowHeightCommand(runtime.editor.document, tableScope(), { index: adjacent.index, height: adjacent.height }, context) : []),
    ];
    runtime.executeOperations(operations, { preserveSelectionById: true });
  };

  /**
   * Phase 11.5 §2.3: mirrors surface/input.ts's Tab dispatch
   * (resolveShortcut) for a different contribution kind - try each
   * registered contextMenu contribution's declared scopeKinds[0], keep it
   * only if that scope actually resolves at the current selection. Unlike
   * Tab this collects every match (a menu, not a single key), and unlike
   * keyboardShortcuts, table.insertRow/insertColumn need caller-generated
   * ids a static contribution can't carry - generated here per invocation,
   * the same way Tab special-cases list.indent/outdent's dynamic params.
   */
  /**
   * Context menu scope reduction: table-only now. Marks (already on the
   * toolbar) and atom/link (moved to their own dedicated overlays -
   * MediaOverlay below, and the auto-triggered LinkEditorPopover - see
   * linkAnchorElement) no longer register contextMenu contributions at
   * all (marks/plugin.ts, atom/plugin.ts) or get hardcoded item blocks
   * here - only table plugin contributions (the generic loop) and the
   * cell-colour items remain.
   */
  const resolveContextMenuItems = (): ContextMenuItem[] => {
    const many = () => ids(128);
    const items: ContextMenuItem[] = [];
    runtime.editor.contextMenu.forEach((contribution) => {
      const wanted = contribution.scopeKinds[0];
      if (!wanted || wanted === "mixed" || wanted === "empty") return;
      const scope = runtime.editor.resolveScope({ want: wanted });
      if (!("kind" in scope) || scope.kind !== wanted) return;
      const command = runtime.editor.commands.get(contribution.commandId);
      if (!command) return;
      const position = (contribution.params as { position?: "before" | "after" } | undefined)?.position;
      // Commands like removeTableRowCommand read params.rowIndex ??
      // <fallback> - a genuinely undefined params object throws on that
      // property access (contribution.params is undefined for any static
      // contribution with no params field, e.g. removeRow/removeColumn/
      // mergeCells/removeTable), where the toolbar's equivalent buttons
      // already pass {} for exactly this reason. Matching that here was
      // the missing piece - this loop previously passed contribution.params
      // straight through.
      const params = contribution.commandId === "table.insertRow"
        ? { position, rowId: createNodeId(), cellIds: many(), paragraphIds: many() }
        : contribution.commandId === "table.insertColumn"
          ? { position, cellIds: many(), paragraphIds: many() }
          : contribution.params || {};
      items.push({
        id: contribution.id,
        label: contribution.label,
        danger: CONTEXT_MENU_DANGER_COMMANDS.has(contribution.commandId),
        onSelect: () => {
          runtime.executeOperations(command.run(runtime.editor.document, scope, params, blockContext()), { preserveSelectionById: true });
        },
      });
    });
    // "Cell style etc" - table_cell.attrs.background/textColor already
    // existed (settable via table.setCellAttributes; background was
    // rendered, textColor wasn't until this pass - see surface/
    // renderer.ts) but the table context menu had no UI for either. Same
    // ColorPickerPopover as the toolbar's text/background colour buttons,
    // routed to applyColor's "cell" branch instead of a mark.
    const tableGridScope = runtime.editor.resolveScope({ want: "table-grid" });
    if ("kind" in tableGridScope && tableGridScope.kind === "table-grid") {
      const openX = contextMenu?.x ?? 0;
      const openY = contextMenu?.y ?? 0;
      items.push(
        {
          id: "table.contextMenu.cellBackgroundColor",
          label: "Cell background colour",
          onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "cell", attr: "background" }, initialValue: currentCellColor("background") }),
        },
        {
          id: "table.contextMenu.cellTextColor",
          label: "Cell text colour",
          onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "cell", attr: "textColor" }, initialValue: currentCellColor("textColor") }),
        },
      );
    }
    return items;
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
        // Best-effort client-side check only - a UX nicety that catches an
        // obviously wrong file early, not a security boundary. A client can
        // always be bypassed, so MediaProvider.upload's real host
        // implementation MUST validate independently server-side; see the
        // doc comment on MediaProvider.upload (mediaProvider.ts).
        if (!file.type.startsWith(`${kind}/`)) {
          throw new Error(`"${file.type || "unknown type"}" does not look like a ${kind} file.`);
        }
        const result = await mediaProvider.upload(file, { signal: controller.signal });
        return { src: result.url, id: result.id };
      });
    } finally {
      pendingMediaUploads.current.delete(controller);
      URL.revokeObjectURL(preview);
    }
  };

  /**
   * Phase 11.5 §2.1: MediaManager already performed the upload (or the item
   * was already in the library) before onSelect fires, unlike
   * insertMediaFile's DefaultMediaPicker path (raw File in, pending
   * placeholder + async upload). Insert straight to "ready" - no pending
   * placeholder, no upload step to await.
   */
  const selectFromMediaManager = (item: MediaItem) => {
    setMediaKind(null);
    insertBlockAtom("block_image", {
      src: item.url, alt: item.alt || item.title || "Image", decorative: false, status: "ready",
      ...(item.width ? { width: item.width } : {}), ...(item.height ? { height: item.height } : {}),
    }, createNodeId());
  };

  const commentAuthorId = authorId || "anonymous";

  useEffect(() => {
    runtime.surface.pipeline?.setTrackChanges(trackChangesEnabled, commentAuthorId);
  }, [runtime, trackChangesEnabled, commentAuthorId]);

  const selectThread = (threadId: string) => {
    setActiveThreadId(threadId);
    setCommentPanelOpen(true);
  };

  const startComment = () => {
    const range = commentRangeFromSelection(runtime.editor.document, runtime.editor.selection);
    if (!range) return;
    setPendingCommentRange(range);
    setActiveThreadId(null);
    setCommentPanelOpen(true);
  };

  const createThread = (text: string) => {
    if (!pendingCommentRange || !commentProvider) return;
    const thread: CommentThread = {
      id: createNodeId(),
      range: pendingCommentRange,
      resolved: false,
      replies: [{ id: createNodeId(), authorId: commentAuthorId, text, createdAt: Date.now() }],
    };
    setThreads((current) => [...current, thread]);
    setPendingCommentRange(null);
    setActiveThreadId(thread.id);
    void commentProvider.save(thread).catch(() => {});
  };

  const replyToThread = (threadId: string, text: string) => {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    const updated: CommentThread = {
      ...target,
      replies: [...target.replies, { id: createNodeId(), authorId: commentAuthorId, text, createdAt: Date.now() }],
    };
    setThreads((current) => current.map((thread) => thread.id === threadId ? updated : thread));
    if (commentProvider) void commentProvider.save(updated).catch(() => {});
  };

  const setThreadResolved = (threadId: string, resolved: boolean) => {
    const target = threads.find((thread) => thread.id === threadId);
    if (!target) return;
    const updated: CommentThread = { ...target, resolved };
    setThreads((current) => current.map((thread) => thread.id === threadId ? updated : thread));
    if (commentProvider) void commentProvider.save(updated).catch(() => {});
  };

  const deleteThread = (threadId: string) => {
    setBusyThreadId(threadId);
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (activeThreadId === threadId) setActiveThreadId(null);
    const finish = () => setBusyThreadId((current) => current === threadId ? null : current);
    if (commentProvider) void commentProvider.remove(threadId).then(finish).catch(finish);
    else finish();
  };

  const canComment = !readOnly && Boolean(commentProvider)
    && Boolean(commentRangeFromSelection(runtime.editor.document, runtime.editor.selection));

  const selectSuggestion = (id: string) => {
    setActiveSuggestionId(id);
    setSuggestionPanelOpen(true);
  };

  const suggestDelete = () => {
    const scope = runtime.editor.resolveScope({ want: "inline-range" });
    if (!("kind" in scope) || scope.kind !== "inline-range" || scope.collapsed) return;
    const operations = suggestDeleteCommand(runtime.editor.document, scope, { authorId: commentAuthorId }, blockContext());
    if (operations.length) runtime.executeOperations(operations);
  };

  const startSuggestInsert = () => {
    setPendingSuggestInsertAt(runtime.editor.selection.head);
    setActiveSuggestionId(null);
    setSuggestionPanelOpen(true);
  };

  const submitSuggestInsert = (text: string) => {
    if (!pendingSuggestInsertAt) return;
    runtime.executeOperations([suggestInsertOperation(pendingSuggestInsertAt, text, { authorId: commentAuthorId })]);
    setPendingSuggestInsertAt(null);
  };

  const suggestBlockRemoval = () => {
    const owner = resolvePos(runtime.editor.document, runtime.editor.selection.head);
    const suggestion = structuralSuggestionFromNode(owner.nodeId, commentAuthorId);
    setStructuralSuggestions((current) => [...current, suggestion]);
    setActiveSuggestionId(suggestion.id);
    setSuggestionPanelOpen(true);
    if (suggestionProvider) void suggestionProvider.save(suggestion).catch(() => {});
  };

  const acceptInlineSuggestion = (id: string) => {
    const operations = acceptSuggestionCommand(runtime.editor.document, id);
    if (operations.length) runtime.executeOperations(operations);
  };

  const rejectInlineSuggestion = (id: string) => {
    const operations = rejectSuggestionCommand(runtime.editor.document, id);
    if (operations.length) runtime.executeOperations(operations);
  };

  const acceptStructural = (suggestion: StructuralSuggestion) => {
    setBusySuggestionId(suggestion.id);
    const operations = acceptStructuralSuggestionCommand(runtime.editor.document, suggestion, runtime.editor.positions);
    if (operations.length) runtime.executeOperations(operations);
    setStructuralSuggestions((current) => current.filter((entry) => entry.id !== suggestion.id));
    if (activeSuggestionId === suggestion.id) setActiveSuggestionId(null);
    const finish = () => setBusySuggestionId((current) => current === suggestion.id ? null : current);
    if (suggestionProvider) void suggestionProvider.remove(suggestion.id).then(finish).catch(finish);
    else finish();
  };

  const rejectStructural = (suggestion: StructuralSuggestion) => {
    setBusySuggestionId(suggestion.id);
    setStructuralSuggestions((current) => current.filter((entry) => entry.id !== suggestion.id));
    if (activeSuggestionId === suggestion.id) setActiveSuggestionId(null);
    const finish = () => setBusySuggestionId((current) => current === suggestion.id ? null : current);
    if (suggestionProvider) void suggestionProvider.remove(suggestion.id).then(finish).catch(finish);
    else finish();
  };

  const canSuggestDelete = (() => {
    if (readOnly || !suggestionProvider) return false;
    const scope = runtime.editor.resolveScope({ want: "inline-range" });
    return "kind" in scope && scope.kind === "inline-range" && !scope.collapsed;
  })();

  /**
   * Phase 11.5 §2.5: wires the already-tested LinkEditorPopover (previously
   * built but never imported anywhere) to the already-tested command-layer
   * link logic (editLinkCommand/resolveMarkRun, previously only reachable
   * via window.prompt). A collapsed selection with no existing link has
   * nothing to apply the mark to and no text to become the label - unlike
   * bold/italic, arming storedMarks alone would insert nothing visible, so
   * that case inserts the popover's typed display text directly with the
   * link mark attached, rather than going through executeMarkTool.
   */
  const applyLink = (value: LinkEditorApplyValue) => {
    if (!linkPopover) return;
    const tool = inlineToolDeclarations.find((entry) => entry.id === "link")!;
    const attrs = { href: value.href, ...(value.openInNewTab ? { target: "_blank" } : {}) };
    if (linkPopover.editingExisting) {
      executeMarkTool(runtime.editor, tool, "editLink", attrs);
    } else if (linkPopover.collapsed && value.text) {
      const pos = runtime.editor.selection.head;
      runtime.editor.transact((builder) => {
        builder.operations.push({ type: "insertText", pos, text: value.text!, marks: [{ type: "link", attrs }] });
        const next = { path: [...pos.path], offset: pos.offset + value.text!.length };
        builder.setSelection({ type: "text", anchor: next, head: next });
      }, { source: "toolbar", addToHistory: true });
    } else {
      executeMarkTool(runtime.editor, tool, "apply", attrs);
    }
    // Without this, the auto-trigger effect (linkAnchorElement) would see
    // the same still-a-link caret position on the very next render and
    // immediately reopen the popover that "Update" just closed.
    setLinkOverlayDismissedAt(runtime.editor.selection.head);
    runtime.focus();
    setLinkPopover(null);
  };

  const removeLink = () => {
    const tool = inlineToolDeclarations.find((entry) => entry.id === "link");
    if (tool) executeMarkTool(runtime.editor, tool, "remove");
    setLinkOverlayDismissedAt(runtime.editor.selection.head);
    runtime.focus();
    setLinkPopover(null);
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

  /** MediaOverlay's drag-corner-handle commit - explicit width/height rather than editSelectedAtom's fixed +/-20 increment. */
  const resizeSelectedAtomTo = (width: number, height: number) => {
    const scope = atomScope();
    if (scope.kind !== "atomic-node") return;
    runtime.executeOperations(
      resizeAtom(runtime.editor.document, scope, { width, height }, blockContext()),
      { historyGroup: `resize-${scope.nodeId}` },
    );
  };

  /** Same atom.delete command the removed atom.contextMenu.delete contribution used to dispatch, now called directly from MediaOverlay. */
  const deleteSelectedAtom = () => {
    const scope = atomScope();
    if (scope.kind !== "atomic-node") return;
    runtime.executeOperations(deleteAtom(runtime.editor.document, scope, {}, blockContext()));
    runtime.focus();
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
        onClick={(event) => {
          if (tool.id === "textColor" || tool.id === "backgroundColor") {
            const rect = event.currentTarget.getBoundingClientRect();
            setColorPopover({ x: rect.left, y: rect.bottom + 4, target: { kind: "mark", markId: tool.id }, initialValue: currentMarkColor(tool.id) });
          } else if (tool.id === "fontSize" || tool.id === "fontFamily") applyAttributedMark(tool.id);
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
      <button type="button" className="srte-tool-button" aria-label="Insert or edit link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
        const description = runtime.editor.resolveScope({ want: "describe" }) as SelectionDescription;
        const linkEntry = description.marks.find((entry) => entry.mark.type === "link");
        const rect = event.currentTarget.getBoundingClientRect();
        setLinkPopover({
          x: rect.left, y: rect.bottom + 4,
          editingExisting: Boolean(linkEntry),
          href: typeof linkEntry?.mark.attrs?.href === "string" ? linkEntry.mark.attrs.href : "",
          openInNewTab: linkEntry?.mark.attrs?.target === "_blank",
          collapsed: description.collapsed,
        });
      }}>Link</button>
      <button type="button" className="srte-tool-button" aria-label="Remove link" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={removeLink}>Unlink</button>
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
      <button type="button" className="srte-tool-button" aria-label="Version history" disabled={readOnly || !versionProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setVersionHistoryOpen(true)}>Version history</button>
      <button type="button" className="srte-tool-button" aria-label="Add comment" disabled={!canComment} onMouseDown={(event) => event.preventDefault()} onClick={startComment}>Add comment</button>
      <button type="button" className="srte-tool-button" aria-label="Comments" disabled={!commentProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setCommentPanelOpen((open) => !open)}>Comments</button>
      <button type="button" className="srte-tool-button" aria-label="Suggest deletion" disabled={!canSuggestDelete} onMouseDown={(event) => event.preventDefault()} onClick={suggestDelete}>Suggest deletion</button>
      <button type="button" className="srte-tool-button" aria-label="Suggest insertion" disabled={readOnly || !suggestionProvider} onMouseDown={(event) => event.preventDefault()} onClick={startSuggestInsert}>Suggest insertion</button>
      <button type="button" className="srte-tool-button" aria-label="Suggest block removal" disabled={readOnly || !suggestionProvider} onMouseDown={(event) => event.preventDefault()} onClick={suggestBlockRemoval}>Suggest block removal</button>
      <button type="button" className="srte-tool-button" aria-label="Suggestions" disabled={!suggestionProvider} onMouseDown={(event) => event.preventDefault()} onClick={() => setSuggestionPanelOpen((open) => !open)}>Suggestions</button>
      <button
        type="button" className="srte-tool-button" aria-label="Track changes" aria-pressed={trackChangesEnabled}
        title="Tracks ordinary typing and edits within a single paragraph as suggestions. Merging paragraphs together - typing over a selection that spans multiple paragraphs, or pressing Backspace/Delete at a paragraph boundary - still applies directly and can't be reviewed as a suggestion."
        disabled={readOnly || !suggestionProvider} onMouseDown={(event) => event.preventDefault()}
        onClick={() => setTrackChangesEnabled((enabled) => !enabled)}
      >Track changes</button>
      <button type="button" className="srte-tool-button" aria-label="Undo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.undo(); runtime.focus(); }}>Undo</button>
      <button type="button" className="srte-tool-button" aria-label="Redo" disabled={readOnly} onMouseDown={(event) => event.preventDefault()} onClick={() => { runtime.editor.redo(); runtime.focus(); }}>Redo</button>
    </div>
    {mediaKind === "image" && mediaManager && mediaProvider && <MediaManager
      open
      onClose={() => setMediaKind(null)}
      adapter={mediaManagerAdapter!}
      onSelect={selectFromMediaManager}
    />}
    {mediaKind && mediaProvider && !(mediaKind === "image" && mediaManager) && <MediaPicker kind={mediaKind} onPick={(file) => void insertMediaFile(mediaKind, file)} onCancel={() => setMediaKind(null)} />}
    {versionProvider && <VersionHistoryPanel
      open={versionHistoryOpen}
      onClose={() => setVersionHistoryOpen(false)}
      runtime={runtime}
      versionProvider={versionProvider}
    />}
    {commentProvider && rootRef.current && runtime.surface.renderer?.mapping && <CommentMarkers
      positions={runtime.editor.positions}
      mapping={runtime.surface.renderer.mapping}
      containerElement={rootRef.current}
      threads={threads}
      activeThreadId={activeThreadId}
      onSelectThread={selectThread}
    />}
    {commentProvider && <CommentThreadPanel
      open={commentPanelOpen}
      onClose={() => { setCommentPanelOpen(false); setPendingCommentRange(null); }}
      threads={threads}
      activeThreadId={activeThreadId}
      onSelectThread={selectThread}
      pendingRange={pendingCommentRange}
      onCreateThread={createThread}
      onReply={replyToThread}
      onResolve={setThreadResolved}
      onDelete={deleteThread}
      busyThreadId={busyThreadId}
    />}
    {suggestionProvider && rootRef.current && runtime.surface.renderer?.mapping && <StructuralSuggestionMarkers
      positions={runtime.editor.positions}
      mapping={runtime.surface.renderer.mapping}
      containerElement={rootRef.current}
      suggestions={structuralSuggestions}
      activeSuggestionId={activeSuggestionId}
      onSelectSuggestion={selectSuggestion}
    />}
    {suggestionProvider && <SuggestionPanel
      open={suggestionPanelOpen}
      onClose={() => { setSuggestionPanelOpen(false); setPendingSuggestInsertAt(null); }}
      document={runtime.editor.document}
      structuralSuggestions={structuralSuggestions}
      activeId={activeSuggestionId}
      onSelect={selectSuggestion}
      pendingInsert={Boolean(pendingSuggestInsertAt)}
      onSubmitInsert={submitSuggestInsert}
      onAcceptInline={acceptInlineSuggestion}
      onRejectInline={rejectInlineSuggestion}
      onAcceptStructural={acceptStructural}
      onRejectStructural={rejectStructural}
      busyId={busySuggestionId}
    />}
    {linkPopover && <LinkEditorPopover
      x={linkPopover.x}
      y={linkPopover.y}
      initialHref={linkPopover.href}
      initialOpenInNewTab={linkPopover.openInNewTab}
      showTextInput={linkPopover.collapsed && !linkPopover.editingExisting}
      showRemove={linkPopover.editingExisting}
      onApply={applyLink}
      onRemove={removeLink}
      onCancel={() => {
        setLinkOverlayDismissedAt(runtime.editor.selection.head);
        setLinkPopover(null);
        runtime.focus();
      }}
    />}
    {!readOnly && atomSelected && selectedAtomElement && <MediaOverlay
      atomElement={selectedAtomElement}
      alt={typeof selectedAtomNode?.attrs?.alt === "string" ? selectedAtomNode.attrs.alt : ""}
      width={typeof selectedAtomNode?.attrs?.width === "number" ? selectedAtomNode.attrs.width : undefined}
      height={typeof selectedAtomNode?.attrs?.height === "number" ? selectedAtomNode.attrs.height : undefined}
      src={typeof selectedAtomNode?.attrs?.src === "string" ? selectedAtomNode.attrs.src : undefined}
      onEdit={() => editSelectedAtom()}
      onResize={(by) => editSelectedAtom(by)}
      onResizeTo={resizeSelectedAtomTo}
      onDelete={deleteSelectedAtom}
      onDismiss={() => runtime.focus()}
    />}
    {colorPopover && <ColorPickerPopover
      x={colorPopover.x}
      y={colorPopover.y}
      label={colorPopover.target.kind === "mark"
        ? (colorPopover.target.markId === "textColor" ? "Text colour" : "Background colour")
        : (colorPopover.target.attr === "textColor" ? "Cell text colour" : "Cell background colour")}
      {...(colorPopover.initialValue ? { initialValue: colorPopover.initialValue } : {})}
      onApply={applyColor}
      onCancel={() => { setColorPopover(null); runtime.focus(); }}
    />}
    {!readOnly && selectedTableElement && <TableResizeHandles
      tableElement={selectedTableElement}
      onResizeColumn={resizeTableColumn}
      onResizeRow={resizeTableRow}
    />}
    {contextMenu && <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      items={resolveContextMenuItems()}
      onDismiss={() => { setContextMenu(null); runtime.focus(); }}
    />}
    <div
      ref={rootRef}
      className="srte-editor"
      data-placeholder={placeholder}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-label="Smart RTE editing surface"
      aria-multiline="true"
      onMouseDown={(event) => {
        // A Ctrl/Cmd+click on a link is meant to open it (onClick below),
        // not move the caret into it - but native mousedown's own default
        // action *is* the caret-repositioning, and mousedown fires (and
        // its default action resolves) before click ever does. Blocking
        // it here means the caret never enters the link for this
        // gesture, so the auto-triggered edit overlay (which keys off
        // exactly that) never gets a reason to open in the first place -
        // root-caused at the source rather than racing a flag against
        // it after the fact. (A flag set in onClick was tried first and
        // proved unreliable: by the time onClick ran, Chromium/Firefox/
        // WebKit had already carried the caret-move through to a
        // completed render in a varying number of passes, so the overlay
        // could already be open before the flag was ever set.)
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        if (anchor && (event.metaKey || event.ctrlKey)) event.preventDefault();
      }}
      onClick={(event) => {
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        if (!anchor || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        window.open(anchor.href, "_blank", "noopener,noreferrer");
      }}
      onContextMenu={(event) => {
        if (readOnly) return;
        event.preventDefault();
        // Atom selection (unlike caret/text placement) is not native
        // browser behavior - it's InputController's own clickListener
        // (surface/input.ts), bound to the "click" DOM event, which never
        // fires for a right-click. Without this, right-clicking an atom
        // directly (no preceding left-click) left whatever selection was
        // already there in place, so atomic-node scope never resolved and
        // MediaOverlay (which shows whenever atomSelected is true) never
        // appeared - right-clicking media looked like right-clicking
        // nothing. Mirrors clickListener's own atom-selection logic
        // exactly.
        const atomTarget = (event.target as Element | null)?.closest<HTMLElement>("[data-smart-atomic]");
        const mapped = atomTarget ? runtime.surface.renderer?.mapping.domToNode(atomTarget) : null;
        if (mapped && !isTextNode(mapped.node) && runtime.editor.schema.nodes[mapped.node.type]?.selectable === true) {
          const range = runtime.editor.positions.rangeOf(mapped.nodeId);
          if (range) {
            runtime.editor.setSelection({ type: "node", anchor: range.from, head: range.to }, { source: "api" });
            runtime.surface.renderer?.render(runtime.editor.document, runtime.editor.selection);
          }
        } else if (isCollapsedTextSelection(runtime.editor.selection)) {
          // Chromium/Firefox reposition the native caret to the click
          // point on a bare right-click, the same as a left-click - the
          // context menu items resolved against runtime.editor.selection
          // afterward were already scoped correctly there. WebKit does
          // not: a right-click leaves the previous selection untouched,
          // so scope resolution (and, before the marksForRange fix above,
          // an unrelated bug in it too) saw stale state instead of what
          // was actually clicked. Explicitly resolving the caret from the
          // click point - the same caretPositionFromPoint/caretRangeFromPoint
          // + mapping.domToPos pattern InputController's own
          // selectionForPoint already uses for drag/drop - makes this
          // right-click path correct on every engine instead of relying
          // on inconsistent native behavior. Only when the selection was
          // already collapsed - right-clicking a deliberately selected
          // range (e.g. to apply Bold from the menu) must never collapse
          // it out from under the user, matching standard context-menu
          // convention (this is what "right-click here does something
          // useful to my selection" depends on).
          const pointDocument = event.currentTarget.ownerDocument as Document & {
            caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
            caretRangeFromPoint?: (x: number, y: number) => Range | null;
          };
          const caret = pointDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
          const fallback = !caret ? pointDocument.caretRangeFromPoint?.(event.clientX, event.clientY) : null;
          const pos = caret ? runtime.surface.renderer?.mapping.domToPos(caret.offsetNode, caret.offset)
            : fallback ? runtime.surface.renderer?.mapping.domToPos(fallback.startContainer, fallback.startOffset) : null;
          if (pos) {
            runtime.editor.setSelection({ type: "text", anchor: pos, head: pos }, { source: "api" });
            runtime.surface.renderer?.render(runtime.editor.document, runtime.editor.selection);
          }
        }
        // Table-only now (context menu scope reduction) - media/link moved
        // to their own dedicated overlays, marks live on the toolbar only.
        // A right-click that doesn't resolve to a table cell opens nothing
        // at all, rather than an empty "No actions here" menu.
        const rightClickTableScope = runtime.editor.resolveScope({ want: "table-grid" });
        if ("kind" in rightClickTableScope && rightClickTableScope.kind === "table-grid") {
          setContextMenu({ x: event.clientX, y: event.clientY });
        }
      }}
      style={{ minHeight, maxHeight, overflow: "auto" }}
    />
  </section>;
});
