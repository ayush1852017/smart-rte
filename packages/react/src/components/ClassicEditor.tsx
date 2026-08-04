import React, { useEffect, useRef, useState } from "react";
import { MediaManager, MediaManagerAdapter, MediaItem } from "./MediaManager.js";
import { LinkEditorPopover, type LinkEditorApplyValue } from "./LinkEditorPopover.js";
import { getSmartListPreset, isSmartListPreset, listStyleForPresetDepth, sanitizeLinkHref, SMART_LIST_PRESETS, type CoreFeatureConfig, type SmartListPreset } from 'smartrte-core/legacy';
import { executeDomMoveCommand } from '../adapters/domMoveCommandBridge.js';
import { executeDomCodeInput } from '../adapters/domBlockCommandBridge.js';
import { adjacentInlineAtom } from '../adapters/domInlineAtomCommandBridge.js';
import { serializeSmartDocument } from '../adapters/domSmartDocument.js';
import { closestFromTarget, isNode } from '../adapters/domTargets.js';
import { ensureStyleSheet, SrteTheme } from '../theme.js';
import { createReactEditorPluginRuntime, matchesPluginShortcut, type ReactContextMenuContribution, type ReactEditorPlugin, type ReactKeyboardShortcutContribution, type ReactToolbarContribution } from '../pluginRuntime.js';
import { createEditorFormatRuntime, type EditorFormatConfig, type EditorFormatDefinition, type EditorFormatExportResult } from '../formatRuntime.js';
import { createBuiltInFormatDefinitions } from '../builtInFormatDefinitions.js';
import { createDomEditorController, type DomEditorController } from '../editorController.js';
import {
  executeCanonicalListCheck,
  executeCanonicalListDepth,
  executeCanonicalListMove,
  executeCanonicalListStyle,
  executeCanonicalListToggle,
  executeCanonicalListStructuralInput,
} from '../adapters/canonicalListCommandBridge.js';
import {
  executeCanonicalInlineTool,
  canonicalInlineStoredMarks,
  describeCanonicalInlineCoverage,
  hasCanonicalInlineStoredMarkOverride,
  installCanonicalInlineStoredMarkInput,
  type CanonicalInlineToolId,
} from '../adapters/canonicalInlineCommandBridge.js';

type ToolbarIconName =
  | "undo" | "redo" | "align-left" | "align-center" | "align-right" | "justify"
  | "move" | "up" | "down" | "outdent" | "indent" | "link" | "quote" | "code"
  | "checklist" | "bullets" | "numbers" | "image" | "media" | "table" | "formula"
  | "insert" | "import" | "export" | "omega" | "more" | "chevron";

const iconPaths: Record<ToolbarIconName, React.ReactNode> = {
  undo: <><path d="M9 7 5 11l4 4"/><path d="M5 11h7a5 5 0 0 1 5 5"/></>,
  redo: <><path d="m15 7 4 4-4 4"/><path d="M19 11h-7a5 5 0 0 0-5 5"/></>,
  "align-left": <><path d="M4 6h16M4 10h11M4 14h16M4 18h11"/></>,
  "align-center": <><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></>,
  "align-right": <><path d="M4 6h16M9 10h11M4 14h16M9 18h11"/></>,
  justify: <><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></>,
  move: <><path d="m8 7 4-4 4 4M12 3v18M8 17l4 4 4-4"/></>,
  up: <><path d="m7 10 5-5 5 5M12 5v14"/></>,
  down: <><path d="m7 14 5 5 5-5M12 19V5"/></>,
  outdent: <><path d="M11 6h9M11 10h7M11 14h9M11 18h7M8 9l-3 3 3 3"/></>,
  indent: <><path d="M11 6h9M11 10h7M11 14h9M11 18h7M4 9l3 3-3 3"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14"/></>,
  quote: <><path d="M6 15h4V9H5v6a4 4 0 0 1-1 2.7M15 15h4V9h-5v6a4 4 0 0 1-1 2.7"/></>,
  code: <><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/></>,
  checklist: <><path d="m4 6 1.5 1.5L8 5M11 6h9M4 12l1.5 1.5L8 11M11 12h9M4 18l1.5 1.5L8 17M11 18h9"/></>,
  bullets: <><circle cx="5" cy="6" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/></>,
  numbers: <><path d="M4 6h1V3.8L4 4.5M4 11h2l-2 2h2M4 17h2l-2 2h2M10 6h10M10 12h10M10 18h10"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></>,
  media: <><path d="M4 7h6l2 2h8v10H4z"/><path d="M8 14h8M12 11v6"/></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 4v16"/></>,
  formula: <><path d="M18 5H8l5 7-5 7h10"/></>,
  insert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
  import: <><path d="M12 3v12M8 11l4 4 4-4M5 20h14"/></>,
  export: <><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></>,
  omega: <><path d="M7 19h4v-2a7 7 0 1 1 2 0v2h4"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
};

function ToolbarIcon({ name, size = 16 }: { name: ToolbarIconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

function ToolbarGroup({ label, priority, children }: { label: string; priority?: number; children: React.ReactNode }) {
  return <div className="srte-toolbar-group" role="group" aria-label={label} data-srte-priority={priority || 1}>{children}</div>;
}

function ToolbarMenu({ label, icon, active, priority, children }: { label: string; icon: ToolbarIconName; active?: boolean; priority?: number; children: React.ReactNode }) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);
  return (
    <details
      ref={menuRef}
      className="srte-toolbar-menu"
      data-srte-priority={priority}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          menuRef.current?.removeAttribute("open");
          menuRef.current?.querySelector<HTMLElement>("summary")?.focus();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
        if (!items.length) return;
        event.preventDefault();
        const currentIndex = items.indexOf(document.activeElement as HTMLElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        items[(currentIndex + direction + items.length) % items.length]?.focus();
      }}
    >
      <summary className={`srte-tool-button srte-menu-trigger${active ? " srte-active" : ""}`} aria-label={label} title={label}>
        <ToolbarIcon name={icon}/><ToolbarIcon name="chevron" size={12}/>
      </summary>
      <div className="srte-menu" role="menu" aria-label={label}>{children}</div>
    </details>
  );
}

function MenuItem({ icon, label, active, disabled, onClick, title }: { icon: ToolbarIconName; label: string; active?: boolean; disabled?: boolean; onClick: () => void; title?: string }) {
  return <button type="button" role="menuitem" className="srte-menu-item" aria-label={title || label} aria-pressed={Boolean(active)} aria-checked={active || undefined} disabled={disabled} title={title || label} onClick={(event) => { onClick(); (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open"); }}><ToolbarIcon name={icon}/><span>{label}</span>{active && <span className="srte-menu-check" aria-hidden="true">✓</span>}</button>;
}

export type ClassicEditorProps = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  readOnly?: boolean;
  // feature toggles
  table?: boolean;
  media?: boolean;
  formula?: boolean;
  /** Filters the standard plugin preset. Supersedes legacy table/media/formula toggles. */
  features?: CoreFeatureConfig;
  /** Exact core plugin set. When provided, `features` and legacy feature toggles are ignored. */
  plugins?: readonly ReactEditorPlugin[];
  /** Independently enables or disables HTML, Markdown, DOCX, and PDF import/export. */
  formats?: EditorFormatConfig;
  /** Exact format definitions. Built-in ids may be replaced and proprietary formats may be added. */
  formatDefinitions?: readonly EditorFormatDefinition[];
  mediaManager?: MediaManagerAdapter;
  /**
   * Optional custom list of fonts to display in the toolbar.
   * If not provided, a default set of web-safe fonts will be used.
   * Example: [{ name: 'Robto', value: 'Roboto, sans-serif' }]
   */
  fonts?: { name: string; value: string }[];
  /**
   * The default font family to apply to the editor content.
   * This sets the font-family style of the editable area.
   * Example: "Arial, sans-serif"
   */
  defaultFont?: string;
  /**
   * Preserve font-family styles from pasted/imported content.
   * Defaults to false so host applications can keep a single app font while
   * still preserving bold, italic, headings, lists, tables, and colors.
   */
  preserveFontFamily?: boolean;
  /**
   * Preserve foreground/background colors from pasted/imported content.
   * Defaults to false so dark-mode editors remain readable when content is
   * copied from sources such as Google Docs with hardcoded black-on-white styles.
   */
  preserveColors?: boolean;
  /**
   * Preserve visual styling from imported DOCX files except font-family.
   * This keeps Word-authored colors, spacing, borders, and table fills while
   * still allowing the host app to control the editor font.
   */
  preserveDocxStyles?: boolean;
  /**
   * Theme mode for the editor.
   * - "light" (default): Uses the built-in light theme.
   * - "dark": Uses the built-in dark theme.
   */
  theme?: SrteTheme;
  /**
   * Show the inline font-size dropdown in the toolbar.
   * Defaults to true. Heading block controls are independent of this option.
   */
  showFontSize?: boolean;
  /**
   * Additional CSS class name(s) to apply to the editor's root element.
   * Useful for custom theming by overriding CSS custom properties.
   * Example: className="my-editor-theme"
   */
  className?: string;
};

export function ClassicEditor({
  value,
  onChange,
  placeholder = "Type here…",
  minHeight = 200,
  maxHeight = 500,
  readOnly = false,
  table: legacyTable = true,
  media: legacyMedia = true,
  formula: legacyFormula = true,
  features,
  plugins,
  formats,
  formatDefinitions,
  mediaManager,
  fonts = [
    { name: "Arial", value: "Arial, Helvetica, sans-serif" },
    { name: "Georgia", value: "Georgia, serif" },
    { name: "Impact", value: "Impact, Charcoal, sans-serif" },
    { name: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
    { name: "Times New Roman", value: "'Times New Roman', Times, serif" },
    { name: "Verdana", value: "Verdana, Geneva, sans-serif" },
    { name: "Courier New", value: "'Courier New', Courier, monospace" },
  ],
  defaultFont,
  preserveFontFamily = false,
  preserveColors = false,
  preserveDocxStyles = true,
  theme = "light",
  showFontSize = true,
  className,
}: ClassicEditorProps) {
  ensureStyleSheet();
  const pluginRuntime = createReactEditorPluginRuntime({
    ...(plugins ? { plugins } : {
      features: {
        ...features,
        table: features?.table ?? legacyTable,
        media: features?.media ?? legacyMedia,
        formula: features?.formula ?? legacyFormula,
      },
    }),
  });
  const formatRuntime = createEditorFormatRuntime(
    formats,
    [
      ...(formatDefinitions ?? createBuiltInFormatDefinitions({ preserveDocxStyles })),
      ...pluginRuntime.formats,
    ],
  );
  const proxyFormatLabel = (format: EditorFormatDefinition) => format.id === "docx" ? "Word" : format.label;
  const proxyExportFormats = [
    ...(["html", "markdown", "docx", "pdf"] as const).flatMap((id) => formatRuntime.exports.filter((format) => format.id === id)),
    ...formatRuntime.exports.filter((format) => !["html", "markdown", "docx", "pdf"].includes(format.id)),
  ];
  const table = pluginRuntime.hasFeature("table");
  const media = pluginRuntime.hasFeature("media");
  const formula = pluginRuntime.hasFeature("formula");
  const listFeature = pluginRuntime.hasFeature("list");
  const checklistFeature = pluginRuntime.hasFeature("checklist");
  const blockquoteFeature = pluginRuntime.hasFeature("blockquote");
  const codeBlockFeature = pluginRuntime.hasFeature("codeBlock");
  const alignmentFeature = pluginRuntime.hasFeature("alignment");
  const blockTypeFeature = pluginRuntime.hasFeature("blockType");
  const basicFormattingFeature = pluginRuntime.hasFeature("basicFormatting");
  const moveFeature = pluginRuntime.hasFeature("move");
  type ActiveState = {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikeThrough: boolean;
    subscript: boolean;
    superscript: boolean;
    checklist: boolean;
    unorderedList: boolean;
    orderedList: boolean;
    blockquote: boolean;
    codeBlock: boolean;
    link: boolean;
  };

  type LinkMenuState = {
    x: number;
    y: number;
    anchor?: HTMLAnchorElement;
    range: Range | null;
    initialHref: string;
    initialText: string;
    showTextInput: boolean;
  };

  const editableRef = useRef<HTMLDivElement | null>(null);
  const editorControllerRef = useRef<DomEditorController | null>(null);
  if (!editorControllerRef.current) editorControllerRef.current = createDomEditorController();
  editorControllerRef.current.configure({
    plugins: pluginRuntime.plugins,
    readOnly,
  });
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");
  const isComposingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingDocx, setLoadingDocx] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    file: File;
    definition: EditorFormatDefinition;
  } | null>(null);
  const replaceTargetRef = useRef<HTMLImageElement | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(
    null
  );
  const [imageOverlay, setImageOverlay] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const resizingRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);
  const draggedImageRef = useRef<HTMLImageElement | null>(null);
  const draggedBlockRef = useRef<HTMLElement | null>(null);
  const dragHandleHideTimerRef = useRef<number | null>(null);
  const [dragHandle, setDragHandle] = useState<{
    left: number;
    top: number;
    height: number;
    target: HTMLElement;
  } | null>(null);
  const tableResizeRef = useRef<{
    type: 'column' | 'row';
    table: HTMLTableElement;
    index: number;
    startPos: number;
    startSize: number;
    cells: HTMLTableCellElement[];
  } | null>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [showFormulaDialog, setShowFormulaDialog] = useState(false);
  const [formulaInput, setFormulaInput] = useState("E=mc^2");
  const [tableMenu, setTableMenu] = useState<{
    x: number;
    y: number;
    cell: HTMLTableCellElement;
  } | null>(null);
  const selectionRef = useRef<{
    tbody: HTMLTableSectionElement;
    sr: number;
    sc: number;
    er: number;
    ec: number;
  } | null>(null);
  const tableFillTargetsRef = useRef<HTMLTableCellElement[] | null>(null);
  const selectingRef = useRef<{
    tbody: HTMLTableSectionElement;
    start: HTMLTableCellElement;
  } | null>(null);
  const [imageMenu, setImageMenu] = useState<{
    x: number;
    y: number;
    img: HTMLImageElement;
  } | null>(null);
  const [pluginContextMenu, setPluginContextMenu] = useState<{
    x: number;
    y: number;
    items: readonly ReactContextMenuContribution[];
  } | null>(null);
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null);
  const [showMediaManager, setShowMediaManager] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSpecialChars, setShowSpecialChars] = useState(false);
  const [colorPickerType, setColorPickerType] = useState<'text' | 'background'>('text');
  const savedRangeRef = useRef<Range | null>(null);
  const inputHistoryGroupRef = useRef<{
    inputType: string;
    timestamp: number;
  } | null>(null);
  const [currentFontSize, setCurrentFontSize] = useState<string>("");
  const [currentFont, setCurrentFont] = useState<string>("");
  const [currentBlockType, setCurrentBlockType] = useState<"p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "mixed">("p");
  const [currentAlignment, setCurrentAlignment] = useState<"left" | "center" | "right" | "justify" | "mixed">("left");
  const [currentTextColor, setCurrentTextColor] = useState("#000000");
  const [currentBackgroundColor, setCurrentBackgroundColor] = useState("#ffffff");
  const [activeState, setActiveState] = useState<ActiveState>({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    subscript: false,
    superscript: false,
    checklist: false,
    unorderedList: false,
    orderedList: false,
    blockquote: false,
    codeBlock: false,
    link: false,
  });
  const [partialInlineMarks, setPartialInlineMarks] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    // Initialize with provided HTML only when externally controlled value changes
    if (typeof value === "string" && value !== el.innerHTML) {
      el.innerHTML = value || "";
      fixNegativeMargins(el);
      ensureTableWrappers(el);
      ensureCaretBoundaryParagraphs(el);
      addTableResizeHandles();
    }
    ensureCaretBoundaryParagraphs(el);
    // Suppress native context menu inside table cells at capture phase
    const onCtx = (evt: Event) => {
      const target = evt.target as Node | null;
      const cell = getClosestCell(target);
      if (cell) {
        evt.preventDefault();
      }
    };
    el.addEventListener("contextmenu", onCtx, { capture: true });
    return () => {
      el.removeEventListener("contextmenu", onCtx, { capture: true } as any);
    };
  }, [value]);

  const parseFontSizePx = (value: string) => {
    const match = /^([\d.]+)(px|pt)?$/i.exec(value.trim());
    if (!match) return null;
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return match[2]?.toLowerCase() === "pt" ? numeric * 4 / 3 : numeric;
  };

  const explicitFontSizeAt = (node: Node) => {
    let element = node instanceof HTMLElement ? node : node.parentElement;
    while (element && element !== editableRef.current) {
      const parsed = parseFontSizePx(element.style.fontSize);
      if (parsed) return parsed;
      element = element.parentElement;
    }
    return null;
  };

  const resolveFontSizeForRange = (range: Range) => {
    const editor = editableRef.current;
    const storedSize = editor && hasCanonicalInlineStoredMarkOverride(editor)
      ? canonicalInlineStoredMarks(editor).find((mark) => mark.type === "fontSize")?.attrs?.valuePx
      : undefined;
    if (range.collapsed && typeof storedSize === "number") return String(Math.round(storedSize));
    if (range.collapsed) {
      const explicit = explicitFontSizeAt(range.startContainer);
      return explicit ? String(Math.round(explicit)) : "";
    }
    if (!editor) return "";
    const sizes = new Set<number>();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      try {
        if (range.intersectsNode(node) && node.textContent) {
          const size = explicitFontSizeAt(node);
          if (size) sizes.add(Math.round(size));
          else sizes.add(0);
        }
      } catch {}
      if (sizes.size > 1) return "";
      node = walker.nextNode();
    }
    const only = Array.from(sizes)[0];
    return only ? String(only) : "";
  };

  const updateActiveState = () => {
    const editor = editableRef.current;
    if (!editor) return;
    try {
      const sel = window.getSelection();
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      const inEditor = range && editor.contains(range.commonAncestorContainer);
      if (!inEditor) return;
      let node: Node | null = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      const element = node instanceof HTMLElement ? node : null;
      const block = element?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div") as HTMLElement | null;
      const tag = block?.tagName.toLowerCase();
      const queryState = (command: string) =>
        typeof document.queryCommandState === "function" && document.queryCommandState(command);
      const subscriptActive =
        queryState("subscript") || Boolean(element?.closest("sub"));
      const superscriptActive =
        queryState("superscript") || Boolean(element?.closest("sup"));
      const storedOverride = hasCanonicalInlineStoredMarkOverride(editor);
      const storedTypes = new Set(canonicalInlineStoredMarks(editor).map((mark) => mark.type));
      const markCoverage = describeCanonicalInlineCoverage(editor);
      setPartialInlineMarks(new Set(Object.entries(markCoverage).filter(([, coverage]) => coverage === "partial").map(([type]) => type)));
      if (!range.collapsed) {
        const formattingBlocks = getSelectedBlocks(range);
        [range.startContainer, range.endContainer].forEach((endpoint) => {
          const endpointElement = endpoint instanceof HTMLElement ? endpoint : endpoint.parentElement;
          const endpointBlock = endpointElement?.closest("p,h1,h2,h3,h4,h5,h6,li") as HTMLElement | null;
          if (endpointBlock && editor.contains(endpointBlock) && !formattingBlocks.includes(endpointBlock)) {
            formattingBlocks.push(endpointBlock);
          }
        });
        const types = new Set(formattingBlocks.map((selectedBlock) => {
          const contentBlock = selectedBlock.tagName === "LI"
            ? selectedBlock.querySelector(":scope > p,:scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > h5,:scope > h6")
            : selectedBlock;
          const selectedTag = contentBlock?.tagName.toLowerCase() || "p";
          return /^h[1-6]$/.test(selectedTag) ? selectedTag : "p";
        }));
        setCurrentBlockType(types.size > 1 ? "mixed" : (Array.from(types)[0] || "p") as typeof currentBlockType);
      } else {
        setCurrentBlockType(/^h[1-6]$/.test(tag || "") ? tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6" : "p");
      }
      setCurrentFontSize(resolveFontSizeForRange(range));
      const colorTarget = getRangeStartElement(range) || editor;
      setCurrentTextColor(cssColorToHex(window.getComputedStyle(colorTarget).color) || "#000000");
      setCurrentBackgroundColor(getEffectiveBackgroundHex(colorTarget) || "#ffffff");
      const alignmentTargets = getAlignmentTargets(range);
      const alignments = new Set(alignmentTargets.map(readTextAlignment));
      setCurrentAlignment(alignments.size > 1 ? "mixed" : Array.from(alignments)[0] || "left");
      setActiveState({
        bold: storedOverride ? storedTypes.has("bold") : markCoverage.bold === "all" || queryState("bold"),
        italic: storedOverride ? storedTypes.has("italic") : markCoverage.italic === "all" || queryState("italic"),
        underline: storedOverride ? storedTypes.has("underline") : markCoverage.underline === "all" || queryState("underline"),
        strikeThrough: storedOverride ? storedTypes.has("strike") : markCoverage.strike === "all" || queryState("strikeThrough"),
        subscript: storedOverride ? storedTypes.has("subscript") : subscriptActive,
        superscript: storedOverride ? storedTypes.has("superscript") : superscriptActive,
        checklist: Boolean(element?.closest('[data-srte-checklist="true"]')),
        unorderedList: Boolean(element?.closest("ul:not([data-srte-checklist=\"true\"])")),
        orderedList: Boolean(element?.closest("ol")),
        blockquote: Boolean(element?.closest("blockquote")),
        codeBlock: Boolean(element?.closest("pre")),
        link: Boolean(element?.closest("a")),
      });
    } catch {}
  };

  // Save selection whenever it changes
  useEffect(() => {
    const saveSelection = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const editor = editableRef.current;
        if (editor && editor.contains(range.commonAncestorContainer)) {
          savedRangeRef.current = range.cloneRange();
          updateActiveState();
        }
      }
    };

    document.addEventListener('selectionchange', saveSelection);
    return () => {
      document.removeEventListener('selectionchange', saveSelection);
    };
  }, []);

  useEffect(() => {
    const editor = editableRef.current;
    return editor ? installCanonicalInlineStoredMarkInput(editor) : undefined;
  }, []);

  const exec = (command: string, valueArg?: string) => {
    try {
      if (command === "undo" && restoreEditorHistory("undo")) return;
      if (command === "redo" && restoreEditorHistory("redo")) return;
      if (!restoreSavedSelection()) {
        safeSelectRange(getSelectionRangeInEditor());
      }
      if (command === "insertUnorderedList") {
        toggleList("ul");
        return;
      }
      if (command === "insertOrderedList") {
        toggleList("ol");
        return;
      }
      pushEditorHistory();
      const editor = editableRef.current;
      const inlineTool = ({
        bold: "bold", italic: "italic", underline: "underline", strikeThrough: "strikethrough",
        superscript: "superscript", subscript: "subscript",
      } as Record<string, CanonicalInlineToolId>)[command];
      if (inlineTool && editor) {
        const result = executeCanonicalInlineTool(editor, inlineTool, "toggle");
        if (result.changed) handleInput();
        updateActiveState();
        return;
      }
      if (command === "createLink" && editor) {
        const result = executeCanonicalInlineTool(editor, "link", "apply", { href: valueArg || "" });
        if (result.changed) handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }
      if (command === "unlink" && editor) {
        const result = executeCanonicalInlineTool(editor, "link", "remove");
        if (result.changed) handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }
      editorControllerRef.current?.discardLastHistorySnapshot();
    } catch {}
  };

  const toggleInlineScript = (command: "subscript" | "superscript") => {
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const editor = editableRef.current;
      const range = getSelectionRangeInEditor();
      if (!editor || !range) return;
      if (!range.collapsed) pushEditorHistory();
      const result = executeCanonicalInlineTool(editor, command, "toggle");
      if (result.changed) handleInput();
      updateActiveState();
    } catch {}
  };

  const applyFormatBlock = (blockName: string) => {
    if (!blockTypeFeature) return;
    try {
      if (!restoreSavedSelection()) {
        safeSelectRange(getSelectionRangeInEditor());
      }
      pushEditorHistory();
      const range = getSelectionRangeInEditor();
      const tag = normalizeBlockTag(blockName);
      const blocks = range
        ? (range.collapsed
          ? [getCurrentBlock()].filter((block): block is HTMLElement => Boolean(block))
          : getSelectedBlocks(range))
        : [];
      if (!tag || !(tag === "p" || /^h[1-6]$/.test(tag)) || blocks.length === 0) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      const targets = blocks.map((block) => block.closest("li") as HTMLElement | null || block);
      const groups = new Map<HTMLElement, HTMLElement[]>();
      targets.forEach((target) => {
        const parent = target.parentElement;
        if (parent) groups.set(parent, [...(groups.get(parent) || []), target]);
      });
      const replacements = Array.from(groups.values()).flatMap((group) =>
        editorControllerRef.current!.bindRoot(editableRef.current).executeBlockCommand(group, {
          id: "block-type.set",
          input: tag === "p"
            ? { type: "paragraph" }
            : { type: "heading", level: Number(tag.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 },
        }) || []);
      if (!replacements.length) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      focusElementEnd(replacements[replacements.length - 1]);
      setCurrentBlockType(tag as "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const emitChange = () => {
    const el = editableRef.current;
    if (!el || !onChange) return;
    const html = el.innerHTML;
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  };

  const pushEditorHistory = (preserveInputGroup = false) => {
    const editor = editableRef.current;
    if (!editor) return;
    if (!preserveInputGroup) inputHistoryGroupRef.current = null;
    const selectionCells = selectionRef.current
      ? getCellsInGridRect(
          selectionRef.current.tbody,
          selectionRef.current.sr,
          selectionRef.current.sc,
          selectionRef.current.er,
          selectionRef.current.ec
        )
      : [];
    const decor = selectionCells.map((cell) => ({
      cell,
      background: cell.style.background,
      outline: cell.style.outline,
      outlineOffset: cell.style.outlineOffset,
      previousBackground: (cell as any).__rtePrevBg,
    }));
    decor.forEach(({ cell, previousBackground }) => {
      if (previousBackground != null) cell.style.background = previousBackground || "";
      cell.style.outline = "";
      cell.style.outlineOffset = "";
    });
    const html = editor.innerHTML;
    decor.forEach(({ cell, background, outline, outlineOffset }) => {
      cell.style.background = background;
      cell.style.outline = outline;
      cell.style.outlineOffset = outlineOffset;
    });
    editorControllerRef.current!.bindRoot(editor).recordHistorySnapshot(html);
  };

  const restoreEditorHistory = (dir: "undo" | "redo") => {
    const editor = editableRef.current;
    if (!editor) return false;
    const restored = editorControllerRef.current!.bindRoot(editor).restoreHistory(dir);
    if (!restored) return false;
    const html = restored.html;
    fixNegativeMargins(editor);
    ensureTableWrappers(editor);
    ensureCaretBoundaryParagraphs(editor);
    addTableResizeHandles();
    clearSelectionDecor();
    setTableMenu(null);
    inputHistoryGroupRef.current = null;
    focusElementEnd(editor);
    requestAnimationFrame(updateActiveState);
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange?.(html);
    }
    return true;
  };

  const captureInputHistory = (inputType: string) => {
    const now = Date.now();
    const previous = inputHistoryGroupRef.current;
    const groupable =
      inputType === "insertText" ||
      inputType === "deleteContentBackward" ||
      inputType === "deleteContentForward";
    const continuesGroup =
      groupable &&
      previous?.inputType === inputType &&
      now - previous.timestamp < 1000;

    if (!continuesGroup) pushEditorHistory(true);
    inputHistoryGroupRef.current = { inputType, timestamp: now };
  };

  const restoreSavedSelection = () => {
    const editor = editableRef.current;
    if (!editor) return false;
    const saved = savedRangeRef.current;
    if (saved && editor.contains(saved.commonAncestorContainer)) {
      editor.focus({ preventScroll: true });
      safeSelectRange(saved.cloneRange());
      return true;
    }
    editor.focus({ preventScroll: true });
    return false;
  };

  const preserveEditorSelection = () => {
    const editor = editableRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  };

  const getSelectedAnchor = () => {
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    if (!editor || !range) return null;
    const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer as Element | null;
    const anchor = node?.closest?.("a") as HTMLAnchorElement | null;
    return anchor && editor.contains(anchor) ? anchor : null;
  };

  const selectAnchorContents = (anchor: HTMLAnchorElement) => {
    const range = document.createRange();
    range.selectNodeContents(anchor);
    safeSelectRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const getRangeRect = (range: Range | null) => {
    if (!range || typeof range.getBoundingClientRect !== "function") return null;
    const rect = range.getBoundingClientRect();
    return rect.width || rect.height ? rect : null;
  };

  const openLinkEditor = (existingAnchor?: HTMLAnchorElement | null) => {
    const editor = editableRef.current;
    if (!editor) return;
    const anchor = existingAnchor || getSelectedAnchor();
    const range = anchor
      ? (() => {
          const anchorRange = document.createRange();
          anchorRange.selectNodeContents(anchor);
          return anchorRange;
        })()
      : getSelectionRangeInEditor();
    const rect = anchor?.getBoundingClientRect() || getRangeRect(range) || editor.getBoundingClientRect();
    setLinkMenu({
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
      y: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 180)),
      anchor: anchor || undefined,
      range: range ? range.cloneRange() : null,
      initialHref: anchor?.getAttribute("href") || "",
      initialText: anchor?.textContent || (range && !range.collapsed ? range.toString() : ""),
      showTextInput: Boolean(anchor || !range || range.collapsed),
    });
  };

  const applyLinkEditorValue = (value: LinkEditorApplyValue) => {
    const state = linkMenu;
    if (!state) return;
    setLinkMenu(null);
    if (state.anchor) {
      pushEditorHistory();
      selectAnchorContents(state.anchor);
      const result = executeCanonicalInlineTool(editableRef.current!, "link", "editLink", {
        href: value.href,
        ...(value.openInNewTab ? { target: "_blank" } : {}),
      });
      const updated = getSelectedAnchor();
      if (updated && value.text != null && value.text !== updated.textContent) updated.textContent = value.text;
      if (result.changed) handleInput();
      return;
    }

    if (state.range) safeSelectRange(state.range.cloneRange());
    if (state.range && !state.range.collapsed) {
      pushEditorHistory();
      const result = executeCanonicalInlineTool(editableRef.current!, "link", "apply", {
        href: value.href,
        ...(value.openInNewTab ? { target: "_blank" } : {}),
      });
      if (result.changed) handleInput();
      return;
    }

    if (!value.text) return;
    pushEditorHistory();
    executeCanonicalInlineTool(editableRef.current!, "link", "apply", {
      href: value.href,
      ...(value.openInNewTab ? { target: "_blank" } : {}),
    });
    editableRef.current!.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true, cancelable: true, inputType: "insertText", data: value.text,
    }));
    handleInput();
  };

  const removeAnchorLink = (anchor: HTMLAnchorElement) => {
    selectAnchorContents(anchor);
    exec("unlink");
    setLinkMenu(null);
  };

  const openEditorLink = (anchor: HTMLAnchorElement) => {
    const safeHref = sanitizeLinkHref(anchor.getAttribute("href"));
    if (!safeHref) return;

    try {
      const url = new URL(safeHref, window.location.href);
      if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return;

      const target = anchor.getAttribute("target") || "_blank";
      const opened = window.open(url.href, target, target === "_blank" ? "noopener,noreferrer" : undefined);
      if (opened && target === "_blank") opened.opener = null;
    } catch {}
  };

  const getSelectionRangeInEditor = () => {
    const editor = editableRef.current;
    if (!editor) return null;

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) return range;
    }

    if (savedRangeRef.current && editor.contains(savedRangeRef.current.commonAncestorContainer)) {
      return savedRangeRef.current.cloneRange();
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  };

  const getCurrentBlock = () => {
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    if (!editor || !range) return null;
    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const element = node instanceof HTMLElement ? node : null;
    const cell = element?.closest("td,th") as HTMLTableCellElement | null;
    if (cell && editor.contains(cell)) {
      const cellBlock = element?.closest("p,h1,h2,h3,h4,h5,h6,blockquote,pre") as HTMLElement | null;
      if (cellBlock && cell.contains(cellBlock)) return cellBlock;
      const directBlock = Array.from(cell.children).find((child) => child.matches("p,h1,h2,h3,h4,h5,h6,blockquote,pre"));
      if (directBlock instanceof HTMLElement) return directBlock;
      return cell;
    }
    const block = element?.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div") as HTMLElement | null;
    if (!block || block === editor || block.getAttribute("data-table-wrapper") === "true" || !editor.contains(block)) return null;
    return block;
  };

  const blockSelector = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div";

  const getSelectedBlocks = (range: Range) => {
    const editor = editableRef.current;
    if (!editor) return [];
    if (range.collapsed) {
      const current = getCurrentBlock();
      return current ? [current] : [];
    }
    const startElement = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer as Element;
    const endElement = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer as Element;
    const startCell = startElement?.closest?.("td,th") as HTMLTableCellElement | null;
    const endCell = endElement?.closest?.("td,th") as HTMLTableCellElement | null;
    const scope: HTMLElement = startCell && startCell === endCell && editor.contains(startCell) ? startCell : editor;
    const blocks = Array.from(scope.querySelectorAll<HTMLElement>(blockSelector)).filter((block) => {
      if (block === editor || block.getAttribute("data-table-wrapper") === "true") return false;
      const parentBlock = block.parentElement?.closest(blockSelector) as HTMLElement | null;
      if (parentBlock && scope.contains(parentBlock) && parentBlock !== scope) return false;
      try {
        if (!range.intersectsNode(block)) return false;
        const parent = block.parentNode;
        if (parent === range.endContainer) {
          const index = Array.prototype.indexOf.call(parent.childNodes, block) as number;
          if (range.endOffset <= index) return false;
        }
        if (parent === range.startContainer) {
          const index = Array.prototype.indexOf.call(parent.childNodes, block) as number;
          if (range.startOffset > index) return false;
        }
        return true;
      } catch {
        return false;
      }
    });
    if (blocks.length > 0) return sortInDocumentOrder(blocks);
    const current = getCurrentBlock();
    return current ? [current] : [];
  };

  const resolveSelectedListItems = (range: Range) => {
    const editor = editableRef.current;
    if (!editor) return [];
    if (range.collapsed) {
      const element = range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
      const item = element?.closest("li") as HTMLElement | null;
      return item && editor.contains(item) ? [item] : [];
    }

    const ownsSelectedContent = (item: HTMLElement) =>
      Array.from(item.childNodes).some((node) => {
        if (node instanceof HTMLElement && (node.matches("ul,ol") || node.dataset.srteCheck === "true")) return false;
        try {
          return range.intersectsNode(node);
        } catch {
          return false;
        }
      });

    return sortInDocumentOrder(
      Array.from(editor.querySelectorAll<HTMLElement>("li")).filter(ownsSelectedContent)
    );
  };

  const getAlignmentTarget = (block: HTMLElement) => {
    const item = block.tagName === "LI" ? block : block.closest("li");
    return item instanceof HTMLElement ? item : block;
  };

  const getAlignmentTargets = (range: Range) => {
    const editor = editableRef.current;
    if (!editor) return [];
    const tableSelection = selectionRef.current;
    const rangeElement = range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement;
    const rangeCell = rangeElement?.closest("td,th") as HTMLTableCellElement | null;
    const selectedCells = tableSelection && rangeCell && isCellInsideSelection(rangeCell)
      ? getCellsInGridRect(
          tableSelection.tbody,
          tableSelection.sr,
          tableSelection.sc,
          tableSelection.er,
          tableSelection.ec
        )
      : [];
    const candidates = selectedCells.length > 0
      ? selectedCells.flatMap((cell) => {
          const blocks = Array.from(cell.children).filter((child): child is HTMLElement =>
            child instanceof HTMLElement && child.matches("p,h1,h2,h3,h4,h5,h6,blockquote,pre")
          );
          return blocks.length > 0 ? blocks : [cell];
        })
      : getSelectedBlocks(range).map(getAlignmentTarget);
    const seen = new Set<HTMLElement>();
    return candidates.filter((target) => {
      if (!editor.contains(target) || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
  };

  const readTextAlignment = (target: HTMLElement): "left" | "center" | "right" | "justify" => {
    const explicit = target.style.textAlign;
    if (explicit === "center" || explicit === "right" || explicit === "justify") return explicit;
    const inherited = target.closest("blockquote[style*='text-align']") as HTMLElement | null;
    const inheritedValue = inherited?.style.textAlign;
    return inheritedValue === "center" || inheritedValue === "right" || inheritedValue === "justify"
      ? inheritedValue
      : "left";
  };

  const applyTextAlignment = (alignment: "left" | "center" | "right" | "justify") => {
    if (!alignmentFeature) return;
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      if (!range) return;
      const targets = getAlignmentTargets(range);
      if (targets.length === 0) return;
      pushEditorHistory();
      const tableCells = targets.filter((target) => target.matches("td,th"));
      const blockTargets = targets.filter((target) => !target.matches("td,th"));
      const groups = new Map<HTMLElement, HTMLElement[]>();
      blockTargets.forEach((target) => {
        const parent = target.parentElement;
        if (parent) groups.set(parent, [...(groups.get(parent) || []), target]);
      });
      const replacements = Array.from(groups.values()).flatMap((group) =>
        editorControllerRef.current!.bindRoot(editableRef.current).executeBlockCommand(group, {
          id: "alignment.set",
          input: { alignment },
        }) || []);
      // LEGACY_TABLE_TOUCHPOINT: direct-cell-alignment owner=Phase6. A bare
      // table cell is not a Phase 5 block; the Phase 6 grid command will own it.
      tableCells.forEach((target) => {
        target.style.textAlign = alignment === "left" ? "" : alignment;
        if (!target.getAttribute("style")) target.removeAttribute("style");
      });
      if (!replacements.length && !tableCells.length) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      safeSelectRange(range);
      savedRangeRef.current = range.cloneRange();
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const normalizeBlockTag = (blockName: string) => {
    const tag = blockName.replace(/[<>]/g, "").toLowerCase() || "p";
    return /^(p|h1|h2|h3|h4|h5|h6|pre|blockquote)$/.test(tag) ? tag : null;
  };

  const sortInDocumentOrder = (elements: HTMLElement[]) => {
    return [...elements].sort((a, b) => {
      if (a === b) return 0;
      const position = a.compareDocumentPosition(b);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  };

  const cloneListShell = (list: HTMLElement, tagName?: "ul" | "ol") => {
    const clone = document.createElement(tagName || (list.tagName.toLowerCase() as "ul" | "ol"));
    Array.from(list.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
    return clone;
  };

  const clearChecklist = (list: HTMLElement) => {
    delete list.dataset.srteChecklist;
    delete list.dataset.srteChecklistStrike;
    list.querySelectorAll(':scope > li > [data-srte-check]').forEach((control) => control.remove());
    Array.from(list.children).forEach((item) => {
      if (item instanceof HTMLElement) {
        delete item.dataset.checked;
        item.style.textDecoration = "";
      }
    });
  };

  const syncChecklistItemControl = (item: HTMLElement, strikeCompleted: boolean) => {
    const legacyCheckbox = item.querySelector(':scope > input[data-srte-check]') as HTMLInputElement | null;
    const checked = item.dataset.smartChecked === "true" || item.dataset.checked === "true" || Boolean(legacyCheckbox?.checked);
    const controls = Array.from(item.querySelectorAll<HTMLElement>(':scope > [data-srte-check]'));
    let control = controls.find((candidate) => candidate.tagName === "BUTTON") as HTMLButtonElement | undefined;
    controls.forEach((candidate) => {
      if (candidate !== control) candidate.remove();
    });
    if (!control) {
      control = document.createElement("button");
      control.type = "button";
      control.dataset.srteCheck = "true";
      control.dataset.smartUi = "check-control";
      control.contentEditable = "false";
      control.tabIndex = -1;
      control.style.cssText = "border:0;padding:0;background:transparent;color:inherit;font:inherit;cursor:pointer";
      item.prepend(control);
    }
    item.dataset.checked = checked ? "true" : "false";
    item.dataset.smartChecked = checked ? "true" : "false";
    control.dataset.checked = checked ? "true" : "false";
    control.setAttribute("aria-pressed", checked ? "true" : "false");
    control.setAttribute("aria-label", checked ? "Mark incomplete" : "Mark complete");
    control.textContent = "";
    item.style.textDecoration = strikeCompleted && checked ? "line-through" : "";
  };

  const syncChecklistControls = (root: HTMLElement) => {
    root.querySelectorAll<HTMLElement>('ul[data-srte-checklist="true"],ul[data-smart-checkable="true"]').forEach((list) => {
      const strikeCompleted = list.dataset.srteChecklistStrike === "true";
      Array.from(list.children).forEach((item) => {
        if (item instanceof HTMLElement && item.tagName === "LI") syncChecklistItemControl(item, strikeCompleted);
      });
    });
  };

  const focusElementEnd = (element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    safeSelectRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const applyListDepthChange = (items: HTMLElement[], direction: "indent" | "outdent") => {
    if (!listFeature) return false;
    const canonicalRoot = editableRef.current;
    if (!canonicalRoot) return false;
    pushEditorHistory();
    const canonicalChanged = executeCanonicalListDepth(canonicalRoot, items, direction);
    if (canonicalChanged) {
      syncChecklistControls(canonicalRoot);
      handleInput();
      requestAnimationFrame(updateActiveState);
    } else editorControllerRef.current!.discardLastHistorySnapshot();
    return canonicalChanged;
  };

  const applyListOrderChange = (items: HTMLElement[], direction: "up" | "down") => {
    if (!moveFeature) return false;
    const canonicalRoot = editableRef.current;
    if (!canonicalRoot) return false;
    pushEditorHistory();
    const changed = executeCanonicalListMove(canonicalRoot, items, direction);
    if (!changed) {
      editorControllerRef.current!.discardLastHistorySnapshot();
      return false;
    }
    syncChecklistControls(canonicalRoot);
    handleInput();
    requestAnimationFrame(updateActiveState);
    return true;
  };

  const listStylesForRoot = (listTag: "ul" | "ol", rootStyle?: string) => {
    if (listTag === "ul") {
      if (rootStyle === "circle") return ["circle", "square", "disc"];
      if (rootStyle === "square") return ["square", "circle", "disc"];
      return ["disc", "circle", "square"];
    }
    if (rootStyle === "upper-alpha") return ["upper-alpha", "lower-alpha", "lower-roman"];
    if (rootStyle === "upper-roman") return ["upper-roman", "upper-alpha", "decimal"];
    // Legacy single-style choices remain stable across the first nested level.
    // Depth-aware families are represented by named presets above.
    if (rootStyle === "lower-alpha") return ["lower-alpha", "lower-alpha", "lower-roman"];
    if (rootStyle === "lower-roman") return ["lower-roman", "lower-roman", "lower-alpha"];
    if (rootStyle === "decimal-leading-zero") return ["decimal-leading-zero", "lower-alpha", "lower-roman"];
    return ["decimal", "lower-alpha", "lower-roman"];
  };

  const clearListPreset = (list: HTMLElement) => {
    delete list.dataset.srteListPreset;
    delete list.dataset.srteListDepth;
    delete list.dataset.srteListMarker;
  };

  const applyListPreset = (list: HTMLElement, preset: SmartListPreset, depth: number) => {
    const definition = getSmartListPreset(preset);
    list.dataset.srteListPreset = preset;
    list.dataset.srteListDepth = String(depth);
    list.style.listStyleType = listStyleForPresetDepth(preset, depth);
    const marker = definition.markers?.[Math.min(depth, definition.markers.length - 1)];
    if (marker) list.dataset.srteListMarker = marker;
    else delete list.dataset.srteListMarker;
  };

  const applyListPresetHierarchy = (list: HTMLElement, preset: SmartListPreset, depth = 0) => {
    applyListPreset(list, preset, depth);
    Array.from(list.children).forEach((item) => {
      if (!(item instanceof HTMLElement) || item.tagName !== "LI") return;
      Array.from(item.children).forEach((child) => {
        if (child instanceof HTMLElement && child.matches("ul,ol")) {
          applyListPresetHierarchy(child, preset, depth + 1);
        }
      });
    });
  };

  const defaultListStyleAtDepth = (listTag: "ul" | "ol", depth: number, rootStyle?: string) => {
    const styles = listStylesForRoot(listTag, rootStyle);
    return styles[Math.min(depth, styles.length - 1)];
  };

  const restyleDescendantLists = (item: HTMLElement, listTag: "ul" | "ol", depth = 1, rootStyle?: string, preset?: SmartListPreset) => {
    Array.from(item.children).forEach((child) => {
      if (!(child instanceof HTMLElement) || !child.matches("ul,ol")) return;
      const replacement = child.tagName.toLowerCase() === listTag
        ? child
        : cloneListShell(child, listTag);
      if (replacement !== child) {
        while (child.firstChild) replacement.appendChild(child.firstChild);
        child.replaceWith(replacement);
      }
      clearChecklist(replacement);
      if (preset) applyListPreset(replacement, preset, depth);
      else {
        clearListPreset(replacement);
        replacement.style.listStyleType = defaultListStyleAtDepth(listTag, depth, rootStyle);
      }
      Array.from(replacement.children).forEach((nestedItem) => {
        if (nestedItem instanceof HTMLElement && nestedItem.tagName === "LI") {
          restyleDescendantLists(nestedItem, listTag, depth + 1, rootStyle, preset);
        }
      });
    });
  };

  const applyListStyle = (value: string) => {
    if (!listFeature) return;
    const canonicalRoot = editableRef.current;
    if (!canonicalRoot) return;
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
    const canonicalRange = getSelectionRangeInEditor();
    if (!canonicalRange) return;
    const canonicalTag = value.startsWith("ordered:") || value.startsWith("ordered-preset:") ? "ol" : "ul";
    const canonicalRequestedPreset = value.replace(/^(ordered|bullet)-preset:/, "");
    const canonicalPreset: SmartListPreset | undefined = isSmartListPreset(canonicalRequestedPreset) ? canonicalRequestedPreset as SmartListPreset : undefined;
    const canonicalStyle = canonicalPreset ? undefined : value.replace(/^(ordered|bullet):/, "");
    const canonicalItems = resolveSelectedListItems(canonicalRange);
    const canonicalBlocks = getSelectedBlocks(canonicalRange);
    pushEditorHistory();
    let canonicalChanged = canonicalItems.length
      ? executeCanonicalListStyle({ root: canonicalRoot, items: canonicalItems, style: canonicalStyle, preset: canonicalPreset, checkable: false })
      : false;
    const canonicalPlainBlocks = canonicalBlocks.filter((block) => !block.closest("ul,ol"));
    if (canonicalPlainBlocks.length || !canonicalItems.length) {
      canonicalChanged = executeCanonicalListToggle({
        root: canonicalRoot, items: [], blocks: canonicalBlocks, listTag: canonicalTag,
        range: canonicalRange, style: canonicalStyle, preset: canonicalPreset, checkable: false,
      }) || canonicalChanged;
    }
    if (!canonicalItems.length && canonicalChanged && (canonicalPreset || canonicalStyle)) {
      const updatedRange = getSelectionRangeInEditor();
      const updatedItems = updatedRange ? resolveSelectedListItems(updatedRange) : [];
      if (updatedItems.length) canonicalChanged = executeCanonicalListStyle({ root: canonicalRoot, items: updatedItems, style: canonicalStyle, preset: canonicalPreset, checkable: false }) || canonicalChanged;
    }
    if (canonicalChanged) {
      handleInput();
      requestAnimationFrame(updateActiveState);
    } else editorControllerRef.current!.discardLastHistorySnapshot();
    return;
  };

  const applyChecklist = (strikeCompleted = false, toggleOff = false) => {
    if (!checklistFeature) return;
    const canonicalRoot = editableRef.current;
    if (!canonicalRoot) return;
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
    const canonicalRange = getSelectionRangeInEditor();
    if (!canonicalRange) return;
    let canonicalItems = resolveSelectedListItems(canonicalRange);
    const hadCanonicalItems = canonicalItems.length > 0;
    pushEditorHistory();
    let canonicalChanged = false;
    if (!canonicalItems.length) {
      canonicalChanged = executeCanonicalListToggle({
        root: canonicalRoot, items: [], blocks: getSelectedBlocks(canonicalRange), listTag: "ul",
        range: canonicalRange, style: "disc", checkable: true,
      });
      const updatedRange = getSelectionRangeInEditor();
      canonicalItems = updatedRange ? resolveSelectedListItems(updatedRange) : [];
    }
    if (toggleOff && hadCanonicalItems && canonicalItems.length && canonicalItems.every((item) => item.parentElement?.dataset.srteChecklist === "true")) {
      canonicalChanged = executeCanonicalListToggle({ root: canonicalRoot, items: canonicalItems, blocks: [], listTag: "ul", range: canonicalRange }) || canonicalChanged;
      canonicalItems = [];
    }
    if (canonicalItems.length) canonicalChanged = executeCanonicalListStyle({
      root: canonicalRoot,
      items: canonicalItems,
      style: "disc",
      checkable: !(toggleOff && hadCanonicalItems),
    }) || canonicalChanged;
    if (canonicalChanged) {
      canonicalRoot.querySelectorAll<HTMLElement>('[data-smart-checkable="true"],[data-srte-checklist="true"]').forEach((list) => {
        list.dataset.srteChecklistStrike = strikeCompleted ? "true" : "false";
      });
      syncChecklistControls(canonicalRoot);
      handleInput();
      requestAnimationFrame(updateActiveState);
    } else editorControllerRef.current!.discardLastHistorySnapshot();
    return;
  };

  const toggleList = (listTag: "ul" | "ol") => {
    if (!listFeature) return;
    const editor = editableRef.current;
    if (!editor) return;
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
    const canonicalRange = getSelectionRangeInEditor();
    if (!canonicalRange) return;
    const canonicalItems = resolveSelectedListItems(canonicalRange);
    const canonicalBlocks = getSelectedBlocks(canonicalRange);
    pushEditorHistory();
    const canonicalChanged = executeCanonicalListToggle({ root: editor, items: canonicalItems, blocks: canonicalBlocks, listTag, range: canonicalRange });
    if (canonicalChanged) {
      handleInput();
      requestAnimationFrame(updateActiveState);
    } else editorControllerRef.current!.discardLastHistorySnapshot();
    return;
  };

  const insertTextAtSelection = (text: string) => {
    if (!text) return;
    try {
      const range = getSelectionRangeInEditor();
      if (!range) return;
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      const nextRange = document.createRange();
      nextRange.setStartAfter(node);
      nextRange.collapse(true);
      safeSelectRange(nextRange);
      handleInput();
    } catch {}
  };

  const toggleBlockquote = () => {
    if (!blockquoteFeature) return;
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      const editor = editableRef.current;
      if (!editor || !range) return;
      const rangeNode = range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const activeQuote = rangeNode?.closest("blockquote") as HTMLElement | null;
      const outerList = (block: HTMLElement) => {
        let list = block.closest<HTMLElement>("ul,ol");
        while (list?.parentElement?.closest("li")?.parentElement?.matches("ul,ol")) {
          list = list.parentElement.closest("li")!.parentElement as HTMLElement;
        }
        return list;
      };
      const raw = activeQuote && editor.contains(activeQuote)
        ? [activeQuote]
        : (range.collapsed
          ? [getCurrentBlock()].filter((block): block is HTMLElement => Boolean(block))
          : getSelectedBlocks(range));
      const targets = sortInDocumentOrder([...new Set(raw.map((block) => outerList(block) || block))])
        .filter((block) => block !== editor && editor.contains(block));
      if (!targets.length) return;
      const groups = new Map<HTMLElement, HTMLElement[]>();
      targets.forEach((target) => {
        const parent = target.parentElement;
        if (parent) groups.set(parent, [...(groups.get(parent) || []), target]);
      });
      pushEditorHistory();
      const replacements = Array.from(groups.values()).flatMap((group) =>
        editorControllerRef.current!.bindRoot(editor).executeBlockCommand(group, { id: "blockquote.toggle" }) || []);
      if (!replacements.length) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      focusElementEnd(replacements[replacements.length - 1]);
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const toggleCodeBlock = () => {
    if (!codeBlockFeature) return;
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const editor = editableRef.current;
      const range = getSelectionRangeInEditor();
      if (!editor || !range) return;

      const blocks = (range.collapsed
        ? [getCurrentBlock()].filter((block): block is HTMLElement => Boolean(block))
        : getSelectedBlocks(range)
      ).filter((block) => editor.contains(block));
      if (blocks.length === 0) return;
      const selectedItems = resolveSelectedListItems(range);
      const plainBlocks = blocks.filter((block) => !block.closest("li"));
      const targets = sortInDocumentOrder([...new Set([...selectedItems, ...plainBlocks])]);
      const allTargetsActive = targets.every((target) => target.tagName === "PRE"
        || Boolean(target.querySelector(":scope > pre")));
      const groups = new Map<HTMLElement, HTMLElement[]>();
      targets.forEach((target) => {
        const parent = target.parentElement;
        if (parent) groups.set(parent, [...(groups.get(parent) || []), target]);
      });
      pushEditorHistory();
      const replacements = Array.from(groups.values()).flatMap((group) =>
        editorControllerRef.current!.bindRoot(editor).executeBlockCommand(group, {
          id: "code-block.toggle", input: { active: !allTargetsActive },
        }) || []);
      if (!replacements.length) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      focusElementEnd(replacements[replacements.length - 1]);
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const applyFontSize = (size: string) => {
    try {
      const editor = editableRef.current;
      if (!editor) return;
      const valuePx = Number(size);
      if (!Number.isFinite(valuePx) || valuePx <= 0) return;
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      if (!range) return;
      setCurrentFontSize(String(Math.round(valuePx)));
      if (!range.collapsed) pushEditorHistory();
      const result = executeCanonicalInlineTool(editor, "fontSize", "apply", { valuePx });
      if (result.changed) handleInput();
      requestAnimationFrame(updateActiveState);
    } catch (error) {
      console.error('Error applying font size:', error);
    }
  };

  const applyFontFamily = (font: string) => {
    try {
      setCurrentFont(font);
      const editor = editableRef.current;
      if (!editor) return;
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      if (!range) return;
      if (!range.collapsed) pushEditorHistory();
      const result = executeCanonicalInlineTool(editor, "fontFamily", "apply", { value: font });
      if (result.changed) handleInput();
      requestAnimationFrame(updateActiveState);
    } catch (error) {
      console.error('Error applying font family:', error);
    }
  };

  const parseCssColor = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "transparent") return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized);
    if (hex) {
      const raw = hex[1].length === 3
        ? hex[1].split("").map((part) => part + part).join("")
        : hex[1];
      return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
      };
    }

    const rgb = /^rgba?\(([^)]+)\)$/.exec(normalized);
    if (!rgb) return null;
    const parts = rgb[1].split(",").map((part) => Number(part.trim()));
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
    if (parts.length >= 4 && parts[3] === 0) return null;
    return {
      r: Math.max(0, Math.min(255, parts[0])),
      g: Math.max(0, Math.min(255, parts[1])),
      b: Math.max(0, Math.min(255, parts[2])),
    };
  };

  const cssColorToHex = (value: string) => {
    const color = parseCssColor(value);
    if (!color) return "";
    const toHex = (part: number) =>
      Math.round(part).toString(16).padStart(2, "0");
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  };

  const getRangeStartElement = (range: Range | null) => {
    const editor = editableRef.current;
    if (!editor || !range) return null;
    let node: Node | null = range.startContainer;

    if (node === editor && editor.childNodes[range.startOffset]) {
      node = editor.childNodes[range.startOffset];
    }

    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node instanceof HTMLElement && editor.contains(node) ? node : null;
  };

  const getEffectiveBackgroundHex = (element: HTMLElement | null) => {
    const editor = editableRef.current;
    let current = element;
    while (current) {
      const inline = cssColorToHex(current.style.backgroundColor || current.style.background);
      if (inline) return inline;
      const computed = typeof window !== "undefined"
        ? cssColorToHex(window.getComputedStyle(current).backgroundColor)
        : "";
      if (computed) return computed;
      if (current === editor) break;
      current = current.parentElement;
    }
    return "";
  };

  const currentPickerColorHex = () => {
    if (typeof window === "undefined") return colorPickerType === "text" ? "#000000" : "#ffffff";
    const editor = editableRef.current;
    if (!editor) return colorPickerType === "text" ? "#000000" : "#ffffff";

    const element = getRangeStartElement(getSelectionRangeInEditor() || savedRangeRef.current);
    if (colorPickerType === "background") {
      return getEffectiveBackgroundHex(element) || "#ffffff";
    }

    const target = element || editor;
    return cssColorToHex(window.getComputedStyle(target).color) || "#000000";
  };

  const relativeLuminance = (color: { r: number; g: number; b: number }) => {
    const channel = (value: number) => {
      const next = value / 255;
      return next <= 0.03928 ? next / 12.92 : Math.pow((next + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };

  const contrastRatio = (fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }) => {
    const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
    const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
    return (lighter + 0.05) / (darker + 0.05);
  };

  const readableTextColorForBackground = (background: string) => {
    const bg = parseCssColor(background);
    if (!bg) return "";
    const candidates = ["#111827", "#f9fafb", "#1f2937", "#ffffff", "#000000", "#374151", "#e5e7eb"];
    return candidates
      .map((candidate) => ({
        color: candidate,
        ratio: contrastRatio(parseCssColor(candidate)!, bg),
      }))
      .sort((a, b) => b.ratio - a.ratio)[0]?.color || "";
  };

  const applyInlineColor = (type: "text" | "background", color: string) => {
    try {
      const editor = editableRef.current;
      if (!editor) return;
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      if (!range) return;
      if (!range.collapsed) pushEditorHistory();
      const result = executeCanonicalInlineTool(
        editor,
        type === "text" ? "textColor" : "backgroundColor",
        "apply",
        { value: color },
      );
      if (result.changed) handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const applyTextColor = (color: string) => applyInlineColor("text", color);
  const applyBackgroundColor = (color: string) => applyInlineColor("background", color);


  const insertImage = () => {
    if (!media) return;
    fileInputRef.current?.click();
  };

  const scheduleImageOverlay = () => {
    const img = selectedImage;
    const scroller = editorScrollRef.current;
    if (!img) {
      setImageOverlay(null);
      return;
    }
    try {
      const rect = img.getBoundingClientRect();
      const hostRect = scroller?.getBoundingClientRect();
      setImageOverlay({
        left: hostRect && scroller ? rect.left - hostRect.left + scroller.scrollLeft : rect.left,
        top: hostRect && scroller ? rect.top - hostRect.top + scroller.scrollTop : rect.top,
        width: rect.width,
        height: rect.height,
      });
    } catch {
      setImageOverlay(null);
    }
  };

  useEffect(() => {
    scheduleImageOverlay();
  }, [selectedImage]);

  useEffect(() => {
    const onScroll = () => scheduleImageOverlay();
    const onResize = () => scheduleImageOverlay();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Table resize event listeners
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    
    addTableResizeHandles();
    
    const onMouseDown = (e: MouseEvent) => {
      if (!table) return;
      
      const target = e.target as Node;
      const cell = getClosestCell(target);
      
      if (cell) {
        const rect = cell.getBoundingClientRect();
        const rightEdge = rect.right;
        const clickX = e.clientX;
        
        if (Math.abs(clickX - rightEdge) < 5) {
          e.preventDefault();
          const tableElem = cell.closest('table') as HTMLTableElement;
          const colIndex = parseInt(cell.getAttribute('data-col-index') || '0', 10);
          if (tableElem) {
            startColumnResize(tableElem, colIndex, e.clientX);
          }
          return;
        }
        
        const bottomEdge = rect.bottom;
        const clickY = e.clientY;
        
        if (Math.abs(clickY - bottomEdge) < 5) {
          e.preventDefault();
          const tableElem = cell.closest('table') as HTMLTableElement;
          const row = cell.closest('tr') as HTMLTableRowElement;
          if (tableElem && row) {
            const rowIndex = parseInt(row.getAttribute('data-row-index') || '0', 10);
            startRowResize(tableElem, rowIndex, e.clientY);
          }
          return;
        }
      }
    };
    
    const onMouseMove = (e: MouseEvent) => {
      if (tableResizeRef.current) {
        handleTableResizeMove(e);
        return;
      }
      
      if (!table) return;
      
      let cursor = '';
      const target = e.target as Node;
      const cell = getClosestCell(target);
      
      if (cell) {
        const rect = cell.getBoundingClientRect();
        const clickX = e.clientX;
        const clickY = e.clientY;
        
        if (Math.abs(clickX - rect.right) < 5) {
          cursor = 'col-resize';
        } else if (Math.abs(clickY - rect.bottom) < 5) {
          cursor = 'row-resize';
        }
      }
      
      if (cursor) {
        el.style.cursor = cursor;
      } else if (el.style.cursor === 'col-resize' || el.style.cursor === 'row-resize') {
        el.style.cursor = '';
      }
    };
    
    const onMouseUp = () => {
      handleTableResizeEnd();
    };
    
    const onTouchStart = (e: TouchEvent) => {
      if (!table) return;
      
      const target = e.target as Node;
      const cell = getClosestCell(target);

      if (cell) {
        const rect = cell.getBoundingClientRect();
        const touch = e.touches[0];
        const clickX = touch.clientX;
        const clickY = touch.clientY;
        
        if (Math.abs(clickX - rect.right) < 15) {
          e.preventDefault();
          const tableElem = cell.closest('table') as HTMLTableElement;
          const colIndex = parseInt(cell.getAttribute('data-col-index') || '0', 10);
          if (tableElem) {
            startColumnResize(tableElem, colIndex, clickX);
          }
          return;
        }
        
        if (Math.abs(clickY - rect.bottom) < 15) {
          e.preventDefault();
          const tableElem = cell.closest('table') as HTMLTableElement;
          const row = cell.closest('tr') as HTMLTableRowElement;
          if (tableElem && row) {
            const rowIndex = parseInt(row.getAttribute('data-row-index') || '0', 10);
            startRowResize(tableElem, rowIndex, clickY);
          }
          return;
        }
      }
    };
    
    const onTouchMove = (e: TouchEvent) => {
      if (tableResizeRef.current) {
        handleTableResizeMove(e);
      }
    };
    
    const onTouchEnd = () => {
      handleTableResizeEnd();
    };
    
    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    el.addEventListener('touchstart', onTouchStart, { passive: false } as any);
    window.addEventListener('touchmove', onTouchMove, { passive: false } as any);
    window.addEventListener('touchend', onTouchEnd);
    
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [table]);


  const insertImageAtSelection = (srcOrItem: string | Pick<MediaItem, "url"> & Partial<MediaItem> & { status?: "pending" | "ready" | "error"; uploadId?: string; error?: string }) => {
    try {
      const host = editableRef.current;
      if (!host) return;
      const src = typeof srcOrItem === "string" ? srcOrItem : srcOrItem.url;
      const suppliedAlt = typeof srcOrItem === "string" ? undefined : (srcOrItem.alt || srcOrItem.title);
      const alt = suppliedAlt ?? window.prompt("Describe this image. Leave blank only when it is decorative.", "");
      if (alt === null) return;
      host.focus();
      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !host.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(host);
        range.collapse(false);
        safeSelectRange(range);
      }
      const coreImage = editorControllerRef.current!.bindRoot(host).insertInlineImage({
        src,
        alt,
        decorative: alt === "",
        ...("status" in Object(srcOrItem) && (srcOrItem as { status?: string }).status ? { status: (srcOrItem as { status: "pending" | "ready" | "error" }).status } : {}),
        ...("uploadId" in Object(srcOrItem) && (srcOrItem as { uploadId?: string }).uploadId ? { uploadId: (srcOrItem as { uploadId: string }).uploadId } : {}),
        ...("error" in Object(srcOrItem) && (srcOrItem as { error?: string }).error ? { error: (srcOrItem as { error: string }).error } : {}),
        ...(typeof srcOrItem !== "string" && srcOrItem.title ? { title: srcOrItem.title } : {}),
      });
      if (coreImage) {
        coreImage.draggable = true;
        coreImage.style.maxWidth = "100%";
        coreImage.style.height = "auto";
        coreImage.style.display = "inline-block";
        if (typeof srcOrItem !== "string") {
          if (srcOrItem.license?.author) coreImage.dataset.licenseAuthor = srcOrItem.license.author;
          if (srcOrItem.license?.licenseType) coreImage.dataset.licenseType = srcOrItem.license.licenseType;
          if (srcOrItem.license?.licenseText) coreImage.dataset.licenseText = srcOrItem.license.licenseText;
          if (srcOrItem.license?.sourceUrl) coreImage.dataset.licenseUrl = srcOrItem.license.sourceUrl;
          if (srcOrItem.license?.workName) coreImage.dataset.workName = srcOrItem.license.workName;
        }
        setSelectedImage(coreImage);
        scheduleImageOverlay();
        handleInput();
        return coreImage;
      }
      console.warn("[Smart RTE atom] canonical image insertion rejected the input.");
    } catch {}
    return null;
  };

  const safeSelectRange = (range: Range | null) => {
    try {
      if (!range) return;
      const start = range.startContainer as Node | null;
      if (!start || !(start as any).isConnected) return;
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  };

  const insertFormulaAtSelection = (tex: string) => {
    if (!tex) return;
    if (!formula) return;
    try {
      const host = editableRef.current;
      if (!host) return;
      restoreSavedSelection();
      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      if (!range || !host.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(host);
        range.collapse(false);
        safeSelectRange(range);
      }
      pushEditorHistory();
      const span = editorControllerRef.current!.bindRoot(host).insertFormula({
        value: tex,
        displayText: `$${tex}$`,
      });
      if (span) {
        try {
          const katex = (window as any).katex;
          if (katex && typeof katex.render === "function") {
            katex.render(tex, span, { throwOnError: false, trust: false, strict: "error" });
          }
        } catch {}
        const next = document.createRange();
        next.setStartAfter(span);
        next.collapse(true);
        safeSelectRange(next);
        savedRangeRef.current = next.cloneRange();
        handleInput();
        return;
      }
      console.warn("[Smart RTE atom] canonical formula insertion rejected the input.");
    } catch {}
  };

  const normalizeShortcutToLatex = (input: string) => {
    let s = (input || "").trim();
    if (!s) return "";
    // Basic wrappers
    s = s.replace(/sqrt\(([^()]*)\)/g, (_m, a) => `\\sqrt{${a}}`);
    s = s.replace(
      /frac\(([^,]+)\s*,\s*([^\)]+)\)/g,
      (_m, a, b) => `\\frac{${a}}{${b}}`
    );
    // Inequalities and arrows
    s = s
      .replace(/>=/g, `\\geq`)
      .replace(/<=/g, `\\leq`)
      .replace(/!=/g, `\\ne`)
      .replace(/->/g, `\\to`);
    // Common operators
    s = s
      .replace(/\blim\b/g, `\\lim`)
      .replace(/\bsum\b/g, `\\sum`)
      .replace(/\bprod\b/g, `\\prod`)
      .replace(/\bint\b/g, `\\int`);
    // Greek letters (subset)
    const greek: Record<string, string> = {
      alpha: `\\alpha`,
      beta: `\\beta`,
      gamma: `\\gamma`,
      delta: `\\delta`,
      theta: `\\theta`,
      lambda: `\\lambda`,
      mu: `\\mu`,
      pi: `\\pi`,
      sigma: `\\sigma`,
      phi: `\\phi`,
      omega: `\\omega`,
      Delta: `\\Delta`,
      Pi: `\\Pi`,
      Sigma: `\\Sigma`,
      Omega: `\\Omega`,
    };
    s = s.replace(/([A-Za-z]+)\b/g, (m) => greek[m] || m);
    return s;
  };

  const handleLocalImageFiles = async (files: FileList | File[]) => {
    if (!media) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (mediaManager) {
      const pending = list.map((file) => {
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const preview = URL.createObjectURL(file);
        return { file, uploadId, preview, image: insertImageAtSelection({ url: preview, alt: file.name, status: "pending", uploadId }) };
      });
      try {
        const uploaded = await mediaManager.upload(list);
        uploaded.forEach((item, index) => {
          const entry = pending[index];
          if (!entry?.image || !editableRef.current?.contains(entry.image)) return;
          editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(entry.image, {
            src: item.url, alt: item.alt || item.title || entry.file.name, status: "ready", uploadId: undefined, error: undefined,
          });
          URL.revokeObjectURL(entry.preview);
        });
        handleInput();
        return;
      } catch (error) {
        pending.forEach((entry) => {
          if (entry.image && editableRef.current?.contains(entry.image)) editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(entry.image, { status: "error", uploadId: undefined, error: error instanceof Error ? error.message : "Upload failed" });
        });
        handleInput();
        return;
      }
    }
    for (const f of list) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          if (dataUrl) insertImageAtSelection(dataUrl);
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsDataURL(f);
      });
    }
  };

  const getExportableDocument = () => {
    return editorControllerRef.current!
      .bindRoot(editableRef.current)
      .getDocument();
  };

  const downloadFormatResult = (result: EditorFormatExportResult) => {
    if (result.kind === "handled") return;
    const blob = result.kind === "blob"
      ? result.content
      : new Blob([result.content], { type: result.mediaType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const processFormatImport = async (
    definition: EditorFormatDefinition,
    file: File,
    mode: "replace" | "append",
  ) => {
    if (!definition.importFile) return;
    if (definition.id === "pdf") setLoadingPdf(true);
    if (definition.id === "docx") setLoadingDocx(true);
    try {
      const imported = await definition.importFile(file, { ownerDocument: document });
      insertImportedHtml(
        imported.layoutHtml || serializeSmartDocument(imported.document),
        mode,
        {
          preserveColors: imported.preserveColors ?? true,
          preserveDocumentLayout: imported.preserveDocumentLayout ?? true,
        },
      );
    } catch (error) {
      console.error(`Error importing ${definition.label}:`, error);
    } finally {
      if (definition.id === "pdf") setLoadingPdf(false);
      if (definition.id === "docx") setLoadingDocx(false);
      setPendingImport(null);
    }
  };

  const openFormatImport = (formatId: string) => {
    const definition = formatRuntime.get(formatId);
    if (!definition?.importFile || !formatRuntime.canImport(formatId)) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = definition.accept || `.${definition.extension}`;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const hasContent = Boolean(editableRef.current?.textContent?.trim());
      if (hasContent && definition.confirmImportWhenNotEmpty) {
        setPendingImport({ file, definition });
        return;
      }
      void processFormatImport(definition, file, hasContent ? "append" : "replace");
    };
    input.click();
  };

  const runFormatExport = async (formatId: string) => {
    const definition = formatRuntime.get(formatId);
    if (!definition || !formatRuntime.canExport(formatId)) return;
    if (!definition.exportDocument) return;
    const result = await definition.exportDocument(getExportableDocument(), {
      ownerDocument: document,
      hostWindow: window,
    });
    downloadFormatResult(result);
  };

  const fixNegativeMargins = (root: HTMLElement) => {
    try {
      const nodes = root.querySelectorAll<HTMLElement>('*');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.style && node.style.marginLeft && node.style.marginLeft.trim().startsWith('-')) {
          node.style.marginLeft = '0px';
        }
      }
    } catch {}
  };

  type CleanHtmlOptions = {
    preserveColors?: boolean;
    preserveDocumentLayout?: boolean;
  };

  const cleanPastedHtml = (html: string, options: CleanHtmlOptions = {}) => {
    const shouldPreserveColors = options.preserveColors ?? preserveColors;
    const shouldPreserveDocumentLayout = options.preserveDocumentLayout ?? false;
    const template = document.createElement('template');
    template.innerHTML = html
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b\u200c\u200d]/g, '');

    template.content.querySelectorAll('meta, link, style, script').forEach((node) => node.remove());

    // LEGACY_LIST_TOUCHPOINT: imported-list-normalization owner=Phase8
    const allowedStyleNames = new Set([
      'font-weight',
      'font-style',
      'text-decoration',
      'text-align',
      'vertical-align',
      'border',
      'border-top',
      'border-right',
      'border-bottom',
      'border-left',
      'border-collapse',
      'padding',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'list-style-type',
      'white-space',
    ]);
    if (preserveFontFamily) allowedStyleNames.add('font-family');
    if (shouldPreserveColors) {
      allowedStyleNames.add('color');
      allowedStyleNames.add('background');
      allowedStyleNames.add('background-color');
    }
    if (shouldPreserveDocumentLayout) {
      [
        'font-size',
        'line-height',
        'margin',
        'margin-top',
        'margin-right',
        'margin-bottom',
        'margin-left',
        'text-indent',
        'width',
        'min-width',
      ].forEach((name) => allowedStyleNames.add(name));
    }

    template.content.querySelectorAll<HTMLElement>('*').forEach((node) => {
      const className = node.getAttribute('class');
      if (className !== 'srte-preserve-colors') node.removeAttribute('class');
      node.removeAttribute('id');
      if (!shouldPreserveDocumentLayout) {
        node.removeAttribute('width');
        node.removeAttribute('height');
      }

      const style = node.getAttribute('style');
      if (!style) return;

      const safeRules = style
        .split(';')
        .map((rule) => rule.trim())
        .filter(Boolean)
        .filter((rule) => {
          const separator = rule.indexOf(':');
          if (separator === -1) return false;
          const name = rule.slice(0, separator).trim().toLowerCase();
          const value = rule.slice(separator + 1).trim().toLowerCase();
          if (!allowedStyleNames.has(name)) return false;
          if (value.includes('position') || value.includes('expression') || value.includes('javascript:')) return false;
          if (name === 'white-space' && value !== 'pre-wrap') return false;
          if ((name === 'width' || name === 'min-width') && !/^[\d.]+(px|pt|em|rem|%)$/.test(value)) return false;
          return true;
        });

      if (safeRules.length) node.setAttribute('style', safeRules.join('; '));
      else node.removeAttribute('style');
    });

    return template.innerHTML;
  };

  const normalizeEditorContent = () => {
    const el = editableRef.current;
    if (!el) return;
    fixNegativeMargins(el);
    ensureTableWrappers(el);
    addTableResizeHandles();
  };

  const insertHtmlAtEnd = (html: string) => {
    const el = editableRef.current;
    if (!el) return;

    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const separator = el.textContent?.trim() ? '<p><br></p>' : '';
    document.execCommand('insertHTML', false, `${separator}${html}`);
  };

  const replaceEditorHtml = (html: string) => {
    const el = editableRef.current;
    if (!el) return;

    el.innerHTML = html;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const insertImportedHtml = (html: string, mode: 'replace' | 'append', cleanOptions?: CleanHtmlOptions) => {
    try {
      const cleanHtml = cleanPastedHtml(html, cleanOptions);
      if (mode === 'replace') replaceEditorHtml(cleanHtml);
      else insertHtmlAtEnd(cleanHtml);
      normalizeEditorContent();
      emitChange();
    } catch (error) {
      console.error('Error inserting imported content:', error);
    }
  };

  const insertCleanHtml = (html: string) => {
    try {
      document.execCommand("insertHTML", false, cleanPastedHtml(html));
      normalizeEditorContent();
      emitChange();
    } catch {}
  };

  const ensureTableWrappers = (root: HTMLElement) => {
    try {
      const tables = root.querySelectorAll('table');
      tables.forEach((table) => {
        const parent = table.parentElement;
        if (parent && parent.getAttribute('data-table-wrapper') !== 'true') {
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-table-wrapper', 'true');
          wrapper.style.overflowX = 'auto';
          wrapper.style.overflowY = 'visible';
          (wrapper.style as any).webkitOverflowScrolling = 'touch';
          wrapper.style.width = '100%';
          wrapper.style.maxWidth = '100%';
          wrapper.style.display = 'block';
          wrapper.style.paddingBottom = '8px';
          // Use insertBefore + appendChild to move element without losing too much state
          // simpler than replaceChild for wrapping
          parent.insertBefore(wrapper, table);
          wrapper.appendChild(table);
        }
        
        // Always ensure table takes full width
        if (table.style.width !== '100%') {
          table.style.width = '100%';
        }
        // Ensure min-width is set
        if (!table.style.minWidth || table.style.minWidth === '0px') {
          table.style.minWidth = '100%';
        }
      });
    } catch (e) {
      console.error("Error wrapping tables", e);
    }
  };

  const isCaretBoundaryBlock = (node: ChildNode | null) => {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName.toLowerCase();
    return (
      tag === "blockquote" ||
      tag === "pre" ||
      tag === "table" ||
      node.getAttribute("data-table-wrapper") === "true"
    );
  };

  const isEmptyCaretParagraph = (node: ChildNode | null) => {
    if (!(node instanceof HTMLParagraphElement)) return false;
    return !node.textContent?.trim();
  };

  const createCaretParagraph = () => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = "<br>";
    paragraph.setAttribute("data-srte-caret-boundary", "true");
    return paragraph;
  };

  const ensureCaretBoundaryParagraphs = (root: HTMLElement) => {
    const first = root.firstElementChild;
    if (isCaretBoundaryBlock(first) && !isEmptyCaretParagraph(first.previousSibling)) {
      root.insertBefore(createCaretParagraph(), first);
    }

    const last = root.lastElementChild;
    if (isCaretBoundaryBlock(last) && !isEmptyCaretParagraph(last.nextSibling)) {
      root.appendChild(createCaretParagraph());
    }
  };

  const handleInput = () => {
    if (isComposingRef.current) return;
    const el = editableRef.current;
    if (!el) return;
    
    // Auto-fix negative margins that might cause visibility issues
    fixNegativeMargins(el);
    // Ensure tables are wrapped for horizontal scrolling
    ensureTableWrappers(el);
    // Keep a reachable typing position around isolating blocks at document edges
    ensureCaretBoundaryParagraphs(el);
    // Add resize handles to tables
    addTableResizeHandles();
    // Native Enter creates new list items; keep checklist controls in sync.
    syncChecklistControls(el);

    if (!onChange) return;
    const html = el.innerHTML;
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  };

  const insertTable = () => {
    try {
      const el = editableRef.current;
      if (!el) return;

      if (!restoreSavedSelection()) {
        el.focus();
      }

      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !el.contains(range.commonAncestorContainer)) {
        // Place caret at end of editor
        range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      if (range?.collapsed) {
        pushEditorHistory();
        const inserted = editorControllerRef.current!.bindRoot(el).insertTable(tableRows, tableCols);
        if (inserted) {
          Array.from(inserted.rows).forEach((row, rowIndex) => {
            row.setAttribute("data-row-index", String(rowIndex));
            cellsOfRow(row).forEach((cell, cellIndex) => {
              cell.setAttribute("data-col-index", String(cellIndex));
              cell.style.border = cell.style.border || "1px solid #d1d5db";
              cell.style.padding = cell.style.padding || "6px";
              cell.style.minWidth = cell.style.minWidth || "60px";
            });
          });
          addTableResizeHandles();
          const firstCell = inserted.querySelector("td,th");
          if (firstCell instanceof HTMLTableCellElement) moveCaretToCell(firstCell, false);
          handleInput();
        }
        return;
      }
    } catch {}
  };

  const getClosestCell = (node: Node | null): HTMLTableCellElement | null => {
    let el = node as HTMLElement | null;
    while (el && el !== editableRef.current) {
      if (el.nodeName === "TD" || el.nodeName === "TH") {
        return el as HTMLTableCellElement;
      }
      el = el.parentElement as any;
    }
    return null;
  };

  const moveCaretToCell = (cell: HTMLTableCellElement, atEnd: boolean) => {
    try {
      const range = document.createRange();
      // Ensure the cell has at least one text node
      if (!cell.firstChild) {
        const text = document.createTextNode("\u00A0");
        cell.appendChild(text);
      }
      const textNode = cell.firstChild as ChildNode;
      const len = (textNode.textContent || "").length;
      range.setStart(textNode, atEnd ? len : 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  };

  const getTableGrid = (tbody: HTMLTableSectionElement) => {
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const grid: (HTMLTableCellElement | null)[][] = [];
    rows.forEach((row, rIdx) => {
      grid[rIdx] = grid[rIdx] || [];
      let cIdx = 0;
      const cells = cellsOfRow(row);
      cells.forEach((cell) => {
        while (grid[rIdx][cIdx]) cIdx += 1;
        const rowSpan = Math.max(1, cell.rowSpan || 1);
        const colSpan = Math.max(1, cell.colSpan || 1);
        for (let r = rIdx; r < rIdx + rowSpan; r += 1) {
          grid[r] = grid[r] || [];
          for (let c = cIdx; c < cIdx + colSpan; c += 1) {
            grid[r][c] = cell;
          }
        }
        cIdx += colSpan;
      });
    });
    return { rows, grid };
  };

  const getCellsInGridRect = (
    tbody: HTMLTableSectionElement,
    sr: number,
    sc: number,
    er: number,
    ec: number
  ) => {
    const { grid } = getTableGrid(tbody);
    const seen = new Set<HTMLTableCellElement>();
    const cells: HTMLTableCellElement[] = [];
    for (let r = sr; r <= er; r += 1) {
      for (let c = sc; c <= ec; c += 1) {
        const cell = grid[r]?.[c];
        if (cell && !seen.has(cell)) {
          seen.add(cell);
          cells.push(cell);
        }
      }
    }
    return cells;
  };

  const getCellPosition = (cell: HTMLTableCellElement) => {
    const row = cell.parentElement as HTMLTableRowElement | null;
    const tbody = row?.parentElement as HTMLTableSectionElement | null;
    const table = tbody?.parentElement as HTMLTableElement | null;
    if (!row || !tbody || !table) return null;
    const { rows, grid } = getTableGrid(tbody);
    const rIdx = rows.indexOf(row);
    let cIdx = -1;
    if (rIdx >= 0) {
      cIdx = (grid[rIdx] || []).findIndex((candidate) => candidate === cell);
    }
    return { row, tbody, table, rIdx, cIdx };
  };

  const cellsOfRow = (row: HTMLTableRowElement) =>
    Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    ) as HTMLTableCellElement[];

  const clearSelectionDecor = () => {
    document.querySelectorAll('[data-smart-ui="table-cell-selection"]').forEach((overlay) => overlay.remove());
    const sel = selectionRef.current;
    if (!sel) return;
    const { tbody, sr, sc, er, ec } = sel;
    const cells = getCellsInGridRect(tbody, sr, sc, er, ec);
    cells.forEach((cell) => {
      if ((cell as any).__rtePrevBg != null) {
        cell.style.background = (cell as any).__rtePrevBg;
        delete (cell as any).__rtePrevBg;
      }
      cell.style.outline = "";
      cell.style.outlineOffset = "";
    });
    selectionRef.current = null;
  };

  const updateSelectionDecor = (
    tbody: HTMLTableSectionElement,
    sr: number,
    sc: number,
    er: number,
    ec: number
  ) => {
    clearSelectionDecor();
    const { grid } = getTableGrid(tbody);
    const snapped = { sr: Math.min(sr, er), sc: Math.min(sc, ec), er: Math.max(sr, er), ec: Math.max(sc, ec) };
    let changed = true;
    while (changed) {
      changed = false;
      const touched = getCellsInGridRect(tbody, snapped.sr, snapped.sc, snapped.er, snapped.ec);
      touched.forEach((cell) => {
        const coordinates: Array<{ row: number; column: number }> = [];
        grid.forEach((row, rowIndex) => row.forEach((candidate, column) => { if (candidate === cell) coordinates.push({ row: rowIndex, column }); }));
        const next = {
          sr: Math.min(snapped.sr, ...coordinates.map((point) => point.row)),
          sc: Math.min(snapped.sc, ...coordinates.map((point) => point.column)),
          er: Math.max(snapped.er, ...coordinates.map((point) => point.row)),
          ec: Math.max(snapped.ec, ...coordinates.map((point) => point.column)),
        };
        if (next.sr !== snapped.sr || next.sc !== snapped.sc || next.er !== snapped.er || next.ec !== snapped.ec) { Object.assign(snapped, next); changed = true; }
      });
    }
    selectionRef.current = { tbody, ...snapped };
    const cells = getCellsInGridRect(tbody, snapped.sr, snapped.sc, snapped.er, snapped.ec);
    cells.forEach((cell) => {
      (cell as any).__rtePrevBg = cell.style.background || "";
      cell.style.background = "var(--srte-accent-bg)";
      cell.style.outline = "2px solid var(--srte-accent)";
      cell.style.outlineOffset = "-2px";
    });
    if (cells.length) {
      const bounds = cells.map((cell) => cell.getBoundingClientRect()).reduce((box, rect) => ({
        top: Math.min(box.top, rect.top), left: Math.min(box.left, rect.left),
        right: Math.max(box.right, rect.right), bottom: Math.max(box.bottom, rect.bottom),
      }), { top: Number.POSITIVE_INFINITY, left: Number.POSITIVE_INFINITY, right: 0, bottom: 0 });
      const overlay = document.createElement("div");
      overlay.setAttribute("data-smart-ui", "table-cell-selection");
      overlay.setAttribute("aria-label", `${cells.length} table cells selected`);
      overlay.contentEditable = "false";
      overlay.style.cssText = `position:fixed;pointer-events:none;z-index:9999;top:${bounds.top}px;left:${bounds.left}px;width:${Math.max(0, bounds.right - bounds.left)}px;height:${Math.max(0, bounds.bottom - bounds.top)}px`;
      document.body.appendChild(overlay);
    }
  };

  const canMergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return false;
    return sel.sr !== sel.er || sel.sc !== sel.ec;
  };

  const canMergeFromCell = (cell?: HTMLTableCellElement | null) =>
    Boolean(cell && canMergeSelection() && isCellInsideSelection(cell));

  const canSplitCell = (cell?: HTMLTableCellElement | null) =>
    Boolean(cell && (Math.max(1, cell.rowSpan || 1) > 1 || Math.max(1, cell.colSpan || 1) > 1));

  const isCellInsideSelection = (cell: HTMLTableCellElement) => {
    const sel = selectionRef.current;
    if (!sel) return false;
    const pos = getCellPosition(cell);
    if (!pos || pos.tbody !== sel.tbody) return false;
    return pos.rIdx >= sel.sr && pos.rIdx <= sel.er && pos.cIdx >= sel.sc && pos.cIdx <= sel.ec;
  };

  const shouldUseTableSelection = (fallbackCell?: HTMLTableCellElement) =>
    Boolean(selectionRef.current && fallbackCell && isCellInsideSelection(fallbackCell));

  const mergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return;
    const { tbody, sr, sc, er, ec } = sel;
    const { grid } = getTableGrid(tbody);
    const anchor = grid[sr]?.[sc];
    if (!anchor) return;
    pushEditorHistory();
    clearSelectionDecor();
    const table = tbody.closest("table");
    if (table instanceof HTMLTableElement) {
      const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
        id: "table.cell.merge",
        input: {
          start: { row: sr, column: sc },
          end: { row: er, column: ec },
        },
      });
      if (replacement) {
        const nextBody = replacement.tBodies[0];
        const nextAnchor = nextBody ? getTableGrid(nextBody).grid[sr]?.[sc] : null;
        if (nextAnchor) moveCaretToCell(nextAnchor, false);
        addTableResizeHandles();
        handleInput();
        return;
      }
    }
  };

  const addRow = (cell: HTMLTableCellElement, dir: "above" | "below") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { rIdx, table } = pos;
    const insertIndex = dir === "above" ? rIdx : rIdx + 1;
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
      id: "table.row.add",
      input: { index: insertIndex },
    });
    if (replacement) {
      const nextBody = replacement.tBodies[0];
      const nextCell = nextBody ? getTableGrid(nextBody).grid[insertIndex]?.[0] : null;
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const deleteRow = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { table, rIdx } = pos;
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
      id: "table.row.remove",
      input: { index: rIdx },
    });
    if (replacement) {
      const nextBody = replacement.tBodies[0];
      const nextRow = Math.min(rIdx, Math.max(0, replacement.rows.length - 1));
      const nextCell = nextBody ? getTableGrid(nextBody).grid[nextRow]?.[0] : null;
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const addCol = (cell: HTMLTableCellElement, dir: "left" | "right") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { cIdx } = pos;
    const insertIndex = dir === "left" ? cIdx : cIdx + 1;
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(pos.table, {
      id: "table.column.add",
      input: { index: insertIndex },
    });
    if (replacement) {
      const nextBody = replacement.tBodies[0];
      const nextCell = nextBody ? getTableGrid(nextBody).grid[0]?.[insertIndex] : null;
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const deleteCol = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { table, cIdx } = pos;
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
      id: "table.column.remove",
      input: { index: cIdx },
    });
    if (replacement) {
      const nextBody = replacement.tBodies[0];
      const nextGrid = nextBody ? getTableGrid(nextBody).grid : [];
      const nextColumn = Math.min(cIdx, Math.max(0, (nextGrid[0]?.length || 1) - 1));
      const nextCell = nextGrid[0]?.[nextColumn] || null;
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const toggleHeaderCell = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    clearSelectionDecor();
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(pos.table, {
      id: "table.header.cell.toggle",
      input: { row: pos.rIdx, column: pos.cIdx },
    });
    if (replacement) {
      const nextCell = getTableGrid(replacement.tBodies[0]).grid[pos.rIdx]?.[pos.cIdx];
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const deleteTable = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { table } = pos;
    editorControllerRef.current!.bindRoot(editableRef.current).removeTable(table);
  };

  const splitCell = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { rIdx, cIdx } = pos;
    if (Math.max(1, cell.rowSpan || 1) === 1 && Math.max(1, cell.colSpan || 1) === 1) return;
    clearSelectionDecor();
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(pos.table, {
      id: "table.cell.split",
      input: { row: rIdx, column: cIdx },
    });
    if (replacement) {
      const nextBody = replacement.tBodies[0];
      const nextCell = nextBody ? getTableGrid(nextBody).grid[rIdx]?.[cIdx] : null;
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const toggleHeaderRow = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    clearSelectionDecor();
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(pos.table, {
      id: "table.header.row.toggle",
      input: { row: pos.rIdx, column: pos.cIdx },
    });
    if (replacement) {
      const nextCell = getTableGrid(replacement.tBodies[0]).grid[pos.rIdx]?.[pos.cIdx];
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const toggleHeaderColumn = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    clearSelectionDecor();
    const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(pos.table, {
      id: "table.header.column.toggle",
      input: { row: pos.rIdx, column: pos.cIdx },
    });
    if (replacement) {
      const nextCell = getTableGrid(replacement.tBodies[0]).grid[pos.rIdx]?.[pos.cIdx];
      if (nextCell) moveCaretToCell(nextCell, false);
      addTableResizeHandles();
      return;
    }
  };

  const applyBgToSelection = (
    hex: string,
    fallbackCell?: HTMLTableCellElement,
    explicitCells?: HTMLTableCellElement[] | null
  ) => {
    const readableColor = readableTextColorForBackground(hex);
    const targetCells = explicitCells?.length
      ? explicitCells
      : shouldUseTableSelection(fallbackCell)
        ? getCellsInGridRect(
            selectionRef.current!.tbody,
            selectionRef.current!.sr,
            selectionRef.current!.sc,
            selectionRef.current!.er,
            selectionRef.current!.ec
          )
        : fallbackCell ? [fallbackCell] : [];
    const positions = targetCells
      .map((target) => getCellPosition(target))
      .filter((position): position is NonNullable<ReturnType<typeof getCellPosition>> => Boolean(position));
    const table = positions[0]?.table;
    if (table && positions.every((position) => position.table === table)) {
      const start = {
        row: Math.min(...positions.map((position) => position.rIdx)),
        column: Math.min(...positions.map((position) => position.cIdx)),
      };
      const end = {
        row: Math.max(...positions.map((position) => position.rIdx)),
        column: Math.max(...positions.map((position) => position.cIdx)),
      };
      clearSelectionDecor();
      const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
        id: "table.cell.style.set",
        input: { start, end, backgroundColor: hex, textColor: readableColor || undefined },
      });
      if (replacement) {
        const nextCell = getTableGrid(replacement.tBodies[0]).grid[start.row]?.[start.column];
        if (nextCell) moveCaretToCell(nextCell, false);
        addTableResizeHandles();
        return;
      }
    }
    clearSelectionDecor();
  };

  const tableCellFillHex = (cell: HTMLTableCellElement) => {
    const storedSelectionBackground = (cell as any).__rtePrevBg;
    const inlineBackground =
      typeof storedSelectionBackground === "string"
        ? storedSelectionBackground
        : cell.style.backgroundColor || cell.style.background;
    const inlineHex = cssColorToHex(inlineBackground || "");
    if (inlineHex) return inlineHex;

    const computedHex = cssColorToHex(window.getComputedStyle(cell).backgroundColor);
    return computedHex || "#ffffff";
  };

  const tableMenuFillHex = (cell: HTMLTableCellElement) => {
    const sel = shouldUseTableSelection(cell) ? selectionRef.current : null;
    if (!sel) return tableCellFillHex(cell);

    const cells = getCellsInGridRect(sel.tbody, sel.sr, sel.sc, sel.er, sel.ec);
    const first = cells[0] ? tableCellFillHex(cells[0]) : tableCellFillHex(cell);
    const allSame = cells.every((candidate) => tableCellFillHex(candidate) === first);
    return allSame ? first : tableCellFillHex(cell);
  };

  const toggleBorderSelection = (fallbackCell?: HTMLTableCellElement) => {
    const targetCells = shouldUseTableSelection(fallbackCell)
      ? getCellsInGridRect(
          selectionRef.current!.tbody,
          selectionRef.current!.sr,
          selectionRef.current!.sc,
          selectionRef.current!.er,
          selectionRef.current!.ec
        )
      : fallbackCell ? [fallbackCell] : [];
    const positions = targetCells
      .map((target) => getCellPosition(target))
      .filter((position): position is NonNullable<ReturnType<typeof getCellPosition>> => Boolean(position));
    const table = positions[0]?.table;
    if (table && positions.every((position) => position.table === table)) {
      const start = {
        row: Math.min(...positions.map((position) => position.rIdx)),
        column: Math.min(...positions.map((position) => position.cIdx)),
      };
      const end = {
        row: Math.max(...positions.map((position) => position.rIdx)),
        column: Math.max(...positions.map((position) => position.cIdx)),
      };
      clearSelectionDecor();
      if (editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(table, {
        id: "table.cell.border.toggle",
        input: { start, end },
      })) return;
    }
    const applyToggle = (cell: HTMLTableCellElement) => {
      const cur = (cell as HTMLElement).style.border;
      (cell as HTMLElement).style.border =
        cur && cur !== "none" ? "none" : "1px solid #d1d5db";
    };
    targetCells.forEach(applyToggle);
  };

  const runTableCellAction = (
    cell: HTMLTableCellElement,
    action: (cell: HTMLTableCellElement) => void
  ) => {
    pushEditorHistory();
    action(cell);
    handleInput();
    setTableMenu(null);
  };

  // Table column and row resizing functions
  const getColumnCells = (table: HTMLTableElement, colIndex: number): HTMLTableCellElement[] => {
    const tbody = table.querySelector('tbody');
    if (!tbody) return [];
    const cells: HTMLTableCellElement[] = [];
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach(row => {
      const rowCells = cellsOfRow(row as HTMLTableRowElement);
      if (rowCells[colIndex]) {
        cells.push(rowCells[colIndex]);
      }
    });
    return cells;
  };

  const startColumnResize = (table: HTMLTableElement, colIndex: number, clientX: number) => {
    const cells = getColumnCells(table, colIndex);
    if (cells.length === 0) return;
    pushEditorHistory();
    
    const firstCell = cells[0];
    const currentWidth = firstCell.offsetWidth;

    // Unlock table width so it can grow
    table.style.width = "max-content";
    table.style.minWidth = "100%";
    
    tableResizeRef.current = {
      type: 'column',
      table,
      index: colIndex,
      startPos: clientX,
      startSize: currentWidth,
      cells,
    };
    
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startRowResize = (table: HTMLTableElement, rowIndex: number, clientY: number) => {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const row = rows[rowIndex] as HTMLTableRowElement | undefined;
    if (!row) return;
    
    const cells = cellsOfRow(row);
    const currentHeight = row.offsetHeight;
    pushEditorHistory();
    
    tableResizeRef.current = {
      type: 'row',
      table,
      index: rowIndex,
      startPos: clientY,
      startSize: currentHeight,
      cells,
    };
    
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const handleTableResizeMove = (e: MouseEvent | TouchEvent) => {
    const resize = tableResizeRef.current;
    if (!resize) return;
    
    e.preventDefault();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    if (resize.type === 'column') {
      const delta = clientX - resize.startPos;
      const newWidth = Math.max(60, resize.startSize + delta);
      
      resize.cells.forEach(cell => {
        (cell as HTMLElement).style.width = `${newWidth}px`;
        (cell as HTMLElement).style.minWidth = `${newWidth}px`;
        (cell as HTMLElement).style.maxWidth = `${newWidth}px`;
      });
    } else if (resize.type === 'row') {
      const delta = clientY - resize.startPos;
      const newHeight = Math.max(30, resize.startSize + delta);
      
      const tbody = resize.table.querySelector('tbody');
      if (tbody) {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const row = rows[resize.index] as HTMLTableRowElement | undefined;
        if (row) {
          (row as HTMLElement).style.height = `${newHeight}px`;
          resize.cells.forEach(cell => {
            (cell as HTMLElement).style.height = `${newHeight}px`;
          });
        }
      }
    }
  };

  const handleTableResizeEnd = () => {
    const resize = tableResizeRef.current;
    if (resize) {
      const size = resize.type === "column"
        ? Number.parseFloat(resize.cells[0]?.style.width || "") || resize.startSize
        : Number.parseFloat(resize.table.rows[resize.index]?.style.height || "") || resize.startSize;
      editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(
        resize.table,
        resize.type === "column"
          ? { id: "table.column.width.set", input: { index: resize.index, widthPx: size } }
          : { id: "table.row.height.set", input: { index: resize.index, heightPx: size } }
      );
      tableResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      handleInput();
    }
  };

  const getRangeFromPoint = (x: number, y: number) => {
    let range: Range | null = null;
    // @ts-ignore
    if (document.caretRangeFromPoint) {
      // @ts-ignore
      range = document.caretRangeFromPoint(x, y);
    } else if ((document as any).caretPositionFromPoint) {
      const pos = (document as any).caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
    return range;
  };

  const getMovableElementFromNode = (node: Node | null) => {
    const editor = editableRef.current;
    if (!editor || !node) return null;
    let element = node instanceof HTMLElement ? node : node.parentElement;
    if (!element || !editor.contains(element)) return null;

    const image = element.closest("img");
    if (image && editor.contains(image)) {
      return (image.parentElement?.tagName === "A" ? image.parentElement : image) as HTMLElement;
    }

    const listElement = element.closest("ul,ol");
    if (listElement && editor.contains(listElement)) return listElement as HTMLElement;

    const tableElement = element.closest("table");
    if (tableElement && editor.contains(tableElement)) {
      return (tableElement.closest('[data-table-wrapper="true"]') || tableElement) as HTMLElement;
    }

    const quoteElement = element.closest("blockquote");
    if (quoteElement && editor.contains(quoteElement)) return quoteElement as HTMLElement;

    const codeBlock = element.closest("pre");
    if (codeBlock && editor.contains(codeBlock)) return codeBlock as HTMLElement;

    const block = element.closest('[data-table-wrapper="true"],blockquote,pre,p,h1,h2,h3,h4,h5,h6,div') as HTMLElement | null;
    if (!block || block === editor || !editor.contains(block)) return null;
    if (block.getAttribute("data-srte-caret-boundary") === "true") return null;
    return block;
  };

  const updateDragHandleForTarget = (target: HTMLElement | null) => {
    const scroller = editorScrollRef.current;
    if (dragHandleHideTimerRef.current != null) {
      window.clearTimeout(dragHandleHideTimerRef.current);
      dragHandleHideTimerRef.current = null;
    }

    if (!target || !scroller || !editableRef.current?.contains(target)) {
      setDragHandle(null);
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    const isTableTarget =
      target.matches("table,[data-table-wrapper='true']") ||
      Boolean(target.querySelector("table"));
    const isListInsideCell =
      target.matches("ul,ol") &&
      Boolean(target.closest("td,th"));
    const next = {
      // Table handles sit on the table's left border so nested tables remain reachable.
      left: Math.max(
        4,
        targetRect.left - scrollRect.left + scroller.scrollLeft - (isTableTarget || isListInsideCell ? 12 : 30)
      ),
      top: targetRect.top - scrollRect.top + scroller.scrollTop,
      height: Math.max(24, targetRect.height),
      target,
    };

    setDragHandle((current) => {
      if (
        current?.target === next.target &&
        Math.abs(current.left - next.left) < 1 &&
        Math.abs(current.top - next.top) < 1 &&
        Math.abs(current.height - next.height) < 1
      ) {
        return current;
      }
      return next;
    });
  };

  const scheduleDragHandleHide = () => {
    if (dragHandleHideTimerRef.current != null) {
      window.clearTimeout(dragHandleHideTimerRef.current);
    }
    dragHandleHideTimerRef.current = window.setTimeout(() => {
      dragHandleHideTimerRef.current = null;
      if (!draggedBlockRef.current) setDragHandle(null);
    }, 350);
  };

  const getImageFromMovableBlock = (block: HTMLElement) => {
    if (block.tagName === "IMG") return block as HTMLImageElement;
    return block.querySelector("img") as HTMLImageElement | null;
  };

  const dropBlockAtPoint = (block: HTMLElement, x: number, y: number) => {
    const editor = editableRef.current;
    if (!editor || !editor.contains(block)) return false;

    const under = document.elementFromPoint(x, y);
    const draggedQuote = block.tagName === "BLOCKQUOTE";
    const draggedCodeBlock = block.tagName === "PRE";
    if (draggedQuote) {
      const underElement = under instanceof HTMLElement ? under : under?.parentElement;
      const quoteTarget = underElement?.closest("blockquote") as HTMLElement | null;
      if (quoteTarget && quoteTarget !== block) {
        let rootQuote = quoteTarget;
        while (rootQuote.parentElement?.closest("blockquote")) {
          rootQuote = rootQuote.parentElement.closest("blockquote") as HTMLElement;
        }
        const parent = rootQuote.parentElement;
        if (!parent) return false;
        const rect = rootQuote.getBoundingClientRect();
        if (rootQuote.contains(block) || y >= rect.top + rect.height / 2) {
          parent.insertBefore(block, rootQuote.nextSibling);
        } else {
          parent.insertBefore(block, rootQuote);
        }
        return true;
      }
    }
    if (draggedCodeBlock) {
      const underElement = under instanceof HTMLElement ? under : under?.parentElement;
      const codeTarget = underElement?.closest("pre") as HTMLElement | null;
      if (codeTarget && codeTarget !== block) {
        let rootCodeBlock = codeTarget;
        while (rootCodeBlock.parentElement?.closest("pre")) {
          rootCodeBlock = rootCodeBlock.parentElement.closest("pre") as HTMLElement;
        }
        const parent = rootCodeBlock.parentElement;
        if (!parent) return false;
        const rect = rootCodeBlock.getBoundingClientRect();
        if (rootCodeBlock.contains(block) || y >= rect.top + rect.height / 2) {
          parent.insertBefore(block, rootCodeBlock.nextSibling);
        } else {
          parent.insertBefore(block, rootCodeBlock);
        }
        return true;
      }
    }
    const draggedImage = getImageFromMovableBlock(block);
    const targetCell = draggedImage ? getClosestCell(under) : null;
    if (draggedImage && targetCell && !block.contains(targetCell)) {
      if (targetCell.contains(block)) return false;
      const range = getRangeFromPoint(x, y);
      if (range && targetCell.contains(range.commonAncestorContainer)) {
        range.insertNode(block);
      } else {
        targetCell.appendChild(block);
      }
      return true;
    }

    const target = getMovableElementFromNode(under);
    if (target && target !== block && !block.contains(target) && !target.contains(block)) {
      const rect = target.getBoundingClientRect();
      const parent = target.parentElement;
      if (!parent) return false;
      if (y < rect.top + rect.height / 2) parent.insertBefore(block, target);
      else parent.insertBefore(block, target.nextSibling);
      return true;
    }

    const range = getRangeFromPoint(x, y);
    if (range && editor.contains(range.commonAncestorContainer)) {
      if (block.contains(range.commonAncestorContainer)) return false;
      if (draggedQuote) {
        const element = range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const container = element?.closest("p,h1,h2,h3,h4,h5,h6,pre") as HTMLElement | null;
        if (container?.parentElement) {
          const isEmpty =
            !container.textContent?.trim() &&
            Array.from(container.children).every((child) => child.tagName === "BR");
          if (isEmpty) {
            container.parentElement.insertBefore(block, container);
            container.remove();
          } else {
            const rect = container.getBoundingClientRect();
            container.parentElement.insertBefore(
              block,
              y < rect.top + rect.height / 2 ? container : container.nextSibling
            );
          }
          return true;
        }
      }
      if (draggedCodeBlock) {
        const element = range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const codeTarget = element?.closest("pre") as HTMLElement | null;
        if (codeTarget?.parentElement) {
          let rootCodeBlock = codeTarget;
          while (rootCodeBlock.parentElement?.closest("pre")) {
            rootCodeBlock = rootCodeBlock.parentElement.closest("pre") as HTMLElement;
          }
          rootCodeBlock.parentElement.insertBefore(block, rootCodeBlock.nextSibling);
          return true;
        }
        const container = element?.closest("p,h1,h2,h3,h4,h5,h6,blockquote") as HTMLElement | null;
        if (container?.parentElement) {
          const isEmpty =
            !container.textContent?.trim() &&
            Array.from(container.children).every((child) => child.tagName === "BR");
          if (isEmpty) {
            container.parentElement.insertBefore(block, container);
            container.remove();
          } else {
            const rect = container.getBoundingClientRect();
            container.parentElement.insertBefore(
              block,
              y < rect.top + rect.height / 2 ? container : container.nextSibling
            );
          }
          return true;
        }
      }
      const isTableBlock = block.matches("table,[data-table-wrapper='true']") || Boolean(block.querySelector("table"));
      if (isTableBlock) {
        const element = range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
        const codeBlock = element?.closest("pre") as HTMLElement | null;
        if (codeBlock?.parentElement) {
          codeBlock.parentElement.insertBefore(block, codeBlock.nextSibling);
          return true;
        }
        const listItem = element?.closest("li") as HTMLElement | null;
        if (listItem) {
          let outerList = listItem.parentElement as HTMLElement | null;
          while (outerList?.parentElement?.tagName === "LI") {
            const parentList = outerList.parentElement.parentElement as HTMLElement | null;
            if (!parentList || !["UL", "OL"].includes(parentList.tagName)) break;
            outerList = parentList;
          }
          if (outerList?.parentElement) {
            outerList.parentElement.insertBefore(block, outerList.nextSibling);
            return true;
          }
        }
      }
      range.insertNode(block);
      return true;
    }

    editor.appendChild(block);
    return true;
  };

  const getTopLevelMovableElement = () => {
    const editor = editableRef.current;
    if (!editor) return null;

    const imageTarget = selectedImage?.parentElement?.tagName === "A"
      ? selectedImage.parentElement
      : selectedImage;
    if (imageTarget && editor.contains(imageTarget)) return imageTarget as HTMLElement;

    const range = getSelectionRangeInEditor();
    let node: Node | null = range?.commonAncestorContainer || null;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    let element = node instanceof HTMLElement ? node : null;
    if (!element) return null;

    return getMovableElementFromNode(element);
  };

  const getMoveTarget = () => {
    const editor = editableRef.current;
    if (!editor) return null;

    const imageTarget = selectedImage?.parentElement?.tagName === "A"
      ? selectedImage.parentElement
      : selectedImage;
    if (imageTarget && editor.contains(imageTarget)) return imageTarget as HTMLElement;

    const range = getSelectionRangeInEditor();
    let node: Node | null = range?.commonAncestorContainer || null;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const element = node instanceof HTMLElement ? node : null;
    if (!element) return null;

    const listItem = element.closest("li") as HTMLElement | null;
    if (listItem && editor.contains(listItem)) return listItem;

    const cell = getClosestCell(element);
    if (cell) {
      const block = element.closest("p,h1,h2,h3,h4,h5,h6,blockquote,pre,div") as HTMLElement | null;
      if (block && block !== cell && cell.contains(block)) return block;
      return cell;
    }

    return getTopLevelMovableElement();
  };

  const elementSibling = (element: HTMLElement, direction: "previous" | "next") => {
    let sibling = direction === "previous" ? element.previousSibling : element.nextSibling;
    while (
      sibling &&
      (
        (sibling.nodeType === Node.TEXT_NODE && !sibling.textContent?.trim()) ||
        (sibling instanceof HTMLElement && sibling.getAttribute("data-srte-caret-boundary") === "true")
      )
    ) {
      sibling = direction === "previous" ? sibling.previousSibling : sibling.nextSibling;
    }
    return sibling;
  };

  const moveSelectedBlocks = (direction: "up" | "down" | "left" | "right") => {
    if (!moveFeature) return false;
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    if (!editor || !range || range.collapsed) return false;

    const blocks = sortInDocumentOrder(getSelectedBlocks(range)).filter((block) => {
      if (!editor.contains(block) || !block.parentElement) return false;
      const parentBlock = block.parentElement.closest(blockSelector);
      return !parentBlock || parentBlock === editor;
    });
    if (blocks.length === 0) return false;

    const parent = blocks[0].parentElement;
    if (!parent || blocks.some((block) => block.parentElement !== parent)) return false;

    pushEditorHistory();
    const result = editorControllerRef.current!.bindRoot(editor).executeBlockCommand(blocks,
      direction === "left" ? { id: "block.outdent" }
        : direction === "right" ? { id: "block.indent" }
          : { id: "block.move", input: { direction } });
    if (!result) {
      editorControllerRef.current!.discardLastHistorySnapshot();
      return true;
    }
    const movedRange = document.createRange();
    movedRange.setStartBefore(result[0]);
    movedRange.setEndAfter(result[result.length - 1]);
    safeSelectRange(movedRange);
    savedRangeRef.current = movedRange.cloneRange();
    handleInput();
    requestAnimationFrame(updateActiveState);
    return true;
  };

  const moveCurrentElement = (direction: "up" | "down" | "left" | "right") => {
    if (!moveFeature) return;
    restoreSavedSelection();
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    const selectedListItems = range ? resolveSelectedListItems(range) : [];
    if (selectedListItems.length > 0) {
      if (direction === "left" || direction === "right") {
        applyListDepthChange(selectedListItems, direction === "right" ? "indent" : "outdent");
      } else {
        applyListOrderChange(selectedListItems, direction);
      }
      return;
    }
    if (moveSelectedBlocks(direction)) return;
    let target = getMoveTarget();
    if (!editor || !target) return;
    let historyPushed = false;

    if (target.tagName === "TD" || target.tagName === "TH") {
      // LEGACY_TABLE_TOUCHPOINT: bare-cell-block-materialization owner=Phase6.
      pushEditorHistory();
      historyPushed = true;
      const cell = target;
      const paragraph = document.createElement("p");
      while (cell.firstChild) paragraph.appendChild(cell.firstChild);
      cell.appendChild(paragraph);
      target = paragraph;
    }
    if (target.matches("p,h1,h2,h3,h4,h5,h6,blockquote,pre")) {
      if (!historyPushed) pushEditorHistory();
      const result = editorControllerRef.current!.bindRoot(editor).executeBlockCommand([target],
        direction === "left" ? { id: "block.outdent" }
          : direction === "right" ? { id: "block.indent" }
            : { id: "block.move", input: { direction } });
      if (!result) {
        editorControllerRef.current!.discardLastHistorySnapshot();
        return;
      }
      focusElementEnd(result[result.length - 1]);
      handleInput();
      requestAnimationFrame(updateActiveState);
      return;
    }
    if (target.tagName.toLowerCase() !== "li") {
      const coreResult = executeDomMoveCommand([target], direction, () => {
        if (!historyPushed) pushEditorHistory();
        historyPushed = true;
      });
      if (coreResult === false) return;
      if (coreResult) {
        focusElementEnd(target);
        setSelectedImage(target.tagName === "IMG" ? target as HTMLImageElement : target.querySelector("img"));
        scheduleImageOverlay();
        handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }
    }
    if (target.tagName.toLowerCase() === "li") return;
  };

  const addTableResizeHandles = () => {
    if (!table) return;
    const el = editableRef.current;
    if (!el) return;
    
    const tables = el.querySelectorAll('table');
    tables.forEach(tableElem => {
      const tbody = tableElem.querySelector('tbody');
      if (!tbody) return;
      
      const firstRow = tbody.querySelector('tr');
      if (firstRow) {
        const cells = cellsOfRow(firstRow as HTMLTableRowElement);
        cells.forEach((cell, index) => {
          (cell as HTMLElement).setAttribute('data-col-index', String(index));
        });
      }
      
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.forEach((row, index) => {
        (row as HTMLElement).setAttribute('data-row-index', String(index));
      });
    });
  };

  const activeButtonStyle = (
    active = false,
    extra: React.CSSProperties = {}
  ): React.CSSProperties => ({
    height: 32,
    minWidth: 32,
    padding: "0 7px",
    border: active ? "1px solid color-mix(in srgb, var(--srte-primary) 35%, transparent)" : "1px solid transparent",
    borderRadius: 8,
    background: active ? "var(--srte-accent-bg)" : "transparent",
    color: active ? "var(--srte-primary)" : "var(--srte-foreground)",
    boxShadow: "none",
    cursor: "pointer",
    ...extra,
  });

  const preserveToolbarMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest("button");
    preserveEditorSelection();
    if (button && !button.hasAttribute("disabled")) {
      event.preventDefault();
    }
  };

  const executePluginCommand = (commandId: string, input?: unknown) => {
    const editor = editableRef.current;
    if (!editor || readOnly) return false;
    const before = editor.innerHTML;
    pushEditorHistory();
    const result = editorControllerRef.current!
      .bindRoot(editor)
      .execute(commandId, input);
    if (!result) {
      editorControllerRef.current!.discardLastHistorySnapshot(before);
      return false;
    }
    handleInput();
    requestAnimationFrame(updateActiveState);
    return true;
  };

  const executePluginToolbarContribution = (contribution: ReactToolbarContribution) =>
    executePluginCommand(contribution.commandId, contribution.input);

  const pluginContributionContext = {
    root: editableRef.current,
    selection: typeof window === "undefined" ? null : window.getSelection(),
    readOnly,
    canExecute: (commandId: string, input?: unknown) =>
      editorControllerRef.current!.bindRoot(editableRef.current).canExecute(commandId, input),
  };
  const isPluginContributionVisible = (contribution: ReactToolbarContribution | ReactContextMenuContribution) => {
    try {
      return contribution.isVisible?.(pluginContributionContext) ?? true;
    } catch {
      return false;
    }
  };
  const isPluginContributionEnabled = (contribution: ReactToolbarContribution | ReactContextMenuContribution) => {
    if (readOnly) return false;
    try {
      if (contribution.isEnabled && !contribution.isEnabled(pluginContributionContext)) return false;
      return !editableRef.current || pluginContributionContext.canExecute(contribution.commandId, contribution.input);
    } catch {
      return false;
    }
  };
  const isPluginContributionActive = (contribution: ReactToolbarContribution) => {
    try {
      return contribution.isActive?.(pluginContributionContext) ?? false;
    } catch {
      return false;
    }
  };
  const isPluginShortcutAvailable = (shortcut: ReactKeyboardShortcutContribution) => {
    if (readOnly) return false;
    try {
      return (shortcut.isVisible?.(pluginContributionContext) ?? true) &&
        (shortcut.isEnabled?.(pluginContributionContext) ?? true) &&
        pluginContributionContext.canExecute(shortcut.commandId, shortcut.input);
    } catch {
      return false;
    }
  };

  const editorClass = `srte-editor${theme === 'dark' ? ' srte-dark' : ''}${className ? ' ' + className : ''}`;

  return (
    <div className={editorClass} style={{
      border: "1px solid var(--srte-border)",
      borderRadius: "var(--srte-radius)",
      width: "100%",
      maxWidth: "100vw",
      overflow: "visible",
      display: "flex",
      flexDirection: "column",
      background: "var(--srte-background)",
      color: "var(--srte-foreground)",
      boxSizing: "border-box"
    }}>
      <div
        className="srte-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        aria-disabled={readOnly}
        onMouseDown={(event) => {
          if (readOnly) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          preserveToolbarMouseDown(event);
        }}
        onClick={(event) => {
          if (!readOnly) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (!readOnly) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          maxWidth: "100%",
          opacity: readOnly ? 0.55 : 1,
          pointerEvents: readOnly ? "none" : "auto",
          userSelect: readOnly ? "none" : undefined,
        }}
      >
        {media && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const list = e.currentTarget.files;
              if (list && list.length) {
                if (replaceTargetRef.current) {
                  const img = replaceTargetRef.current;
                  replaceTargetRef.current = null;
                  const f = list[0];
                  if (f && f.type.startsWith("image/")) {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = String(reader.result || "");
                      if (dataUrl) {
                        img.src = dataUrl;
                        setSelectedImage(img);
                        scheduleImageOverlay();
                        handleInput();
                      }
                    };
                    reader.readAsDataURL(f);
                  }
                } else {
                  handleLocalImageFiles(list);
                }
              }
              e.currentTarget.value = "";
            }}
          />
        )}
        <ToolbarGroup label="History">
          <button type="button" className="srte-tool-button" aria-label="Undo" title="Undo" onClick={() => exec("undo")}><ToolbarIcon name="undo" /></button>
          <button type="button" className="srte-tool-button" aria-label="Redo" title="Redo" onClick={() => exec("redo")}><ToolbarIcon name="redo" /></button>
        </ToolbarGroup>
        {blockTypeFeature && <select
          value={currentBlockType}
          onPointerDown={preserveEditorSelection}
          onMouseDown={preserveEditorSelection}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "p") applyFormatBlock("<p>");
            else if (val === "h1") applyFormatBlock("<h1>");
            else if (val === "h2") applyFormatBlock("<h2>");
            else if (val === "h3") applyFormatBlock("<h3>");
            else if (val === "h4") applyFormatBlock("<h4>");
            else if (val === "h5") applyFormatBlock("<h5>");
            else if (val === "h6") applyFormatBlock("<h6>");
          }}
          title="Paragraph/Heading"
          style={{
            height: 32,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
          }}
        >
          <option value="mixed" disabled>Mixed</option>
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="h5">Heading 5</option>
          <option value="h6">Heading 6</option>
        </select>}
        {basicFormattingFeature && <>
        <button
          type="button"
          className={`srte-tool-button${activeState.bold ? " srte-active" : ""}${partialInlineMarks.has("bold") ? " srte-indeterminate" : ""}`}
          title="Bold"
          onClick={() => exec("bold")}
          aria-pressed={partialInlineMarks.has("bold") ? "mixed" : activeState.bold}
          data-srte-mark-coverage={partialInlineMarks.has("bold") ? "partial" : activeState.bold ? "all" : "none"}
          style={activeButtonStyle(activeState.bold)}
        >
          <span style={{ fontWeight: 700 }}>B</span>
        </button>
        <button
          type="button"
          className={`srte-tool-button${activeState.italic ? " srte-active" : ""}${partialInlineMarks.has("italic") ? " srte-indeterminate" : ""}`}
          title="Italic"
          onClick={() => exec("italic")}
          aria-pressed={partialInlineMarks.has("italic") ? "mixed" : activeState.italic}
          data-srte-mark-coverage={partialInlineMarks.has("italic") ? "partial" : activeState.italic ? "all" : "none"}
          style={activeButtonStyle(activeState.italic, { fontStyle: "italic" })}
        >
          I
        </button>
        <button
          type="button"
          className={`srte-tool-button${activeState.underline ? " srte-active" : ""}${partialInlineMarks.has("underline") ? " srte-indeterminate" : ""}`}
          title="Underline"
          onClick={() => exec("underline")}
          aria-pressed={partialInlineMarks.has("underline") ? "mixed" : activeState.underline}
          data-srte-mark-coverage={partialInlineMarks.has("underline") ? "partial" : activeState.underline ? "all" : "none"}
          style={activeButtonStyle(activeState.underline, { textDecoration: "underline" })}
        >
          U
        </button>
        <button
          type="button"
          className={`srte-tool-button${activeState.strikeThrough ? " srte-active" : ""}${partialInlineMarks.has("strike") ? " srte-indeterminate" : ""}`}
          title="Strikethrough"
          onClick={() => exec("strikeThrough")}
          aria-pressed={partialInlineMarks.has("strike") ? "mixed" : activeState.strikeThrough}
          data-srte-mark-coverage={partialInlineMarks.has("strike") ? "partial" : activeState.strikeThrough ? "all" : "none"}
          style={activeButtonStyle(activeState.strikeThrough, { textDecoration: "line-through" })}
        >
          S
        </button>
        {showFontSize && (
          <select
            value={currentFontSize}
            onPointerDown={preserveEditorSelection}
            onMouseDown={preserveEditorSelection}
            onChange={(e) => applyFontSize(e.target.value)}
            title="Font Size"
            style={{
              height: 32,
              padding: "0 8px",
              border: "1px solid var(--srte-input-border)",
              borderRadius: 6,
              background: "var(--srte-input-bg)",
              color: "var(--srte-input-text)",
            }}
          >
            <option value="" disabled>Size</option>
            {currentFontSize && !["8", "9", "10", "11", "12", "14", "16", "18", "24", "30", "36", "48", "60", "72", "96"].includes(currentFontSize) && (
              <option value={currentFontSize}>{currentFontSize}</option>
            )}
            <option value="8">8</option>
            <option value="9">9</option>
            <option value="10">10</option>
            <option value="11">11</option>
            <option value="12">12</option>
            <option value="14">14</option>
            <option value="16">16</option>
            <option value="18">18</option>
            <option value="24">24</option>
            <option value="30">30</option>
            <option value="36">36</option>
            <option value="48">48</option>
            <option value="60">60</option>
            <option value="72">72</option>
            <option value="96">96</option>
          </select>
        )}
        {preserveFontFamily && (
          <select
            value={currentFont}
            onMouseDown={() => {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const editor = editableRef.current;
                if (editor && editor.contains(range.commonAncestorContainer) && !range.collapsed) {
                  savedRangeRef.current = range.cloneRange();
                }
              }
            }}
            onChange={(e) => applyFontFamily(e.target.value)}
            title="Font Family"
            style={{
              height: 32,
              padding: "0 8px",
              border: "1px solid var(--srte-input-border)",
              borderRadius: 6,
              background: "var(--srte-input-bg)",
              color: "var(--srte-input-text)",
              maxWidth: 100,
            }}
          >
            <option value="" disabled>Font</option>
            {fonts.map((f) => (
              <option key={f.value} value={f.value}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="srte-tool-button"
          aria-label="Text color"
          title="Text Color"
          onMouseDown={preserveEditorSelection}
          onClick={() => {
            setColorPickerType('text');
            setShowColorPicker(true);
          }}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
            position: "relative",
          }}
        >
          <span style={{ fontWeight: 700, borderBottom: `3px solid ${currentTextColor}`, lineHeight: 1 }}>A</span>
        </button>
        <button
          type="button"
          className="srte-tool-button"
          aria-label="Background color"
          title="Background Color"
          onMouseDown={preserveEditorSelection}
          onClick={() => {
            setColorPickerType('background');
            setShowColorPicker(true);
          }}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
          }}
        >
          <span style={{ fontWeight: 700, padding: "1px 4px", background: currentBackgroundColor, color: readableTextColorForBackground(currentBackgroundColor) || "currentColor", borderRadius: 3 }}>A</span>
        </button>
        <button
          type="button"
          className={`srte-tool-button${activeState.subscript ? " srte-active" : ""}${partialInlineMarks.has("subscript") ? " srte-indeterminate" : ""}`}
          title="Subscript"
          onMouseDown={preserveEditorSelection}
          onClick={() => toggleInlineScript("subscript")}
          aria-pressed={partialInlineMarks.has("subscript") ? "mixed" : activeState.subscript}
          style={activeButtonStyle(activeState.subscript)}
        >
          X<sub>2</sub>
        </button>
        <button
          type="button"
          className={`srte-tool-button${activeState.superscript ? " srte-active" : ""}${partialInlineMarks.has("superscript") ? " srte-indeterminate" : ""}`}
          title="Superscript"
          onMouseDown={preserveEditorSelection}
          onClick={() => toggleInlineScript("superscript")}
          aria-pressed={partialInlineMarks.has("superscript") ? "mixed" : activeState.superscript}
          style={activeButtonStyle(activeState.superscript)}
        >
          X<sup>2</sup>
        </button>
        </>}
        {[
          {
            key: "check",
            enabled: checklistFeature,
            icon: "checklist" as ToolbarIconName,
            title: "Checklist",
            active: activeState.checklist,
            action: () => applyChecklist(false, true),
            options: [["check:plain", "☐ Checklist"], ["check:strike", "☑ Checked + strike"]],
          },
          {
            key: "bullet",
            enabled: listFeature,
            icon: "bullets" as ToolbarIconName,
            title: "Bulleted list",
            active: activeState.unorderedList,
            action: () => toggleList("ul"),
            options: [
              ...SMART_LIST_PRESETS.filter((preset) => preset.kind === "bullet")
                .map((preset) => [`bullet-preset:${preset.id}`, preset.label, false] as const),
              ["bullet:disc", "• Disc", true] as const,
              ["bullet:circle", "○ Circle", true] as const,
              ["bullet:square", "▪ Square", true] as const,
            ],
          },
          {
            key: "ordered",
            enabled: listFeature,
            icon: "numbers" as ToolbarIconName,
            title: "Numbered list",
            active: activeState.orderedList,
            action: () => toggleList("ol"),
            options: [
              ...SMART_LIST_PRESETS.filter((preset) => preset.kind === "ordered")
                .map((preset) => [`ordered-preset:${preset.id}`, preset.label, false] as const),
              ["ordered:decimal", "1. 2. 3.", true] as const,
              ["ordered:lower-alpha", "a. b. c.", true] as const,
              ["ordered:upper-alpha", "A. B. C.", true] as const,
              ["ordered:lower-roman", "i. ii. iii.", true] as const,
              ["ordered:upper-roman", "I. II. III.", true] as const,
            ],
          },
        ].filter((control) => control.enabled).map((control) => (
          <span key={control.key} className="srte-split-control">
            <button
              type="button"
              className={`srte-tool-button${control.active ? " srte-active" : ""}`}
              title={control.title}
              onPointerDown={preserveEditorSelection}
              onClick={control.action}
              aria-pressed={control.active}
            >
              <ToolbarIcon name={control.icon} />
            </button>
            <select
              defaultValue=""
              aria-label={`${control.title} styles`}
              title={`${control.title} styles`}
              onPointerDown={preserveEditorSelection}
              onMouseDown={preserveEditorSelection}
              onChange={(event) => {
                const selected = event.currentTarget.value;
                if (selected === "check:plain") applyChecklist(false);
                else if (selected === "check:strike") applyChecklist(true);
                else if (selected) applyListStyle(selected);
                event.currentTarget.value = "";
              }}
            >
              <option value="" disabled>Style</option>
              {control.options.map(([value, label, hidden]) => <option key={value} value={value} hidden={hidden}>{label}</option>)}
            </select>
          </span>
        ))}
        {blockquoteFeature && <button
          type="button"
          className={`srte-tool-button${activeState.blockquote ? " srte-active" : ""}`}
          title="Blockquote"
          onPointerDown={preserveEditorSelection}
          onClick={toggleBlockquote}
          aria-pressed={activeState.blockquote}
        >
          <ToolbarIcon name="quote" />
        </button>}
        <button
          type="button"
          className="srte-tool-button"
          aria-label="Special characters"
          title="Special characters"
          onClick={() => setShowSpecialChars(true)}
        >
          <ToolbarIcon name="omega" />
        </button>
        {codeBlockFeature && <button
          type="button"
          className={`srte-tool-button${activeState.codeBlock ? " srte-active" : ""}`}
          title="Code block"
          onPointerDown={preserveEditorSelection}
          onClick={toggleCodeBlock}
          aria-pressed={activeState.codeBlock}
        >
          <ToolbarIcon name="code" />
        </button>}
        {basicFormattingFeature && <button
          type="button"
          className={`srte-tool-button${activeState.link ? " srte-active" : ""}`}
          title="Insert link"
          aria-label="Insert or edit link"
          aria-pressed={activeState.link}
          onPointerDown={preserveEditorSelection}
          onClick={() => openLinkEditor()}
        >
          <ToolbarIcon name="link" />
        </button>}
        {pluginRuntime.toolbar
          .filter((contribution) =>
            (!contribution.placement || contribution.placement === "main") &&
            isPluginContributionVisible(contribution))
          .map((contribution) => (
            <button
              key={contribution.id}
              type="button"
              className="srte-tool-button"
              disabled={!isPluginContributionEnabled(contribution)}
              aria-pressed={isPluginContributionActive(contribution)}
              aria-label={contribution.label}
              title={contribution.title || contribution.label}
              onPointerDown={preserveEditorSelection}
              onClick={() => executePluginToolbarContribution(contribution)}
            >
              {contribution.icon || contribution.label.slice(0, 2)}
            </button>
          ))}
        {(table || media || formula || pluginRuntime.toolbar.some((item) => item.placement === "insert")) && (
          <ToolbarMenu label="Insert" icon="insert" priority={2}>
            {table && <MenuItem icon="table" label="Table" title="Insert table" onClick={() => setShowTableDialog(true)} />}
            {media && <MenuItem icon="image" label="Upload image" title="Insert image" onClick={insertImage} />}
            {media && <MenuItem icon="media" label="Media" title="Open media" onClick={() => mediaManager ? setShowMediaManager(true) : insertImage()} />}
            {formula && <MenuItem icon="formula" label="Formula" title="Insert formula" onClick={() => setShowFormulaDialog(true)} />}
            {pluginRuntime.toolbar.filter((item) =>
              item.placement === "insert" && isPluginContributionVisible(item)).map((contribution) => (
              <button
                key={contribution.id}
                type="button"
                role="menuitem"
                className="srte-menu-item"
                disabled={!isPluginContributionEnabled(contribution)}
                title={contribution.title || contribution.label}
                onClick={() => executePluginToolbarContribution(contribution)}
              >
                <span aria-hidden="true">{contribution.icon || "＋"}</span>
                <span>{contribution.label}</span>
              </button>
            ))}
          </ToolbarMenu>
        )}
        {selectedImage && (
          <ToolbarMenu label="Image alignment" icon="image">
            <MenuItem icon="align-center" label="Center image" onClick={() => {
              if (editableRef.current) editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, { align: "center" }); scheduleImageOverlay(); handleInput();
            }} />
            <MenuItem icon="align-left" label="Float left" onClick={() => {
              if (editableRef.current) editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, { align: "left" }); scheduleImageOverlay(); handleInput();
            }} />
            <MenuItem icon="align-right" label="Float right" onClick={() => {
              if (editableRef.current) editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, { align: "right" }); scheduleImageOverlay(); handleInput();
            }} />
          </ToolbarMenu>
        )}
        {formatRuntime.formats.length > 0 && <ToolbarGroup label="Document" priority={3}>
        {formatRuntime.imports.length > 0 && <ToolbarMenu label={loadingPdf || loadingDocx ? "Importing document" : "Import document"} icon="import">
          {formatRuntime.imports.map((format) => <MenuItem key={format.id} icon="import" label={`${format.label} (.${format.extension})`} disabled={loadingPdf || loadingDocx} onClick={() => openFormatImport(format.id)} />)}
        </ToolbarMenu>}
        {formatRuntime.exports.length > 0 && <ToolbarMenu label="Export document" icon="export">
          {formatRuntime.exports.map((format) => <MenuItem key={format.id} icon="export" label={format.label} onClick={() => void runFormatExport(format.id)} />)}
        </ToolbarMenu>}
        <select
          className="srte-command-proxy"
          aria-hidden="true"
          tabIndex={-1}
          defaultValue=""
          aria-label="Import document"
          title="Import document"
          disabled={loadingPdf || loadingDocx}
          onChange={(event) => {
            const format = event.currentTarget.value;
            event.currentTarget.value = "";
            openFormatImport(format);
          }}
          style={{
            height: 32,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
            opacity: loadingPdf || loadingDocx ? 0.6 : 1,
          }}
        >
          <option value="" disabled>{loadingPdf || loadingDocx ? "Importing…" : "Import…"}</option>
          {formatRuntime.imports.map((format) => <option key={format.id} value={format.id}>{proxyFormatLabel(format)} (.{format.extension})</option>)}
        </select>
        <select
          className="srte-command-proxy"
          aria-hidden="true"
          tabIndex={-1}
          defaultValue=""
          aria-label="Export document"
          title="Export document"
          onChange={(event) => {
            const format = event.currentTarget.value;
            event.currentTarget.value = "";
            void runFormatExport(format);
          }}
          style={{
            height: 32,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
          }}
        >
          <option value="" disabled>Export…</option>
          {proxyExportFormats.map((format) => <option key={format.id} value={format.id}>{proxyFormatLabel(format)} (.{format.extension})</option>)}
        </select>
        </ToolbarGroup>}
        {alignmentFeature && <ToolbarMenu
          label="Text alignment"
          icon={currentAlignment === "center" ? "align-center" : currentAlignment === "right" ? "align-right" : currentAlignment === "justify" ? "justify" : "align-left"}
          active={currentAlignment !== "left"}
        >
          {(["left", "center", "right", "justify"] as const).map((alignment) => (
            <MenuItem
              key={alignment}
              icon={alignment === "left" ? "align-left" : alignment === "center" ? "align-center" : alignment === "right" ? "align-right" : "justify"}
              label={alignment === "justify" ? "Justify" : `Align ${alignment}`}
              title={alignment === "justify" ? "Justify" : `Align ${alignment}`}
              active={currentAlignment === alignment}
              onClick={() => applyTextAlignment(alignment)}
            />
          ))}
        </ToolbarMenu>}
        {moveFeature && <ToolbarMenu label="Move and indent" icon="move" priority={2}>
          <MenuItem icon="up" label="Move block up" title="Move selected block up" onClick={() => moveCurrentElement("up")} />
          <MenuItem icon="down" label="Move block down" title="Move selected block down" onClick={() => moveCurrentElement("down")} />
          <div className="srte-menu-separator" role="separator" />
          <MenuItem icon="outdent" label="Decrease indent" title="Move selected block left" onClick={() => moveCurrentElement("left")} />
          <MenuItem icon="indent" label="Increase indent" title="Move selected block right" onClick={() => moveCurrentElement("right")} />
        </ToolbarMenu>}
        <div className="srte-mobile-more">
          <ToolbarMenu label="More editor actions" icon="more">
            {table && <MenuItem icon="table" label="Insert table" onClick={() => setShowTableDialog(true)} />}
            {media && <MenuItem icon="image" label="Upload image" onClick={insertImage} />}
            {media && <MenuItem icon="media" label="Media" onClick={() => mediaManager ? setShowMediaManager(true) : insertImage()} />}
            {formula && <MenuItem icon="formula" label="Insert formula" onClick={() => setShowFormulaDialog(true)} />}
            {pluginRuntime.toolbar.filter((item) =>
              item.placement === "more" && isPluginContributionVisible(item)).map((contribution) => (
              <button
                key={contribution.id}
                type="button"
                role="menuitem"
                className="srte-menu-item"
                disabled={!isPluginContributionEnabled(contribution)}
                title={contribution.title || contribution.label}
                onClick={() => executePluginToolbarContribution(contribution)}
              >
                <span aria-hidden="true">{contribution.icon || "•"}</span>
                <span>{contribution.label}</span>
              </button>
            ))}
            <MenuItem icon="omega" label="Special characters" onClick={() => setShowSpecialChars(true)} />
            {moveFeature && <MenuItem icon="up" label="Move block up" onClick={() => moveCurrentElement("up")} />}
            {moveFeature && <MenuItem icon="down" label="Move block down" onClick={() => moveCurrentElement("down")} />}
            {moveFeature && <MenuItem icon="outdent" label="Decrease indent" onClick={() => moveCurrentElement("left")} />}
            {moveFeature && <MenuItem icon="indent" label="Increase indent" onClick={() => moveCurrentElement("right")} />}
            <div className="srte-menu-separator" role="separator" />
            {formatRuntime.imports.map((format) => <MenuItem key={`mobile-import-${format.id}`} icon="import" label={`Import ${format.label}`} onClick={() => openFormatImport(format.id)} />)}
            <div className="srte-menu-separator" role="separator" />
            {formatRuntime.exports.map((format) => <MenuItem key={`mobile-export-${format.id}`} icon="export" label={`Export ${format.label}`} onClick={() => void runFormatExport(format.id)} />)}
          </ToolbarMenu>
        </div>
      </div>
      {media && mediaManager && (
        <MediaManager
          open={showMediaManager}
          onClose={() => setShowMediaManager(false)}
          adapter={mediaManager}
          onSelect={(item: MediaItem) => {
            if (item?.url) insertImageAtSelection(item);
          }}
        />
      )}
      {table && showTableDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--srte-modal-backdrop)",
            backdropFilter: "var(--srte-modal-backdrop-filter)",
            WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 90,
          }}
          onClick={() => setShowTableDialog(false)}
        >
          <div
            style={{
              background: "var(--srte-modal-bg)",
              color: "var(--srte-modal-text)",
              padding: 16,
              borderRadius: 8,
              minWidth: 280,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Insert table</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(10, 18px)",
                  gap: 2,
                  padding: 6,
                  border: "1px solid var(--srte-border-light)",
                }}
              >
                {Array.from({ length: 100 }).map((_, i) => {
                  const r = Math.floor(i / 10) + 1;
                  const c = (i % 10) + 1;
                  const active = r <= tableRows && c <= tableCols;
                  return (
                    <div
                      key={i}
                      onMouseEnter={() => {
                        setTableRows(r);
                        setTableCols(c);
                      }}
                      onClick={() => {
                        insertTable();
                        setShowTableDialog(false);
                      }}
                      style={{
                        width: 16,
                        height: 16,
                        border: "1px solid var(--srte-border)",
                        background: active ? "var(--srte-accent)" : "var(--srte-input-bg)",
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ fontSize: 12, minWidth: 48 }}>
                {tableRows} × {tableCols}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "end",
                marginTop: 12,
              }}
            >
              <button onClick={() => setShowTableDialog(false)}>Cancel</button>
              <button
                onClick={() => {
                  insertTable();
                  setShowTableDialog(false);
                }}
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingImport && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--srte-modal-backdrop)",
            backdropFilter: "var(--srte-modal-backdrop-filter)",
            WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => {
             setPendingImport(null);
          }}
        >
          <div
            style={{
              background: "var(--srte-modal-bg)",
              color: "var(--srte-modal-text)",
              padding: 20,
              borderRadius: 8,
              maxWidth: 400,
              width: "90%",
              boxShadow: "var(--srte-menu-shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: 18, fontWeight: 600 }}>
                Import Content
            </h3>
            <p style={{ margin: "0 0 20px 0", color: "var(--srte-text-muted)", fontSize: 14 }}>
               The editor already contains content. How would you like to handle the imported document?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                    onClick={() => void processFormatImport(pendingImport.definition, pendingImport.file, 'replace')}
                    style={{
                        padding: "8px 16px",
                        background: "var(--srte-danger)",
                        color: "var(--srte-on-primary)",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 500,
                        textAlign: "left"
                    }}
                >
                    Replace Check existing content (Overwrite)
                </button>
                <button
                    onClick={() => void processFormatImport(pendingImport.definition, pendingImport.file, 'append')}
                    style={{
                        padding: "8px 16px",
                        background: "var(--srte-primary)",
                        color: "var(--srte-on-primary)",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 500,
                        textAlign: "left"
                    }}
                >
                    Append to bottom
                </button>
                <button
                    onClick={() => {
                        setPendingImport(null);
                    }}
                    style={{
                        padding: "8px 16px",
                        background: "var(--srte-cancel-bg)",
                        color: "var(--srte-text)",
                        border: "1px solid var(--srte-border)",
                        borderRadius: 6,
                        cursor: "pointer",
                        marginTop: 4
                    }}
                >
                    Cancel
                </button>
            </div>
          </div>
        </div>
      )}
      {showColorPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--srte-modal-backdrop)",
            backdropFilter: "var(--srte-modal-backdrop-filter)",
            WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowColorPicker(false)}
        >
          <div
            style={{
              background: "var(--srte-modal-bg)",
              padding: 16,
              borderRadius: 8,
              minWidth: 320,
              maxWidth: "90vw",
              color: "var(--srte-modal-text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 12 }}>
              {colorPickerType === 'text' ? 'Select Text Color' : 'Select Background Color'}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(8, 1fr)",
                gap: 8,
                marginBottom: 12,
              }}
            >
              {[
                '#000000', '#434343', '#666666', '#999999',
                '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef',
                '#f3f3f3', '#ffffff', '#980000', '#ff0000',
                '#ff9900', '#ffff00', '#00ff00', '#00ffff',
                '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
                '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc',
                '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3',
                '#d9d2e9', '#ead1dc', '#dd7e6b', '#ea9999',
                '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9',
                '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
              ].map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    if (colorPickerType === 'text') {
                      applyTextColor(color);
                    } else {
                      applyBackgroundColor(color);
                    }
                    setShowColorPicker(false);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    border: color === '#ffffff' ? '1px solid var(--srte-border)' : 'none',
                    borderRadius: 4,
                    background: color,
                    cursor: 'pointer',
                  }}
                  title={color}
                />
              ))}
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
                Custom color:
              </label>
              <input
                type="color"
                value={currentPickerColorHex()}
                onChange={(e) => {
                  if (colorPickerType === 'text') {
                    applyTextColor(e.target.value);
                  } else {
                    applyBackgroundColor(e.target.value);
                  }
                }}
                style={{
                  width: '100%',
                  height: 40,
                  border: '1px solid var(--srte-border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'end' }}>
              <button 
                onClick={() => setShowColorPicker(false)}
                style={{
                  padding: '6px 16px',
                  border: '1px solid var(--srte-input-border)',
                  borderRadius: 6,
                  background: 'var(--srte-input-bg)',
                  color: 'var(--srte-input-text)',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {showSpecialChars && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--srte-modal-backdrop)",
            backdropFilter: "var(--srte-modal-backdrop-filter)",
            WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowSpecialChars(false)}
        >
          <div
            style={{
              background: "var(--srte-modal-bg)",
              color: "var(--srte-modal-text)",
              padding: 16,
              borderRadius: 8,
              width: 420,
              maxWidth: "90vw",
              boxShadow: "var(--srte-menu-shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Special characters</div>
            {[
              {
                label: "Greek",
                chars: ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "π", "ρ", "σ", "τ", "φ", "χ", "ψ", "ω", "Δ", "Σ", "Ω"],
              },
              {
                label: "Medical / Math",
                chars: ["±", "≤", "≥", "≠", "≈", "∞", "°", "µ", "×", "÷", "→", "←", "↑", "↓", "∴", "∵", "√", "∑", "∫", "₂", "₃", "²", "³"],
              },
            ].map((group) => (
              <div key={group.label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: "var(--srte-text-muted)", marginBottom: 6 }}>{group.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {group.chars.map((char) => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => {
                        insertTextAtSelection(char);
                        setShowSpecialChars(false);
                      }}
                      style={{
                        height: 32,
                        minWidth: 32,
                        padding: "0 8px",
                        border: "1px solid var(--srte-input-border)",
                        borderRadius: 6,
                        background: "var(--srte-input-bg)",
                        color: "var(--srte-input-text)",
                        fontSize: 16,
                      }}
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowSpecialChars(false)}
                style={{
                  padding: "6px 16px",
                  border: "1px solid var(--srte-input-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {formula && showFormulaDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--srte-modal-backdrop)",
            backdropFilter: "var(--srte-modal-backdrop-filter)",
            WebkitBackdropFilter: "var(--srte-modal-backdrop-filter)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowFormulaDialog(false)}
        >
          <div
            style={{
              background: "var(--srte-modal-bg)",
              padding: 16,
              borderRadius: 8,
              minWidth: 520,
              maxWidth: 720,
              color: "var(--srte-modal-text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 600 }}>Insert formula</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Shortcut: Cmd/Ctrl+M
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                value={formulaInput}
                onChange={(e) => setFormulaInput(e.target.value)}
                placeholder="Type LaTeX or shortcuts: sqrt(x), x^2, x_1, frac(a,b)"
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  border: "1px solid var(--srte-border)",
                  borderRadius: 6,
                  color: "var(--srte-input-text)",
                  background: "var(--srte-input-bg)",
                }}
              />
              <button
                onClick={() => {
                  const tex = normalizeShortcutToLatex(formulaInput);
                  if (tex) insertFormulaAtSelection(tex);
                  setShowFormulaDialog(false);
                }}
              >
                Insert
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
              }}
            >
              {[
                { label: "Fraction", tex: "\\frac{a}{b}" },
                { label: "Square root", tex: "\\sqrt{x}" },
                { label: "n-th root", tex: "\\sqrt[n]{x}" },
                { label: "Exponent", tex: "x^n" },
                { label: "Subscript", tex: "x_i" },
                { label: "Pythagorean", tex: "a^2+b^2=c^2" },
                {
                  label: "Quadratic",
                  tex: "x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
                },
                {
                  label: "Def. derivative",
                  tex: "f'(x)=\\lim_{h\\to 0} \\frac{f(x+h)-f(x)}{h}",
                },
                { label: "Integral", tex: "\\int_a^b f(x)\\,dx" },
                { label: "Sum i=1..n", tex: "\\sum_{i=1}^{n} i" },
                {
                  label: "Mean",
                  tex: "\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n} x_i",
                },
                {
                  label: "Variance",
                  tex: "\\sigma^2=\\frac{1}{n}\\sum_{i=1}^{n}(x_i-\\bar{x})^2",
                },
                { label: "Area circle", tex: "A=\\pi r^2" },
                { label: "Circumference", tex: "C=2\\pi r" },
                { label: "Einstein", tex: "E=mc^2" },
                { label: "Ohm's law", tex: "V=IR" },
              ].map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    insertFormulaAtSelection(p.tex);
                    setShowFormulaDialog(false);
                  }}
                  title={p.tex}
                  style={{
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 6,
                    background: "var(--srte-surface-subtle)",
                    fontSize: 12,
                    color: "var(--srte-modal-text)",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {p.label}
                  </div>
                  <div>$ {p.tex} $</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              Symbols:{" "}
              {[
                `\\alpha`,
                `\\beta`,
                `\\gamma`,
                `\\delta`,
                `\\theta`,
                `\\lambda`,
                `\\mu`,
                `\\pi`,
                `\\sigma`,
                `\\phi`,
                `\\omega`,
                `\\infty`,
                `\\leq`,
                `\\geq`,
                `\\neq`,
                `\\approx`,
              ].map((sym, i) => (
                <button
                  key={i}
                  onClick={() => insertFormulaAtSelection(sym)}
                  style={{
                    marginRight: 6,
                    marginBottom: 6,
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    background: "var(--srte-input-bg)",
                    color: "var(--srte-modal-text)",
                  }}
                  title={sym}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div
        ref={editorScrollRef}
        onScroll={() => updateDragHandleForTarget(dragHandle?.target || null)}
        style={{
          width: "100%",
          maxWidth: "100%",
          flex: "1 1 auto",
          minWidth: 0,
          minHeight: typeof minHeight === "number" ? `${minHeight}px` : minHeight,
          maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          overflowY: "auto",
          overflowX: "auto",
          overscrollBehavior: "contain",
          boxSizing: "border-box",
          position: "relative",
          scrollPaddingBottom: 24,
        }}
      >
        <div
          ref={editableRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onBeforeInput={(e) => {
            const inputType = (e.nativeEvent as InputEvent).inputType || "input";
            if (inputType === "historyUndo" || inputType === "historyRedo") {
              if (restoreEditorHistory(inputType === "historyUndo" ? "undo" : "redo")) {
                e.preventDefault();
              }
              return;
            }
            captureInputHistory(inputType);
          }}
          onInput={handleInput}
          onKeyUp={updateActiveState}
          onMouseUp={updateActiveState}
          onCompositionStart={() => (isComposingRef.current = true)}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            handleInput();
          }}
          onMouseMove={(e) => {
            if (draggedBlockRef.current) return;
            updateDragHandleForTarget(isNode(e.target) ? getMovableElementFromNode(e.target) : null);
          }}
          onMouseOver={(e) => {
            if (draggedBlockRef.current) return;
            updateDragHandleForTarget(isNode(e.target) ? getMovableElementFromNode(e.target) : null);
          }}
          onMouseLeave={(e) => {
            if (closestFromTarget(e.relatedTarget, "[data-srte-drag-handle]")) return;
            if (!draggedBlockRef.current) scheduleDragHandleHide();
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.files;
            if (media && items && items.length) {
              const hasImage = Array.from(items).some((f) =>
                f.type.startsWith("image/")
              );
              if (hasImage) {
                e.preventDefault();
                handleLocalImageFiles(items);
                return;
              }
            }

            pushEditorHistory();
            const html = e.clipboardData?.getData("text/html");
            if (html) {
              e.preventDefault();
              insertCleanHtml(cleanPastedHtml(html));
            }
          }}
          onDragOver={(e) => {
            // Allow dragging images within editor and file drops
            if (
              draggedBlockRef.current ||
              draggedImageRef.current ||
              e.dataTransfer?.types?.includes("Files")
            ) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            if (draggedBlockRef.current) {
              e.preventDefault();
              const block = draggedBlockRef.current;
              draggedBlockRef.current = null;
              pushEditorHistory();
              if (dropBlockAtPoint(block, e.clientX, e.clientY)) {
                focusElementEnd(block);
                updateDragHandleForTarget(block);
                handleInput();
              }
              return;
            }
            // Move existing dragged image inside editor
            if (draggedImageRef.current) {
              e.preventDefault();
              const x = e.clientX;
              const y = e.clientY;
              let range: Range | null = getRangeFromPoint(x, y);
              const img = draggedImageRef.current;
              draggedImageRef.current = null;
              if (
                range &&
                img &&
                editableRef.current?.contains(range.commonAncestorContainer)
              ) {
                // Avoid inserting inside the image itself
                if (range.startContainer === img || range.endContainer === img)
                  return;
                pushEditorHistory();
                // If dropping inside a link, insert right after the link element
                let container: Node = range.commonAncestorContainer;
                let linkAncestor: HTMLAnchorElement | null = null;
                let el: HTMLElement | null = container as HTMLElement;
                while (el && el !== editableRef.current) {
                  if (el.tagName === "A") {
                    linkAncestor = el as HTMLAnchorElement;
                    break;
                  }
                  el = el.parentElement;
                }
                if (linkAncestor) {
                  linkAncestor.parentElement?.insertBefore(
                    img,
                    linkAncestor.nextSibling
                  );
                } else {
                  range.insertNode(img);
                }
                const r = document.createRange();
                r.setStartAfter(img);
                r.collapse(true);
                safeSelectRange(r);
                setSelectedImage(img);
                scheduleImageOverlay();
                handleInput();
              }
              return;
            }
            if (media && e.dataTransfer?.files?.length) {
              e.preventDefault();
              // Try to move caret to drop point
              const x = e.clientX;
              const y = e.clientY;
              let range: Range | null = getRangeFromPoint(x, y);
              if (range) {
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
              handleLocalImageFiles(e.dataTransfer.files);
            }
          }}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.dataset.srteCheck === "true") {
              const item = t.closest("li") as HTMLElement | null;
              const list = item?.closest('[data-srte-checklist="true"],[data-smart-checkable="true"]') as HTMLElement | null;
              if (item && list) {
                pushEditorHistory();
                const checked = item.dataset.smartChecked !== "true" && item.dataset.checked !== "true";
                const changed = editableRef.current
                  ? executeCanonicalListCheck(editableRef.current, item, checked)
                  : false;
                if (changed) {
                  syncChecklistControls(editableRef.current!);
                  handleInput();
                  return;
                }
                item.dataset.checked = checked ? "true" : "false";
                t.dataset.checked = checked ? "true" : "false";
                t.setAttribute("aria-pressed", checked ? "true" : "false");
                t.setAttribute("aria-label", checked ? "Mark incomplete" : "Mark complete");
                item.style.textDecoration =
                  list.dataset.srteChecklistStrike === "true" && checked ? "line-through" : "";
                handleInput();
                return;
              }
            }
            const anchor = t?.closest("a");
            if (anchor && editableRef.current?.contains(anchor)) {
              e.preventDefault();
              e.stopPropagation();
              openLinkEditor(anchor as HTMLAnchorElement);
              setTableMenu(null);
              setImageMenu(null);
              return;
            }
            setLinkMenu(null);
            if (t && t.tagName === "IMG") {
              setSelectedImage(t as HTMLImageElement);
              scheduleImageOverlay();
            } else {
              setSelectedImage(null);
              setImageOverlay(null);
            }
          }}
          onDragStart={(e) => {
            const t = e.target as HTMLElement | null;
            if (t && t.tagName === "IMG") {
              draggedImageRef.current = t as HTMLImageElement;
              try {
                e.dataTransfer?.setData("text/plain", "moving-image");
                e.dataTransfer!.effectAllowed = "move";
                // Provide a subtle drag image
                const dt = e.dataTransfer;
                if (dt && typeof dt.setDragImage === "function") {
                  const ghost = new Image();
                  ghost.src = (t as HTMLImageElement).src;
                  ghost.width = Math.min(120, (t as HTMLImageElement).width);
                  ghost.height = Math.min(120, (t as HTMLImageElement).height);
                  dt.setDragImage(ghost, 10, 10);
                }
              } catch {}
            } else {
              draggedImageRef.current = null;
            }
          }}
          onDragEnd={() => {
            draggedImageRef.current = null;
            draggedBlockRef.current = null;
          }}
          style={{
            minHeight: typeof minHeight === "number" ? `${minHeight}px` : minHeight,
            maxWidth: "100%",
            overflowX: "visible",
            padding: "16px",
            paddingBottom: "32px",
            outline: "none",
            lineHeight: 1.6,
            boxSizing: "border-box",
            fontFamily: defaultFont || "inherit",
          }}
          data-placeholder={placeholder}
          onFocus={(e) => {
            // Ensure the editor has at least one paragraph to type into
            const el = e.currentTarget;
            if (!el.innerHTML || el.innerHTML === "<br>") {
              el.innerHTML = "<p><br></p>";
            }
            updateActiveState();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" || e.key === "Delete") {
              const selection = window.getSelection();
              const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
              const atom = range
                ? adjacentInlineAtom(range, e.key === "Backspace" ? "backward" : "forward")
                : null;
              if (atom && editableRef.current) {
                pushEditorHistory();
                if (editorControllerRef.current!.bindRoot(editableRef.current).deleteInlineAtom(atom)) {
                  e.preventDefault();
                  handleInput();
                  return;
                }
                editorControllerRef.current!.discardLastHistorySnapshot();
              }
            }
            const pluginShortcut = pluginRuntime.shortcuts.find((shortcut) =>
              matchesPluginShortcut(e, shortcut) &&
              isPluginShortcutAvailable(shortcut));
            if (
              pluginShortcut &&
              executePluginCommand(pluginShortcut.commandId, pluginShortcut.input)
            ) {
              e.preventDefault();
              return;
            }
            if (basicFormattingFeature && (e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
              e.preventDefault();
              openLinkEditor();
              return;
            }
            if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "z") {
              const restored = restoreEditorHistory(e.shiftKey ? "redo" : "undo");
              if (restored) {
                e.preventDefault();
                return;
              }
            }
            if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "y") {
              const restored = restoreEditorHistory("redo");
              if (restored) {
                e.preventDefault();
                return;
              }
            }
            if (
              formula &&
              (e.metaKey || e.ctrlKey) &&
              String(e.key).toLowerCase() === "m"
            ) {
              e.preventDefault();
              setShowFormulaDialog(true);
              return;
            }
            const nativeAnchor = window.getSelection()?.anchorNode;
            const nativeElement = nativeAnchor instanceof HTMLElement ? nativeAnchor : nativeAnchor?.parentElement;
            const activeTableCell = getClosestCell(nativeAnchor || null);
            if (e.key === "Tab" && table && activeTableCell) {
              const position = getCellPosition(activeTableCell);
              if (position) {
                e.preventDefault();
                const logical = getTableGrid(position.tbody).grid;
                const ordered: HTMLTableCellElement[] = [];
                logical.forEach((row) => row.forEach((cell) => { if (cell && ordered[ordered.length - 1] !== cell && !ordered.includes(cell)) ordered.push(cell); }));
                const current = ordered.indexOf(activeTableCell);
                const target = ordered[current + (e.shiftKey ? -1 : 1)];
                if (target) moveCaretToCell(target, e.shiftKey);
                else if (!e.shiftKey && current === ordered.length - 1) {
                  const replacement = editorControllerRef.current!.bindRoot(editableRef.current).executeTableCommand(position.table, {
                    id: "table.row.add", input: { index: logical.length },
                  });
                  const next = replacement?.tBodies[0] ? getTableGrid(replacement.tBodies[0]).grid[logical.length]?.[0] : null;
                  if (next) moveCaretToCell(next, false);
                  addTableResizeHandles();
                  handleInput();
                }
                return;
              }
            }
            const activeCodeBlock = nativeElement?.closest("pre");
            if (activeCodeBlock && editableRef.current?.contains(activeCodeBlock)
              && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pushEditorHistory();
              const changed = executeDomCodeInput(editableRef.current,
                e.key === "Tab" ? "tab" : (e.metaKey || e.ctrlKey) ? "exit" : "newline");
              if (changed) {
                handleInput();
                requestAnimationFrame(updateActiveState);
              } else editorControllerRef.current!.discardLastHistorySnapshot();
              return;
            }
            // Lists own structural keys; tables own Tab at their isolating edge.
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Backspace" || e.key === "Delete") {
              const editor = editableRef.current;
              const selection = window.getSelection();
              const inList = selection?.anchorNode && (selection.anchorNode instanceof HTMLElement
                ? selection.anchorNode : selection.anchorNode.parentElement)?.closest("li");
              if (editor && inList && editor.contains(inList)) {
                pushEditorHistory();
                const changed = executeCanonicalListStructuralInput(
                  editor,
                  e.key === "Enter" ? "enter" : e.key === "Backspace" ? "backspace" : "delete",
                );
                if (changed) {
                  e.preventDefault();
                  handleInput();
                  requestAnimationFrame(updateActiveState);
                  return;
                }
                editorControllerRef.current!.discardLastHistorySnapshot();
              }
            }
            if (e.key === "Tab") {
              const selection = getSelectionRangeInEditor();
              const selectedListItems = selection ? resolveSelectedListItems(selection) : [];
              if (selectedListItems.length > 0) {
                // Table navigation owns Tab inside an isolating cell; list indentation
                // remains available through the explicit move/indent command.
                if (selectedListItems.some((item) => item.closest("td,th"))) return;
                e.preventDefault();
                applyListDepthChange(selectedListItems, e.shiftKey ? "outdent" : "indent");
                return;
              }
              e.preventDefault();
              const currentBlock = getCurrentBlock();
              if (!currentBlock?.closest("li")) {
                captureInputHistory("insertText");
                document.execCommand("insertText", false, "  ");
              }
              return;
            }
            // Table navigation with arrows inside cells
            if (
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
            ) {
              const sel = window.getSelection();
              const cell = getClosestCell(sel?.anchorNode || null);
              if (
                table &&
                cell &&
                cell.parentElement &&
                cell.parentElement.parentElement
              ) {
                const row = cell.parentElement as HTMLTableRowElement;
                const tbody = row.parentElement as HTMLTableSectionElement;
                const cells = Array.from(row.children).filter(
                  (c) =>
                    (c as HTMLElement).tagName === "TD" ||
                    (c as HTMLElement).tagName === "TH"
                );
                const rows = Array.from(tbody.children) as HTMLTableRowElement[];
                const rIdx = rows.indexOf(row);
                const cIdx = cells.indexOf(cell);
                if (e.shiftKey) {
                  const current = selectionRef.current?.tbody === tbody ? selectionRef.current : { tbody, sr: rIdx, sc: cIdx, er: rIdx, ec: cIdx };
                  const next = { sr: current.sr, sc: current.sc, er: current.er, ec: current.ec };
                  if (e.key === "ArrowLeft") next.sc = Math.max(0, next.sc - 1);
                  else if (e.key === "ArrowRight") next.ec = Math.min((getTableGrid(tbody).grid[0]?.length || 1) - 1, next.ec + 1);
                  else if (e.key === "ArrowUp") next.sr = Math.max(0, next.sr - 1);
                  else next.er = Math.min(rows.length - 1, next.er + 1);
                  e.preventDefault();
                  updateSelectionDecor(tbody, next.sr, next.sc, next.er, next.ec);
                  return;
                }
                const atStart = (sel?.anchorOffset || 0) === 0;
                const cellTextLen = (cell.textContent || "").length;
                const atEnd = (sel?.anchorOffset || 0) >= cellTextLen;
                let target: HTMLTableCellElement | null = null;
                if (e.key === "ArrowLeft" && atStart && cIdx > 0) {
                  target = row.children[cIdx - 1] as HTMLTableCellElement;
                } else if (
                  e.key === "ArrowRight" &&
                  atEnd &&
                  cIdx < row.children.length - 1
                ) {
                  target = row.children[cIdx + 1] as HTMLTableCellElement;
                } else if (e.key === "ArrowUp" && rIdx > 0 && atStart) {
                  target = rows[rIdx - 1].children[cIdx] as HTMLTableCellElement;
                } else if (
                  e.key === "ArrowDown" &&
                  rIdx < rows.length - 1 &&
                  atEnd
                ) {
                  target = rows[rIdx + 1].children[cIdx] as HTMLTableCellElement;
                }
                if (target) {
                  e.preventDefault();
                  moveCaretToCell(
                    target,
                    e.key === "ArrowRight" || e.key === "ArrowDown"
                  );
                }
              }
            }
          }}
          onMouseDown={(e) => {
            const cell = getClosestCell(e.target as Node);
            if (!cell) {
              clearSelectionDecor();
              return;
            }
            const pos = getCellPosition(cell);
            if (!pos) return;
            selectingRef.current = { tbody: pos.tbody, start: cell };
            const onMove = (ev: MouseEvent) => {
              const under = document.elementFromPoint(ev.clientX, ev.clientY);
              const overCell = getClosestCell(under);
              const startInfo = selectingRef.current;
              if (!overCell || !startInfo) return;
              const a = getCellPosition(startInfo.start);
              const b = getCellPosition(overCell);
              if (!a || !b || a.tbody !== b.tbody) return;
              const sr = Math.min(a.rIdx, b.rIdx);
              const sc = Math.min(a.cIdx, b.cIdx);
              const er = Math.max(a.rIdx, b.rIdx);
              const ec = Math.max(a.cIdx, b.cIdx);
              updateSelectionDecor(a.tbody, sr, sc, er, ec);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              selectingRef.current = null;
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement;
            const contextItems = pluginRuntime.contextMenu.filter((item) => {
              try {
                return isPluginContributionVisible(item) && (!item.when || item.when({
                  root: e.currentTarget,
                  target,
                  selection: window.getSelection(),
                }));
              } catch {
                return false;
              }
            });
            if (contextItems.length) {
              e.preventDefault();
              preserveEditorSelection();
              setPluginContextMenu({
                x: Math.max(8, Math.min(e.clientX, window.innerWidth - 228)),
                y: Math.max(8, Math.min(e.clientY, window.innerHeight - 48 - contextItems.length * 36)),
                items: contextItems,
              });
              setImageMenu(null);
              setTableMenu(null);
              return;
            }
            setPluginContextMenu(null);
            if (target && target.tagName === "IMG") {
              e.preventDefault();
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const menuW = 220;
              const menuH = 200;
              const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
              const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
              setImageMenu({ x, y, img: target as HTMLImageElement });
              setTableMenu(null);
              return;
            }
            const cell = getClosestCell(e.target as Node);
            if (cell) {
              e.preventDefault();
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const menuW = 220;
              const menuH = 300;
              const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
              const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
              setTableMenu({ x, y, cell });
            } else {
              setTableMenu(null);
              setImageMenu(null);
            }
          }}
        />
        {dragHandle && !readOnly && (
          <button
            type="button"
            draggable
            data-srte-drag-handle="true"
            title="Drag block"
            aria-label="Drag block"
            onMouseEnter={() => {
              if (dragHandleHideTimerRef.current != null) {
                window.clearTimeout(dragHandleHideTimerRef.current);
                dragHandleHideTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              if (!draggedBlockRef.current) scheduleDragHandleHide();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onDragStart={(e) => {
              draggedBlockRef.current = dragHandle.target;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", "moving-block");
              try {
                const ghost = dragHandle.target.cloneNode(true) as HTMLElement;
                ghost.style.position = "fixed";
                ghost.style.left = "-10000px";
                ghost.style.top = "-10000px";
                ghost.style.width = `${Math.min(dragHandle.target.getBoundingClientRect().width, 480)}px`;
                ghost.style.opacity = "0.75";
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 12, 12);
                window.setTimeout(() => ghost.remove(), 0);
              } catch {}
            }}
            onDragEnd={() => {
              draggedBlockRef.current = null;
              updateDragHandleForTarget(dragHandle.target);
            }}
            style={{
              position: "absolute",
              left: dragHandle.left,
              top: dragHandle.top + Math.max(0, (dragHandle.height - 24) / 2),
              width: 24,
              height: 24,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--srte-border)",
              borderRadius: 6,
              background: "var(--srte-input-bg)",
              color: "var(--srte-input-text)",
              boxShadow: "var(--srte-menu-shadow)",
              cursor: "grab",
              zIndex: 8,
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ⋮⋮
          </button>
        )}
        {selectedImage && imageOverlay && (
          <div
            style={{
              position: "absolute",
              left: imageOverlay.left,
              top: imageOverlay.top,
              width: imageOverlay.width,
              height: imageOverlay.height,
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                outline: "2px solid var(--srte-accent)",
                outlineOffset: -2,
              }}
            />
            <div
              title="Resize"
              data-smart-ui="atom-resize-handle"
              role="button"
              tabIndex={0}
              aria-label="Resize image narrower or wider"
              onKeyDown={(event) => {
                if (!selectedImage || !editableRef.current || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                pushEditorHistory();
                const width = Math.max(80, Math.round(selectedImage.getBoundingClientRect().width + (event.key === "ArrowRight" ? 10 : -10)));
                editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, { width });
                scheduleImageOverlay(); handleInput();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!selectedImage) return;
                pushEditorHistory();
                resizingRef.current = {
                  side: "left",
                  startX: e.clientX,
                  startWidth: selectedImage.getBoundingClientRect().width,
                };
                const onMove = (ev: MouseEvent) => {
                  const info = resizingRef.current;
                  if (!info || !selectedImage) return;
                  const delta = info.startX - ev.clientX;
                  const next = Math.max(80, Math.round(info.startWidth + delta));
                  selectedImage.style.width = next + "px";
                  selectedImage.style.height = "auto";
                  scheduleImageOverlay();
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  resizingRef.current = null;
                  if (editableRef.current && selectedImage) {
                    editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, {
                      width: Math.max(1, Math.round(selectedImage.getBoundingClientRect().width)),
                    });
                  }
                  handleInput();
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              style={{
                position: "absolute",
                left: -4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 8,
                height: 24,
                background: "var(--srte-accent)",
                borderRadius: 2,
                cursor: "ew-resize",
                pointerEvents: "auto",
              }}
            />
            <div
              title="Resize"
              data-smart-ui="atom-resize-handle"
              role="button"
              tabIndex={0}
              aria-label="Resize image narrower or wider"
              onKeyDown={(event) => {
                if (!selectedImage || !editableRef.current || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
                event.preventDefault();
                pushEditorHistory();
                const width = Math.max(80, Math.round(selectedImage.getBoundingClientRect().width + (event.key === "ArrowRight" ? 10 : -10)));
                editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, { width });
                scheduleImageOverlay(); handleInput();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!selectedImage) return;
                pushEditorHistory();
                resizingRef.current = {
                  side: "right",
                  startX: e.clientX,
                  startWidth: selectedImage.getBoundingClientRect().width,
                };
                const onMove = (ev: MouseEvent) => {
                  const info = resizingRef.current;
                  if (!info || !selectedImage) return;
                  const delta = ev.clientX - info.startX;
                  const next = Math.max(80, Math.round(info.startWidth + delta));
                  selectedImage.style.width = next + "px";
                  selectedImage.style.height = "auto";
                  scheduleImageOverlay();
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  resizingRef.current = null;
                  if (editableRef.current && selectedImage) {
                    editorControllerRef.current!.bindRoot(editableRef.current).updateInlineImage(selectedImage, {
                      width: Math.max(1, Math.round(selectedImage.getBoundingClientRect().width)),
                    });
                  }
                  handleInput();
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              }}
              style={{
                position: "absolute",
                right: -4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 8,
                height: 24,
                background: "var(--srte-accent)",
                borderRadius: 2,
                cursor: "ew-resize",
                pointerEvents: "auto",
              }}
            />
          </div>
        )}
      </div>
      {pluginContextMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 70 }}
          onMouseDown={() => setPluginContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setPluginContextMenu(null);
          }}
        >
          <div
            role="menu"
            aria-label="Plugin actions"
            style={{
              position: "fixed",
              left: pluginContextMenu.x,
              top: pluginContextMenu.y,
              minWidth: 200,
              padding: 6,
              border: "1px solid var(--srte-border)",
              borderRadius: 8,
              background: "var(--srte-input-bg)",
              boxShadow: "var(--srte-menu-shadow)",
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {pluginContextMenu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="srte-menu-item"
                disabled={!isPluginContributionEnabled(item)}
                onClick={() => {
                  restoreSavedSelection();
                  executePluginCommand(item.commandId, item.input);
                  setPluginContextMenu(null);
                }}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {linkMenu && (
        <LinkEditorPopover
          x={linkMenu.x}
          y={linkMenu.y}
          initialHref={linkMenu.initialHref}
          initialText={linkMenu.initialText}
          initialOpenInNewTab={linkMenu.anchor?.target === "_blank"}
          showTextInput={linkMenu.showTextInput}
          showOpen={Boolean(linkMenu.anchor)}
          showRemove={Boolean(linkMenu.anchor)}
          onApply={applyLinkEditorValue}
          onOpen={linkMenu.anchor ? () => {
            openEditorLink(linkMenu.anchor!);
            setLinkMenu(null);
          } : undefined}
          onRemove={linkMenu.anchor ? () => removeAnchorLink(linkMenu.anchor!) : undefined}
          onCancel={() => setLinkMenu(null)}
        />
      )}
      {tableMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "transparent",
          }}
          onClick={() => setTableMenu(null)}
          onContextMenu={(e) => {
            // Prevent native menu while overlay is shown and reposition our menu
            e.preventDefault();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const menuW = 220;
            const menuH = 300;
            const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
            const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
            // Temporarily hide overlay to detect underlying cell
            const overlay = e.currentTarget as HTMLElement;
            const prev = overlay.style.display;
            overlay.style.display = "none";
            const under = document.elementFromPoint(e.clientX, e.clientY);
            overlay.style.display = prev;
            const cell = getClosestCell(under as Node);
            if (cell) setTableMenu({ x, y, cell });
          }}
        >
          <div
            style={{
              position: "fixed",
              left: tableMenu.x,
              top: tableMenu.y,
              background: "var(--srte-menu-bg)",
              border: "1px solid var(--srte-border)",
              borderRadius: 8,
              boxShadow: "var(--srte-menu-shadow)",
              padding: 6,
              width: 200,
              maxHeight: 260,
              overflowY: "auto",
              color: "var(--srte-menu-text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, fontSize: 11, margin: "2px 6px 6px" }}
            >
              Table
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "4px 6px",
                  fontSize: 12,
                }}
              >
                <span>Fill:</span>
                <input
                  type="color"
                  value={tableMenuFillHex(tableMenu.cell)}
                  onPointerDown={() => {
                    const selection = shouldUseTableSelection(tableMenu.cell) ? selectionRef.current : null;
                    tableFillTargetsRef.current = selection
                      ? getCellsInGridRect(selection.tbody, selection.sr, selection.sc, selection.er, selection.ec)
                      : [tableMenu.cell];
                    pushEditorHistory();
                    clearSelectionDecor();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onInput={(e) => {
                    applyBgToSelection(e.currentTarget.value, tableMenu.cell, tableFillTargetsRef.current);
                    handleInput();
                  }}
                  onChange={(e) => {
                    applyBgToSelection(e.currentTarget.value, tableMenu.cell, tableFillTargetsRef.current);
                    handleInput();
                  }}
                  style={{
                    width: 28,
                    height: 18,
                    padding: 0,
                    border: "none",
                    background: "transparent",
                  }}
                />
              </div>
              <button
                title="Show or hide border for this cell, or for the selected cell range."
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, toggleBorderSelection);
                }}
              >
                <span>▦</span>
                <span>Show/hide cell border</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                disabled={!canMergeFromCell(tableMenu.cell)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  opacity: canMergeFromCell(tableMenu.cell) ? 1 : 0.45,
                  cursor: canMergeFromCell(tableMenu.cell) ? "pointer" : "not-allowed",
                }}
                onClick={() => {
                  if (!canMergeFromCell(tableMenu.cell)) return;
                  mergeSelection();
                  setTableMenu(null);
                }}
              >
                <span>⇄</span>
                <span>Merge cells</span>
              </button>
              <button
                disabled={!canSplitCell(tableMenu.cell)}
                title={canSplitCell(tableMenu.cell) ? "Split this merged cell back into individual cells." : "Only merged cells can be split."}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  opacity: canSplitCell(tableMenu.cell) ? 1 : 0.45,
                  cursor: canSplitCell(tableMenu.cell) ? "pointer" : "not-allowed",
                }}
                onClick={() => {
                  if (!canSplitCell(tableMenu.cell)) return;
                  runTableCellAction(tableMenu.cell, splitCell);
                }}
              >
                <span>⤢</span>
                <span>Split cell</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, (cell) => addRow(cell, "above"));
                }}
              >
                <span>↥</span>
                <span>Row above</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, (cell) => addRow(cell, "below"));
                }}
              >
                <span>↧</span>
                <span>Row below</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, (cell) => addCol(cell, "left"));
                }}
              >
                <span>←</span>
                <span>Column left</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, (cell) => addCol(cell, "right"));
                }}
              >
                <span>→</span>
                <span>Column right</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, deleteRow);
                }}
              >
                <span>✖</span>
                <span>Delete row</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, deleteCol);
                }}
              >
                <span>✖</span>
                <span>Delete column</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, toggleHeaderCell);
                }}
              >
                <span>H</span>
                <span>{tableMenu.cell.tagName === "TH" ? "Remove cell header" : "Make cell header"}</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, toggleHeaderRow);
                }}
              >
                <span>H₁</span>
                <span>Make this row header</span>
              </button>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, toggleHeaderColumn);
                }}
              >
                <span>H↕</span>
                <span>Make this column header</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  runTableCellAction(tableMenu.cell, deleteTable);
                }}
              >
                <span>🗑</span>
                <span>Delete table</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {imageMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "transparent",
          }}
          onClick={() => setImageMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const menuW = 220;
            const menuH = 220;
            const x = Math.max(8, Math.min(e.clientX, vw - menuW - 8));
            const y = Math.max(8, Math.min(e.clientY, vh - menuH - 8));
            setImageMenu({ x, y, img: imageMenu.img });
          }}
        >
          <div
            style={{
              position: "fixed",
              left: imageMenu.x,
              top: imageMenu.y,
              background: "var(--srte-menu-bg)",
              border: "1px solid var(--srte-border)",
              borderRadius: 8,
              boxShadow: "var(--srte-menu-shadow)",
              padding: 8,
              width: 280,
              maxHeight: "80vh",
              overflowY: "auto",
              color: "var(--srte-menu-text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, fontSize: 11, margin: "2px 6px 6px" }}
            >
              Image
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Link</span>
                <input
                  defaultValue={
                    imageMenu.img.parentElement?.tagName === "A"
                      ? (imageMenu.img.parentElement as HTMLAnchorElement).href
                      : ""
                  }
                  placeholder="https://"
                  onChange={(e) => {
                    const url = e.target.value.trim();
                    const curParent = imageMenu.img.parentElement;
                    if (url) {
                      if (curParent && curParent.tagName === "A") {
                        (curParent as HTMLAnchorElement).href = url;
                      } else {
                        const a = document.createElement("a");
                        a.href = url;
                        curParent?.insertBefore(a, imageMenu.img);
                        a.appendChild(imageMenu.img);
                      }
                    } else if (curParent && curParent.tagName === "A") {
                      // unwrap
                      curParent.parentElement?.insertBefore(
                        imageMenu.img,
                        curParent
                      );
                      curParent.remove();
                    }
                    handleInput();
                  }}
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Target</span>
                <select
                  defaultValue={
                    imageMenu.img.parentElement?.tagName === "A"
                      ? (imageMenu.img.parentElement as HTMLAnchorElement)
                          .target || "_self"
                      : "_self"
                  }
                  onChange={(e) => {
                    const curParent = imageMenu.img.parentElement;
                    if (curParent && curParent.tagName === "A") {
                      (curParent as HTMLAnchorElement).target = e.target.value;
                      handleInput();
                    }
                  }}
                  style={{
                    flex: 1,
                    height: 28,
                    padding: "0 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    background: "var(--srte-input-bg)",
                    color: "var(--srte-input-text)",
                  }}
                >
                  <option value="_self">Same tab</option>
                  <option value="_blank">New tab</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Alt</span>
                <input
                  defaultValue={imageMenu.img.alt || ""}
                  onChange={(e) => {
                    imageMenu.img.alt = e.target.value;
                    handleInput();
                  }}
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Width</span>
                <input
                  type="number"
                  min={40}
                  max={2000}
                  defaultValue={Math.round(
                    imageMenu.img.getBoundingClientRect().width
                  )}
                  onChange={(e) => {
                    const v = Math.max(
                      40,
                      Math.min(2000, Number(e.target.value) || 0)
                    );
                    imageMenu.img.style.width = v + "px";
                    imageMenu.img.style.height = "auto";
                    scheduleImageOverlay();
                  }}
                  style={{
                    width: 90,
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
                <span style={{ fontSize: 12 }}>px</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Radius</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  defaultValue={
                    parseInt(
                      (imageMenu.img.style.borderRadius || "0").toString()
                    ) || 0
                  }
                  onChange={(e) => {
                    const v = Math.max(
                      0,
                      Math.min(200, Number(e.target.value) || 0)
                    );
                    imageMenu.img.style.borderRadius = v + "px";
                    handleInput();
                  }}
                  style={{
                    width: 90,
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
                <span style={{ fontSize: 12 }}>px</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 48, fontSize: 12 }}>Align</span>
                <button
                  onClick={() => {
                    const img = imageMenu.img;
                    img.style.display = "block";
                    img.style.margin = "0 auto";
                    img.style.float = "none";
                    scheduleImageOverlay();
                    handleInput();
                  }}
                >
                  ⦿
                </button>
                <button
                  onClick={() => {
                    const img = imageMenu.img;
                    img.style.display = "inline";
                    img.style.float = "left";
                    img.style.margin = "0 8px 8px 0";
                    scheduleImageOverlay();
                    handleInput();
                  }}
                >
                  ⟸
                </button>
                <button
                  onClick={() => {
                    const img = imageMenu.img;
                    img.style.display = "inline";
                    img.style.float = "right";
                    img.style.margin = "0 0 8px 8px";
                    scheduleImageOverlay();
                    handleInput();
                  }}
                >
                  ⟹
                </button>
              </div>
              <div
                style={{
                  borderTop: "1px solid var(--srte-border-light)",
                  paddingTop: 6,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 11 }}>License</div>
                <input
                  placeholder="Work name"
                  defaultValue={imageMenu.img.dataset.workName || ""}
                  onChange={(e) => {
                    imageMenu.img.dataset.workName = e.target.value;
                    handleInput();
                  }}
                  style={{
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
                <input
                  placeholder="Author"
                  defaultValue={imageMenu.img.dataset.licenseAuthor || ""}
                  onChange={(e) => {
                    imageMenu.img.dataset.licenseAuthor = e.target.value;
                    handleInput();
                  }}
                  style={{
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
                <select
                  defaultValue={imageMenu.img.dataset.licenseType || ""}
                  onChange={(e) => {
                    imageMenu.img.dataset.licenseType = e.target.value;
                    handleInput();
                  }}
                  style={{
                    height: 28,
                    padding: "0 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                >
                  <option value="">License type</option>
                  <option value="public-domain">Public domain</option>
                  <option value="cc0">CC0</option>
                  <option value="cc-by">CC BY</option>
                  <option value="cc-by-sa">CC BY-SA</option>
                  <option value="cc-by-nc">CC BY-NC</option>
                  <option value="rights-managed">Rights managed</option>
                  <option value="custom">Custom</option>
                </select>
                <input
                  placeholder="License notes"
                  defaultValue={imageMenu.img.dataset.licenseText || ""}
                  onChange={(e) => {
                    imageMenu.img.dataset.licenseText = e.target.value;
                    handleInput();
                  }}
                  style={{
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
                <input
                  placeholder="Source URL"
                  defaultValue={imageMenu.img.dataset.licenseUrl || ""}
                  onChange={(e) => {
                    imageMenu.img.dataset.licenseUrl = e.target.value;
                    handleInput();
                  }}
                  style={{
                    padding: "4px 6px",
                    border: "1px solid var(--srte-border-light)",
                    borderRadius: 4,
                    color: "var(--srte-input-text)",
                    background: "var(--srte-input-bg)",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    replaceTargetRef.current = imageMenu.img;
                    fileInputRef.current?.click();
                  }}
                >
                  Replace…
                </button>
                <button
                  onClick={() => {
                    const img = imageMenu.img;
                    img.style.width = "";
                    img.style.height = "auto";
                    img.style.borderRadius = "";
                    img.style.margin = "";
                    img.style.float = "none";
                    scheduleImageOverlay();
                    handleInput();
                  }}
                >
                  Reset
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  style={{ color: "var(--srte-danger)" }}
                  onClick={() => {
                    pushEditorHistory();
                    const removedThroughCore = editableRef.current
                      ? editorControllerRef.current!.bindRoot(editableRef.current).deleteInlineAtom(imageMenu.img)
                      : false;
                    if (!removedThroughCore) imageMenu.img.remove();
                    setImageMenu(null);
                    setSelectedImage(null);
                    setImageOverlay(null);
                    handleInput();
                  }}
                >
                  Delete
                </button>
                <button onClick={() => setImageMenu(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
