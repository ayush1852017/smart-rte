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
  reportMarkApplication,
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
import { TableSizePickerPopover } from "./TableSizePickerPopover.js";
import { FormulaLibraryPopover } from "./FormulaLibraryPopover.js";
import { SpecialCharacterPopover } from "./SpecialCharacterPopover.js";
import { TableBorderPopover, BORDER_WIDTH_PRESETS, type BorderDraft, type BorderSides, type BorderStyle } from "./TableBorderPopover.js";
import { BlockquoteBorderPopover, type BlockquoteBorderDraft } from "./BlockquoteBorderPopover.js";
import type { FormulaLibraryEntry } from "../formulaLibrary.js";
import { TableResizeHandles } from "./TableResizeHandles.js";
import { MediaOverlay } from "./MediaOverlay.js";
import { MediaDetailsPopover, type MediaDetailsDraft } from "./MediaDetailsPopover.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { ToolbarButton, ToolbarDropdown, ToolbarGroup, ToolbarMenuItem, MobileMoreMenu } from "./ToolbarPrimitives.js";
import type { EditorCapabilityPreset } from "../capabilityPresets.js";
import { resolveToolbarTools, type ToolbarTools } from "../toolbarTools.js";
import { exportDocxDocument, importStyledDocxDocument, importPdfDocument } from "smartrte-core/foundation";
import { printSmartDocumentAsPdf } from "../adapters/pdfPrint.js";
import {
  CanonicalEditorRuntime,
  type SmartEditorChange,
  type SmartEditorCheckpoint,
  type SmartEditorHandle,
} from "../canonicalEditorRuntime.js";

export interface CanonicalAuthorityEditorProps {
  /** Initial value only. Later replacements must use SmartEditorHandle.replaceValue. */
  defaultValue?: string | PersistedEditorDocument;
  /**
   * Which built-in plugins this instance is constructed with - see
   * capabilityPresets.ts. Construction-time only, matching `defaultValue`'s
   * own uncontrolled-after-mount contract (the underlying runtime is
   * created once and retained; changing this prop on an already-mounted
   * instance has no effect). Defaults to "full" - every existing consumer
   * that never sets this is unaffected.
   */
  preset?: EditorCapabilityPreset;
  onChange?: (change: SmartEditorChange) => void;
  /** Transitional serialization callback for hosts that still persist HTML. */
  onHtmlChange?: (html: string) => void;
  /**
   * Bakes real KaTeX-rendered HTML into onHtmlChange's formula elements
   * instead of leaving them as empty placeholders - see
   * canonicalEditorRuntime.ts's CanonicalEditorRuntimeOptions for the full
   * rationale. Construction-time only, same contract as `preset`.
   */
  renderFormulaHtml?: boolean;
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
  /**
   * Per-tool toolbar visibility - "developers should be able to hide tools
   * which are not for their use" (docs/bugs/per-tool-toolbar-visibility.md).
   * Every tool defaults to visible; a host only needs to name the ones they
   * want off (`tools={{ video: false, versionHistory: false }}`). Composes
   * with, never overrides, the deeper existing gates: a tool whose required
   * provider is absent (`versionProvider`/`commentProvider`/
   * `suggestionProvider`/`mediaProvider`) or whose plugin was excluded via
   * `preset` (e.g. `insertTable` under `preset="simple"`) still won't
   * render even if explicitly set to `true` here - see ToolbarTools.ts's
   * own doc comment for the full contract and scoping decisions.
   */
  tools?: Partial<ToolbarTools>;
  /** Host-owned save/list/load/remove boundary for document version history. */
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

/**
 * Recently-used colors are bucketed by "text-like" vs "background-like"
 * rather than by the 4 exact target shapes (mark.textColor, mark.
 * backgroundColor, cell.textColor, cell.background) - a user picking "our
 * brand navy" almost always means the same thing whether it's landing on a
 * text selection or a table cell, and a combined-across-everything list
 * would mix genuinely different intents (a text color next to a page
 * background color) into one row. In-memory only, for the current editor
 * instance's lifetime: this project has no existing pattern for persisting
 * light UI preference state across sessions (no localStorage/sessionStorage
 * usage anywhere in the codebase), and building new persistence
 * infrastructure for this one feature would be disproportionate.
 */
const RECENT_COLOR_LIMIT = 4;
type ColorBucket = "text" | "background" | "border";
const colorBucketFor = (target: { kind: "mark"; markId: "textColor" | "backgroundColor" } | { kind: "cell"; attr: "background" | "textColor" } | { kind: "blockquote"; attr: "backgroundColor" | "textColor" }): ColorBucket =>
  target.kind === "mark" ? (target.markId === "textColor" ? "text" : "background")
    : target.attr === "textColor" ? "text" : "background";

/**
 * table_cell's border attrs (schema.ts: legacy uniform `borders`, plus
 * per-side `borderTop`/`borderRight`/`borderBottom`/`borderLeft` overrides
 * added for the "Border options" popover's per-side control) are free-form
 * CSS border shorthand strings, already rendered (surface/renderer.ts) and
 * round-tripped through HTML/DOCX. These compose/parse the one shape this
 * UI itself ever writes ("{width}px {style} {hex}") - a value pasted in some
 * other shape still renders fine (the renderer applies the raw string
 * unconditionally) but won't round-trip through these two helpers, which is
 * fine: they exist only to seed/update this UI's own controls, not to be a
 * general CSS border parser.
 */
const composeBorderShorthand = (widthPx: number, style: BorderStyle, hex: string): string => `${widthPx}px ${style} ${hex}`;
const parseBorderShorthand = (value: unknown): { widthPx: number; style: BorderStyle; hex: string } | null => {
  if (typeof value !== "string") return null;
  const width = /(\d+(?:\.\d+)?)\s*px/.exec(value);
  const color = /#[0-9a-f]{3,8}\b/i.exec(value);
  if (!width || !color) return null;
  const styleMatch = /\b(solid|dashed|dotted)\b/i.exec(value);
  return { widthPx: Number(width[1]), style: (styleMatch?.[1].toLowerCase() as BorderStyle | undefined) ?? "solid", hex: color[0].toLowerCase() };
};

const isCollapsedTextSelection = (selection: SmartSelection): boolean =>
  selection.type === "text" && selection.anchor.offset === selection.head.offset
    && selection.anchor.path.length === selection.head.path.length
    && selection.anchor.path.every((part, index) => part === selection.head.path[index]);

export const CanonicalAuthorityEditor = forwardRef<SmartEditorHandle, CanonicalAuthorityEditorProps>(function CanonicalAuthorityEditor({
  defaultValue,
  preset,
  renderFormulaHtml,
  onChange,
  onHtmlChange,
  onClipboardDiagnostic,
  mediaProvider,
  mediaPicker: MediaPicker = DefaultMediaPicker,
  mediaManager = true,
  tools,
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
    // True when the popover opened itself because the caret merely entered
    // an existing link (see linkAnchorElement below), not because the user
    // asked to edit it - autofocusing the href input in that case steals
    // focus from the editor on every ordinary click/caret-move into a link,
    // defeating the whole point of this overlay not trapping the cursor.
    autoTriggered?: boolean;
  } | null>(null);
  const [colorPopover, setColorPopover] = useState<{
    x: number; y: number;
    // The cell case captures the actual TableGridScope (cell IDs) at the
    // moment the context-menu item is clicked, rather than having
    // applyColorToTarget re-resolve `tableScope()` live at preview/commit
    // time - a real, WebKit-specific race found during verification: an
    // async `selectionchange` (delivered late, the same class of issue as
    // docs/bugs/home-end-key-stale-selection-race-after-click.md) can land
    // between the popover opening and the user staging a color, resolving
    // the live selection away from the table entirely - see
    // docs/bugs/color-picker-cell-target-recomputed-live-race.md.
    // The blockquote case captures the blockquote's own node id at click
    // time, same discipline as the cell case's scope capture above (and
    // for the same reason - an async selectionchange landing between
    // open and stage must not retarget which blockquote gets styled).
    target: { kind: "mark"; markId: "textColor" | "backgroundColor" } | { kind: "cell"; attr: "background" | "textColor"; scope: TableGridScope } | { kind: "blockquote"; attr: "backgroundColor" | "textColor"; blockId: string };
    initialValue?: string;
  } | null>(null);
  const [recentColors, setRecentColors] = useState<{ text: string[]; background: string[]; border: string[] }>({ text: [], background: [], border: [] });
  /**
   * "Let both bullet and number list tool icon work as toggle and on click
   * text should [adopt] respective preset list" - the plain Bulleted
   * list/Numbered list buttons always applied a generic disc/decimal
   * marker, ignoring whatever glyph preset (e.g. "❖ ➢ ■") the user had
   * already picked from the "List preset" dropdown elsewhere in the same
   * session. Session-only React state, matching recentColors' own
   * documented "no localStorage" convention above - not persisted across
   * reloads.
   */
  const [lastListPreset, setLastListPreset] = useState<{ bullet: string | null; ordered: string | null }>({ bullet: null, ordered: null });
  const [tableSizePopover, setTableSizePopover] = useState<{ x: number; y: number } | null>(null);
  const [tableBorderPopover, setTableBorderPopover] = useState<{ x: number; y: number; scope: TableGridScope; initial: BorderDraft } | null>(null);
  const [blockquoteBorderPopover, setBlockquoteBorderPopover] = useState<{ x: number; y: number; blockId: string; initial: BlockquoteBorderDraft } | null>(null);
  const [mediaDetailsPopover, setMediaDetailsPopover] = useState<{ x: number; y: number; scope: ResolvedScope; initial: MediaDetailsDraft } | null>(null);
  const borderPreviewCheckpointRef = useRef<SmartEditorCheckpoint | null>(null);
  const blockquoteBorderPreviewCheckpointRef = useRef<SmartEditorCheckpoint | null>(null);
  const [formulaLibraryPopover, setFormulaLibraryPopover] = useState<{ x: number; y: number } | null>(null);
  const [specialCharPopover, setSpecialCharPopover] = useState<{ x: number; y: number } | null>(null);
  const [recentSpecialChars, setRecentSpecialChars] = useState<string[]>([]);
  // Set once the native color input's first live-preview frame fires for
  // the currently-open popover, cleared on commit/cancel - lets both paths
  // tell "a preview is in progress that needs to be unwound" from "the user
  // never touched the native input at all" (the latter needs no unwinding,
  // since nothing was ever applied to the model).
  const colorPreviewCheckpointRef = useRef<SmartEditorCheckpoint | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [mediaContextMenu, setMediaContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [mediaResizeTarget, setMediaResizeTarget] = useState<{ nodeId: string } | null>(null);
  // Tracks the exact caret position (path+offset) the link overlay was
  // last dismissed at (Escape/outside click) - suppresses an instant
  // re-popup while the caret hasn't moved, without needing a separate
  // "is this the same link" identity check. Cleared implicitly the moment
  // selection.head differs from this value.
  const [linkOverlayDismissedAt, setLinkOverlayDismissedAt] = useState<{ path: number[]; offset: number } | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new CanonicalEditorRuntime({ initialValue: defaultValue, preset, renderFormulaHtml, onChange, onHtmlChange, onClipboardDiagnostic });
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
  /**
   * `SelectionDescription` (resolveScope({want:"describe"})) tracks mark
   * coverage (markCoverage below) but has no equivalent for block
   * *attributes* - `blockTypes` is the closest thing, and it's just node
   * types, not attrs. This mirrors foundation/block/commands.ts's own
   * (core-internal, not exported) blockScopes/selectedBlockIds traversal -
   * a "mixed" scope is a caret/selection spanning more than one real
   * block-range part (e.g. a paragraph plus a list item), each of which
   * carries its own blockIds.
   */
  const selectedLineHeightBlockIds = (scope: ResolvedScope): string[] => {
    const collect = (candidate: ResolvedScope): string[] =>
      candidate.kind === "block-range" ? candidate.blockIds
        : candidate.kind === "mixed" ? candidate.parts.flatMap(collect)
          : [];
    return [...new Set(collect(scope))];
  };
  /** `undefined` = no block selected/no override anywhere, a number = every selected block shares that exact value, `"mixed"` = selected blocks disagree - same three-state shape as markCoverage's boolean|"mixed"|undefined. */
  const currentLineHeight = (): number | "mixed" | undefined => {
    const ids = selectedLineHeightBlockIds(blockScope());
    if (!ids.length) return undefined;
    const values = ids.map((id) => {
      const value = findNode(runtime.editor.document, id)?.attrs?.lineHeight;
      return typeof value === "number" ? value : undefined;
    });
    const unique = [...new Set(values)];
    return unique.length === 1 ? unique[0] : "mixed";
  };
  const setLineHeight = (value: number | undefined) =>
    transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { lineHeight: value } }, blockContext()));
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
  // Whether the "table" plugin was included when this instance was
  // constructed (see capabilityPresets.ts's "simple" preset) - the toolbar
  // JSX is hand-authored, not driven by the plugin registry's own toolbar
  // contributions the way the context menu already is, so this needs an
  // explicit check to hide table-insertion UI for a schema that can't
  // represent tables at all. Existing content containing a table, loaded
  // under a schema without the table plugin, still round-trips safely as
  // an `unknown` node (Phase 10's disable-safety contract, unchanged) -
  // this only hides the *toolbar affordance* for creating new ones.
  const tablesEnabled = Boolean(runtime.editor.schema.nodes.table);
  // Per-tool toolbar visibility (toolbarTools.ts) - `tools` is a pure
  // UI-visibility layer, composed with (never overriding) the deeper
  // existing gates below: a required provider being absent, or a plugin
  // having been excluded via `preset`, still wins even if a tool is
  // explicitly left enabled here.
  const t = resolveToolbarTools(tools);
  const showInsertTable = t.insertTable && tablesEnabled;
  const showImageTool = t.image && Boolean(mediaProvider);
  const showVideoTool = t.video && Boolean(mediaProvider);
  const showAudioTool = t.audio && Boolean(mediaProvider);
  const showVersionHistoryTool = t.versionHistory && Boolean(versionProvider);
  const showCommentsTool = t.comments && Boolean(commentProvider);
  const showSuggestionsTool = t.suggestions && Boolean(suggestionProvider);
  const tableSelected = currentTableScope.kind === "table-grid";
  const selectedTableElement = tableSelected
    ? runtime.surface.renderer?.mapping.nodeToDom((currentTableScope as TableGridScope).tableId) as HTMLTableElement | undefined
    : undefined;
  const atomSelected = currentAtomScope.kind === "atomic-node";
  const selectedAtomElement = atomSelected
    ? runtime.surface.renderer?.mapping.nodeToDom((currentAtomScope as { nodeId: string }).nodeId) as HTMLElement | undefined
    : undefined;
  const selectedAtomNode = atomSelected ? findNode(runtime.editor.document, (currentAtomScope as { nodeId: string }).nodeId) : null;
  // A divider (<hr>) or page break is atomic/selectable (so ordinary caret/
  // Backspace/Delete behavior around it works, and the toolbar's "Delete
  // selected atom" button applies to it), but neither has any src/alt/
  // width/height at all - MediaOverlay and the media-specific Edit/Resize
  // actions assume every atom is a real media item, and unconditionally
  // showing them for one of these surfaced nonsensical empty/undefined
  // values with no sensible edit or resize target. Media-only UI is gated
  // on this instead of plain atomSelected; delete stays available for any
  // atom.
  const mediaAtomSelected = atomSelected && selectedAtomNode?.type !== "divider" && selectedAtomNode?.type !== "page_break";
  // Formula (like divider above) has no width/height concept - KaTeX sizes
  // its own rendering from the source/font-size, not stored dimensions, so
  // "Enlarge/Shrink selected media" and MediaOverlay's resize handle had no
  // real effect other than silently persisting meaningless width/height
  // attrs onto the formula node (see
  // docs/bugs/formula-resize-controls-shown-for-non-resizable-atom.md).
  // Edit/Delete stay available - editSelectedAtom already branches on
  // node.type.includes("formula") for its own correct "Formula source"
  // prompt.
  const resizableAtomSelected = mediaAtomSelected && selectedAtomNode?.type !== "formula" && selectedAtomNode?.type !== "block_formula";
  // A divider/page break has no editable field and no width/height, but it
  // is still a real, selectable, deletable atom - right-clicking one should
  // surface the same kind of Delete-only action menu formula already gets
  // (docs/bugs/horizontal-line-not-visibly-selectable.md), not the silence
  // `mediaAtomSelected` alone produces (that flag exists to hide fields
  // that don't apply, not to hide a delete affordance entirely).
  const actionOnlyAtomSelected = atomSelected && (selectedAtomNode?.type === "divider" || selectedAtomNode?.type === "page_break");
  const selectedAtomId = atomSelected && "nodeId" in currentAtomScope ? currentAtomScope.nodeId : null;
  useEffect(() => {
    if (mediaContextMenu && (!(mediaAtomSelected || actionOnlyAtomSelected) || mediaContextMenu.nodeId !== selectedAtomId)) setMediaContextMenu(null);
  }, [mediaContextMenu, mediaAtomSelected, actionOnlyAtomSelected, selectedAtomId]);
  useEffect(() => {
    if (mediaResizeTarget && (!mediaAtomSelected || mediaResizeTarget.nodeId !== selectedAtomId)) setMediaResizeTarget(null);
  }, [mediaResizeTarget, mediaAtomSelected, selectedAtomId]);
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
      autoTriggered: true,
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
  /**
   * Nearest enclosing blockquote ancestor of `pos` (defaulting to the
   * current selection head), or undefined outside one. For a nested
   * blockquote this resolves to the innermost one - shared by the toggle
   * button's active state, the toggle command itself, the right-click
   * gate, and the blockquote styling context-menu items below, so all
   * four can never drift apart on "which blockquote is this."
   */
  const findBlockquoteAncestor = (pos: SmartPos = runtime.editor.selection.head) =>
    [...runtime.editor.resolve({ pos }).ancestors].reverse().find((node) => node.type === "blockquote");
  const currentBlockquoteActive = Boolean(findBlockquoteAncestor());
  /** A synthetic block-range scope targeting exactly one blockquote node's own id - the shape setBlockAttributes/wrapBlocks/unwrapBlocks all expect. */
  const blockquoteScopeFor = (blockId: string, pos: SmartPos): ResolvedScope => ({
    kind: "block-range",
    blockIds: [blockId],
    promotedFromPartial: false,
    commonParentId: null,
    range: { from: pos, to: pos },
    isolatingAncestorId: null,
    clamped: false,
  });
  const currentListPreset = currentListParts.length === 1 && typeof rootList?.attrs?.preset === "string"
    ? rootList.attrs.preset
    : "";
  // The Bulleted/Numbered list buttons' own split-control style pickers -
  // scoped to one kind each, so unlike the shared "List preset" select above
  // (which lists both kinds together) each only shows/reflects presets of
  // its own kind, and reads as unset (native placeholder) when the active
  // preset (if any) belongs to the other kind.
  const currentBulletPreset = SMART_LIST_PRESETS.find((preset) => preset.id === currentListPreset)?.kind === "bullet" ? currentListPreset : "";
  const currentOrderedPreset = SMART_LIST_PRESETS.find((preset) => preset.id === currentListPreset)?.kind === "ordered" ? currentListPreset : "";

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

  // A list's "current style" the toggle buttons care about (bullet vs.
  // ordered) can come from either a literal .attrs.style (disc/decimal, what
  // these buttons themselves write) *or* a .attrs.preset (bullet-diamond,
  // ordered-upper-alpha, etc. - the preset dropdown clears .attrs.style when
  // setting one, see docs/bugs/list-marker-competing-style-and-preset-signals.md).
  // Comparing raw strings only ever matched the literal case - after picking
  // a preset, every toggle button read as "not active" (style is unset) even
  // though the list still visually is a bullet/ordered list, so the first
  // click on the matching button silently replaced the preset with a bare
  // disc/decimal instead of removing the list, and only a *second* click
  // actually toggled it off. Comparing by kind (bullet/ordered) instead
  // fixes both the toolbar's own pressed-state display and the toggle
  // decision in one place, so they can't drift apart from each other again.
  const BULLET_LIST_STYLES = new Set(["disc", "circle", "square"]);
  const listActiveKind = (list?: SmartElementNode | null): "bullet" | "ordered" | undefined => {
    if (typeof list?.attrs?.style === "string") return BULLET_LIST_STYLES.has(list.attrs.style) ? "bullet" : "ordered";
    if (typeof list?.attrs?.preset === "string") return SMART_LIST_PRESETS.find((preset) => preset.id === list.attrs?.preset)?.kind;
    return undefined;
  };

  // Shared by the toggle buttons' click handler and their aria-pressed state,
  // so "this button looks active" and "clicking it again removes the list"
  // can never drift apart. Checked against the outermost list (see
  // outermostListId) so a deeply nested cursor still reports the true
  // whole-list state, matching what applying a new type would change.
  const listStyleActive = (style: string, checkable = false) =>
    listActiveKind(rootList) === (style === "decimal" ? "ordered" : "bullet") && Boolean(rootList?.attrs?.checkable) === checkable;

  const toggleList = (style: string, checkable = false) => {
    const selectedList = listScope();
    const context = blockContext();
    // A checklist's marker is a checkbox, not a bullet/number glyph - never
    // substitute a remembered preset for it. Otherwise, reapply whichever
    // preset the user last picked from the "List preset" dropdown for this
    // same kind (bullet/ordered), instead of always resetting to the
    // generic disc/decimal marker - see lastListPreset's own doc comment.
    // setListStyle's own params type has no `preset` field (it's a
    // deliberately distinct command from setListPreset - see setListPreset
    // itself clearing `style` and vice versa), so this is a real branch,
    // not just a differently-shaped params object.
    const rememberedPreset = checkable ? null : lastListPreset[style === "decimal" ? "ordered" : "bullet"];
    if (selectedList.kind === "list-selection") {
      const rootId = outermostListId(selectedList.listId);
      const list = findNode(runtime.editor.document, rootId);
      const sameStyle = listActiveKind(list) === (style === "decimal" ? "ordered" : "bullet") && Boolean(list?.attrs?.checkable) === checkable;
      const target = { ...selectedList, listId: rootId };
      const operations = sameStyle
        // Toggling an already-active style off is deliberately scoped to just
        // the current item (selectedList), not the whole list.
        ? unwrapList(runtime.editor.document, selectedList, { splitListIds: ids(4) }, context)
        // Applying a genuinely different style/type is a whole-list decision
        // regardless of how deep the cursor is nested.
        : rememberedPreset
          ? setListPreset(runtime.editor.document, target, { preset: rememberedPreset }, context)
          : setListStyle(runtime.editor.document, target, { style, checkable }, context);
      runtime.executeOperations(operations, { preserveSelectionById: true });
      return;
    }
    const selectedBlocks = blockScope();
    const count = selectedBlocks.kind === "block-range" ? selectedBlocks.blockIds.length : 1;
    // Nesting reconstruction (see createList) can need up to one extra list
    // per block, on top of one list per originally-flat contiguous group —
    // over-provision generously rather than compute the exact worst case.
    runtime.executeOperations(createList(runtime.editor.document, selectedBlocks, {
      listIds: ids(Math.max(1, count * 2)), itemIds: ids(Math.max(1, count)), checkable,
      ...(rememberedPreset ? { preset: rememberedPreset } : { style }),
    }, context), { preserveSelectionById: true });
  };

  /**
   * The Bulleted/Numbered list buttons' own split-control style picker
   * (a native `<select>`, not a custom-positioned dropdown - see the
   * `.srte-split-control` styling) - lets the user choose a specific preset
   * directly from the button itself, instead of only ever getting the
   * plain/remembered default from a click and having to visit the separate
   * "More list tools" menu to pick a named style. Applies to an existing
   * list (whole-list, like the shared "List preset" select) or creates a
   * brand-new list with that preset when nothing is selected yet - unlike
   * that shared select, which only ever edits an already-existing list.
   * Scope is resolved fresh here (not from the outer currentListScope/
   * currentListParts consts) to match toggleList's own convention of
   * re-resolving at click time rather than trusting a render-time snapshot.
   */
  const applyListPreset = (preset: string) => {
    const pickedKind = SMART_LIST_PRESETS.find((candidate) => candidate.id === preset)?.kind;
    const selectedList = listScope();
    const context = blockContext();
    if (selectedList.kind === "list-selection") {
      const parts = listSelectionParts(selectedList);
      if (parts.length !== 1) return;
      const rootId = outermostListId(parts[0].listId);
      runtime.executeOperations(setListPreset(runtime.editor.document, { ...parts[0], listId: rootId }, { preset }, context), { preserveSelectionById: true });
    } else {
      const selectedBlocks = blockScope();
      const count = selectedBlocks.kind === "block-range" ? selectedBlocks.blockIds.length : 1;
      runtime.executeOperations(createList(runtime.editor.document, selectedBlocks, {
        listIds: ids(Math.max(1, count * 2)), itemIds: ids(Math.max(1, count)), checkable: false, preset,
      }, context), { preserveSelectionById: true });
    }
    if (pickedKind) setLastListPreset((previous) => ({ ...previous, [pickedKind]: preset }));
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
  const applyMarkAttrs = (id: string, attrs: Record<string, unknown> | undefined, options: { addToHistory?: boolean } = {}) => {
    const declaration = inlineToolDeclarations.find((tool) => tool.id === id);
    if (!declaration || !attrs) return;
    try {
      executeMarkTool(runtime.editor, declaration, "apply", attrs, options);
      // Skipped during a live preview (addToHistory: false) - see the
      // matching comment in canonicalEditorRuntime.ts's executeOperations,
      // same reasoning: focusing the main editor mid-drag would steal focus
      // away from the color popover's own native input.
      if (options.addToHistory ?? true) runtime.focus();
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

  const currentBlockquoteColor = (blockId: string, attr: "backgroundColor" | "textColor"): string | undefined => {
    const value = findNode(runtime.editor.document, blockId)?.attrs?.[attr];
    return typeof value === "string" ? value : undefined;
  };

  /** Blockquote's *effective* left border (only one side exists, unlike table_cell's 4 - no `sides` toggle concept needed at all). */
  const currentBlockquoteBorderDraft = (blockId: string): BlockquoteBorderDraft => {
    const value = findNode(runtime.editor.document, blockId)?.attrs?.borderLeft;
    const parsed = parseBorderShorthand(value);
    return { style: parsed?.style ?? "solid", widthPx: parsed?.widthPx ?? BORDER_WIDTH_PRESETS[0].px, hex: parsed?.hex ?? "#000000" };
  };

  const CELL_BORDER_SIDE_KEYS = { top: "borderTop", right: "borderRight", bottom: "borderBottom", left: "borderLeft" } as const;

  /** Reads the cell's *effective* per-side border (a side's own override, falling back to the legacy uniform `borders` value) to seed the Border options popover. */
  const currentCellBorderDraft = (scope: ResolvedScope): BorderDraft => {
    const cell = scope.kind === "table-grid" && (scope as TableGridScope).cellIds.length
      ? findNode(runtime.editor.document, (scope as TableGridScope).cellIds[0]) : null;
    const resolvedSide = (side: keyof BorderSides): unknown => cell?.attrs?.[CELL_BORDER_SIDE_KEYS[side]] ?? cell?.attrs?.borders;
    const sides: BorderSides = { top: resolvedSide("top") !== undefined, right: resolvedSide("right") !== undefined, bottom: resolvedSide("bottom") !== undefined, left: resolvedSide("left") !== undefined };
    const firstSetValue = (["top", "right", "bottom", "left"] as const).map(resolvedSide).find((value) => value !== undefined);
    const parsed = parseBorderShorthand(firstSetValue);
    return { sides, style: parsed?.style ?? "solid", widthPx: parsed?.widthPx ?? BORDER_WIDTH_PRESETS[0].px, hex: parsed?.hex ?? "#000000" };
  };

  /** Applies a Border options draft to `scope`'s cell(s): a toggled-on side gets the composed shorthand, a toggled-off side has its per-side override cleared (falling back to no border on that side, unless the legacy uniform `borders` still has a value - a pre-existing pasted uniform border isn't silently touched by only clearing a side that never had its own override). */
  const applyCellBorderDraft = (scope: TableGridScope, draft: BorderDraft, options: { addToHistory: boolean }) => {
    const value = composeBorderShorthand(draft.widthPx, draft.style, draft.hex);
    const attrs = (["top", "right", "bottom", "left"] as const).reduce<Record<string, string | undefined>>((acc, side) => {
      acc[CELL_BORDER_SIDE_KEYS[side]] = draft.sides[side] ? value : undefined;
      return acc;
    }, {});
    runtime.executeOperations(
      setTableCellAttributesCommand(runtime.editor.document, scope, { attrs }, blockContext()),
      { preserveSelectionById: true, ...options },
    );
  };

  /** Live preview while adjusting the Border options popover - same checkpoint-then-reapply pattern as previewColor below. */
  const previewCellBorder = (draft: BorderDraft) => {
    if (!tableBorderPopover) return;
    if (!borderPreviewCheckpointRef.current) borderPreviewCheckpointRef.current = runtime.createCheckpoint();
    runtime.restoreCheckpoint(borderPreviewCheckpointRef.current);
    applyCellBorderDraft(tableBorderPopover.scope, draft, { addToHistory: false });
  };

  const applyCellBorderCommit = (draft: BorderDraft) => {
    if (!tableBorderPopover) return;
    if (borderPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(borderPreviewCheckpointRef.current);
      borderPreviewCheckpointRef.current = null;
    }
    applyCellBorderDraft(tableBorderPopover.scope, draft, { addToHistory: true });
    recordRecentColor("border", draft.hex);
    setTableBorderPopover(null);
    runtime.focus();
  };

  const cancelTableBorderPopover = () => {
    if (borderPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(borderPreviewCheckpointRef.current);
      borderPreviewCheckpointRef.current = null;
    }
    setTableBorderPopover(null);
    runtime.focus();
  };

  /** Same shape as applyCellBorderDraft, but for the one side a blockquote has - the whole draft always applies to borderLeft, no per-side toggle to reduce down first. */
  const applyBlockquoteBorderDraft = (blockId: string, draft: BlockquoteBorderDraft, options: { addToHistory: boolean }) => {
    const scope = blockquoteScopeFor(blockId, runtime.editor.selection.head);
    runtime.executeOperations(
      setBlockAttributes(runtime.editor.document, scope, { attrs: { borderLeft: composeBorderShorthand(draft.widthPx, draft.style, draft.hex) } }, blockContext()),
      { preserveSelectionById: true, ...options },
    );
  };

  const previewBlockquoteBorder = (draft: BlockquoteBorderDraft) => {
    if (!blockquoteBorderPopover) return;
    if (!blockquoteBorderPreviewCheckpointRef.current) blockquoteBorderPreviewCheckpointRef.current = runtime.createCheckpoint();
    runtime.restoreCheckpoint(blockquoteBorderPreviewCheckpointRef.current);
    applyBlockquoteBorderDraft(blockquoteBorderPopover.blockId, draft, { addToHistory: false });
  };

  const applyBlockquoteBorderCommit = (draft: BlockquoteBorderDraft) => {
    if (!blockquoteBorderPopover) return;
    if (blockquoteBorderPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(blockquoteBorderPreviewCheckpointRef.current);
      blockquoteBorderPreviewCheckpointRef.current = null;
    }
    applyBlockquoteBorderDraft(blockquoteBorderPopover.blockId, draft, { addToHistory: true });
    recordRecentColor("border", draft.hex);
    setBlockquoteBorderPopover(null);
    runtime.focus();
  };

  const cancelBlockquoteBorderPopover = () => {
    if (blockquoteBorderPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(blockquoteBorderPreviewCheckpointRef.current);
      blockquoteBorderPreviewCheckpointRef.current = null;
    }
    setBlockquoteBorderPopover(null);
    runtime.focus();
  };

  const recordRecentColor = (bucket: ColorBucket, hex: string) => {
    setRecentColors((current) => ({
      ...current,
      [bucket]: [hex, ...current[bucket].filter((existing) => existing.toLowerCase() !== hex.toLowerCase())].slice(0, RECENT_COLOR_LIMIT),
    }));
  };

  /** Applies `hex` to whatever colorPopover.target currently points at - shared by both the live-preview path and the real commit path below, differing only in `addToHistory`. */
  const applyColorToTarget = (hex: string, options: { addToHistory: boolean }) => {
    if (!colorPopover) return;
    if (colorPopover.target.kind === "mark") {
      applyMarkAttrs(colorPopover.target.markId, { value: hex }, options);
    } else if (colorPopover.target.kind === "cell") {
      // Uses the scope captured when the popover opened, not a fresh
      // tableScope() re-resolved against the live selection - see the
      // colorPopover state's own doc comment for why.
      runtime.executeOperations(
        setTableCellAttributesCommand(runtime.editor.document, colorPopover.target.scope, { attrs: { [colorPopover.target.attr]: hex } }, blockContext()),
        { preserveSelectionById: true, ...options },
      );
    } else {
      // Same captured-id-at-click-time discipline as the cell case above.
      const scope = blockquoteScopeFor(colorPopover.target.blockId, runtime.editor.selection.head);
      runtime.executeOperations(
        setBlockAttributes(runtime.editor.document, scope, { attrs: { [colorPopover.target.attr]: hex } }, blockContext()),
        { preserveSelectionById: true, ...options },
      );
    }
  };

  /**
   * Live preview while dragging the in-page saturation/hue picker (or typing
   * a valid hex, or clicking a recent swatch), mirroring TableResizeHandles'
   * own live-preview-then-commit-once pattern: every drag frame re-applies
   * the color for real (so a multi-node mark selection, not just a single
   * element's style, previews correctly), but always starting from a
   * checkpoint of the state from *before* any preview began, and always with
   * `addToHistory: false` - so however many drag frames fire, none of them
   * become their own undo step, and each one fully supersedes the last
   * rather than compounding on top of it. The checkpoint is created lazily,
   * on the first preview frame, so a picker session that's opened and
   * closed without ever touching anything never creates or restores
   * anything extra.
   */
  const previewColor = (hex: string) => {
    if (!colorPopover) return;
    if (!colorPreviewCheckpointRef.current) colorPreviewCheckpointRef.current = runtime.createCheckpoint();
    runtime.restoreCheckpoint(colorPreviewCheckpointRef.current);
    applyColorToTarget(hex, { addToHistory: false });
  };

  /**
   * There is no separate Apply button (ColorPickerPopover's own doc comment)
   * - this fires when the popover is dismissed any way *other than* Discard,
   * committing whatever was last staged by a drag/type/swatch-click.
   */
  const applyColor = (hex: string) => {
    if (!colorPopover) return;
    // Undo whatever the live preview left in the (non-history) model state
    // before making the real, history-eligible change - re-applying a
    // setNodeAttributes-style operation on top of an already-previewed
    // value would compute a before/after diff against the *previewed*
    // state, not the true original, which would either no-op or corrupt
    // the resulting undo step depending on the target.
    if (colorPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(colorPreviewCheckpointRef.current);
      colorPreviewCheckpointRef.current = null;
    }
    applyColorToTarget(hex, { addToHistory: true });
    recordRecentColor(colorBucketFor(colorPopover.target), hex);
    setColorPopover(null);
    runtime.focus();
  };

  /** Discard - the only way to revert to the color the popover opened with; every other dismissal commits (see applyColor). */
  const cancelColorPopover = () => {
    if (colorPreviewCheckpointRef.current) {
      runtime.restoreCheckpoint(colorPreviewCheckpointRef.current);
      colorPreviewCheckpointRef.current = null;
    }
    setColorPopover(null);
    runtime.focus();
  };

  const toggleBlockquote = () => {
    const scope = blockScope();
    const resolved = runtime.editor.resolve({ pos: runtime.editor.selection.head });
    const ancestor = findBlockquoteAncestor();
    const context = blockContext();
    if (ancestor) {
      const quoteScope = blockquoteScopeFor(ancestor.id, resolved.pos);
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

  const insertTable = (rows = 2, columns = 2) => {
    const paragraphIds = ids(rows * columns);
    const selected = blockScope();
    const firstId = selected.kind === "block-range" ? selected.blockIds[0] : undefined;
    const target = firstId ? runtime.editor.positions.positionOf(firstId) : null;
    const operations = insertTableCommand(runtime.editor.document, selected, {
      rows, columns, placement: "after",
      ids: { tableId: createNodeId(), rowIds: ids(rows), cellIds: ids(rows * columns), paragraphIds },
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
   * The generic plugin context menu remains table-scoped. Images use their
   * direct right-click details editor below, other media keeps its dedicated
   * quick-action menu, while marks stay on the toolbar and links use the
   * auto-triggered LinkEditorPopover.
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
          onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "cell", attr: "background", scope: tableGridScope as TableGridScope }, initialValue: currentCellColor("background") }),
        },
        {
          id: "table.contextMenu.cellTextColor",
          label: "Cell text colour",
          onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "cell", attr: "textColor", scope: tableGridScope as TableGridScope }, initialValue: currentCellColor("textColor") }),
        },
        {
          id: "table.contextMenu.cellBorderOptions",
          label: "Cell border options",
          onSelect: () => setTableBorderPopover({ x: openX, y: openY, scope: tableGridScope as TableGridScope, initial: currentCellBorderDraft(tableGridScope) }),
        },
      );
    } else {
      // Table cell checked first (above) - a right-click inside a table
      // nested inside a blockquote shows cell options, not these.
      const blockquoteAncestor = findBlockquoteAncestor();
      if (blockquoteAncestor) {
        const openX = contextMenu?.x ?? 0;
        const openY = contextMenu?.y ?? 0;
        const blockId = blockquoteAncestor.id;
        items.push(
          {
            id: "blockquote.contextMenu.backgroundColor",
            label: "Blockquote background colour",
            onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "blockquote", attr: "backgroundColor", blockId }, initialValue: currentBlockquoteColor(blockId, "backgroundColor") }),
          },
          {
            id: "blockquote.contextMenu.textColor",
            label: "Blockquote text colour",
            onSelect: () => setColorPopover({ x: openX, y: openY, target: { kind: "blockquote", attr: "textColor", blockId }, initialValue: currentBlockquoteColor(blockId, "textColor") }),
          },
          {
            id: "blockquote.contextMenu.borderOptions",
            label: "Blockquote border options",
            onSelect: () => setBlockquoteBorderPopover({ x: openX, y: openY, blockId, initial: currentBlockquoteBorderDraft(blockId) }),
          },
        );
      }
    }
    return items;
  };

  /**
   * Inserts a formula-library entry (see formulaLibrary.ts), then
   * auto-selects the new atom and opens the existing edit-formula
   * interaction immediately - most real use needs customization (different
   * variable names, specific values), so landing the user straight into an
   * editable state beats a silent insert-and-walk-away. Reuses the atom
   * "node" selection pattern already used elsewhere (e.g. the context
   * menu's own atom-selection logic) rather than inventing a new one.
   */
  const insertFormulaFromLibrary = (entry: FormulaLibraryEntry) => {
    setFormulaLibraryPopover(null);
    const declaration = atomDeclarations.find((atom) => atom.type === "formula")!;
    const resolved = runtime.editor.resolve({ pos: runtime.editor.selection.head });
    const formulaAtomId = createNodeId();
    runtime.executeOperations(insertAtom(runtime.editor.document, atomScope(), {
      declaration, nodeId: formulaAtomId, ownerId: resolved.nodeId, offset: runtime.editor.selection.head.offset,
      attrs: { source: entry.latex, notation: "latex" },
    }, blockContext()));
    const range = runtime.editor.positions.rangeOf(formulaAtomId);
    if (range) {
      runtime.editor.setSelection({ type: "node", anchor: range.from, head: range.to }, { source: "api" });
      runtime.surface.renderer?.render(runtime.editor.document, runtime.editor.selection);
      editSelectedAtom();
    }
  };

  /**
   * Inserts plain text at the cursor via a real synthetic `beforeinput`
   * event (inputType "insertText") rather than a hand-rolled operation -
   * this is the exact same event InputController's own beforeInputListener
   * already handles correctly for ordinary typing (replaceSelection),
   * including deleting an active selection first. Verified this works
   * identically across Chromium/Firefox/WebKit rather than assumed.
   */
  const insertSpecialCharacter = (char: string) => {
    setSpecialCharPopover(null);
    setRecentSpecialChars((current) => [char, ...current.filter((existing) => existing !== char)].slice(0, 8));
    const root = runtime.surface.root;
    if (!root) return;
    root.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: char, bubbles: true, cancelable: true }));
    runtime.focus();
  };

  const insertBlockAtom = (type: "block_image" | "video" | "audio" | "divider" | "page_break", attrs: Record<string, unknown>, nodeId: string): boolean => {
    const declaration = atomDeclarations.find((entry) => entry.type === type)!;
    const selection = runtime.editor.selection;
    let parentId: string | undefined;
    let index: number | undefined;
    const resolved = runtime.editor.resolve({ pos: selection.head });
    // A selected atom's own parent is only a legal insertion point for a
    // *block* atom (image/video/audio/table etc., whose parent is the
    // document root or a table cell). An inline atom (formula, inline image)
    // lives inside a paragraph - inserting a block atom there would nest a
    // block inside a paragraph, which insertAtom's schema validation rejects,
    // silently no-opping. Fall through to the generic "insert after the
    // current block" logic below for that case instead.
    const selectedBlockAtom = (() => {
      if (selection.type !== "node") return false;
      const scope = atomScope();
      const atomType = scope.kind === "atomic-node" ? findNode(runtime.editor.document, scope.nodeId)?.type : undefined;
      return atomType ? atomDeclarations.find((entry) => entry.type === atomType)?.group === "block" : false;
    })();
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
    } else if (selectedBlockAtom) {
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
      // docs/bugs/media-details-old-editor-field-parity.md: item.license was
      // already fetched and shown in MediaManager's own library-browser info
      // panel (MediaManager.tsx), but had nowhere to persist once inserted -
      // the atom schema had no license attrs at all, so this real,
      // already-available data was silently discarded at exactly this call
      // site. `licenseVersion` has no MediaItem.license equivalent (its
      // shape has no separate version field) - left for the user to fill in
      // via the media details panel, same as a freshly uploaded image.
      ...(item.license?.workName || item.license?.licenseText
        ? { licenseDescription: [item.license.workName, item.license.licenseText].filter(Boolean).join(" - ") } : {}),
      ...(item.license?.sourceUrl ? { licenseSourceUrl: item.license.sourceUrl } : {}),
      ...(item.license?.licenseType ? { licenseType: item.license.licenseType } : {}),
      ...(item.license?.author ? { licenseAttribution: item.license.author } : {}),
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

  const openMediaDetails = (scope: ResolvedScope, node: SmartElementNode, element?: HTMLElement) => {
    if (scope.kind !== "atomic-node") return;
    const rect = (element || selectedAtomElement)?.getBoundingClientRect();
    setMediaDetailsPopover({
      x: rect ? rect.left : 0, y: rect ? rect.bottom + 6 : 0, scope,
      initial: {
        alt: String(node.attrs?.alt || ""),
        href: String(node.attrs?.href || ""),
        openInNewTab: node.attrs?.target === "_blank",
        width: typeof node.attrs?.width === "number" ? node.attrs.width : undefined,
        borderRadius: typeof node.attrs?.borderRadius === "number" ? node.attrs.borderRadius : undefined,
        align: node.attrs?.align === "left" || node.attrs?.align === "center" || node.attrs?.align === "right" ? node.attrs.align : undefined,
        licenseDescription: String(node.attrs?.licenseDescription || ""),
        licenseSourceUrl: String(node.attrs?.licenseSourceUrl || ""),
        licenseType: String(node.attrs?.licenseType || ""),
        licenseVersion: String(node.attrs?.licenseVersion || ""),
        licenseAttribution: String(node.attrs?.licenseAttribution || ""),
      },
    });
  };

  const editSelectedAtom = (resizeBy?: number) => {
    const scope = atomScope();
    if (scope.kind !== "atomic-node") return;
    const node = findNode(runtime.editor.document, scope.nodeId);
    if (!node) return;
    if (resizeBy === undefined && !node.type.includes("formula")) {
      // Images: the old window.prompt("Alt text") one-field edit is
      // replaced by the full Media details panel (docs/bugs/
      // media-details-old-editor-field-parity.md) - formulas keep their
      // existing prompt unchanged below, since this panel's fields
      // (link/align/radius/license) don't apply to a formula atom at all.
      openMediaDetails(scope, node);
      return;
    }
    const operations = resizeBy === undefined
      ? updateAtom(runtime.editor.document, scope, { attrs: { source: window.prompt("Formula source", String(node.attrs?.source || "")) || node.attrs?.source } }, blockContext())
      : resizeAtom(runtime.editor.document, scope, {
        width: Math.max(16, Number(node.attrs?.width || 160) + resizeBy),
        height: Math.max(16, Number(node.attrs?.height || 90) + resizeBy),
      }, blockContext());
    runtime.executeOperations(operations, resizeBy === undefined ? {} : { historyGroup: `resize-${scope.nodeId}` });
  };

  const applyMediaDetails = (draft: MediaDetailsDraft) => {
    if (!mediaDetailsPopover) return;
    const { scope } = mediaDetailsPopover;
    if (scope.kind !== "atomic-node") { setMediaDetailsPopover(null); return; }
    const node = findNode(runtime.editor.document, scope.nodeId);
    const currentWidth = typeof node?.attrs?.width === "number" ? node.attrs.width : undefined;
    const currentHeight = typeof node?.attrs?.height === "number" ? node.attrs.height : undefined;
    // Width preserves the original aspect ratio (matches the drag handle
    // and Resize +/- buttons' own behavior) rather than exposing a separate
    // Height field the old editor's own screenshot didn't have either.
    const resizedHeight = draft.width && currentWidth && currentHeight
      ? Math.round((draft.width * currentHeight) / currentWidth)
      : currentHeight;
    setMediaDetailsPopover(null);
    runtime.executeOperations(updateAtom(runtime.editor.document, scope, {
      attrs: {
        alt: draft.alt,
        href: draft.href || undefined,
        target: draft.href && draft.openInNewTab ? "_blank" : undefined,
        width: draft.width ?? currentWidth,
        height: draft.width ? resizedHeight : currentHeight,
        borderRadius: draft.borderRadius || undefined,
        align: draft.align,
        licenseDescription: draft.licenseDescription || undefined,
        licenseSourceUrl: draft.licenseSourceUrl || undefined,
        licenseType: draft.licenseType || undefined,
        licenseVersion: draft.licenseVersion || undefined,
        licenseAttribution: draft.licenseAttribution || undefined,
      },
    }, blockContext()));
    runtime.focus();
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

  const markTool = (id: string) => inlineToolDeclarations.find((tool) => tool.id === id)!;
  // aria-pressed tri-state per docs/bugs/mark-toolbar-buttons-no-pressed-state.md's
  // prescribed fix: SelectionDescription.marks already reports "all"/"partial"
  // coverage per mark, so a selection only partially covered by e.g. bold
  // reports aria-pressed="mixed" rather than silently rounding to true/false.
  const markCoverage = (id: string): boolean | "mixed" | undefined => {
    if (readOnly) return undefined;
    const description = runtime.editor.resolveScope({ want: "describe" }) as SelectionDescription;
    const markType = markTool(id).markType;
    const entry = description.marks.find((entry) => entry.mark.type === markType);
    if (!entry) return false;
    return entry.coverage === "all" ? true : "mixed";
  };
  /**
   * Whether clicking this mark tool right now would do anything at all - a
   * node type can declare `marks: ""` (code_block, every atom) to disallow
   * every mark, and applyMarkCommand already silently skips owners that
   * disallow the mark rather than erroring - previously that made these
   * buttons stay fully clickable no-ops with zero feedback inside a code
   * block or with an image selected. Reuses reportMarkApplication (already
   * built for exactly this question, previously only exercised by tests)
   * rather than re-deriving the schema check: "allowed somewhere" is
   * ownerCount > ownerIdsSkipped.length, i.e. at least one touched owner
   * does NOT skip it. Deliberately "somewhere", not "everywhere" - a
   * selection spanning both a normal paragraph and a code block still
   * partially applies to the paragraph half today, and disabling here
   * would take that capability away for no reason.
   */
  const markToolAllowed = (id: string): boolean => {
    const scope = runtime.editor.resolveScope({ want: "inline-range" }) as ResolvedScope;
    const report = reportMarkApplication(runtime.editor.document, scope, markTool(id).markType, blockContext());
    return report.ownerCount > report.ownerIdsSkipped.length;
  };
  const toggleMark = (id: string) => { executeMarkTool(runtime.editor, markTool(id), "toggle"); runtime.focus(); };
  const openLinkPopover = (event: React.MouseEvent<HTMLButtonElement>) => {
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
  };
  const tableAction = (action: "row+" | "row-" | "column+" | "column-" | "merge" | "split" | "header" | "row-up" | "row-down" | "column-left" | "column-right" | "remove") => {
    const disabled = readOnly || !tableSelected
      || action === "merge" && (currentTableScope as TableGridScope).cellIds.length < 2
      || action === "row-up" && (currentTableScope as TableGridScope).rect.top === 0
      || action === "column-left" && (currentTableScope as TableGridScope).rect.left === 0;
    return { disabled, onClick: () => runTable(action) };
  };

  // Rendered in two places (its home dropdown, and the narrow-viewport
  // overflow menu) so nothing becomes unreachable once dropdowns collapse -
  // see ToolbarPrimitives.tsx's MobileMoreMenu doc comment.
  // Superscript/Subscript/Text colour/Background colour/Font size/Font
  // family also get a standalone widePromote ToolbarButton (below, in the
  // main toolbar row) that appears past theme.ts's 1440px breakpoint - this
  // dropdown copy's `widePromote` flag hides it there so it isn't offered
  // twice; below 1440px (including mobile) this copy is what's reachable,
  // same as before. "Code" isn't promoted - see the docs/bugs/ writeup on
  // why it stayed the dropdown's sole remaining item at wide widths.
  const textStylesMenuItems = <>
    {t.code && <ToolbarMenuItem icon="code" label="Code" pressed={markCoverage("inlineCode")} disabled={readOnly || !markToolAllowed("inlineCode")} onClick={() => toggleMark("inlineCode")} />}
    {t.superscript && <ToolbarMenuItem icon="superscript" label="Superscript" pressed={markCoverage("superscript")} disabled={readOnly || !markToolAllowed("superscript")} onClick={() => toggleMark("superscript")} widePromote />}
    {t.subscript && <ToolbarMenuItem icon="subscript" label="Subscript" pressed={markCoverage("subscript")} disabled={readOnly || !markToolAllowed("subscript")} onClick={() => toggleMark("subscript")} widePromote />}
    {t.textColor && <ToolbarMenuItem icon="textColor" label="Text colour" disabled={readOnly || !markToolAllowed("textColor")} widePromote onClick={(event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setColorPopover({ x: rect.left, y: rect.bottom + 4, target: { kind: "mark", markId: "textColor" }, initialValue: currentMarkColor("textColor") });
    }} />}
    {t.backgroundColor && <ToolbarMenuItem icon="backgroundColor" label="Background colour" disabled={readOnly || !markToolAllowed("backgroundColor")} widePromote onClick={(event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setColorPopover({ x: rect.left, y: rect.bottom + 4, target: { kind: "mark", markId: "backgroundColor" }, initialValue: currentMarkColor("backgroundColor") });
    }} />}
    {t.fontSize && <ToolbarMenuItem icon="fontSize" label="Font size" disabled={readOnly || !markToolAllowed("fontSize")} onClick={() => applyAttributedMark("fontSize")} widePromote />}
    {t.fontFamily && <ToolbarMenuItem icon="fontFamily" label="Font family" disabled={readOnly || !markToolAllowed("fontFamily")} onClick={() => applyAttributedMark("fontFamily")} widePromote />}
  </>;
  const showMoreTextStyles = t.code || t.superscript || t.subscript || t.textColor || t.backgroundColor || t.fontSize || t.fontFamily;
  /**
   * Line spacing - matches Google Docs' own reference shape: a short preset
   * list plus a custom/exact value entry, with a checkmark on whichever
   * preset (or "Default") currently applies. "Default" clears the
   * attribute entirely (setLineHeight(undefined)) rather than writing an
   * explicit "1" - the block then renders at the browser/font's own
   * natural line-height, matching how no override ever forces a value for
   * align/indent either. A mixed-value selection (blocks disagreeing)
   * shows no checkmark on any entry, matching every comparison below
   * evaluating false against the "mixed" sentinel with no special-casing
   * needed.
   */
  const LINE_HEIGHT_PRESETS = [1, 1.15, 1.5, 2, 2.5];
  const lineHeightMenuItems = <>
    <ToolbarMenuItem label="Default" pressed={currentLineHeight() === undefined} disabled={readOnly} onClick={() => setLineHeight(undefined)} />
    {LINE_HEIGHT_PRESETS.map((preset) => <ToolbarMenuItem key={preset} label={String(preset)} pressed={currentLineHeight() === preset} disabled={readOnly} onClick={() => setLineHeight(preset)} />)}
    <div className="srte-menu-separator" />
    {/*
      aria-label, not <label htmlFor>+id - this same JSX tree is rendered
      twice (the desktop dropdown and its MobileMoreMenu copy, matching
      every other dual-rendered tool in this file), and a hardcoded id
      would collide the moment both are mounted, which they always are
      (CSS visibility, not conditional rendering, is what hides one of
      them - see MobileMoreMenu's own doc comment). aria-label has no such
      uniqueness constraint.
    */}
    <div className="srte-line-height-custom" style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden="true" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Custom:</span>
      <input
        // Keyed by the live value so moving the caret to a different
        // selection remounts this uncontrolled input with a fresh
        // defaultValue - React only applies defaultValue on initial mount,
        // and this control never unmounts on its own (CSS visibility, not
        // conditional rendering, is what hides the closed dropdown), so an
        // unkeyed input kept showing whatever custom value was last typed
        // regardless of where the caret actually moved afterward.
        key={String((() => { const current = currentLineHeight(); return typeof current === "number" && !LINE_HEIGHT_PRESETS.includes(current) ? current : "none"; })())}
        aria-label="Custom line spacing"
        type="number"
        min={0.1}
        max={10}
        step={0.05}
        disabled={readOnly}
        defaultValue={(() => { const current = currentLineHeight(); return typeof current === "number" && !LINE_HEIGHT_PRESETS.includes(current) ? current : ""; })()}
        placeholder="e.g. 1.75"
        style={{ width: "100%", minWidth: 0 }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value) && value >= 0.1 && value <= 10) setLineHeight(value);
          event.currentTarget.closest("details")?.removeAttribute("open");
        }}
        onBlur={(event) => {
          const value = Number(event.currentTarget.value);
          if (event.currentTarget.value && Number.isFinite(value) && value >= 0.1 && value <= 10) setLineHeight(value);
        }}
      />
    </div>
  </>;
  const paragraphToolsMenuItems = <>
    <ToolbarMenuItem icon="moveUp" label="Move block up" disabled={readOnly} onClick={() => runBlock("up")} />
    <ToolbarMenuItem icon="moveDown" label="Move block down" disabled={readOnly} onClick={() => runBlock("down")} />
    <ToolbarMenuItem icon="indent" label="Indent block" disabled={readOnly} onClick={() => runBlock("indent")} />
    <ToolbarMenuItem icon="outdent" label="Outdent block" disabled={readOnly} onClick={() => runBlock("outdent")} />
  </>;
  /**
   * Named multi-level marker presets (decimal/lower-alpha/upper-alpha/
   * roman/outline) - a distinct control from the plain Bulleted/Numbered/
   * Checklist buttons above, which only toggle a raw list style. Extracted
   * to a variable so it can be reused verbatim in both the desktop "More
   * list tools" dropdown and MobileMoreMenu below - it was previously
   * hardcoded only into the dropdown, meaning a narrow/mobile viewport
   * (where every ToolbarDropdown hides entirely, per theme.ts's
   * 639px breakpoint) had no way to reach it at all - see
   * docs/bugs/list-preset-missing-from-mobile-more-menu.md.
   */
  const listPresetSelect = t.listPreset && <div style={{ padding: "4px 8px" }}>
    <select aria-label="List preset" title="List type / preset" disabled={readOnly || currentListParts.length !== 1} value={currentListPreset} onChange={(event) => {
      const preset = event.target.value;
      if (!preset || currentListParts.length !== 1) return;
      // A preset choice applies to the whole list, regardless of how deep
      // the cursor is nested — see outermostListId.
      const rootId = outermostListId(currentListParts[0].listId);
      runtime.executeOperations(setListPreset(runtime.editor.document, { ...currentListParts[0], listId: rootId }, { preset }, blockContext()), { preserveSelectionById: true });
      const pickedKind = SMART_LIST_PRESETS.find((candidate) => candidate.id === preset)?.kind;
      if (pickedKind) setLastListPreset((previous) => ({ ...previous, [pickedKind]: preset }));
    }} style={{ width: "100%" }}>
      <option value="">List preset</option>
      {SMART_LIST_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>
        {preset.kind === "bullet" ? `Bullet · ${preset.label}` : `Number · ${preset.label}`}
      </option>)}
    </select>
  </div>;
  const listToolsMenuItems = <>
    <ToolbarMenuItem icon="checkSquare" label="Check selected items" pressed={currentListScope.kind === "list-selection" && currentListScope.items.every((item) => findNode(runtime.editor.document, item.itemId)?.attrs?.checked === true)} disabled={readOnly || currentList?.attrs?.checkable !== true} onClick={toggleCheckedItems} />
    <ToolbarMenuItem icon="indent" label="Indent list item" disabled={readOnly || !canIndent} onClick={() => runList("indent")} />
    <ToolbarMenuItem icon="outdent" label="Outdent list item" disabled={readOnly || currentListParts.length === 0} onClick={() => runList("outdent")} />
    <ToolbarMenuItem icon="moveUp" label="Move item up" disabled={readOnly || !canMoveUp} onClick={() => runList("up")} />
    <ToolbarMenuItem icon="moveDown" label="Move item down" disabled={readOnly || !canMoveDown} onClick={() => runList("down")} />
    <ToolbarMenuItem icon="restart" label="Restart numbering" disabled={readOnly || !orderedList} onClick={restartNumbering} />
    <ToolbarMenuItem icon="continueNumbering" label="Continue numbering" disabled={readOnly || !orderedList} onClick={() => runtime.executeOperations(continueListNumbering(runtime.editor.document, currentListScope, {}, blockContext()), { preserveSelectionById: true })} />
  </>;
  // Remove link/Insert formula/Special characters also get a standalone
  // widePromote ToolbarButton (see textStylesMenuItems's own comment above
  // for the mechanism) - Insert video/audio and the selected-media actions
  // stay dropdown-only, matching the report's own named tool list.
  const insertMoreMenuItems = <>
    {t.removeLink && <ToolbarMenuItem icon="unlink" label="Remove link" disabled={readOnly} onClick={removeLink} widePromote />}
    {showVideoTool && <ToolbarMenuItem icon="video" label="Insert video" disabled={readOnly} onClick={() => setMediaKind("video")} />}
    {showAudioTool && <ToolbarMenuItem icon="audio" label="Insert audio" disabled={readOnly} onClick={() => setMediaKind("audio")} />}
    {t.insertFormula && <ToolbarMenuItem icon="formula" label="Insert formula" disabled={readOnly} widePromote onClick={(event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setFormulaLibraryPopover({ x: rect.left, y: rect.bottom + 4 });
    }} />}
    {t.specialCharacters && <ToolbarMenuItem icon="specialChar" label="Special characters" disabled={readOnly} widePromote onClick={(event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setSpecialCharPopover({ x: rect.left, y: rect.bottom + 4 });
    }} />}
    {t.horizontalLine && <ToolbarMenuItem icon="divider" label="Horizontal line" disabled={readOnly} widePromote onClick={() => { insertBlockAtom("divider", {}, createNodeId()); runtime.focus(); }} />}
    {t.pageBreak && <ToolbarMenuItem icon="pageBreak" label="Page break" disabled={readOnly} widePromote onClick={() => { insertBlockAtom("page_break", {}, createNodeId()); runtime.focus(); }} />}
    <ToolbarMenuItem icon="edit" label="Edit selected media" disabled={readOnly || !mediaAtomSelected} onClick={() => editSelectedAtom()} />
    <ToolbarMenuItem icon="zoomIn" label="Enlarge selected media" disabled={readOnly || !resizableAtomSelected} onClick={() => editSelectedAtom(20)} />
    <ToolbarMenuItem icon="zoomOut" label="Shrink selected media" disabled={readOnly || !resizableAtomSelected} onClick={() => editSelectedAtom(-20)} />
    <ToolbarMenuItem icon="delete" label="Delete selected media" disabled={readOnly || !atomSelected} onClick={() => runtime.executeOperations(deleteAtom(runtime.editor.document, atomScope(), {}, blockContext()))} />
  </>;
  // "Remove row"/"Remove column"/"Remove table" renamed to "Delete ..." -
  // matches the right-click table context menu's existing wording
  // (table/plugin.ts's table.contextMenu.removeRow/removeColumn/removeTable
  // contributions, labeled "Delete row"/"Delete column"/"Delete table")
  // for the identical action, found as a wording inconsistency during the
  // toolbar audit.
  const tableToolsMenuItems = <>
    <ToolbarMenuItem icon="addRow" label="Add row" {...tableAction("row+")} />
    <ToolbarMenuItem icon="delete" label="Delete row" {...tableAction("row-")} />
    <ToolbarMenuItem icon="addColumn" label="Add column" {...tableAction("column+")} />
    <ToolbarMenuItem icon="delete" label="Delete column" {...tableAction("column-")} />
    <ToolbarMenuItem icon="mergeCells" label="Merge cells" {...tableAction("merge")} />
    <ToolbarMenuItem icon="splitCell" label="Split cell" {...tableAction("split")} />
    <ToolbarMenuItem icon="headerRow" label="Header row" {...tableAction("header")} />
    <ToolbarMenuItem icon="moveUp" label="Move row up" {...tableAction("row-up")} />
    <ToolbarMenuItem icon="moveDown" label="Move row down" {...tableAction("row-down")} />
    <ToolbarMenuItem icon="moveLeft" label="Move column left" {...tableAction("column-left")} />
    <ToolbarMenuItem icon="moveRight" label="Move column right" {...tableAction("column-right")} />
    <ToolbarMenuItem icon="deleteTable" label="Delete table" {...tableAction("remove")} />
    <div className="srte-menu-separator" />
    {/*
      table_cell's border attrs already existed (or, for the per-side
      overrides, were added specifically to back this control), already
      rendered, already round-tripped through HTML/DOCX - just never
      settable from this editor's own UI (only reachable by pasting HTML
      that already had cell borders). Applies to whichever cell(s) are
      currently selected - same per-cell granularity
      setTableCellAttributesCommand already uses for background/text
      colour, matching the model's own attribute placement (table_cell, not
      table_row or table). One combined popover (sides/style/width/colour)
      rather than separate controls - see TableBorderPopover.tsx's own doc
      comment.
    */}
    <ToolbarMenuItem icon="cellBorder" label="Border options" disabled={readOnly || !tableSelected} onClick={(event) => {
      const scope = runtime.editor.resolveScope({ want: "table-grid" });
      if (!("kind" in scope) || scope.kind !== "table-grid") return;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setTableBorderPopover({ x: rect.left, y: rect.bottom + 4, scope: scope as TableGridScope, initial: currentCellBorderDraft(scope) });
    }} />
  </>;
  const saveCopyMenuItems = <>
    {t.saveAsHtml && <ToolbarMenuItem label="Save as HTML" onClick={() => runExport("html")} />}
    {t.saveAsMarkdown && <ToolbarMenuItem label="Save as Markdown" onClick={() => runExport("markdown")} />}
    {t.saveAsWord && <ToolbarMenuItem label="Save as Word document" onClick={() => void runDocxExport()} />}
    {/*
      Not a direct file download like its "Save as ..." siblings - it opens
      a print window and triggers the browser's own print dialog, where
      the user picks "Save as PDF" as the destination. A real one-click
      PDF download would require bundling a client-side PDF-generation
      library (browsers have no built-in API for a page to generate a PDF
      itself) - out of scope; this label instead sets the right
      expectation for the mechanism that actually exists, reported live as
      "Save as PDF should download as PDF but it opens in new page."
    */}
    {t.saveAsPdf && <ToolbarMenuItem label="Print / Save as PDF" onClick={runPdfExport} />}
    {t.saveAsSmartRte && <ToolbarMenuItem icon="json" label="Save as Smart RTE file" onClick={() => runExport("native")} />}
  </>;
  const showSaveCopy = t.saveAsHtml || t.saveAsMarkdown || t.saveAsWord || t.saveAsPdf || t.saveAsSmartRte;
  // "Review" splits into two independently-toggleable tools (comments,
  // suggestions) - not an arbitrary split, it maps directly onto the two
  // already-separate providers this architecture has (commentProvider,
  // suggestionProvider). Kept as ONE dropdown trigger (labeled "Review")
  // rather than two, showing whichever half(s) are actually enabled.
  const commentsMenuItems = <>
    <ToolbarMenuItem icon="addComment" label="Add comment" disabled={!canComment} onClick={startComment} />
    <ToolbarMenuItem icon="comments" label="Comments" pressed={commentPanelOpen} disabled={!commentProvider} onClick={() => setCommentPanelOpen((open) => !open)} />
  </>;
  const suggestionsMenuItems = <>
    <ToolbarMenuItem icon="suggest" label="Suggest deletion" disabled={!canSuggestDelete} onClick={suggestDelete} />
    <ToolbarMenuItem icon="suggest" label="Suggest insertion" disabled={readOnly || !suggestionProvider} onClick={startSuggestInsert} />
    <ToolbarMenuItem icon="suggest" label="Suggest removing this" disabled={readOnly || !suggestionProvider} onClick={suggestBlockRemoval} />
    <ToolbarMenuItem icon="suggestions" label="Suggestions" pressed={suggestionPanelOpen} disabled={!suggestionProvider} onClick={() => setSuggestionPanelOpen((open) => !open)} />
    <ToolbarMenuItem
      icon="showEdits" label="Show edits" pressed={trackChangesEnabled}
      title="Tracks ordinary typing and edits within a single paragraph as suggestions. Merging paragraphs together - typing over a selection that spans multiple paragraphs, or pressing Backspace/Delete at a paragraph boundary - still applies directly and can't be reviewed as a suggestion."
      disabled={readOnly || !suggestionProvider} onClick={() => setTrackChangesEnabled((enabled) => !enabled)}
    />
  </>;
  const reviewMenuItems = <>
    {showCommentsTool && commentsMenuItems}
    {showCommentsTool && showSuggestionsTool && <div className="srte-menu-separator" />}
    {showSuggestionsTool && suggestionsMenuItems}
  </>;
  const showReviewDropdown = showCommentsTool || showSuggestionsTool;

  return <section className={`srte-root srte-editor srte-canonical-authority${className ? ` ${className}` : ""}`} data-smart-authority="canonical">
    <div className="srte-toolbar" role="toolbar" aria-label="Formatting toolbar">
      <ToolbarGroup>
        {t.bold && <ToolbarButton icon="bold" label="Bold" pressed={markCoverage("bold")} disabled={readOnly || !markToolAllowed("bold")} onClick={() => toggleMark("bold")} />}
        {t.italic && <ToolbarButton icon="italic" label="Italic" pressed={markCoverage("italic")} disabled={readOnly || !markToolAllowed("italic")} onClick={() => toggleMark("italic")} />}
        {t.underline && <ToolbarButton icon="underline" label="Underline" pressed={markCoverage("underline")} disabled={readOnly || !markToolAllowed("underline")} onClick={() => toggleMark("underline")} />}
        {t.strikethrough && <ToolbarButton icon="strikethrough" label="Strikethrough" pressed={markCoverage("strikethrough")} disabled={readOnly || !markToolAllowed("strikethrough")} onClick={() => toggleMark("strikethrough")} />}
        {/* Wide-viewport promoted copies of tools that also live in "More text styles" - see textStylesMenuItems's own comment. */}
        {t.superscript && <ToolbarButton icon="superscript" label="Superscript" pressed={markCoverage("superscript")} disabled={readOnly || !markToolAllowed("superscript")} onClick={() => toggleMark("superscript")} widePromote />}
        {t.subscript && <ToolbarButton icon="subscript" label="Subscript" pressed={markCoverage("subscript")} disabled={readOnly || !markToolAllowed("subscript")} onClick={() => toggleMark("subscript")} widePromote />}
        {t.textColor && <ToolbarButton icon="textColor" label="Text colour" disabled={readOnly || !markToolAllowed("textColor")} widePromote onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setColorPopover({ x: rect.left, y: rect.bottom + 4, target: { kind: "mark", markId: "textColor" }, initialValue: currentMarkColor("textColor") });
        }} />}
        {t.backgroundColor && <ToolbarButton icon="backgroundColor" label="Background colour" disabled={readOnly || !markToolAllowed("backgroundColor")} widePromote onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setColorPopover({ x: rect.left, y: rect.bottom + 4, target: { kind: "mark", markId: "backgroundColor" }, initialValue: currentMarkColor("backgroundColor") });
        }} />}
        {t.fontSize && <ToolbarButton icon="fontSize" label="Font size" disabled={readOnly || !markToolAllowed("fontSize")} onClick={() => applyAttributedMark("fontSize")} widePromote />}
        {t.fontFamily && <ToolbarButton icon="fontFamily" label="Font family" disabled={readOnly || !markToolAllowed("fontFamily")} onClick={() => applyAttributedMark("fontFamily")} widePromote />}
        {showMoreTextStyles && <ToolbarDropdown icon="textColor" label="More text styles" priority={2}>{textStylesMenuItems}</ToolbarDropdown>}
      </ToolbarGroup>

      <ToolbarGroup>
        {t.blockType && <select
          className="srte-block-type-select"
          aria-label="Block type"
          title="Block type"
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
        </select>}
        {t.alignLeft && <ToolbarButton icon="alignLeft" label="Align left" ariaLabel="Align left" iconOnly disabled={readOnly} onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align: "left" } }, blockContext()))} />}
        {t.alignCenter && <ToolbarButton icon="alignCenter" label="Align center" ariaLabel="Align center" iconOnly disabled={readOnly} onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align: "center" } }, blockContext()))} />}
        {t.alignRight && <ToolbarButton icon="alignRight" label="Align right" ariaLabel="Align right" iconOnly disabled={readOnly} onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align: "right" } }, blockContext()))} />}
        {t.alignJustify && <ToolbarButton icon="alignJustify" label="Justify" ariaLabel="Align justify" iconOnly disabled={readOnly} onClick={() => transactBlock(setBlockAttributes(runtime.editor.document, blockScope(), { attrs: { align: "justify" } }, blockContext()))} />}
        {t.lineHeight && <ToolbarDropdown icon="lineHeight" label="Line spacing" priority={2}>{lineHeightMenuItems}</ToolbarDropdown>}
        {t.quote && <ToolbarButton icon="quote" label="Quote" ariaLabel="Blockquote" pressed={currentBlockquoteActive} disabled={readOnly} onClick={toggleBlockquote} />}
        <ToolbarDropdown icon="moveUp" label="More paragraph tools" priority={2}>{paragraphToolsMenuItems}</ToolbarDropdown>
      </ToolbarGroup>

      <ToolbarGroup>
        {/*
          A split control: the button itself keeps its existing one-click
          toggle behavior unchanged (create/remove, reapplying whichever
          preset was last picked) - dozens of existing flows and tests
          depend on that single click. The attached native <select> (styled
          via .srte-split-control into a plain chevron - see theme.ts) is
          the new, additional way to jump straight to a specific preset from
          the button itself, without a custom-positioned dropdown panel (and
          therefore none of that pattern's own containing-block/clamping bug
          class - see docs/bugs/toolbar-overlay-*.md). Gated behind
          t.listPreset like the shared "List preset" select elsewhere - a
          consumer that disabled that feature gets the plain button only.
        */}
        {t.bulletedList && (t.listPreset ? <span className="srte-split-control">
          <ToolbarButton icon="bulletedList" label="Bulleted list" ariaLabel="Bulleted list" pressed={listStyleActive("disc")} disabled={readOnly} narrowIconOnly onClick={() => toggleList("disc")} />
          <select
            aria-label="Bulleted list style" title="Bulleted list style"
            disabled={readOnly || (currentListScope.kind === "list-selection" && currentListParts.length !== 1)}
            value={currentBulletPreset}
            onChange={(event) => { const preset = event.target.value; if (preset) applyListPreset(preset); }}
          >
            <option value="">Bulleted list style</option>
            {SMART_LIST_PRESETS.filter((preset) => preset.kind === "bullet").map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </span> : <ToolbarButton icon="bulletedList" label="Bulleted list" ariaLabel="Bulleted list" pressed={listStyleActive("disc")} disabled={readOnly} narrowIconOnly onClick={() => toggleList("disc")} />)}
        {t.numberedList && (t.listPreset ? <span className="srte-split-control">
          <ToolbarButton icon="numberedList" label="Numbered list" ariaLabel="Numbered list" pressed={listStyleActive("decimal")} disabled={readOnly} narrowIconOnly onClick={() => toggleList("decimal")} />
          <select
            aria-label="Numbered list style" title="Numbered list style"
            disabled={readOnly || (currentListScope.kind === "list-selection" && currentListParts.length !== 1)}
            value={currentOrderedPreset}
            onChange={(event) => { const preset = event.target.value; if (preset) applyListPreset(preset); }}
          >
            <option value="">Numbered list style</option>
            {SMART_LIST_PRESETS.filter((preset) => preset.kind === "ordered").map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </span> : <ToolbarButton icon="numberedList" label="Numbered list" ariaLabel="Numbered list" pressed={listStyleActive("decimal")} disabled={readOnly} narrowIconOnly onClick={() => toggleList("decimal")} />)}
        {t.checklist && <ToolbarButton icon="checklist" label="Checklist" ariaLabel="Checklist" pressed={listStyleActive("disc", true)} disabled={readOnly} narrowIconOnly onClick={() => toggleList("disc", true)} />}
        <ToolbarDropdown icon="restart" label="More list tools" priority={2}>
          {listPresetSelect}
          {t.listPreset && <div className="srte-menu-separator" />}
          {listToolsMenuItems}
        </ToolbarDropdown>
      </ToolbarGroup>

      <ToolbarGroup>
        {t.link && <ToolbarButton icon="link" label="Link" ariaLabel="Insert or edit link" disabled={readOnly || !markToolAllowed("link")} onClick={openLinkPopover} />}
        {showImageTool && <ToolbarButton icon="image" label="Image" ariaLabel="Insert image" disabled={readOnly} onClick={() => setMediaKind("image")} />}
        {/* Wide-viewport promoted copies of tools that also live in "More to insert" - see insertMoreMenuItems's own comment. */}
        {t.removeLink && <ToolbarButton icon="unlink" label="Remove link" disabled={readOnly} onClick={removeLink} widePromote />}
        {t.insertFormula && <ToolbarButton icon="formula" label="Insert formula" disabled={readOnly} widePromote onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setFormulaLibraryPopover({ x: rect.left, y: rect.bottom + 4 });
        }} />}
        {t.specialCharacters && <ToolbarButton icon="specialChar" label="Special characters" disabled={readOnly} widePromote onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setSpecialCharPopover({ x: rect.left, y: rect.bottom + 4 });
        }} />}
        {t.horizontalLine && <ToolbarButton icon="divider" label="Horizontal line" disabled={readOnly} widePromote onClick={() => { insertBlockAtom("divider", {}, createNodeId()); runtime.focus(); }} />}
        {t.pageBreak && <ToolbarButton icon="pageBreak" label="Page break" disabled={readOnly} widePromote onClick={() => { insertBlockAtom("page_break", {}, createNodeId()); runtime.focus(); }} />}
        <ToolbarDropdown icon="video" label="More to insert" priority={2}>{insertMoreMenuItems}</ToolbarDropdown>
      </ToolbarGroup>

      {showInsertTable && <ToolbarGroup>
        <ToolbarButton
          icon="table" label="Insert table" ariaLabel="Insert table" disabled={readOnly}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setTableSizePopover({ x: rect.left, y: rect.bottom + 4 });
          }}
        />
        <ToolbarDropdown icon="mergeCells" label="Table tools" priority={2}>{tableToolsMenuItems}</ToolbarDropdown>
      </ToolbarGroup>}

      <input ref={importRef} type="file" accept=".html,.htm,.md,.markdown,.docx,.pdf,text/html,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void runImport(file);
        event.currentTarget.value = "";
      }} />
      <ToolbarGroup>
        {t.import && <ToolbarButton icon="import" label="Import" ariaLabel="Import document" disabled={readOnly} onClick={() => importRef.current?.click()} />}
        {showSaveCopy && <ToolbarDropdown icon="saveCopy" label="Save a copy" priority={2}>{saveCopyMenuItems}</ToolbarDropdown>}
        {showVersionHistoryTool && <ToolbarButton icon="history" label="Version history" ariaLabel="Version history" disabled={readOnly} onClick={() => setVersionHistoryOpen(true)} />}
        {showReviewDropdown && <ToolbarDropdown icon="comments" label="Review" priority={2}>{reviewMenuItems}</ToolbarDropdown>}
      </ToolbarGroup>

      <ToolbarGroup>
        {t.undo && <ToolbarButton icon="undo" label="Undo" ariaLabel="Undo" disabled={readOnly} onClick={() => { runtime.editor.undo(); runtime.focus(); }} />}
        {t.redo && <ToolbarButton icon="redo" label="Redo" ariaLabel="Redo" disabled={readOnly} onClick={() => { runtime.editor.redo(); runtime.focus(); }} />}
      </ToolbarGroup>

      <MobileMoreMenu>
        {textStylesMenuItems}
        <div className="srte-menu-separator" />
        {paragraphToolsMenuItems}
        {t.lineHeight && <div className="srte-menu-separator" />}
        {t.lineHeight && lineHeightMenuItems}
        <div className="srte-menu-separator" />
        {listPresetSelect}
        {listToolsMenuItems}
        <div className="srte-menu-separator" />
        {insertMoreMenuItems}
        {showInsertTable && <><div className="srte-menu-separator" />{tableToolsMenuItems}</>}
        {showSaveCopy && <><div className="srte-menu-separator" />{saveCopyMenuItems}</>}
        {showReviewDropdown && <><div className="srte-menu-separator" />{reviewMenuItems}</>}
      </MobileMoreMenu>
    </div>
    {mediaKind === "image" && mediaManager && mediaProvider && <MediaManager
      open
      onClose={() => setMediaKind(null)}
      adapter={mediaManagerAdapter!}
      onSelect={selectFromMediaManager}
    />}
    {mediaKind && mediaProvider && !(mediaKind === "image" && mediaManager) && <MediaPicker kind={mediaKind} onPick={(file) => void insertMediaFile(mediaKind, file)} onCancel={() => setMediaKind(null)} />}
    {showVersionHistoryTool && <VersionHistoryPanel
      open={versionHistoryOpen}
      onClose={() => setVersionHistoryOpen(false)}
      runtime={runtime}
      versionProvider={versionProvider!}
    />}
    {showCommentsTool && rootRef.current && runtime.surface.renderer?.mapping && <CommentMarkers
      positions={runtime.editor.positions}
      mapping={runtime.surface.renderer.mapping}
      containerElement={rootRef.current}
      threads={threads}
      activeThreadId={activeThreadId}
      onSelectThread={selectThread}
    />}
    {showCommentsTool && <CommentThreadPanel
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
    {showSuggestionsTool && rootRef.current && runtime.surface.renderer?.mapping && <StructuralSuggestionMarkers
      positions={runtime.editor.positions}
      mapping={runtime.surface.renderer.mapping}
      containerElement={rootRef.current}
      suggestions={structuralSuggestions}
      activeSuggestionId={activeSuggestionId}
      onSelectSuggestion={selectSuggestion}
    />}
    {showSuggestionsTool && <SuggestionPanel
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
      autoFocus={!linkPopover.autoTriggered}
      onApply={applyLink}
      onRemove={removeLink}
      onCancel={() => {
        setLinkOverlayDismissedAt(runtime.editor.selection.head);
        setLinkPopover(null);
        runtime.focus();
      }}
    />}
    {!readOnly && mediaResizeTarget && mediaResizeTarget.nodeId === selectedAtomId && mediaAtomSelected && selectedAtomElement && <MediaOverlay
      atomElement={selectedAtomElement}
      alt={typeof selectedAtomNode?.attrs?.alt === "string" ? selectedAtomNode.attrs.alt : ""}
      width={typeof selectedAtomNode?.attrs?.width === "number" ? selectedAtomNode.attrs.width : undefined}
      height={typeof selectedAtomNode?.attrs?.height === "number" ? selectedAtomNode.attrs.height : undefined}
      src={typeof selectedAtomNode?.attrs?.src === "string" ? selectedAtomNode.attrs.src : undefined}
      showMenu={false}
      resizable={resizableAtomSelected}
      onEdit={() => undefined}
      onResize={() => undefined}
      onResizeTo={resizeSelectedAtomTo}
      onDelete={() => undefined}
      onDismiss={() => setMediaResizeTarget(null)}
    />}
    {!readOnly && mediaContextMenu && (mediaAtomSelected || actionOnlyAtomSelected) && selectedAtomElement && <MediaOverlay
      atomElement={selectedAtomElement}
      alt={typeof selectedAtomNode?.attrs?.alt === "string" ? selectedAtomNode.attrs.alt : ""}
      width={typeof selectedAtomNode?.attrs?.width === "number" ? selectedAtomNode.attrs.width : undefined}
      height={typeof selectedAtomNode?.attrs?.height === "number" ? selectedAtomNode.attrs.height : undefined}
      src={typeof selectedAtomNode?.attrs?.src === "string" ? selectedAtomNode.attrs.src : undefined}
      x={mediaContextMenu.x}
      y={mediaContextMenu.y}
      resizable={resizableAtomSelected}
      editable={mediaAtomSelected}
      onEdit={() => { setMediaContextMenu(null); editSelectedAtom(); }}
      onResize={(by) => { setMediaContextMenu(null); editSelectedAtom(by); }}
      onResizeTo={resizeSelectedAtomTo}
      onDelete={() => { setMediaContextMenu(null); deleteSelectedAtom(); }}
      onDismiss={() => { setMediaContextMenu(null); runtime.focus(); }}
    />}
    {colorPopover && <ColorPickerPopover
      x={colorPopover.x}
      y={colorPopover.y}
      label={colorPopover.target.kind === "mark"
        ? (colorPopover.target.markId === "textColor" ? "Text colour" : "Background colour")
        : colorPopover.target.kind === "blockquote"
          ? (colorPopover.target.attr === "textColor" ? "Blockquote text colour" : "Blockquote background colour")
          : colorPopover.target.attr === "textColor" ? "Cell text colour" : "Cell background colour"}
      {...(colorPopover.initialValue ? { initialValue: colorPopover.initialValue } : {})}
      recentColors={recentColors[colorBucketFor(colorPopover.target)]}
      onPreview={previewColor}
      onApply={applyColor}
      onCancel={cancelColorPopover}
    />}
    {tableSizePopover && <TableSizePickerPopover
      x={tableSizePopover.x}
      y={tableSizePopover.y}
      onInsert={(rows, columns) => {
        setTableSizePopover(null);
        insertTable(rows, columns);
        runtime.focus();
      }}
      onCancel={() => {
        setTableSizePopover(null);
        runtime.focus();
      }}
    />}
    {tableBorderPopover && <TableBorderPopover
      x={tableBorderPopover.x}
      y={tableBorderPopover.y}
      initial={tableBorderPopover.initial}
      recentColors={recentColors.border}
      onPreview={previewCellBorder}
      onApply={applyCellBorderCommit}
      onCancel={cancelTableBorderPopover}
    />}
    {blockquoteBorderPopover && <BlockquoteBorderPopover
      x={blockquoteBorderPopover.x}
      y={blockquoteBorderPopover.y}
      initial={blockquoteBorderPopover.initial}
      recentColors={recentColors.border}
      onPreview={previewBlockquoteBorder}
      onApply={applyBlockquoteBorderCommit}
      onCancel={cancelBlockquoteBorderPopover}
    />}
    {mediaDetailsPopover && <MediaDetailsPopover
      x={mediaDetailsPopover.x}
      y={mediaDetailsPopover.y}
      initial={mediaDetailsPopover.initial}
      onApply={applyMediaDetails}
      onCancel={() => { setMediaDetailsPopover(null); runtime.focus(); }}
    />}
    {formulaLibraryPopover && <FormulaLibraryPopover
      x={formulaLibraryPopover.x}
      y={formulaLibraryPopover.y}
      onInsert={insertFormulaFromLibrary}
      onCancel={() => { setFormulaLibraryPopover(null); runtime.focus(); }}
    />}
    {specialCharPopover && <SpecialCharacterPopover
      x={specialCharPopover.x}
      y={specialCharPopover.y}
      recentCharacters={recentSpecialChars}
      onInsert={insertSpecialCharacter}
      onCancel={() => { setSpecialCharPopover(null); runtime.focus(); }}
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
        const linkedMedia = (event.target as Element | null)?.closest<HTMLElement>("[data-smart-href]");
        if ((anchor || linkedMedia) && (event.metaKey || event.ctrlKey)) event.preventDefault();
      }}
      onClick={(event) => {
        const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
        // An image atom with a Link set (docs/bugs/media-details-old-editor-field-parity.md)
        // - plain data attributes, not a real <a> wrapper, in the live DOM
        // (see surface/renderer.ts's own reasoning); Ctrl/Cmd+click opens it
        // the same way a real text link does, matching this project's only
        // existing link-opening convention rather than inventing a second one.
        const linkedMedia = (event.target as Element | null)?.closest<HTMLElement>("[data-smart-href]");
        const href = anchor?.href || linkedMedia?.getAttribute("data-smart-href");
        if (href && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        const imageTarget = (event.target as Element | null)?.closest<HTMLElement>("[data-smart-type=\"image\"], [data-smart-type=\"block_image\"]");
        if (!imageTarget) return;
        setMediaContextMenu(null);
        const mappedImage = runtime.surface.renderer?.mapping.domToNode(imageTarget);
        if (mappedImage) setMediaResizeTarget({ nodeId: mappedImage.nodeId });
      }}
      onContextMenu={(event) => {
        if (readOnly) return;
        event.preventDefault();
        setMediaContextMenu(null);
        // Atom selection (unlike caret/text placement) is not native
        // browser behavior - it's InputController's own clickListener
        // (surface/input.ts), bound to the "click" DOM event, which never
        // fires for a right-click. Without this, right-clicking an atom
        // directly (no preceding left-click) left whatever selection was
        // already there in place, so atomic-node scope never resolved and
        // the media interaction (details editor for images, quick-action
        // menu for other media) never appeared - right-clicking media looked
        // like right-clicking nothing. Mirrors clickListener's own
        // atom-selection logic
        // exactly.
        const atomTarget = (event.target as Element | null)?.closest<HTMLElement>("[data-smart-atomic]");
        const mapped = atomTarget ? runtime.surface.renderer?.mapping.domToNode(atomTarget) : null;
        if (mapped && !isTextNode(mapped.node) && runtime.editor.schema.nodes[mapped.node.type]?.selectable === true) {
          const range = runtime.editor.positions.rangeOf(mapped.nodeId);
          if (range) {
            runtime.editor.setSelection({ type: "node", anchor: range.from, head: range.to }, { source: "api" });
            runtime.surface.renderer?.render(runtime.editor.document, runtime.editor.selection);
          }
          if (mapped.node.type !== "unknown") {
            setContextMenu(null);
            const isImage = mapped.node.type === "image" || mapped.node.type === "block_image";
            if (isImage) {
              const scope = runtime.editor.resolveScope({ want: "atomic-node" }) as ResolvedScope;
              setMediaResizeTarget({ nodeId: mapped.nodeId });
              if (scope.kind === "atomic-node") openMediaDetails(scope, mapped.node, atomTarget || undefined);
              return;
            }
            setMediaContextMenu({ x: event.clientX, y: event.clientY, nodeId: mapped.nodeId });
            return;
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
        // A right-click that is not handled by the media branch above and
        // does not resolve to a table cell or a blockquote opens no
        // generic menu. Table cell checked first: a right-click inside a
        // table nested inside a blockquote should still show cell
        // options, matching "closest/innermost container wins."
        const rightClickTableScope = runtime.editor.resolveScope({ want: "table-grid" });
        if ("kind" in rightClickTableScope && rightClickTableScope.kind === "table-grid") {
          setContextMenu({ x: event.clientX, y: event.clientY });
        } else if (findBlockquoteAncestor()) {
          setContextMenu({ x: event.clientX, y: event.clientY });
        }
      }}
      style={{ minHeight, maxHeight, overflow: "auto" }}
    />
  </section>;
});
