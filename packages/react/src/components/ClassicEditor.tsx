import React, { useEffect, useRef, useState } from "react";
import { MediaManager, MediaManagerAdapter, MediaItem } from "./MediaManager.js";
import { LinkEditorPopover, type LinkEditorApplyValue } from "./LinkEditorPopover.js";
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { applyLink, applyTextColor as coreApplyTextColor, markdownToCompatibilityHtml, removeLink, sanitizeLinkHref, toggleBold, toggleItalic, toggleSubscript, toggleSuperscript, toggleUnderline, type SmartCommand, type SmartEditorState } from 'smartrte-core';
import { restoreSelectionToDom, selectionFromDom } from '../adapters/domSelectionBridge.js';
import { serializeSmartDocument, smartDocumentFromEditorRoot } from '../adapters/domSmartDocument.js';
import { isShadowModeEnabled, runShadowCommand } from '../adapters/shadowMode.js';
import { getCoreInlineMarkResult, isCoreInlineMarkEnabled, type CoreInlineMark } from '../adapters/inlineMarkCoreExecution.js';
import { closestFromTarget, isNode } from '../adapters/domTargets.js';
import { ensureStyleSheet, SrteTheme } from '../theme.js';

// Initialize PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

type ClassicEditorProps = {
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
  table = true,
  media = true,
  formula = true,
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
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");
  const isComposingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const htmlInputRef = useRef<HTMLInputElement | null>(null);
  const mdInputRef = useRef<HTMLInputElement | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingDocx, setLoadingDocx] = useState(false);
  // State for import confirmation
  const [pendingImport, setPendingImport] = useState<{
      file: File;
      type: 'pdf' | 'docx';
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
  const selectingRef = useRef<{
    tbody: HTMLTableSectionElement;
    start: HTMLTableCellElement;
  } | null>(null);
  const [imageMenu, setImageMenu] = useState<{
    x: number;
    y: number;
    img: HTMLImageElement;
  } | null>(null);
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null);
  const [showMediaManager, setShowMediaManager] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSpecialChars, setShowSpecialChars] = useState(false);
  const [colorPickerType, setColorPickerType] = useState<'text' | 'background'>('text');
  const savedRangeRef = useRef<Range | null>(null);
  const pendingFontSizeRef = useRef<{
    valuePx: number;
    container: Node;
    offset: number;
  } | null>(null);
  const inlineScriptCaretOverrideRef = useRef<{
    command: "normal" | "subscript" | "superscript";
    container: Node;
    offset: number;
  } | null>(null);
  const historyRef = useRef<{ undo: string[]; redo: string[] }>({
    undo: [],
    redo: [],
  });
  const inputHistoryGroupRef = useRef<{
    inputType: string;
    timestamp: number;
  } | null>(null);
  const [currentFontSize, setCurrentFontSize] = useState<string>("");
  const [currentFont, setCurrentFont] = useState<string>("");
  const [currentBlockType, setCurrentBlockType] = useState<"p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "mixed">("p");
  const [currentAlignment, setCurrentAlignment] = useState<"left" | "center" | "right" | "justify" | "mixed">("left");
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

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    // Initialize with provided HTML only when externally controlled value changes
    if (typeof value === "string" && value !== el.innerHTML) {
      el.innerHTML = value || "";
      fixNegativeMargins(el);
      normalizeInvalidQuoteNesting(el);
      normalizeInvalidCodeBlockNesting(el);
      normalizeInvalidTableNesting(el);
      ensureTableWrappers(el);
      ensureCaretBoundaryParagraphs(el);
      addTableResizeHandles();
    }
    normalizeInvalidQuoteNesting(el);
    normalizeInvalidCodeBlockNesting(el);
    normalizeInvalidTableNesting(el);
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

  const normalizeFontSizeSpans = (root: HTMLElement) => {
    Array.from(root.querySelectorAll<HTMLElement>('span[style*="font-size"]')).reverse().forEach((span) => {
      const parent = span.parentElement;
      if (
        parent?.tagName === "SPAN" &&
        parseFontSizePx(parent.style.fontSize) === parseFontSizePx(span.style.fontSize) &&
        span.attributes.length === 1
      ) {
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        span.remove();
      }
    });
    Array.from(root.querySelectorAll<HTMLElement>('span[style*="font-size"]')).forEach((span) => {
      let next = span.nextElementSibling as HTMLElement | null;
      while (
        next?.tagName === "SPAN" &&
        next.getAttribute("style") === span.getAttribute("style") &&
        next.attributes.length === span.attributes.length
      ) {
        while (next.firstChild) span.appendChild(next.firstChild);
        const following = next.nextElementSibling as HTMLElement | null;
        next.remove();
        next = following;
      }
    });
  };

  const resolveFontSizeForRange = (range: Range) => {
    const pending = pendingFontSizeRef.current;
    if (
      range.collapsed && pending &&
      range.startContainer === pending.container &&
      range.startOffset === pending.offset
    ) return String(Math.round(pending.valuePx));
    if (range.collapsed) {
      const explicit = explicitFontSizeAt(range.startContainer);
      return explicit ? String(Math.round(explicit)) : "";
    }
    const editor = editableRef.current;
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
      const scriptOverride = inlineScriptCaretOverrideRef.current;
      const overrideApplies = Boolean(
        scriptOverride &&
        range.collapsed &&
        range.startContainer === scriptOverride.container &&
        range.startOffset === scriptOverride.offset
      );
      if (scriptOverride && !overrideApplies) {
        inlineScriptCaretOverrideRef.current = null;
      }
      const subscriptActive =
        queryState("subscript") || Boolean(element?.closest("sub"));
      const superscriptActive =
        queryState("superscript") || Boolean(element?.closest("sup"));
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
      const alignmentTargets = getAlignmentTargets(range);
      const alignments = new Set(alignmentTargets.map(readTextAlignment));
      setCurrentAlignment(alignments.size > 1 ? "mixed" : Array.from(alignments)[0] || "left");
      setActiveState({
        bold: queryState("bold"),
        italic: queryState("italic"),
        underline: queryState("underline"),
        strikeThrough: queryState("strikeThrough"),
        subscript: overrideApplies ? scriptOverride?.command === "subscript" : subscriptActive,
        superscript: overrideApplies ? scriptOverride?.command === "superscript" : superscriptActive,
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
          const pending = pendingFontSizeRef.current;
          if (
            pending &&
            (!range.collapsed || range.startContainer !== pending.container || range.startOffset !== pending.offset)
          ) pendingFontSizeRef.current = null;
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
      const coreMark = ({ bold: "bold", italic: "italic", underline: "underline", superscript: "superscript", subscript: "subscript" } as Record<string, CoreInlineMark>)[command];
      if (coreMark && editor && isCoreInlineMarkEnabled(coreMark)) {
        try {
          const result = getCoreInlineMarkResult(editor, coreMark);
          if (result) {
            editor.innerHTML = result.html;
            ensureTableWrappers(editor);
            addTableResizeHandles();
            if (!restoreSelectionToDom(editor, result.selectionAfter)) {
              const fallback = document.createRange();
              fallback.selectNodeContents(editor);
              fallback.collapse(false);
              safeSelectRange(fallback);
              if (isShadowModeEnabled()) console.warn(`[Smart RTE] Core ${coreMark} could not restore its exact selection.`);
            }
            handleInput();
            return;
          }
        } catch (error) {
          if (isShadowModeEnabled()) console.warn(`[Smart RTE] Core ${coreMark} fell back to legacy execution.`, error);
        }
      }
      const shadowCommand = ({
        bold: toggleBold,
        italic: toggleItalic,
        underline: toggleUnderline,
        superscript: toggleSuperscript,
        subscript: toggleSubscript,
        foreColor: coreApplyTextColor,
        createLink: applyLink,
        unlink: removeLink,
      } as Record<string, SmartCommand<any>>)[command];
      const shadowInput = command === "createLink" ? { href: valueArg || "" } : valueArg;
      const shadowState = shadowCommand && editor && isShadowModeEnabled()
        ? (() => {
            const selection = selectionFromDom(editor, window.getSelection());
            if (!selection) return null;
            const { document: coreDocument } = smartDocumentFromEditorRoot(editor);
            return { document: coreDocument, selection } as SmartEditorState;
          })()
        : null;
      const beforeHtml = editableRef.current?.innerHTML || "";
      const ok = document.execCommand(command, false, valueArg);
      const afterHtml = editableRef.current?.innerHTML || "";
      const needsFallback =
        !ok ||
        (command === "formatBlock" && beforeHtml === afterHtml);
      if (needsFallback) {
        if (command === "formatBlock" && valueArg) applyFormatBlockFallback(valueArg);
      }
      if (shadowCommand && shadowState) {
        runShadowCommand({
          command: shadowCommand,
          context: { document: shadowState.document, selection: shadowState.selection },
          input: shadowInput,
          state: shadowState,
          legacyHtml: afterHtml,
          serialize: (state) => serializeSmartDocument(state.document),
        });
      }
      handleInput();
    } catch {}
  };

  const getScriptAncestor = (
    node: Node | null,
    tagName: "sub" | "sup"
  ) => {
    const editor = editableRef.current;
    let element = node instanceof HTMLElement ? node : node?.parentElement || null;
    while (element && element !== editor) {
      if (element.tagName.toLowerCase() === tagName) return element;
      element = element.parentElement;
    }
    return null;
  };

  const toggleInlineScript = (command: "subscript" | "superscript") => {
    try {
      if (!restoreSavedSelection()) {
        safeSelectRange(getSelectionRangeInEditor());
      }

      const editor = editableRef.current;
      const range = getSelectionRangeInEditor();
      if (!editor || !range) return;

      if (range.collapsed) {
        const tagName = command === "subscript" ? "sub" : "sup";
        const pending = inlineScriptCaretOverrideRef.current;
        const pendingApplies = pending &&
          pending.container === range.startContainer && pending.offset === range.startOffset;
        const active = pendingApplies
          ? pending.command === command
          : Boolean(getScriptAncestor(range.startContainer, tagName));
        const nextCommand = active ? "normal" : command;
        inlineScriptCaretOverrideRef.current = {
          command: nextCommand,
          container: range.startContainer,
          offset: range.startOffset,
        };
        setActiveState((current) => ({
          ...current,
          subscript: nextCommand === "subscript",
          superscript: nextCommand === "superscript",
        }));
        savedRangeRef.current = range.cloneRange();
        return;
      }

      inlineScriptCaretOverrideRef.current = null;
      pushEditorHistory();
      const result = getCoreInlineMarkResult(editor, command);
      if (result) {
        editor.innerHTML = result.html;
        ensureTableWrappers(editor);
        addTableResizeHandles();
        restoreSelectionToDom(editor, result.selectionAfter);
        handleInput();
      } else {
        exec(command);
      }
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  useEffect(() => {
    const editor = editableRef.current;
    if (!editor) return;

    const splitScriptAtRange = (script: HTMLElement, range: Range) => {
      const rightRange = document.createRange();
      rightRange.selectNodeContents(script);
      rightRange.setStart(range.startContainer, range.startOffset);
      const rightContent = rightRange.extractContents();
      const rightScript = script.cloneNode(false) as HTMLElement;
      rightScript.appendChild(rightContent);
      script.parentNode?.insertBefore(rightScript, script.nextSibling);
      const insertion = document.createRange();
      insertion.setStartAfter(script);
      insertion.collapse(true);
      if (!script.textContent) script.remove();
      if (!rightScript.textContent) rightScript.remove();
      return insertion;
    };

    const applyPendingInlineScript = (event: InputEvent) => {
      const pending = inlineScriptCaretOverrideRef.current;
      if (!pending || event.inputType !== "insertText" || !event.data) return;
      const range = getSelectionRangeInEditor();
      if (!range?.collapsed || range.startContainer !== pending.container || range.startOffset !== pending.offset) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      pushEditorHistory();
      const currentScript = getScriptAncestor(range.startContainer, "sub") ||
        getScriptAncestor(range.startContainer, "sup");
      const desiredTag = pending.command === "normal"
        ? null
        : pending.command === "subscript" ? "sub" : "sup";
      let insertion = range;
      if (currentScript && currentScript.tagName.toLowerCase() !== desiredTag) {
        insertion = splitScriptAtRange(currentScript, range);
      }

      const text = document.createTextNode(event.data);
      let inserted: Node = text;
      if (desiredTag && currentScript?.tagName.toLowerCase() !== desiredTag) {
        const script = document.createElement(desiredTag);
        script.appendChild(text);
        inserted = script;
      }
      const pendingSize = pendingFontSizeRef.current;
      if (pendingSize) {
        const span = document.createElement("span");
        span.style.fontSize = `${pendingSize.valuePx}px`;
        span.appendChild(inserted);
        inserted = span;
      }
      insertion.insertNode(inserted);
      const nextRange = document.createRange();
      nextRange.setStartAfter(text);
      nextRange.collapse(true);
      safeSelectRange(nextRange);
      inlineScriptCaretOverrideRef.current = {
        command: pending.command,
        container: nextRange.startContainer,
        offset: nextRange.startOffset,
      };
      if (pendingSize) pendingFontSizeRef.current = {
        valuePx: pendingSize.valuePx,
        container: nextRange.startContainer,
        offset: nextRange.startOffset,
      };
      savedRangeRef.current = nextRange.cloneRange();
      handleInput();
    };

    editor.addEventListener("beforeinput", applyPendingInlineScript);
    return () => editor.removeEventListener("beforeinput", applyPendingInlineScript);
  }, []);

  const applyFormatBlock = (blockName: string) => {
    try {
      if (!restoreSavedSelection()) {
        safeSelectRange(getSelectionRangeInEditor());
      }
      pushEditorHistory();
      if (applyFormatBlockFallback(blockName)) {
        const tag = normalizeBlockTag(blockName);
        if (tag === "p" || /^h[1-6]$/.test(tag || "")) {
          setCurrentBlockType(tag as "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
        }
        handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }
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
    const undo = historyRef.current.undo;
    if (undo[undo.length - 1] !== html) {
      undo.push(html);
      if (undo.length > 100) undo.shift();
    }
    historyRef.current.redo = [];
  };

  const restoreEditorHistory = (dir: "undo" | "redo") => {
    const editor = editableRef.current;
    if (!editor) return false;
    const history = historyRef.current;
    const from = dir === "undo" ? history.undo : history.redo;
    const to = dir === "undo" ? history.redo : history.undo;
    const currentHtml = editor.innerHTML;
    let html: string | undefined;
    while (from.length > 0) {
      const candidate = from.pop();
      if (candidate !== currentHtml) {
        html = candidate;
        break;
      }
    }
    if (html == null) return false;
    if (to[to.length - 1] !== currentHtml) to.push(currentHtml);
    editor.innerHTML = html;
    fixNegativeMargins(editor);
    normalizeInvalidCodeBlockNesting(editor);
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

  const escapeAttribute = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
      state.anchor.setAttribute("href", value.href);
      updateAnchorTarget(state.anchor, value.openInNewTab);
      if (value.text != null && value.text !== state.anchor.textContent) {
        state.anchor.textContent = value.text;
      }
      selectAnchorContents(state.anchor);
      handleInput();
      return;
    }

    if (state.range) safeSelectRange(state.range.cloneRange());
    if (state.range && !state.range.collapsed) {
      exec("createLink", value.href);
      const createdAnchor = getSelectedAnchor();
      if (createdAnchor) {
        updateAnchorTarget(createdAnchor, value.openInNewTab);
        handleInput();
      }
      return;
    }

    if (!value.text) return;
    pushEditorHistory();
    const targetAttributes = value.openInNewTab ? ' target="_blank" rel="noopener noreferrer"' : "";
    document.execCommand("insertHTML", false, `<a href="${escapeAttribute(value.href)}"${targetAttributes}>${escapeAttribute(value.text)}</a>`);
    handleInput();
  };

  const updateAnchorTarget = (anchor: HTMLAnchorElement, openInNewTab: boolean) => {
    const otherRelValues = (anchor.getAttribute("rel") || "")
      .split(/\s+/)
      .filter((value) => value && value !== "noopener" && value !== "noreferrer");
    if (openInNewTab) {
      anchor.target = "_blank";
      anchor.rel = [...otherRelValues, "noopener", "noreferrer"].join(" ");
      return;
    }
    anchor.removeAttribute("target");
    if (otherRelValues.length) anchor.rel = otherRelValues.join(" ");
    else anchor.removeAttribute("rel");
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

  const getSelectedListItems = (blocks: HTMLElement[]) => {
    const seen = new Set<HTMLElement>();
    const items: HTMLElement[] = [];
    blocks.forEach((block) => {
      const li = block.tagName.toLowerCase() === "li"
        ? block
        : (block.closest("li") as HTMLElement | null);
      if (li && editableRef.current?.contains(li) && !seen.has(li)) {
        seen.add(li);
        items.push(li);
      }
    });
    return items;
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
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      if (!range) return;
      const targets = getAlignmentTargets(range);
      if (targets.length === 0) return;
      pushEditorHistory();
      targets.forEach((target) => {
        target.style.textAlign = alignment === "left" ? "" : alignment;
        if (!target.getAttribute("style")) target.removeAttribute("style");
      });
      safeSelectRange(range);
      savedRangeRef.current = range.cloneRange();
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch {}
  };

  const copyCellOrBlockStyles = (from: HTMLElement, to: HTMLElement) => {
    to.innerHTML = from.innerHTML || "<br>";
    const style = from.getAttribute("style");
    if (style) to.setAttribute("style", style);
  };

  const applyHeaderCellStyle = (cell: HTMLElement) => {
    cell.style.fontWeight = "700";
    cell.style.background = "#f3f4f6";
    cell.style.textAlign = cell.style.textAlign || "left";
  };

  const clearHeaderCellStyle = (cell: HTMLElement) => {
    if (cell.style.fontWeight === "700" || cell.style.fontWeight === "bold") cell.style.fontWeight = "";
    if (cell.style.background === "var(--srte-surface-subtle)" || cell.style.background === "rgb(243, 244, 246)" || cell.style.background === "#f3f4f6") cell.style.background = "";
  };

  const replaceTableCellTag = (cell: HTMLTableCellElement, tag: "td" | "th") => {
    const replacement = document.createElement(tag);
    replacement.innerHTML = cell.innerHTML || "&nbsp;";
    replacement.colSpan = cell.colSpan;
    replacement.rowSpan = cell.rowSpan;
    const style = cell.getAttribute("style");
    if (style) replacement.setAttribute("style", style);
    if ((cell as any).__rtePrevBg != null) {
      replacement.style.background = (cell as any).__rtePrevBg || "";
      delete (cell as any).__rtePrevBg;
    }
    if (
      replacement.style.background === "var(--srte-accent-bg)" ||
      replacement.style.background.includes("59, 130, 246") ||
      replacement.style.background.includes("59, 158, 255")
    ) {
      replacement.style.background = "";
    }
    replacement.style.outline = "";
    replacement.style.outlineOffset = "";
    replacement.style.border = replacement.style.border || "1px solid #d1d5db";
    replacement.style.padding = replacement.style.padding || "6px";
    replacement.style.minWidth = replacement.style.minWidth || "60px";
    if (tag === "th") applyHeaderCellStyle(replacement);
    else clearHeaderCellStyle(replacement);
    cell.parentElement?.replaceChild(replacement, cell);
    return replacement as HTMLTableCellElement;
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

  const replaceBlockTag = (block: HTMLElement, tag: string) => {
    if (block.tagName.toLowerCase() === tag) return block;
    const replacement = document.createElement(tag);
    copyCellOrBlockStyles(block, replacement);
    block.parentElement?.replaceChild(replacement, block);
    return replacement;
  };

  const clearExplicitFontSizes = (block: HTMLElement) => {
    Array.from(block.querySelectorAll<HTMLElement>('[style*="font-size"]')).forEach((element) => {
      element.style.fontSize = "";
      if (!element.style.cssText) element.removeAttribute("style");
      if (element.tagName === "SPAN" && !element.getAttribute("style") && element.attributes.length === 0) {
        const parent = element.parentNode;
        if (!parent) return;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
      }
    });
  };

  const replaceListItemContentTag = (item: HTMLElement, tag: string) => {
    const directBlock = Array.from(item.children).find((child) =>
      child.matches("p,h1,h2,h3,h4,h5,h6")
    ) as HTMLElement | undefined;
    if (directBlock) return replaceBlockTag(directBlock, tag);

    const block = document.createElement(tag);
    const boundary = Array.from(item.children).find((child) =>
      child.matches("ul,ol,blockquote,pre")
    ) || null;
    Array.from(item.childNodes).forEach((node) => {
      if (node === boundary) return;
      if (node instanceof HTMLElement && node.dataset.srteCheck === "true") return;
      block.appendChild(node);
    });
    if (!block.childNodes.length) block.innerHTML = "<br>";
    item.insertBefore(block, boundary);
    return block;
  };

  const applyFormatBlockFallback = (blockName: string) => {
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    const tag = normalizeBlockTag(blockName);
    if (!editor || !range || !tag) return false;

    if (!editor.innerHTML.trim()) {
      const block = document.createElement(tag);
      block.innerHTML = "<br>";
      editor.appendChild(block);
      focusElementEnd(block);
      return true;
    }

    if (range.collapsed) {
      const block = getCurrentBlock();
      if (!block || block === editor || !block.parentElement) return false;
      const item = block.closest("li") as HTMLElement | null;
      const replacement = item ? replaceListItemContentTag(item, tag) : replaceBlockTag(block, tag);
      if (/^h[1-6]$/.test(tag)) clearExplicitFontSizes(replacement);
      focusElementEnd(replacement);
      return true;
    }

    const selectedBlocks = sortInDocumentOrder(getSelectedBlocks(range)).filter((block) => {
      if (!editor.contains(block) || block === editor) return false;
      return Boolean(block.parentElement);
    });

    if (selectedBlocks.length > 0) {
      let lastReplacement: HTMLElement | null = null;
      const handledItems = new Set<HTMLElement>();
      selectedBlocks.forEach((block) => {
        const item = block.closest("li") as HTMLElement | null;
        if (item) {
          if (handledItems.has(item)) return;
          handledItems.add(item);
          lastReplacement = replaceListItemContentTag(item, tag);
        } else {
          lastReplacement = replaceBlockTag(block, tag);
        }
        if (lastReplacement && /^h[1-6]$/.test(tag)) clearExplicitFontSizes(lastReplacement);
      });
      if (lastReplacement) focusElementEnd(lastReplacement);
      return true;
    }

    const block = document.createElement(tag);
    const contents = range.extractContents();
    block.appendChild(contents);
    if (!block.innerHTML.trim()) block.innerHTML = "<br>";
    range.insertNode(block);
    focusElementEnd(block);
    return true;
  };

  const cloneListShell = (list: HTMLElement, tagName?: "ul" | "ol") => {
    const clone = document.createElement(tagName || (list.tagName.toLowerCase() as "ul" | "ol"));
    Array.from(list.attributes).forEach((attr) => clone.setAttribute(attr.name, attr.value));
    return clone;
  };

  const mergeAdjacentCompatibleLists = (list: HTMLElement) => {
    const isCompatible = (candidate: Element | null) =>
      candidate instanceof HTMLElement &&
      candidate.tagName === list.tagName &&
      candidate.style.listStyleType === list.style.listStyleType &&
      candidate.dataset.srteChecklist === list.dataset.srteChecklist &&
      candidate.dataset.srteChecklistStrike === list.dataset.srteChecklistStrike;

    let merged = list;
    const previous = merged.previousElementSibling;
    if (isCompatible(previous)) {
      while (merged.firstChild) previous!.appendChild(merged.firstChild);
      merged.remove();
      merged = previous as HTMLElement;
    }

    const next = merged.nextElementSibling;
    if (isCompatible(next)) {
      while (next!.firstChild) merged.appendChild(next!.firstChild);
      next!.remove();
    }
    return merged;
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

  const decorateChecklist = (list: HTMLElement, strikeCompleted: boolean) => {
    list.dataset.srteChecklist = "true";
    list.dataset.srteChecklistStrike = strikeCompleted ? "true" : "false";
    list.style.listStyleType = "none";
    list.style.paddingInlineStart = "1.5em";
    Array.from(list.children).forEach((item) => {
      if (!(item instanceof HTMLElement) || item.tagName !== "LI") return;
      const legacyCheckbox = item.querySelector(':scope > input[data-srte-check]') as HTMLInputElement | null;
      const checked = item.dataset.checked === "true" || Boolean(legacyCheckbox?.checked);
      item.querySelectorAll(':scope > [data-srte-check]').forEach((control) => control.remove());
      item.dataset.checked = checked ? "true" : "false";
      const control = document.createElement("button");
      control.type = "button";
      control.dataset.srteCheck = "true";
      control.contentEditable = "false";
      control.tabIndex = -1;
      control.setAttribute("aria-label", checked ? "Mark incomplete" : "Mark complete");
      control.textContent = checked ? "☑" : "☐";
      control.style.cssText = "margin-inline:-1.45em .45em;border:0;padding:0;background:transparent;color:inherit;font:inherit;cursor:pointer";
      item.prepend(control);
      item.style.textDecoration = strikeCompleted && checked ? "line-through" : "";
    });
    return mergeAdjacentCompatibleLists(list);
  };

  const focusElementEnd = (element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    safeSelectRange(range);
    savedRangeRef.current = range.cloneRange();
  };

  const insertEmptyListAtSelection = (listTag: "ul" | "ol") => {
    const editor = editableRef.current;
    const range = getSelectionRangeInEditor();
    if (!editor || !range) return;
    const list = document.createElement(listTag);
    const li = document.createElement("li");
    li.innerHTML = "<br>";
    list.appendChild(li);
    range.deleteContents();
    range.insertNode(list);
    focusElementEnd(li);
  };

  const unwrapListItem = (li: HTMLElement, list: HTMLElement) => {
    const parent = list.parentElement;
    if (!parent) return;

    const paragraph = document.createElement("p");
    paragraph.innerHTML = li.innerHTML || "<br>";
    paragraph.style.textAlign = li.style.textAlign;

    const beforeList = cloneListShell(list);
    const afterList = cloneListShell(list);

    while (list.firstChild && list.firstChild !== li) {
      beforeList.appendChild(list.firstChild);
    }
    while (li.nextSibling) {
      afterList.appendChild(li.nextSibling);
    }

    if (beforeList.childNodes.length) parent.insertBefore(beforeList, list);
    parent.insertBefore(paragraph, list);
    if (afterList.childNodes.length) parent.insertBefore(afterList, list);
    li.remove();
    if (!list.querySelector("li")) list.remove();
    focusElementEnd(paragraph);
  };

  const convertListTag = (list: HTMLElement, listTag: "ul" | "ol") => {
    const replacement = cloneListShell(list, listTag);
    replacement.innerHTML = list.innerHTML;
    list.parentElement?.replaceChild(replacement, list);
    const li = replacement.querySelector("li") as HTMLElement | null;
    focusElementEnd(li || replacement);
  };

  const getOrCreateNestedList = (li: HTMLElement, listTag: "ul" | "ol") => {
    let nested = Array.from(li.children).find((child) => {
      const tag = child.tagName.toLowerCase();
      return tag === "ul" || tag === "ol";
    }) as HTMLElement | undefined;

    if (nested && nested.tagName.toLowerCase() !== listTag) {
      const replacement = cloneListShell(nested, listTag);
      replacement.innerHTML = nested.innerHTML;
      nested.parentElement?.replaceChild(replacement, nested);
      nested = replacement;
    }

    if (!nested) {
      nested = document.createElement(listTag);
      li.appendChild(nested);
    }

    return nested;
  };

  const nestSelectedListItems = (items: HTMLElement[], listTag: "ul" | "ol") => {
    if (items.length === 0) return false;
    let changed = false;
    let lastTargetList: HTMLElement | null = null;

    items.forEach((li) => {
      const previous = li.previousElementSibling as HTMLElement | null;
      if (!previous || previous.tagName.toLowerCase() !== "li") return;
      const targetList = getOrCreateNestedList(previous, listTag);
      targetList.appendChild(li);
      lastTargetList = targetList;
      changed = true;
    });

    if (changed) {
      const lastItem = lastTargetList?.lastElementChild as HTMLElement | null;
      if (lastItem) focusElementEnd(lastItem);
    }
    return changed;
  };

  const nestListSelection = () => {
    const editor = editableRef.current;
    if (!editor) return;
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());

    const range = getSelectionRangeInEditor();
    if (!range || range.collapsed) return;
    const items = sortInDocumentOrder(getSelectedListItems(getSelectedBlocks(range)));
    const firstList = items[0]?.parentElement;
    if (
      items.length === 0 ||
      !firstList ||
      !["ul", "ol"].includes(firstList.tagName.toLowerCase())
    ) {
      return;
    }

    const listTag = firstList.tagName.toLowerCase() as "ul" | "ol";
    const directItems = items.filter((item) => item.parentElement === firstList);
    if (directItems.length === 0 || !directItems[0].previousElementSibling) return;

    pushEditorHistory();
    if (nestSelectedListItems(directItems, listTag)) {
      handleInput();
      requestAnimationFrame(updateActiveState);
    }
  };

  const restyleSelectedListItems = (
    items: HTMLElement[],
    listTag: "ul" | "ol",
    styleType: string
  ) => {
    const editor = editableRef.current;
    if (!editor || items.length === 0) return null;
    const selected = new Set(items);
    const sourceLists = Array.from(new Set(items.map((item) => item.parentElement as HTMLElement)));
    let lastSelected: HTMLElement | null = null;

    sourceLists.forEach((source) => {
      const parent = source.parentElement;
      if (!parent || !editor.contains(source)) return;
      const outputs: HTMLElement[] = [];
      let pending: HTMLElement | null = null;
      let pendingSelected: boolean | null = null;

      Array.from(source.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child.tagName !== "LI") return;
        const isSelected = selected.has(child);
        if (!pending || pendingSelected !== isSelected) {
          pending = isSelected ? document.createElement(listTag) : cloneListShell(source);
          if (isSelected) pending.style.listStyleType = styleType;
          outputs.push(pending);
          pendingSelected = isSelected;
        }
        if (isSelected) {
          child.querySelectorAll(':scope > [data-srte-check]').forEach((control) => control.remove());
          delete child.dataset.checked;
          child.style.textDecoration = "";
          lastSelected = child;
        }
        pending.appendChild(child);
      });

      outputs.forEach((output) => parent.insertBefore(output, source));
      source.remove();
      outputs.forEach((output) => {
        if (output.tagName.toLowerCase() === listTag && output.style.listStyleType === styleType) {
          clearChecklist(output);
        }
        mergeAdjacentCompatibleLists(output);
      });
    });
    return lastSelected;
  };

  const applyListStyle = (value: string) => {
    const listTag = value.startsWith("ordered:") ? "ol" : "ul";
    const styleType = value.replace(/^(ordered|bullet):/, "");
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());

    const range = getSelectionRangeInEditor();
    if (!range) return;
    const selectedBlocks = getSelectedBlocks(range);
    const selectedItems = getSelectedListItems(selectedBlocks);
    const selectedPlainBlocks = selectedBlocks.filter((block) => !block.closest("ul,ol"));
    if (selectedItems.length > 0) {
      pushEditorHistory();
      const lastItem = restyleSelectedListItems(selectedItems, listTag, styleType);
      const convertedPlainBlocks = convertSelectedBlocksToList(selectedPlainBlocks, listTag, styleType);
      if (!convertedPlainBlocks && lastItem) focusElementEnd(lastItem);
      handleInput();
      requestAnimationFrame(updateActiveState);
      return;
    }
    const lists = new Set<HTMLElement>();
    getSelectedListItems(getSelectedBlocks(range)).forEach((item) => {
      const list = item.parentElement;
      if (
        list &&
        ["ul", "ol"].includes(list.tagName.toLowerCase())
      ) {
        lists.add(list);
      }
    });
    [range.startContainer, range.endContainer].forEach((node) => {
      const element = node instanceof HTMLElement ? node : node.parentElement;
      const list = element?.closest("ul,ol") as HTMLElement | null;
      if (list && editableRef.current?.contains(list)) lists.add(list);
    });

    if (lists.size === 0) {
      const blocks = range.collapsed
        ? [getCurrentBlock()].filter((block): block is HTMLElement => Boolean(block))
        : getSelectedBlocks(range);
      const convertibleBlocks = blocks.filter((block) =>
        editableRef.current?.contains(block) &&
        !block.closest("ul,ol") &&
        Boolean(block.parentElement)
      );
      if (convertibleBlocks.length > 0) {
        pushEditorHistory();
        if (convertSelectedBlocksToList(convertibleBlocks, listTag)) {
          const createdList = getCurrentBlock()?.closest("ul,ol") as HTMLElement | null;
          if (createdList) {
            createdList.style.listStyleType = styleType;
            const mergedList = mergeAdjacentCompatibleLists(createdList);
            const lastItem = mergedList.lastElementChild as HTMLElement | null;
            if (lastItem) focusElementEnd(lastItem);
          }
        }
        handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }

      if (!range.collapsed && blocks.length === 0) {
        toggleList(listTag);
        const createdList = getCurrentBlock()?.closest("ul,ol") as HTMLElement | null;
        if (createdList) {
          createdList.style.listStyleType = styleType;
          handleInput();
        }
        return;
      }

      const block = getCurrentBlock();
      if (!block?.closest("ul,ol")) return;
      const currentList = block.closest("ul,ol") as HTMLElement | null;
      if (currentList) lists.add(currentList);
    }

    if (lists.size === 0) return;
    pushEditorHistory();
    let lastList: HTMLElement | null = null;
    const styledLists: HTMLElement[] = [];
    lists.forEach((list) => {
      const target =
        list.tagName.toLowerCase() === listTag
          ? list
          : cloneListShell(list, listTag);
      if (target !== list) {
        target.innerHTML = list.innerHTML;
        list.parentElement?.replaceChild(target, list);
      }
      clearChecklist(target);
      target.style.listStyleType = styleType;
      lastList = target;
      styledLists.push(target);
    });
    styledLists.forEach((list) => {
      if (editableRef.current?.contains(list)) {
        lastList = mergeAdjacentCompatibleLists(list);
      }
    });
    const lastItem = lastList?.lastElementChild as HTMLElement | null;
    if (lastItem) focusElementEnd(lastItem);
    handleInput();
    requestAnimationFrame(updateActiveState);
  };

  const applyChecklist = (strikeCompleted = false, toggleOff = false) => {
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
    const range = getSelectionRangeInEditor();
    if (!range) return;
    const selectedItems = getSelectedListItems(getSelectedBlocks(range));
    const selectedChecklists = selectedItems.filter(
      (item) => item.parentElement?.dataset.srteChecklist === "true"
    );
    if (toggleOff && selectedItems.length > 0 && selectedChecklists.length === selectedItems.length) {
      pushEditorHistory();
      selectedItems.forEach((item) => {
        item.querySelectorAll(':scope > [data-srte-check]').forEach((control) => control.remove());
        delete item.dataset.checked;
        item.style.textDecoration = "";
      });
      if (transformSelectedListItems(selectedItems, "ul")) {
        handleInput();
        requestAnimationFrame(updateActiveState);
      }
      return;
    }

    if (selectedItems.length > 0) {
      pushEditorHistory();
      const lastItem = restyleSelectedListItems(selectedItems, "ul", "none");
      const lists = new Set<HTMLElement>();
      selectedItems.forEach((item) => {
        if (item.parentElement) lists.add(item.parentElement);
      });
      lists.forEach((list) => decorateChecklist(list, strikeCompleted));
      if (lastItem) focusElementEnd(lastItem);
      handleInput();
      requestAnimationFrame(updateActiveState);
      return;
    }

    applyListStyle("bullet:none");
    const createdList = getCurrentBlock()?.closest("ul") as HTMLElement | null;
    if (!createdList) return;
    const merged = decorateChecklist(createdList, strikeCompleted);
    const lastItem = merged.lastElementChild as HTMLElement | null;
    if (lastItem) focusElementEnd(lastItem);
    handleInput();
    requestAnimationFrame(updateActiveState);
  };

  const convertSelectedBlocksToList = (
    blocks: HTMLElement[],
    listTag: "ul" | "ol",
    styleType?: string
  ) => {
    const editor = editableRef.current;
    if (!editor || blocks.length === 0) return false;
    const selected = blocks.filter((block) => {
      if (!editor.contains(block)) return false;
      if (block.tagName.toLowerCase() === "li") return false;
      if (block.closest("ul,ol")) return false;
      return block.parentElement;
    });
    if (selected.length === 0) return false;

    const groups = new Map<HTMLElement, HTMLElement[]>();
    selected.forEach((block) => {
      const parent = block.parentElement;
      if (!parent) return;
      const group = groups.get(parent) || [];
      group.push(block);
      groups.set(parent, group);
    });

    let lastLi: HTMLElement | null = null;
    groups.forEach((group, parent) => {
      group.sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      const list = document.createElement(listTag);
      if (styleType) list.style.listStyleType = styleType;
      parent.insertBefore(list, group[0]);
      group.forEach((block) => {
        const li = document.createElement("li");
        li.innerHTML = block.innerHTML || "<br>";
        li.style.textAlign = block.style.textAlign;
        list.appendChild(li);
        block.remove();
        lastLi = li;
      });
      mergeAdjacentCompatibleLists(list);
    });

    if (lastLi) focusElementEnd(lastLi);
    return true;
  };

  const convertTableCellSelectionToList = (range: Range, listTag: "ul" | "ol") => {
    if (range.collapsed) return false;
    const startCell = getClosestCell(range.startContainer);
    const endCell = getClosestCell(range.endContainer);
    if (!startCell || startCell !== endCell) return false;

    const fragment = range.extractContents();
    const parts: DocumentFragment[] = [document.createDocumentFragment()];
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof HTMLBRElement) {
        parts.push(document.createDocumentFragment());
      } else {
        parts[parts.length - 1].appendChild(node);
      }
    });
    const nonEmptyParts = parts.filter((part) => part.textContent?.trim() || part.childNodes.length > 0);
    if (nonEmptyParts.length === 0) {
      range.insertNode(fragment);
      return false;
    }

    const list = document.createElement(listTag);
    nonEmptyParts.forEach((part) => {
      const item = document.createElement("li");
      item.appendChild(part);
      if (!item.innerHTML.trim()) item.innerHTML = "<br>";
      list.appendChild(item);
    });
    range.insertNode(list);
    const lastItem = list.lastElementChild as HTMLElement | null;
    if (lastItem) focusElementEnd(lastItem);
    return true;
  };

  const convertRootLineSelectionToList = (range: Range, listTag: "ul" | "ol") => {
    const editor = editableRef.current;
    if (!editor || range.collapsed) return false;

    const closestBlock = (node: Node) => {
      const element = node instanceof HTMLElement ? node : node.parentElement;
      const block = element?.closest(blockSelector) as HTMLElement | null;
      return block === editor ? null : block;
    };
    if (closestBlock(range.startContainer) || closestBlock(range.endContainer)) return false;

    const lineRange = range.cloneRange();
    const breaks = Array.from(editor.querySelectorAll("br"));
    let previousBreak: HTMLBRElement | null = null;
    let nextBreak: HTMLBRElement | null = null;

    breaks.forEach((lineBreak) => {
      const parent = lineBreak.parentNode;
      if (!parent) return;
      const index = Array.prototype.indexOf.call(parent.childNodes, lineBreak) as number;
      const beforeRelation = range.comparePoint(parent, index);
      const afterRelation = range.comparePoint(parent, index + 1);

      if (afterRelation === -1) {
        previousBreak = lineBreak;
      } else if (
        !nextBreak &&
        (beforeRelation === 1 || (beforeRelation === 0 && !range.intersectsNode(lineBreak)))
      ) {
        nextBreak = lineBreak;
      }
    });

    if (previousBreak) lineRange.setStartAfter(previousBreak);
    else lineRange.setStart(editor, 0);
    if (nextBreak) lineRange.setEndBefore(nextBreak);
    else lineRange.setEnd(editor, editor.childNodes.length);

    const fragment = lineRange.extractContents();
    const parts: DocumentFragment[] = [document.createDocumentFragment()];
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof HTMLBRElement) parts.push(document.createDocumentFragment());
      else if (node instanceof HTMLElement && node.matches(blockSelector)) {
        if (parts[parts.length - 1].childNodes.length > 0) parts.push(document.createDocumentFragment());
        while (node.firstChild) parts[parts.length - 1].appendChild(node.firstChild);
        parts.push(document.createDocumentFragment());
      } else parts[parts.length - 1].appendChild(node);
    });
    const nonEmptyParts = parts.filter((part) => part.textContent?.length || part.childNodes.length > 0);
    if (nonEmptyParts.length === 0) {
      lineRange.insertNode(fragment);
      return false;
    }

    const list = document.createElement(listTag);
    nonEmptyParts.forEach((part) => {
      const item = document.createElement("li");
      item.appendChild(part);
      list.appendChild(item);
    });
    lineRange.insertNode(list);
    const mergedList = mergeAdjacentCompatibleLists(list);
    const lastItem = mergedList.lastElementChild as HTMLElement | null;
    if (lastItem) focusElementEnd(lastItem);
    return true;
  };

  const transformSelectedListItems = (
    items: HTMLElement[],
    listTag: "ul" | "ol"
  ) => {
    const editor = editableRef.current;
    if (!editor || items.length === 0) return false;

    const selected = new Set(
      items.filter((item) => {
        const parentItem = item.parentElement?.closest("li");
        return !parentItem || !items.includes(parentItem as HTMLElement);
      })
    );
    const lists = new Set<HTMLElement>();
    selected.forEach((item) => {
      const list = item.parentElement;
      if (
        list &&
        (list.tagName.toLowerCase() === "ul" || list.tagName.toLowerCase() === "ol")
      ) {
        lists.add(list);
      }
    });

    let changed = false;
    let lastTarget: HTMLElement | null = null;

    lists.forEach((list) => {
      const parent = list.parentElement;
      if (!parent || !editor.contains(list)) return;

      const toggleOff = list.tagName.toLowerCase() === listTag;
      let pendingList: HTMLElement | null = null;
      const flushPendingList = () => {
        if (!pendingList?.childNodes.length) return;
        parent.insertBefore(pendingList, list);
        pendingList = null;
      };

      Array.from(list.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== "li") return;
        const isSelected = selected.has(child);

        if (isSelected && toggleOff) {
          flushPendingList();
          const paragraph = document.createElement("p");
          paragraph.innerHTML = child.innerHTML || "<br>";
          paragraph.style.textAlign = child.style.textAlign;
          parent.insertBefore(paragraph, list);
          lastTarget = paragraph;
          child.remove();
          changed = true;
          return;
        }

        const outputTag = isSelected ? listTag : (list.tagName.toLowerCase() as "ul" | "ol");
        if (!pendingList || pendingList.tagName.toLowerCase() !== outputTag) {
          flushPendingList();
          pendingList = cloneListShell(list, outputTag);
        }
        pendingList.appendChild(child);
        if (isSelected) {
          lastTarget = child;
          changed = true;
        }
      });

      flushPendingList();
      list.remove();
    });

    if (changed && lastTarget) focusElementEnd(lastTarget);
    return changed;
  };

  const toggleList = (listTag: "ul" | "ol") => {
    const editor = editableRef.current;
    if (!editor) return;
    if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
    const setListActiveState = (active: boolean) => {
      setActiveState((current) => ({
        ...current,
        unorderedList: listTag === "ul" ? active : false,
        orderedList: listTag === "ol" ? active : false,
      }));
    };

    const range = getSelectionRangeInEditor();
    if (range && !range.collapsed) {
      const blocks = getSelectedBlocks(range);
      const selectedListItems = getSelectedListItems(blocks);
      if (selectedListItems.length > 0) {
        pushEditorHistory();
        if (transformSelectedListItems(selectedListItems, listTag)) {
          const active = Boolean(getCurrentBlock()?.closest(listTag));
          setListActiveState(active);
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
      }

      pushEditorHistory();
      const convertedBlocks = convertSelectedBlocksToList(blocks, listTag);
      if (convertedBlocks) {
        setListActiveState(true);
        handleInput();
        requestAnimationFrame(updateActiveState);
        return;
      }

      if (blocks.length === 0) {
        pushEditorHistory();
        if (convertRootLineSelectionToList(range, listTag)) {
          setListActiveState(true);
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
        if (convertTableCellSelectionToList(range, listTag)) {
          setListActiveState(true);
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
      }
    }

    const block = getCurrentBlock();
    if (!block) {
      pushEditorHistory();
      insertEmptyListAtSelection(listTag);
      setListActiveState(true);
      handleInput();
      requestAnimationFrame(updateActiveState);
      return;
    }

    const currentList = block.closest("ul,ol");
    if (currentList && editor.contains(currentList)) {
      pushEditorHistory();
      if (currentList.tagName.toLowerCase() === listTag) {
        const li = block.closest("li") as HTMLElement | null;
        if (li) {
          unwrapListItem(li, currentList as HTMLElement);
          setListActiveState(false);
        }
      } else {
        convertListTag(currentList as HTMLElement, listTag);
        setListActiveState(true);
      }
      handleInput();
      requestAnimationFrame(updateActiveState);
      return;
    }

    pushEditorHistory();
    const list = document.createElement(listTag);
    const li = document.createElement("li");
    li.innerHTML = block.innerHTML || "<br>";
    list.appendChild(li);
    block.parentElement?.replaceChild(list, block);
    focusElementEnd(li);
    setListActiveState(true);
    handleInput();
    requestAnimationFrame(updateActiveState);
  };

  const toggleListFallback = (listTag: "ul" | "ol") => {
    toggleList(listTag);
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
    try {
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      const editor = editableRef.current;
      if (!editor || !range) return;

      const unwrapQuote = (quote: HTMLElement) => {
        const parent = quote.parentElement;
        if (!parent) return false;
        const moved: HTMLElement[] = [];
        while (quote.firstChild) {
          const child = quote.firstChild;
          parent.insertBefore(child, quote);
          if (child instanceof HTMLElement) moved.push(child);
        }
        quote.remove();
        focusElementEnd(moved[moved.length - 1] || parent);
        return true;
      };

      const wrapBlocks = (blocks: HTMLElement[]) => {
        const selected = sortInDocumentOrder(blocks).filter((block) => {
          if (!editor.contains(block) || block === editor) return false;
          if (block.tagName.toLowerCase() === "blockquote") return false;
          return Boolean(block.parentElement);
        });
        if (selected.length === 0) return false;

        const mergeQuote = (quote: HTMLElement) => {
          let merged = quote;
          const previous = merged.previousElementSibling;
          if (previous?.tagName === "BLOCKQUOTE") {
            while (merged.firstChild) previous.appendChild(merged.firstChild);
            merged.remove();
            merged = previous as HTMLElement;
          }
          const next = merged.nextElementSibling;
          if (next?.tagName === "BLOCKQUOTE") {
            while (next.firstChild) merged.appendChild(next.firstChild);
            next.remove();
          }
          return merged;
        };

        const selectedItems = new Set(getSelectedListItems(selected));
        const sourceLists = Array.from(new Set(Array.from(selectedItems, (item) => item.parentElement as HTMLElement)));
        let lastWrapped: HTMLElement | null = null;
        sourceLists.forEach((source) => {
          const parent = source.parentElement;
          if (!parent) return;
          let pending: HTMLElement | null = null;
          let pendingSelected: boolean | null = null;
          const outputs: Array<{ list: HTMLElement; selected: boolean }> = [];
          Array.from(source.children).forEach((child) => {
            if (!(child instanceof HTMLElement) || child.tagName !== "LI") return;
            const isSelected = selectedItems.has(child);
            if (!pending || pendingSelected !== isSelected) {
              pending = cloneListShell(source);
              pendingSelected = isSelected;
              outputs.push({ list: pending, selected: isSelected });
            }
            pending.appendChild(child);
          });
          outputs.forEach((output) => {
            if (output.selected) {
              const quote = document.createElement("blockquote");
              quote.appendChild(output.list);
              parent.insertBefore(quote, source);
              mergeQuote(quote);
              lastWrapped = output.list.lastElementChild as HTMLElement | null;
            } else {
              parent.insertBefore(output.list, source);
            }
          });
          source.remove();
        });

        selected.filter((block) => !block.closest("ul,ol")).forEach((block) => {
          const quote = document.createElement("blockquote");
          block.parentElement?.insertBefore(quote, block);
          quote.appendChild(block);
          mergeQuote(quote);
          lastWrapped = block;
        });
        if (lastWrapped) focusElementEnd(lastWrapped);
        return true;
      };

      if (!range) return;
      let node: Node | null = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const element = node as HTMLElement | null;
      const quote = element?.closest?.('blockquote');
      if (quote && editableRef.current?.contains(quote)) {
        pushEditorHistory();
        if (unwrapQuote(quote as HTMLElement)) {
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
      }

      if (range.collapsed) {
        const block = getCurrentBlock();
        if (block) {
          pushEditorHistory();
          const currentList = block.closest("ul,ol") as HTMLElement | null;
          if (currentList && editor.contains(currentList)) {
            const quote = document.createElement("blockquote");
            currentList.parentElement?.insertBefore(quote, currentList);
            quote.appendChild(currentList);
            focusElementEnd(block);
            handleInput();
            requestAnimationFrame(updateActiveState);
            return;
          }
          if (!wrapBlocks([block])) return;
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
      } else {
        const blocks = getSelectedBlocks(range);
        if (blocks.length > 0) {
          pushEditorHistory();
          if (!wrapBlocks(blocks)) return;
          handleInput();
          requestAnimationFrame(updateActiveState);
          return;
        }
      }

      pushEditorHistory();
      exec("formatBlock", "<blockquote>");
    } catch {}
  };

  const toggleCodeBlock = () => {
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

      const listItems = getSelectedListItems(blocks);
      const plainBlocks = blocks.filter((block) => !block.closest("ul,ol") && !block.closest("table"));
      const getItemCode = (item: HTMLElement) =>
        item.querySelector(":scope > pre[data-srte-list-code]") as HTMLElement | null;
      const allTargetsActive =
        listItems.every((item) => Boolean(getItemCode(item))) &&
        plainBlocks.every((block) => block.tagName === "PRE") &&
        listItems.length + plainBlocks.length > 0;

      pushEditorHistory();
      let lastTarget: HTMLElement | null = null;
      listItems.forEach((item) => {
        const existing = getItemCode(item);
        if (allTargetsActive && existing) {
          const code = existing.querySelector(":scope > code") as HTMLElement | null;
          const source = code || existing;
          while (source.firstChild) item.insertBefore(source.firstChild, existing);
          existing.remove();
          lastTarget = item;
          return;
        }
        if (existing) {
          lastTarget = existing;
          return;
        }
        const pre = document.createElement("pre");
        pre.dataset.srteListCode = "true";
        pre.style.textAlign = "left";
        const code = document.createElement("code");
        const nestedList = Array.from(item.children).find((child) => child.matches("ul,ol")) || null;
        Array.from(item.childNodes).forEach((node) => {
          if (node === nestedList) return;
          if (node instanceof HTMLElement && node.dataset.srteCheck === "true") return;
          code.appendChild(node);
        });
        if (!code.childNodes.length) code.innerHTML = "<br>";
        pre.appendChild(code);
        item.insertBefore(pre, nestedList);
        lastTarget = pre;
      });

      sortInDocumentOrder(plainBlocks).forEach((block) => {
        if (allTargetsActive && block.tagName === "PRE") {
          const paragraph = document.createElement("p");
          const code = block.querySelector(":scope > code") as HTMLElement | null;
          paragraph.innerHTML = code?.innerHTML || block.innerHTML || "<br>";
          block.parentElement?.replaceChild(paragraph, block);
          lastTarget = paragraph;
        } else if (block.tagName !== "PRE") {
          const pre = replaceBlockTag(block, "pre");
          pre.style.textAlign = "left";
          if (!pre.querySelector(":scope > code")) {
            const code = document.createElement("code");
            while (pre.firstChild) code.appendChild(pre.firstChild);
            pre.appendChild(code);
          }
          lastTarget = pre;
        }
      });
      if (lastTarget) focusElementEnd(lastTarget);
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

      if (range.collapsed) {
        pendingFontSizeRef.current = {
          valuePx,
          container: range.startContainer,
          offset: range.startOffset,
        };
        savedRangeRef.current = range.cloneRange();
        return;
      }

      pushEditorHistory();
      pendingFontSizeRef.current = null;
      const textNodes: Text[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let candidate = walker.nextNode();
      while (candidate) {
        const text = candidate as Text;
        const owner = text.parentElement;
        try {
          if (
            text.data.length > 0 && range.intersectsNode(text) &&
            !owner?.closest('[contenteditable="false"],button,[data-srte-editor-only="true"]')
          ) textNodes.push(text);
        } catch {}
        candidate = walker.nextNode();
      }

      const selectedTexts: Text[] = [];
      [...textNodes].reverse().forEach((text) => {
        const start = text === range.startContainer ? range.startOffset : 0;
        const end = text === range.endContainer ? range.endOffset : text.data.length;
        if (end <= start) return;
        if (end < text.data.length) text.splitText(end);
        const selected = start > 0 ? text.splitText(start) : text;
        const parent = selected.parentElement;
        if (
          parent?.tagName === "SPAN" &&
          parent.childNodes.length === 1 &&
          parent.textContent === selected.data
        ) {
          parent.style.fontSize = `${valuePx}px`;
        } else {
          const span = document.createElement("span");
          span.style.fontSize = `${valuePx}px`;
          selected.parentNode?.insertBefore(span, selected);
          span.appendChild(selected);
        }
        selectedTexts.unshift(selected);
      });

      if (selectedTexts.length > 0) {
        normalizeFontSizeSpans(editor);
        const nextRange = document.createRange();
        nextRange.setStart(selectedTexts[0], 0);
        const last = selectedTexts[selectedTexts.length - 1];
        nextRange.setEnd(last, last.data.length);
        safeSelectRange(nextRange);
        savedRangeRef.current = nextRange.cloneRange();
      }
      handleInput();
      requestAnimationFrame(updateActiveState);
    } catch (error) {
      console.error('Error applying font size:', error);
    }
  };

  useEffect(() => {
    const editor = editableRef.current;
    if (!editor) return;
    const applyPendingFontSize = (event: InputEvent) => {
      const pending = pendingFontSizeRef.current;
      if (!pending || event.inputType !== "insertText" || !event.data) return;
      const range = getSelectionRangeInEditor();
      if (
        !range?.collapsed ||
        range.startContainer !== pending.container ||
        range.startOffset !== pending.offset
      ) return;

      event.preventDefault();
      event.stopPropagation();
      pushEditorHistory();
      const text = document.createTextNode(event.data);
      const sizedAncestor = range.startContainer instanceof HTMLElement
        ? range.startContainer.closest("span")
        : range.startContainer.parentElement?.closest("span");
      if (
        sizedAncestor instanceof HTMLElement &&
        parseFontSizePx(sizedAncestor.style.fontSize) === pending.valuePx
      ) {
        range.insertNode(text);
      } else {
        const span = document.createElement("span");
        span.style.fontSize = `${pending.valuePx}px`;
        span.appendChild(text);
        range.insertNode(span);
      }
      const nextRange = document.createRange();
      nextRange.setStartAfter(text);
      nextRange.collapse(true);
      safeSelectRange(nextRange);
      pendingFontSizeRef.current = {
        valuePx: pending.valuePx,
        container: nextRange.startContainer,
        offset: nextRange.startOffset,
      };
      savedRangeRef.current = nextRange.cloneRange();
      handleInput();
    };
    editor.addEventListener("beforeinput", applyPendingFontSize);
    return () => editor.removeEventListener("beforeinput", applyPendingFontSize);
  }, []);

  const applyFontFamily = (font: string) => {
    try {
      setCurrentFont(font);
      
      const editor = editableRef.current;
      if (!editor) return;
      
      editor.focus();
      
      let range: Range | null = null;
      const sel = window.getSelection();
      
      if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        if (editor.contains(currentRange.commonAncestorContainer)) {
          range = currentRange;
        }
      }
      
      if (!range && savedRangeRef.current) {
        range = savedRangeRef.current.cloneRange();
      }
      
      if (!range) return;
      
      if (range.collapsed) {
        const span = document.createElement('span');
        span.style.fontFamily = font;
        span.textContent = '\u200B';
        
        range.insertNode(span);
        
        const newRange = document.createRange();
        newRange.setStart(span.firstChild!, 1);
        newRange.collapse(true);
        
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(newRange);
        }
        
        handleInput();
        return;
      }
      
      const span = document.createElement('span');
      span.style.fontFamily = font;
      
      const fragment = range.extractContents();
      span.appendChild(fragment);
      
      range.insertNode(span);
      
      if (sel) {
        range.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      
      handleInput();
    } catch (error) {
      console.error('Error applying font family:', error);
    }
  };

  const applyTextColor = (color: string) => {
    exec("foreColor", color);
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

  const getInlineBackgroundHex = (element: HTMLElement | null) => {
    const editor = editableRef.current;
    let current: HTMLElement | null = element;

    while (current && current !== editor) {
      const inlineHex = cssColorToHex(current.style.backgroundColor || current.style.background);
      if (inlineHex) return inlineHex;
      current = current.parentElement;
    }

    return "";
  };

  const currentPickerColorHex = () => {
    if (typeof window === "undefined") return colorPickerType === "text" ? "#000000" : "#ffffff";
    const editor = editableRef.current;
    if (!editor) return colorPickerType === "text" ? "#000000" : "#ffffff";

    const element = getRangeStartElement(getSelectionRangeInEditor());
    if (colorPickerType === "background") {
      return getInlineBackgroundHex(element) || "#ffffff";
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

  const applyBackgroundColor = (color: string) => {
    try {
      const editor = editableRef.current;
      if (!editor) return;
      if (!restoreSavedSelection()) safeSelectRange(getSelectionRangeInEditor());
      const range = getSelectionRangeInEditor();
      const readableColor = readableTextColorForBackground(color);
      if (!range) return;

      const applyToElement = (element: HTMLElement) => {
        element.style.backgroundColor = color;
        if (readableColor) element.style.color = readableColor;
      };

      if (range.collapsed) {
        const span = document.createElement("span");
        applyToElement(span);
        span.textContent = "\u200B";
        range.insertNode(span);
        const nextRange = document.createRange();
        nextRange.setStart(span.firstChild || span, 1);
        nextRange.collapse(true);
        safeSelectRange(nextRange);
        savedRangeRef.current = nextRange.cloneRange();
        handleInput();
        return;
      }

      const selectedCells = Array.from(editor.querySelectorAll<HTMLElement>("td,th"))
        .filter((cell) => {
          try {
            return range.intersectsNode(cell);
          } catch {
            return false;
          }
        });

      if (selectedCells.length > 0) {
        selectedCells.forEach(applyToElement);
        handleInput();
        return;
      }

      const span = document.createElement("span");
      applyToElement(span);
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
      range.selectNodeContents(span);
      safeSelectRange(range);
      savedRangeRef.current = range.cloneRange();
      handleInput();
    } catch {
      exec("hiliteColor", color);
    }
  };


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


  const insertImageAtSelection = (srcOrItem: string | MediaItem) => {
    try {
      const host = editableRef.current;
      if (!host) return;
      const src = typeof srcOrItem === "string" ? srcOrItem : srcOrItem.url;
      host.focus();
      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !host.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(host);
        range.collapse(false);
        safeSelectRange(range);
      }
      const img = document.createElement("img");
      img.src = src;
      img.draggable = true;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.display = "inline-block";
      img.alt = typeof srcOrItem === "string" ? "image" : (srcOrItem.alt || srcOrItem.title || "image");
      if (typeof srcOrItem !== "string") {
        if (srcOrItem.title) img.title = srcOrItem.title;
        if (srcOrItem.license?.author) img.dataset.licenseAuthor = srcOrItem.license.author;
        if (srcOrItem.license?.licenseType) img.dataset.licenseType = srcOrItem.license.licenseType;
        if (srcOrItem.license?.licenseText) img.dataset.licenseText = srcOrItem.license.licenseText;
        if (srcOrItem.license?.sourceUrl) img.dataset.licenseUrl = srcOrItem.license.sourceUrl;
        if (srcOrItem.license?.workName) img.dataset.workName = srcOrItem.license.workName;
      }
      if (range) {
        range.insertNode(img);
      } else {
        host.appendChild(img);
      }
      const r = document.createRange();
      r.setStartAfter(img);
      r.collapse(true);
      safeSelectRange(r);
      setSelectedImage(img);
      scheduleImageOverlay();
      handleInput();
    } catch {}
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
      host.focus();
      let sel = window.getSelection();
      let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (!range || !host.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(host);
        range.collapse(false);
        safeSelectRange(range);
      }
      const span = document.createElement("span");
      span.setAttribute("data-formula", tex);
      try {
        // @ts-ignore
        const katex = (window as any).katex;
        if (katex && typeof katex.render === "function") {
          katex.render(tex, span, { throwOnError: false });
        } else {
          span.textContent = `$${tex}$`;
        }
      } catch {
        span.textContent = `$${tex}$`;
      }
      if (range) range.insertNode(span);
      else host.appendChild(span);
      const r = document.createRange();
      r.setStartAfter(span);
      r.collapse(true);
      safeSelectRange(r);
      handleInput();
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
      try {
        const uploaded = await mediaManager.upload(list);
        uploaded.forEach((item) => insertImageAtSelection(item));
        return;
      } catch (error) {
        console.error("Image upload failed, inserting local image data instead:", error);
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

  const handlePdfFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.type !== 'application/pdf') return;

    // Check if editor has content
    const el = editableRef.current;
    const hasContent = el && el.textContent && el.textContent.trim().length > 0;
    
    if (hasContent) {
        setPendingImport({ file, type: 'pdf' });
    } else {
        processImport(file, 'pdf', 'replace');
    }
  };

  const processImport = async (file: File, type: 'pdf' | 'docx', mode: 'replace' | 'append') => {
      if (type === 'pdf') {
          await processPdf(file, mode);
      } else {
          await processDocx(file, mode);
      }
      setPendingImport(null);
      // Reset inputs
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      if (docxInputRef.current) docxInputRef.current.value = "";
  };

  const processPdf = async (file: File, mode: 'replace' | 'append') => {


    try {
      setLoadingPdf(true);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let fullHtml = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        const styles = textContent.styles;
        
        // 1. Group items into lines
        const items = textContent.items as any[];
        // Calculate base statistics
        const heights = items.map(item => Math.abs(item.transform[3])).filter(h => h > 0);
        heights.sort((a,b) => a-b);
        const medianHeight = heights[Math.floor(heights.length/2)] || 12;

        // Group by Y (with tolerance)
        const linesMap = new Map<number, {y: number, items: any[]}>();
        for (const item of items) {
            if (!item.str.trim()) continue;
            // Normalize Y to integer buckets to group roughly
            // PDF Y is bottom-0, so higher Y is higher on page.
            const y = item.transform[5];
            // Find closest existing line
            let foundKey = -1;
            for (const key of linesMap.keys()) {
                if (Math.abs(key - y) < medianHeight * 0.5) {
                    foundKey = key;
                    break;
                }
            }
            if (foundKey !== -1) {
                linesMap.get(foundKey)!.items.push(item);
            } else {
                linesMap.set(y, {y, items: [item]});
            }
        }

        // Convert map to sorted array (top to bottom)
        const lines = Array.from(linesMap.values()).sort((a,b) => b.y - a.y);
        
        // Sort items within lines (left to right)
        lines.forEach(line => {
            line.items.sort((a,b) => a.transform[4] - b.transform[4]);
        });

        // 2. Identify and Build Structures
        let html = '';
        let listStack: string[] = []; // 'ul' or 'ol'
        let inTable = false;
        let tableColumns: number[] = []; // X-coordinates of column starts
        let tableHtml = '';

        const closeList = () => {
             if (listStack.length > 0) {
                 html += `</${listStack.pop()}>`;
             }
        };

        const closeTable = () => {
            if (inTable) {
                html += '<div data-table-wrapper="true" style="overflow-x:auto;width:100%;"><table style="border-collapse:collapse;width:100%;" border="1"><tbody>' + tableHtml + '</tbody></table></div>';
                tableHtml = '';
                inTable = false;
                tableColumns = [];
            }
        };

        for (let lIndex = 0; lIndex < lines.length; lIndex++) {
            const line = lines[lIndex];
            // Calculate gaps and text
            let lineText = '';
            let lineHtmlContent = '';
            let lastX = -1;
            let gaps: number[] = [];
            let itemXs: number[] = []; // Start X of logical items (words or phrases)
            
            // Reconstruct text with spacing detection
            for (let j = 0; j < line.items.length; j++) {
                const item = line.items[j];
                const x = item.transform[4];
                const width = item.width;
                const fontName = item.fontName;
                const fontObj = styles[fontName];
                const fontFamily = fontObj?.fontFamily?.toLowerCase() || '';
                const isBold = fontFamily.includes('bold') || false;
                const isItalic = fontFamily.includes('italic') || fontFamily.includes('oblique');
                const fontSize = Math.max(8, Math.round(Math.abs(item.transform[3])));

                if (lastX > 0) {
                    const gap = x - lastX;
                    if (gap > 2) { // Minimal space threshold
                         lineText += ' ';
                         lineHtmlContent += ' ';
                         if (gap > 20) { // Large gap threshold for table detection
                             gaps.push(gap);
                         }
                    }
                } else {
                     // First item
                }
                
                // Track "columns" candidates: items separated by big gaps
                if (j === 0 || (x - lastX) > 20) {
                    itemXs.push(x);
                }

                // Append text style
                const chunkStyle = cssRules([
                  ['font-size', `${fontSize}px`],
                  ['font-weight', isBold ? '700' : ''],
                  ['font-style', isItalic ? 'italic' : ''],
                ]);
                let chunk = `<span${styleAttr(chunkStyle)}>${escapeHtml(item.str)}</span>`;
                
                lineText += item.str;
                lineHtmlContent += chunk;
                
                lastX = x + width;
            }

            // === Structure Detection ===
            
            // Max Font Size in line
            const maxH = Math.max(...line.items.map((i: any) => Math.abs(i.transform[3])));
            const isHeader = maxH > medianHeight * 1.2;

            // List Detection
            const isBullet = /^[•\-\*]\s/.test(lineText);
            const isNumber = /^\d+[\.\)]\s/.test(lineText);
            
            // Table Detection Logic
            // A line starts a table if it has distinct "columns" (multiple items with large gaps)
            // Or if we are already in a table and this line aligns with columns
            
            let isTableLine = false;
            
            // If in table, check alignment
            if (inTable) {
                 // Check if items align with known columns
                 // Simple loose check: do any of the itemXs align with tableColumns?
                 // Or is the line just sparsely populated but roughly compatible?
                 // We'll continually simple-add rows for now until a Paragraph break (plain text, no gaps) is found.
                 
                 // If line looks like normal paragraph (no large gaps, starts at left margin), close table
                 const isPlainParagraph = gaps.length === 0 && itemXs[0] < 50 && lineText.length > 50; 
                 // Allow wrapping text in table cells, which might look like lines with no gaps?
                 // Table wrapping usually is indented or aligns with a column > 0.
                 
                 const alignsWithColumn = itemXs.some(x => tableColumns.some(cx => Math.abs(x - cx) < 20));
                 
                 if (alignsWithColumn || (itemXs[0] > 50)) {
                     isTableLine = true;
                 } else {
                     // Maybe a new row starting at col 0?
                     // If it aligns with col 0.
                     if (Math.abs(itemXs[0] - tableColumns[0]) < 20) {
                         isTableLine = true;
                     }
                 }
            } else {
                // Potential start of table: multiple items separated by gaps, AND next line likely follows suit?
                // Or simply: It has > 1 column significantly spaced.
                if (itemXs.length >= 2 && gaps.some(g => g > 30)) {
                    isTableLine = true;
                    // Establish columns
                    tableColumns = [...itemXs];
                }
            }

            // --- Apply Logic ---

            if (isTableLine) {
                closeList();
                if (!inTable) {
                    inTable = true;
                    // Start table
                }
                
                // Build Row
                // We need to map items to cells based on tableColumns.
                // Naive approach: Items close to col X go to col X.
                let rowHtml = '<tr>';
                
                // We assume `tableColumns` defines the start of each cell.
                // We create a cell for each column.
                // Collect content for each bucket.
                const cellContents: string[] = new Array(tableColumns.length).fill('');
                
                let currentItemHtml = '';
                let currentItemStart = -1;
                
                // process items again to slot them
                let currentLineX = 0;
                for (const item of line.items) {
                    const x = item.transform[4];
                    const w = item.width;
                    const txt = item.str;
                    const fontObj = styles[item.fontName];
                    const fontFamily = fontObj?.fontFamily?.toLowerCase() || '';
                    const isBold = fontFamily.includes('bold');
                    const isItalic = fontFamily.includes('italic') || fontFamily.includes('oblique');
                    const fontSize = Math.max(8, Math.round(Math.abs(item.transform[3])));
                    const styledTxt = `<span${styleAttr(cssRules([
                      ['font-size', `${fontSize}px`],
                      ['font-weight', isBold ? '700' : ''],
                      ['font-style', isItalic ? 'italic' : ''],
                    ]))}>${escapeHtml(txt)}</span>`;
                    
                    // Decide which column this belongs to
                    // Find closest column to the left (or close enough)
                    let colIdx = 0;
                    let minDiff = 9999;
                    
                    for (let c=0; c<tableColumns.length; c++) {
                        const colX = tableColumns[c];
                        // If item starts near colX or after it (but before next col)
                        // Actually, just find the "controlling" column (closest start to the left)
                        if (x >= colX - 10) {
                            colIdx = c;
                        }
                    }
                    
                    // Append space if needed
                    if (cellContents[colIdx]) cellContents[colIdx] += ' ';
                    cellContents[colIdx] += styledTxt;
                }
                
                cellContents.forEach(content => {
                    rowHtml += `<td style="border:1px solid #d1d5db;padding:8px;vertical-align:top;">${content || '&nbsp;'}</td>`;
                });
                
                rowHtml += '</tr>';
                tableHtml += rowHtml;
                
            } else {
                closeTable();
                
                if (isBullet || isNumber) {
                    const listType = isBullet ? 'ul' : 'ol';
                    if (listStack.length === 0 || listStack[listStack.length-1] !== listType) {
                         if (listStack.length > 0) closeList(); // Close switch
                         html += `<${listType}>`;
                         listStack.push(listType);
                    }
                    // Strip marker
                    const content = lineHtmlContent.replace(/^[•\-\*]|\d+[\.\)]/, '').trim();
                    html += `<li>${content}</li>`;
                } else {
                    closeList();
                    if (isHeader) {
                        const tag = maxH > medianHeight * 1.5 ? 'h2' : 'h3';
                        const firstX = line.items[0]?.transform?.[4] || 0;
                        const lastItem = line.items[line.items.length - 1];
                        const lastRight = lastItem ? lastItem.transform[4] + lastItem.width : firstX;
                        const center = (firstX + lastRight) / 2;
                        const align = Math.abs(center - viewport.width / 2) < viewport.width * 0.12 ? 'center' : firstX > viewport.width * 0.55 ? 'right' : '';
                        html += `<${tag}${styleAttr(cssRules([['text-align', align]]))}>${lineHtmlContent}</${tag}>`;
                    } else {
                        const firstX = line.items[0]?.transform?.[4] || 0;
                        const lastItem = line.items[line.items.length - 1];
                        const lastRight = lastItem ? lastItem.transform[4] + lastItem.width : firstX;
                        const center = (firstX + lastRight) / 2;
                        const align = Math.abs(center - viewport.width / 2) < viewport.width * 0.12 ? 'center' : firstX > viewport.width * 0.55 ? 'right' : '';
                        html += `<p${styleAttr(cssRules([
                          ['text-align', align],
                          ['margin-left', firstX > 40 && !align ? `${Math.round(firstX)}px` : ''],
                        ]))}>${lineHtmlContent}</p>`;
                    }
                }
            }
        }
        
        closeList();
        closeTable();
        
        fullHtml += html;
      }

      insertImportedHtml(fullHtml, mode, { preserveColors: true, preserveDocumentLayout: true });
      
    } catch (error) {
      console.error('Error reading PDF:', error);
      // Optional: show user error
    } finally {
      setLoadingPdf(false);
    }
  };

  const handleDocxFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.endsWith('.docx')) return;
    
    // Check if editor has content
    const el = editableRef.current;
    const hasContent = el && el.textContent && el.textContent.trim().length > 0;
    
    if (hasContent) {
        setPendingImport({ file, type: 'docx' });
    } else {
        processImport(file, 'docx', 'replace');
    }
  };

  const processDocx = async (file: File, mode: 'replace' | 'append') => {

    try {
      setLoadingDocx(true);
      const arrayBuffer = await file.arrayBuffer();
      const html = preserveDocxStyles
        ? await convertDocxToStyledHtml(arrayBuffer)
        : await convertDocxWithMammoth(arrayBuffer);

      if (html) {
        insertImportedHtml(`<div class="srte-preserve-colors">${html}</div>`, mode, {
          preserveColors: preserveDocxStyles,
          preserveDocumentLayout: preserveDocxStyles,
        });
      }
    } catch (error) {
      console.error('Error reading DOCX:', error);
    } finally {
      setLoadingDocx(false);
    }
  };

  const convertDocxWithMammoth = async (arrayBuffer: ArrayBuffer) => {
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const temp = document.createElement('div');
    temp.innerHTML = result.value;
    enhanceImportedTables(temp);
    return temp.innerHTML;
  };

  const convertDocxToStyledHtml = async (arrayBuffer: ArrayBuffer) => {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      const documentXml = await zip.file('word/document.xml')?.async('text');
      if (!documentXml) return convertDocxWithMammoth(arrayBuffer);

      const parser = new DOMParser();
      const doc = parser.parseFromString(documentXml, 'application/xml');
      if (doc.querySelector('parsererror')) return convertDocxWithMammoth(arrayBuffer);

      const body = Array.from(doc.getElementsByTagName('*')).find((node) => node.localName === 'body');
      if (!body) return convertDocxWithMammoth(arrayBuffer);

      const html = directChildren(body)
        .filter((node) => node.localName !== 'sectPr')
        .map((node) => {
          if (node.localName === 'p') return convertDocxParagraph(node);
          if (node.localName === 'tbl') return convertDocxTable(node);
          return '';
        })
        .join('');

      if (!html.trim()) return convertDocxWithMammoth(arrayBuffer);
      const temp = document.createElement('div');
      temp.innerHTML = html;
      enhanceImportedTables(temp);
      return temp.innerHTML;
    } catch (error) {
      console.warn('Falling back to Mammoth DOCX import:', error);
      return convertDocxWithMammoth(arrayBuffer);
    }
  };

  const directChildren = (node: Element) => Array.from(node.children);

  const firstChildByName = (node: Element | undefined | null, localName: string) =>
    node
      ? directChildren(node).find((child) => child.localName === localName)
      : undefined;

  const childrenByName = (node: Element | undefined | null, localName: string) =>
    node
      ? directChildren(node).filter((child) => child.localName === localName)
      : [];

  const docxAttr = (node: Element | undefined | null, name: string) => {
    if (!node) return '';
    return (
      node.getAttribute(`w:${name}`) ||
      node.getAttribute(name) ||
      node.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', name) ||
      ''
    );
  };

  const docxHexColor = (value: string) => {
    if (!value || value.toLowerCase() === 'auto') return '';
    const normalized = value.replace(/[^0-9a-f]/gi, '');
    return normalized.length === 6 ? `#${normalized}` : '';
  };

  const twipsToPt = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.max(n / 20, 0)}pt` : '';
  };

  const halfPointsToPt = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.max(n / 2, 1)}pt` : '';
  };

  const cssRules = (rules: Array<[string, string]>) =>
    rules
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ');

  const styleAttr = (style: string) => (style ? ` style="${escapeHtml(style)}"` : '');

  const convertDocxParagraphStyle = (paragraph: Element) => {
    const pPr = firstChildByName(paragraph, 'pPr');
    if (!pPr) return '';
    const spacing = firstChildByName(pPr, 'spacing');
    const jc = firstChildByName(pPr, 'jc');
    const indent = firstChildByName(pPr, 'ind');
    const borderBottom = firstChildByName(firstChildByName(pPr, 'pBdr') as Element, 'bottom');
    const line = docxAttr(spacing, 'line');
    const lineRule = docxAttr(spacing, 'lineRule');

    return cssRules([
      ['text-align', docxAttr(jc, 'val')],
      ['margin-top', twipsToPt(docxAttr(spacing, 'before'))],
      ['margin-bottom', twipsToPt(docxAttr(spacing, 'after'))],
      ['margin-left', twipsToPt(docxAttr(indent, 'left'))],
      ['text-indent', twipsToPt(docxAttr(indent, 'firstLine'))],
      ['line-height', line && lineRule === 'auto' ? `${Number(line) / 240}` : ''],
      ['border-bottom', docxBorderCss(borderBottom)],
    ]);
  };

  const convertDocxRunStyle = (run: Element) => {
    const rPr = firstChildByName(run, 'rPr');
    if (!rPr) return '';
    const color = docxHexColor(docxAttr(firstChildByName(rPr, 'color'), 'val'));
    const highlight = docxHexColor(docxAttr(firstChildByName(rPr, 'highlight'), 'val'));
    const shade = docxHexColor(docxAttr(firstChildByName(rPr, 'shd'), 'fill'));
    const size = halfPointsToPt(docxAttr(firstChildByName(rPr, 'sz'), 'val'));
    const underline = firstChildByName(rPr, 'u');

    return cssRules([
      ['font-weight', firstChildByName(rPr, 'b') ? '700' : ''],
      ['font-style', firstChildByName(rPr, 'i') ? 'italic' : ''],
      ['text-decoration', underline ? 'underline' : ''],
      ['color', color],
      ['background-color', highlight || shade],
      ['font-size', size],
    ]);
  };

  const convertDocxRun = (run: Element) => {
    const rPr = firstChildByName(run, 'rPr');
    const vertAlign = docxAttr(firstChildByName(rPr as Element, 'vertAlign'), 'val');
    const style = convertDocxRunStyle(run);
    const content = directChildren(run)
      .map((child) => {
        if (child.localName === 't') return escapeHtml(child.textContent || '');
        if (child.localName === 'tab') return '&emsp;';
        if (child.localName === 'br') {
          return docxAttr(child, 'type') === 'page'
            ? '<hr class="srte-docx-page-break">'
            : '<br>';
        }
        return '';
      })
      .join('');

    if (!content) return '';
    const tag = vertAlign === 'superscript' ? 'sup' : vertAlign === 'subscript' ? 'sub' : 'span';
    return `<${tag}${styleAttr(style)}>${content}</${tag}>`;
  };

  const convertDocxParagraph = (paragraph: Element) => {
    const style = convertDocxParagraphStyle(paragraph);
    const content = childrenByName(paragraph, 'r').map(convertDocxRun).join('');
    return `<p${styleAttr(style)}>${content || '<br>'}</p>`;
  };

  const docxBorderCss = (border: Element | undefined) => {
    if (!border) return '';
    const val = docxAttr(border, 'val');
    if (!val || val === 'nil' || val === 'none') return '';
    const size = Number(docxAttr(border, 'sz')) || 4;
    const width = Math.max(size / 8, 0.5);
    const color = docxHexColor(docxAttr(border, 'color')) || '#d1d5db';
    return `${width}px solid ${color}`;
  };

  const convertDocxCellStyle = (cell: Element) => {
    const tcPr = firstChildByName(cell, 'tcPr');
    const width = twipsToPt(docxAttr(firstChildByName(tcPr as Element, 'tcW'), 'w'));
    const shade = docxHexColor(docxAttr(firstChildByName(tcPr as Element, 'shd'), 'fill'));
    const borders = firstChildByName(tcPr as Element, 'tcBorders');
    const top = docxBorderCss(firstChildByName(borders as Element, 'top'));
    const right = docxBorderCss(firstChildByName(borders as Element, 'right'));
    const bottom = docxBorderCss(firstChildByName(borders as Element, 'bottom'));
    const left = docxBorderCss(firstChildByName(borders as Element, 'left'));

    return cssRules([
      ['width', width],
      ['background-color', shade],
      ['border-top', top],
      ['border-right', right],
      ['border-bottom', bottom],
      ['border-left', left],
      ['padding', '8px'],
      ['vertical-align', 'top'],
    ]);
  };

  const convertDocxTable = (table: Element) => {
    const rows = childrenByName(table, 'tr')
      .map((row) => {
        const cells = childrenByName(row, 'tc')
          .map((cell) => {
            const content = directChildren(cell)
              .filter((child) => child.localName === 'p' || child.localName === 'tbl')
              .map((child) => child.localName === 'p' ? convertDocxParagraph(child) : convertDocxTable(child))
              .join('');
            return `<td${styleAttr(convertDocxCellStyle(cell))}>${content || '<p><br></p>'}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    return `<table style="border-collapse: collapse; width: 100%; margin: 12px 0;"><tbody>${rows}</tbody></table>`;
  };

  const enhanceImportedTables = (root: HTMLElement) => {
    const tables = root.querySelectorAll('table');
    tables.forEach(tbl => {
      tbl.style.borderCollapse = tbl.style.borderCollapse || 'collapse';
      tbl.style.width = tbl.style.width || '100%';
      const cells = tbl.querySelectorAll('td, th');
      cells.forEach(cell => {
        const el = cell as HTMLElement;
        if (!el.style.border && !el.style.borderTop && !el.style.borderRight && !el.style.borderBottom && !el.style.borderLeft) {
          el.style.border = '1px solid #d1d5db';
        }
        el.style.padding = el.style.padding || '8px';
        el.style.verticalAlign = el.style.verticalAlign || 'top';
      });
    });
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const htmlToMarkdown = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (!(node instanceof HTMLElement)) return "";
      const content = Array.from(node.childNodes).map(walk).join("");
      const tag = node.tagName.toLowerCase();
      if (tag === "strong" || tag === "b") return `**${content}**`;
      if (tag === "em" || tag === "i") return `*${content}*`;
      if (tag === "code") return `\`${content}\``;
      if (tag === "br") return "\n";
      if (/h[1-6]/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
      if (tag === "p") return `${content.trim()}\n\n`;
      if (tag === "li") return `- ${content.trim()}\n`;
      if (tag === "ul" || tag === "ol") return `${content}\n`;
      if (tag === "blockquote") return `> ${content.trim()}\n\n`;
      if (tag === "table") return `${node.outerHTML}\n\n`;
      if (tag === "img") return `![${node.getAttribute("alt") || ""}](${node.getAttribute("src") || ""})`;
      if (tag === "a") return `[${content}](${node.getAttribute("href") || ""})`;
      return content;
    };

    return Array.from(root.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
  };

  const importTextFile = async (files: FileList | null, type: "html" | "md") => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const text = await file.text();
    const html = type === "html" ? text : markdownToCompatibilityHtml(text);
    const el = editableRef.current;
    const hasContent = el && el.textContent && el.textContent.trim().length > 0;
    insertImportedHtml(html, hasContent ? "append" : "replace", {
      preserveColors: true,
      preserveDocumentLayout: true,
    });
  };

  const downloadText = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const buildStandaloneHtmlDocument = (html: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smart RTE Export</title>
  <style>
    :root {
      --srte-bg: #ffffff;
      --srte-text: #111111;
      --srte-text-muted: #4b5563;
      --srte-border: #d1d5db;
      --srte-border-light: #e5e7eb;
      --srte-accent: #1e90ff;
      --srte-accent-bg: rgba(30, 144, 255, 0.15);
      --srte-surface-subtle: #f3f4f6;
    }
    html, body {
      margin: 0;
      background: var(--srte-bg);
      color: var(--srte-text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
    }
    body {
      padding: 32px;
    }
    .srte-export {
      max-width: 960px;
      margin: 0 auto;
    }
    .srte-export h1,
    .srte-export h2,
    .srte-export h3,
    .srte-export h4,
    .srte-export h5,
    .srte-export h6 {
      line-height: 1.3;
      margin: 1.25em 0 0.5em;
      font-weight: 700;
      color: var(--srte-text);
    }
    .srte-export p {
      margin: 0 0 0.85em;
    }
    .srte-export blockquote {
      border-left: 4px solid var(--srte-accent);
      margin: 0.75em 0;
      padding: 0.5em 1em;
      background: var(--srte-surface-subtle);
      color: var(--srte-text);
    }
    .srte-export ul,
    .srte-export ol {
      margin: 0.75em 0;
      padding-left: 1.75em;
      list-style-position: outside;
    }
    .srte-export ul {
      list-style-type: disc;
    }
    .srte-export ol {
      list-style-type: decimal;
    }
    .srte-export li {
      display: list-item;
      margin: 0.25em 0;
      padding-left: 0.25em;
    }
    .srte-export table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
    }
    .srte-export td,
    .srte-export th {
      border: 1px solid var(--srte-border);
      padding: 8px;
      vertical-align: top;
      text-align: left;
    }
    .srte-export th {
      background: var(--srte-surface-subtle);
      font-weight: 700;
    }
    .srte-export img {
      max-width: 100%;
      height: auto;
    }
    .srte-export pre,
    .srte-export code {
      background: var(--srte-surface-subtle);
      color: var(--srte-text);
      border-radius: 4px;
    }
    .srte-export pre {
      padding: 12px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    @media print {
      body {
        padding: 0;
      }
      .srte-export {
        max-width: none;
      }
    }
  </style>
</head>
<body>
  <main class="srte-export">${html || "<p></p>"}</main>
</body>
</html>`;

  const exportHtml = () => {
    const html = editableRef.current?.innerHTML || "";
    downloadText("smart-rte-export.html", buildStandaloneHtmlDocument(html), "text/html;charset=utf-8");
  };

  const exportMarkdown = () => {
    const html = editableRef.current?.innerHTML || "";
    downloadText("smart-rte-export.md", htmlToMarkdown(html), "text/markdown");
  };

  const htmlToDocxXml = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;

    const xmlEscape = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const colorValue = (value: string) => {
      const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
      if (hex) return hex[1].toUpperCase();
      const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(value.trim());
      if (!rgb) return "";
      return [rgb[1], rgb[2], rgb[3]]
        .map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    };

    const sizeToHalfPoints = (value: string) => {
      const trimmed = value.trim();
      const match = /^([\d.]+)(px|pt)$/i.exec(trimmed);
      if (!match) return "";
      const raw = Number(match[1]);
      const pt = match[2].toLowerCase() === "px" ? raw * 0.75 : raw;
      return String(Math.max(2, Math.round(pt * 2)));
    };

    const runProperties = (el: HTMLElement) => {
      const style = el.style;
      const color = colorValue(style.color);
      const size = sizeToHalfPoints(style.fontSize);
      const isBold = el.tagName === "B" || el.tagName === "STRONG" || /bold|700|800|900/.test(style.fontWeight);
      const isItalic = el.tagName === "I" || el.tagName === "EM" || style.fontStyle === "italic";
      const isUnderline = el.tagName === "U" || style.textDecoration.includes("underline");
      return [
        isBold ? "<w:b/>" : "",
        isItalic ? "<w:i/>" : "",
        isUnderline ? '<w:u w:val="single"/>' : "",
        color ? `<w:color w:val="${color}"/>` : "",
        size ? `<w:sz w:val="${size}"/>` : "",
      ].join("");
    };

    const runs = (node: Node, inheritedProps = ""): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        return text ? `<w:r>${inheritedProps ? `<w:rPr>${inheritedProps}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` : "";
      }
      if (!(node instanceof HTMLElement)) return "";
      if (node.tagName === "BR") return "<w:r><w:br/></w:r>";
      if (node.tagName === "IMG") {
        const alt = node.getAttribute("alt") || node.getAttribute("title") || "Image";
        return `<w:r><w:t>[Image: ${xmlEscape(alt)}]</w:t></w:r>`;
      }
      const props = `${inheritedProps}${runProperties(node)}`;
      return Array.from(node.childNodes).map((child) => runs(child, props)).join("");
    };

    const paragraph = (el: HTMLElement, fallbackTag = "p") => {
      const tag = el.tagName.toLowerCase();
      const headingMatch = /^h([1-6])$/.exec(tag);
      const style = el.style;
      const align = style.textAlign ? `<w:jc w:val="${xmlEscape(style.textAlign)}"/>` : "";
      const headingSize = headingMatch ? `<w:rPr><w:b/><w:sz w:val="${Math.max(24, 40 - Number(headingMatch[1]) * 4)}"/></w:rPr>` : "";
      const body = runs(el);
      return `<w:p><w:pPr>${align}${headingSize}</w:pPr>${body || "<w:r><w:t></w:t></w:r>"}</w:p>`;
    };

    const tableCell = (cell: HTMLElement) => {
      const fill = colorValue(cell.style.backgroundColor);
      const shading = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
      const cellContent = Array.from(cell.childNodes)
        .map((child) => child instanceof HTMLElement && ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6"].includes(child.tagName)
          ? paragraph(child)
          : `<w:p>${runs(child)}</w:p>`)
        .join("");
      return `<w:tc><w:tcPr>${shading}<w:tcBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/></w:tcBorders></w:tcPr>${cellContent || "<w:p/>"}</w:tc>`;
    };

    const tableXml = (table: HTMLTableElement) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${Array.from(row.children).map((cell) => tableCell(cell as HTMLElement)).join("")}</w:tr>`).join("")}</w:tbl>`;
    };

    const blockXml = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        return text ? `<w:p>${runs(node)}</w:p>` : "";
      }
      if (!(node instanceof HTMLElement)) return "";
      if (node.tagName === "TABLE") return tableXml(node as HTMLTableElement);
      if (node.tagName === "UL" || node.tagName === "OL") {
        return Array.from(node.children).map((li) => `<w:p><w:r><w:t>• </w:t></w:r>${runs(li)}</w:p>`).join("");
      }
      if (node.tagName === "BLOCKQUOTE") {
        return `<w:p><w:pPr><w:ind w:left="720"/></w:pPr>${runs(node)}</w:p>`;
      }
      if (node.tagName === "HR") return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="D1D5DB"/></w:pBdr></w:pPr></w:p>';
      if (["P", "DIV", "PRE", "H1", "H2", "H3", "H4", "H5", "H6"].includes(node.tagName)) return paragraph(node);
      return Array.from(node.childNodes).map(blockXml).join("");
    };

    const body = Array.from(root.childNodes).map(blockXml).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`;
  };

  const exportDocx = async () => {
    const html = editableRef.current?.innerHTML || "";
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
    zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.folder("word")?.file("document.xml", htmlToDocxXml(html));
    zip.folder("word")?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "smart-rte-export.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const html = editableRef.current?.innerHTML || "";
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>Export PDF</title><style>@page{margin:18mm}html,body{background:#fff}body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6;padding:32px;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0;break-inside:auto}tr,img,blockquote,pre{break-inside:avoid}td,th{border:1px solid #d1d5db;padding:8px;vertical-align:top}img{max-width:100%;height:auto}blockquote{border-left:4px solid #d1d5db;padding-left:12px;color:#374151}pre,code{background:#f3f4f6}pre{padding:12px;white-space:pre-wrap}@media print{body{padding:0}}</style></head><body>${html || "<p></p>"}<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},150);});</script></body></html>`);
    printWindow.document.close();
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

  const normalizeInvalidTableNesting = (root: HTMLElement) => {
    const getOuterList = (item: HTMLElement) => {
      let list = item.parentElement as HTMLElement | null;
      while (list?.parentElement?.tagName === "LI") {
        const parentList = list.parentElement.parentElement as HTMLElement | null;
        if (!parentList || !["UL", "OL"].includes(parentList.tagName)) break;
        list = parentList;
      }
      return list;
    };

    root.querySelectorAll("table").forEach((table) => {
      const tableBlock = (table.closest('[data-table-wrapper="true"]') || table) as HTMLElement;
      const codeBlock = tableBlock.closest("pre") as HTMLElement | null;
      if (codeBlock?.parentElement) {
        codeBlock.parentElement.insertBefore(tableBlock, codeBlock.nextSibling);
        return;
      }

      const listItem = tableBlock.closest("li") as HTMLElement | null;
      if (!listItem) return;
      const outerList = getOuterList(listItem);
      if (outerList?.parentElement) {
        outerList.parentElement.insertBefore(tableBlock, outerList.nextSibling);
      }
    });
  };

  const normalizeInvalidQuoteNesting = (root: HTMLElement) => {
    root.querySelectorAll("blockquote blockquote").forEach((quote) => {
      const outerQuote = quote.parentElement?.closest("blockquote") as HTMLElement | null;
      if (outerQuote?.parentElement) {
        outerQuote.parentElement.insertBefore(quote, outerQuote.nextSibling);
      }
    });

    root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,pre").forEach((container) => {
      const nestedQuotes = Array.from(container.children).filter(
        (child) => child.tagName === "BLOCKQUOTE"
      ) as HTMLElement[];
      nestedQuotes.forEach((quote) => {
        container.parentElement?.insertBefore(quote, container.nextSibling);
      });
      if (
        nestedQuotes.length > 0 &&
        container.tagName === "P" &&
        !container.textContent?.trim() &&
        Array.from(container.children).every((child) => child.tagName === "BR")
      ) {
        container.remove();
      }
    });
  };

  const normalizeInvalidCodeBlockNesting = (root: HTMLElement) => {
    root.querySelectorAll("pre pre").forEach((codeBlock) => {
      const outerCodeBlock = codeBlock.parentElement?.closest("pre") as HTMLElement | null;
      if (outerCodeBlock?.parentElement) {
        outerCodeBlock.parentElement.insertBefore(codeBlock, outerCodeBlock.nextSibling);
      }
    });

    root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,blockquote").forEach((container) => {
      const nestedCodeBlocks = Array.from(container.children).filter(
        (child) => child.tagName === "PRE"
      ) as HTMLElement[];
      nestedCodeBlocks.forEach((codeBlock) => {
        container.parentElement?.insertBefore(codeBlock, container.nextSibling);
      });
    });
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
    // Quotes are document blocks and cannot be nested by drag and drop.
    normalizeInvalidQuoteNesting(el);
    // Code blocks are document blocks and cannot be nested by drag and drop.
    normalizeInvalidCodeBlockNesting(el);
    // Tables are document-level blocks and must not remain inside code or list items.
    normalizeInvalidTableNesting(el);
    // Ensure tables are wrapped for horizontal scrolling
    ensureTableWrappers(el);
    // Keep a reachable typing position around isolating blocks at document edges
    ensureCaretBoundaryParagraphs(el);
    // Add resize handles to tables
    addTableResizeHandles();

    if (!onChange) return;
    const html = el.innerHTML;
    if (html !== lastEmittedRef.current) {
      lastEmittedRef.current = html;
      onChange(html);
    }
  };

  const buildTableHTML = (rows: number, cols: number) => {
    const safeRows = Math.max(1, Math.min(50, Math.floor(rows) || 1));
    const safeCols = Math.max(1, Math.min(20, Math.floor(cols) || 1));
    let html = '<div data-table-wrapper="true" style="overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%;max-width:100%;display:block;"><table style="border-collapse:collapse;min-width:100%;"><tbody>';
    for (let r = 0; r < safeRows; r++) {
      html += "<tr>";
      for (let c = 0; c < safeCols; c++) {
        html +=
          '<td style="border:1px solid #d1d5db;padding:6px;min-width:60px;">&nbsp;</td>';
      }
      html += "</tr>";
    }
    html += "</tbody></table></div>";
    return html;
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
      const html = buildTableHTML(tableRows, tableCols);
      // Insert via Range for broader support
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      const node = wrapper.firstChild as HTMLElement | null;
      if (!node || !range) return;
      pushEditorHistory();
      if (!range.collapsed) range.deleteContents();
      range.insertNode(node);
      
      // Add resize handles to the new table
      const insertedTable = node instanceof HTMLTableElement ? node : node.querySelector("table");
      if (insertedTable) {
        const tbody = insertedTable.querySelector('tbody');
        if (tbody) {
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.forEach((row, index) => {
            (row as HTMLElement).setAttribute('data-row-index', String(index));
            const cells = cellsOfRow(row as HTMLTableRowElement);
            cells.forEach((cell, cellIndex) => {
              (cell as HTMLElement).setAttribute('data-col-index', String(cellIndex));
            });
          });
        }
      }
      
      // Move caret into first cell
      const firstCell = node.querySelector(
        "td,th"
      ) as HTMLTableCellElement | null;
      if (firstCell) moveCaretToCell(firstCell, false);
      handleInput();
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
    selectionRef.current = { tbody, sr, sc, er, ec };
    const cells = getCellsInGridRect(tbody, sr, sc, er, ec);
    cells.forEach((cell) => {
      (cell as any).__rtePrevBg = cell.style.background || "";
      cell.style.background = "var(--srte-accent-bg)";
      cell.style.outline = "2px solid var(--srte-accent)";
      cell.style.outlineOffset = "-2px";
    });
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
    // Collect content and remove other cells
    const contents: string[] = [];
    const cellsToMerge = getCellsInGridRect(tbody, sr, sc, er, ec);
    cellsToMerge.forEach((cell) => {
      if (cell === anchor) return;
      const html = cell.innerHTML.trim();
      if (html) contents.push(html);
    });
    if (contents.length) {
      anchor.innerHTML = (anchor.innerHTML || "") + " " + contents.join(" ");
    }
    // Set spans
    anchor.colSpan = ec - sc + 1;
    anchor.rowSpan = er - sr + 1;
    // Remove other cells
    cellsToMerge.forEach((cell) => {
      if (cell !== anchor) cell.remove();
    });
    moveCaretToCell(anchor, false);
    clearSelectionDecor();
    handleInput();
  };

  const addRow = (cell: HTMLTableCellElement, dir: "above" | "below") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { row, tbody, rIdx } = pos;
    const newRow = document.createElement("tr");
    const numCols = Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    ).length;
    for (let i = 0; i < numCols; i++) {
      const td = document.createElement("td");
      td.style.border = "1px solid #d1d5db";
      td.style.padding = "6px";
      td.style.minWidth = "60px";
      td.innerHTML = "&nbsp;";
      newRow.appendChild(td);
    }
    const insertIndex = dir === "above" ? rIdx : rIdx + 1;
    const refRow = tbody.children[insertIndex] || null;
    tbody.insertBefore(newRow, refRow);
  };

  const deleteRow = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { row, tbody, table } = pos;
    tbody.removeChild(row);
    if (tbody.querySelectorAll("tr").length === 0) {
      table.parentElement?.removeChild(table);
    }
  };

  const addCol = (cell: HTMLTableCellElement, dir: "left" | "right") => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { tbody, cIdx } = pos;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const insertIndex = dir === "left" ? cIdx : cIdx + 1;
    for (const r of rows) {
      const cells = Array.from(r.children).filter((c) =>
        ["TD", "TH"].includes((c as HTMLElement).tagName)
      );
      const td = document.createElement("td");
      td.style.border = "1px solid #d1d5db";
      td.style.padding = "6px";
      td.style.minWidth = "60px";
      td.innerHTML = "&nbsp;";
      const ref = (cells[insertIndex] as HTMLElement) || null;
      if (ref) r.insertBefore(td, ref);
      else r.appendChild(td);
    }
  };

  const deleteCol = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { tbody, table, cIdx } = pos;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (const r of rows) {
      const cells = Array.from(r.children).filter((c) =>
        ["TD", "TH"].includes((c as HTMLElement).tagName)
      );
      const target = cells[cIdx] as HTMLElement | undefined;
      if (target) r.removeChild(target);
    }
    // If table has no columns left, remove it
    const hasAnyCell = table.querySelector("td,th");
    if (!hasAnyCell) table.parentElement?.removeChild(table);
  };

  const toggleHeaderCell = (cell: HTMLTableCellElement) => {
    clearSelectionDecor();
    const isTh = cell.tagName === "TH";
    replaceTableCellTag(cell, isTh ? "td" : "th");
    handleInput();
  };

  const deleteTable = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { table } = pos;
    table.parentElement?.removeChild(table);
  };

  const splitCell = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    const { tbody, rIdx, cIdx } = pos;
    const rs = Math.max(1, cell.rowSpan || 1);
    const cs = Math.max(1, cell.colSpan || 1);
    if (rs === 1 && cs === 1) return;
    // Reset current cell
    cell.rowSpan = 1;
    cell.colSpan = 1;
    // Add missing cells in the current row
    const currentRow = Array.from(tbody.querySelectorAll("tr"))[rIdx];
    for (let j = 1; j < cs; j++) {
      const td = document.createElement("td");
      td.style.border = "1px solid #d1d5db";
      td.style.padding = "6px";
      td.style.minWidth = "60px";
      td.innerHTML = "&nbsp;";
      const cells = cellsOfRow(currentRow as HTMLTableRowElement);
      const ref = cells[cIdx + j] || null;
      (currentRow as HTMLTableRowElement).insertBefore(td, ref);
    }
    // For extra rows, insert cells at the same column index
    for (let i = 1; i < rs; i++) {
      const row = Array.from(tbody.querySelectorAll("tr"))[
        rIdx + i
      ] as HTMLTableRowElement;
      for (let j = 0; j < cs; j++) {
        const td = document.createElement("td");
        td.style.border = "1px solid #d1d5db";
        td.style.padding = "6px";
        td.style.minWidth = "60px";
        td.innerHTML = "&nbsp;";
        const cells = cellsOfRow(row);
        const ref = cells[cIdx + j] || null;
        row.insertBefore(td, ref);
      }
    }
    handleInput();
  };

  const toggleHeaderRow = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    clearSelectionDecor();
    const { row } = pos;
    const cells = cellsOfRow(row);
    const shouldMakeHeader = cells.some((c) => c.tagName !== "TH");
    for (const c of cells) {
      const isTh = c.tagName === "TH";
      if (shouldMakeHeader && !isTh) {
        replaceTableCellTag(c, "th");
      } else if (!shouldMakeHeader && isTh) {
        replaceTableCellTag(c, "td");
      }
    }
    handleInput();
  };

  const toggleHeaderColumn = (cell: HTMLTableCellElement) => {
    const pos = getCellPosition(cell);
    if (!pos) return;
    clearSelectionDecor();
    const { tbody, cIdx } = pos;
    const { grid } = getTableGrid(tbody);
    const seen = new Set<HTMLTableCellElement>();
    const columnCells = grid
      .map((row) => row?.[cIdx])
      .filter((candidate): candidate is HTMLTableCellElement => {
        if (!candidate || seen.has(candidate)) return false;
        seen.add(candidate);
        return true;
      });
    const shouldMakeHeader = columnCells.some((c) => c.tagName !== "TH");

    for (const c of columnCells) {
      replaceTableCellTag(c, shouldMakeHeader ? "th" : "td");
    }
    handleInput();
  };

  const applyBgToSelection = (
    hex: string,
    fallbackCell?: HTMLTableCellElement
  ) => {
    const readableColor = readableTextColorForBackground(hex);
    const applyFill = (cell: HTMLTableCellElement) => {
      cell.style.background = hex;
      if (readableColor) cell.style.color = readableColor;
    };
    const sel = shouldUseTableSelection(fallbackCell) ? selectionRef.current : null;
    if (sel) {
      const cells = getCellsInGridRect(sel.tbody, sel.sr, sel.sc, sel.er, sel.ec);
      clearSelectionDecor();
      cells.forEach(applyFill);
    } else if (fallbackCell) {
      clearSelectionDecor();
      applyFill(fallbackCell);
    }
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
    const applyToggle = (cell: HTMLTableCellElement) => {
      const cur = (cell as HTMLElement).style.border;
      (cell as HTMLElement).style.border =
        cur && cur !== "none" ? "none" : "1px solid #d1d5db";
    };
    const sel = shouldUseTableSelection(fallbackCell) ? selectionRef.current : null;
    if (sel) {
      getCellsInGridRect(sel.tbody, sel.sr, sel.sc, sel.er, sel.ec).forEach(applyToggle);
    } else if (fallbackCell) {
      applyToggle(fallbackCell);
    }
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
    if (tableResizeRef.current) {
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

  const outdentListItem = (item: HTMLElement) => {
    const list = item.parentElement as HTMLElement | null;
    const parentItem = list?.parentElement;
    const outerList = parentItem?.parentElement as HTMLElement | null;
    if (
      !list ||
      !parentItem ||
      parentItem.tagName.toLowerCase() !== "li" ||
      !outerList ||
      !["ul", "ol"].includes(outerList.tagName.toLowerCase())
    ) {
      return false;
    }

    outerList.insertBefore(item, parentItem.nextSibling);
    if (!list.querySelector("li")) list.remove();
    return true;
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
    if (direction === "up") {
      const previous = elementSibling(blocks[0], "previous");
      if (previous && !blocks.includes(previous as HTMLElement)) {
        blocks.forEach((block) => parent.insertBefore(block, previous));
      }
    } else if (direction === "down") {
      const next = elementSibling(blocks[blocks.length - 1], "next");
      if (next && !blocks.includes(next as HTMLElement)) {
        const afterNext = next.nextSibling;
        blocks.forEach((block) => parent.insertBefore(block, afterNext));
      }
    } else {
      blocks.forEach((block) => {
        const current = parseInt(block.style.marginLeft || "0", 10) || 0;
        const nextMargin = direction === "right"
          ? Math.min(current + 24, 240)
          : Math.max(current - 24, 0);
        block.style.marginLeft = nextMargin ? `${nextMargin}px` : "";
      });
    }

    const movedRange = document.createRange();
    movedRange.setStartBefore(blocks[0]);
    movedRange.setEndAfter(blocks[blocks.length - 1]);
    safeSelectRange(movedRange);
    savedRangeRef.current = movedRange.cloneRange();
    handleInput();
    requestAnimationFrame(updateActiveState);
    return true;
  };

  const moveCurrentElement = (direction: "up" | "down" | "left" | "right") => {
    const editor = editableRef.current;
    if (moveSelectedBlocks(direction)) return;
    let target = getMoveTarget();
    if (!editor || !target) return;

    pushEditorHistory();
    if (target.tagName === "TD" || target.tagName === "TH") {
      const cell = target;
      const paragraph = document.createElement("p");
      while (cell.firstChild) paragraph.appendChild(cell.firstChild);
      cell.appendChild(paragraph);
      target = paragraph;
    }
    if (target.tagName.toLowerCase() === "li") {
      const list = target.parentElement as HTMLElement | null;
      if (!list) return;
      if (direction === "up") {
        const previous = elementSibling(target, "previous");
        if (previous?.nodeName === "LI") list.insertBefore(target, previous);
      } else if (direction === "down") {
        const next = elementSibling(target, "next");
        if (next?.nodeName === "LI") list.insertBefore(next, target);
      } else if (direction === "right") {
        nestSelectedListItems([target], list.tagName.toLowerCase() as "ul" | "ol");
      } else {
        outdentListItem(target);
      }
    } else if (direction === "up") {
      const previous = elementSibling(target, "previous");
      if (previous) target.parentElement?.insertBefore(target, previous);
    } else if (direction === "down") {
      const next = elementSibling(target, "next");
      if (next) target.parentElement?.insertBefore(next, target);
    } else {
      const current = parseInt(target.style.marginLeft || "0", 10) || 0;
      const nextMargin = direction === "right"
        ? Math.min(current + 24, 240)
        : Math.max(current - 24, 0);
      target.style.marginLeft = nextMargin ? `${nextMargin}px` : "";
    }

    focusElementEnd(target);
    setSelectedImage(target.tagName === "IMG" ? target as HTMLImageElement : target.querySelector("img"));
    scheduleImageOverlay();
    handleInput();
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
    padding: "0 8px",
    border: active
      ? "2px solid var(--srte-accent)"
      : "1px solid var(--srte-input-border)",
    borderRadius: 6,
    background: active ? "var(--srte-accent-bg)" : "var(--srte-input-bg)",
    color: "var(--srte-input-text)",
    boxShadow: active ? "inset 0 0 0 1px var(--srte-accent)" : "none",
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


  const editorClass = `srte-editor${theme === 'dark' ? ' srte-dark' : ''}${className ? ' ' + className : ''}`;

  return (
    <div className={editorClass} style={{
      border: "1px solid var(--srte-border)",
      borderRadius: 6,
      width: "100%",
      maxWidth: "100vw",
      overflow: "visible",
      display: "flex",
      flexDirection: "column",
      background: "var(--srte-bg)",
      color: "var(--srte-text)",
      boxSizing: "border-box"
    }}>
      <div
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
          display: "flex",
          flexWrap: "wrap",
          maxWidth: "100%",
          gap: 8,
          padding: 8,
          borderBottom: "1px solid var(--srte-border-light)",
          background: "var(--srte-toolbar-bg)",
          position: "sticky",
          top: 0,
          zIndex: 1,
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
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            handlePdfFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={docxInputRef}
          type="file"
          accept=".docx"
          style={{ display: "none" }}
          onChange={(e) => {
             handleDocxFiles(e.currentTarget.files);
             e.currentTarget.value = "";
          }}
        />
        <input
          ref={htmlInputRef}
          type="file"
          accept=".html,.htm,text/html"
          style={{ display: "none" }}
          onChange={(e) => {
            importTextFile(e.currentTarget.files, "html");
            e.currentTarget.value = "";
          }}
        />
        <input
          ref={mdInputRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          style={{ display: "none" }}
          onChange={(e) => {
            importTextFile(e.currentTarget.files, "md");
            e.currentTarget.value = "";
          }}
        />
        <select
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
        </select>
        {([
          ["left", "Left", "Align left"],
          ["center", "Center", "Align center"],
          ["right", "Right", "Align right"],
          ["justify", "Justify", "Justify"],
        ] as const).map(([alignment, label, title]) => (
          <button
            key={alignment}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={currentAlignment === alignment}
            onPointerDown={preserveEditorSelection}
            onMouseDown={preserveEditorSelection}
            onClick={() => applyTextAlignment(alignment)}
            style={activeButtonStyle(currentAlignment === alignment, {
              minWidth: 32,
              padding: "0 6px",
              fontSize: 10,
            })}
          >
            {label}
          </button>
        ))}
        <button
          title="Bold"
          onClick={() => exec("bold")}
          aria-pressed={activeState.bold}
          style={activeButtonStyle(activeState.bold)}
        >
          <span style={{ fontWeight: 700 }}>B</span>
        </button>
        <button
          title="Italic"
          onClick={() => exec("italic")}
          aria-pressed={activeState.italic}
          style={activeButtonStyle(activeState.italic, { fontStyle: "italic" })}
        >
          I
        </button>
        <button
          title="Underline"
          onClick={() => exec("underline")}
          aria-pressed={activeState.underline}
          style={activeButtonStyle(activeState.underline, { textDecoration: "underline" })}
        >
          U
        </button>
        <button
          title="Strikethrough"
          onClick={() => exec("strikeThrough")}
          aria-pressed={activeState.strikeThrough}
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
          title="Text Color"
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
          <span style={{ fontWeight: 700, borderBottom: "3px solid currentColor", lineHeight: 1 }}>A</span>
        </button>
        <button
          title="Background Color"
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
          <span style={{ fontWeight: 700, padding: "1px 4px", background: "var(--srte-accent-bg)", borderRadius: 3 }}>A</span>
        </button>
        <button
          title="Subscript"
          onMouseDown={preserveEditorSelection}
          onClick={() => toggleInlineScript("subscript")}
          aria-pressed={activeState.subscript}
          style={activeButtonStyle(activeState.subscript)}
        >
          X<sub>2</sub>
        </button>
        <button
          title="Superscript"
          onMouseDown={preserveEditorSelection}
          onClick={() => toggleInlineScript("superscript")}
          aria-pressed={activeState.superscript}
          style={activeButtonStyle(activeState.superscript)}
        >
          X<sup>2</sup>
        </button>
        {[
          {
            key: "check",
            label: "☐",
            title: "Checklist",
            active: activeState.checklist,
            action: () => applyChecklist(false, true),
            options: [["check:plain", "☐ Checklist"], ["check:strike", "☑ Checked + strike"]],
          },
          {
            key: "bullet",
            label: "•≡",
            title: "Bulleted list",
            active: activeState.unorderedList,
            action: () => applyListStyle("bullet:disc"),
            options: [["bullet:disc", "• Disc"], ["bullet:circle", "○ Circle"], ["bullet:square", "▪ Square"]],
          },
          {
            key: "ordered",
            label: "1≡",
            title: "Numbered list",
            active: activeState.orderedList,
            action: () => applyListStyle("ordered:decimal"),
            options: [["ordered:decimal", "1. 2. 3."], ["ordered:lower-alpha", "a. b. c."], ["ordered:upper-alpha", "A. B. C."], ["ordered:lower-roman", "i. ii. iii."], ["ordered:upper-roman", "I. II. III."]],
          },
        ].map((control) => (
          <span key={control.key} style={{ display: "inline-flex", height: 32 }}>
            <button
              type="button"
              title={control.title}
              onPointerDown={preserveEditorSelection}
              onClick={control.action}
              aria-pressed={control.active}
              style={activeButtonStyle(control.active, { padding: "0 9px", borderRadius: "6px 0 0 6px" })}
            >
              {control.label}
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
              style={{
                width: 28,
                height: 32,
                padding: 0,
                border: "1px solid var(--srte-input-border)",
                borderLeft: 0,
                borderRadius: "0 6px 6px 0",
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              <option value="" disabled>Style</option>
              {control.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </span>
        ))}
        <button
          type="button"
          title="Blockquote"
          onPointerDown={preserveEditorSelection}
          onClick={toggleBlockquote}
          aria-pressed={activeState.blockquote}
          style={activeButtonStyle(activeState.blockquote)}
        >
          ❝
        </button>
        <button
          title="Special characters"
          onClick={() => setShowSpecialChars(true)}
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
          Ω
        </button>
        <button
          type="button"
          title="Code block"
          onPointerDown={preserveEditorSelection}
          onClick={toggleCodeBlock}
          aria-pressed={activeState.codeBlock}
          style={activeButtonStyle(activeState.codeBlock, {
            minWidth: 36,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo",
          })}
        >
          {"< />"}
        </button>
        {formula && (
          <button
            title="Insert formula"
            onClick={() => setShowFormulaDialog(true)}
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
            ∑
          </button>
        )}
        <button
          type="button"
          title="Insert link"
          aria-label="Insert or edit link"
          aria-pressed={activeState.link}
          onPointerDown={preserveEditorSelection}
          onClick={() => openLinkEditor()}
          style={activeButtonStyle(activeState.link, { minWidth: 34, fontSize: 17 })}
        >
          <span aria-hidden="true">↗</span>
        </button>
        <button
          type="button"
          title="Remove link"
          aria-label="Remove link"
          disabled={!activeState.link}
          onPointerDown={preserveEditorSelection}
          onClick={() => exec("unlink")}
          style={{
            height: 32,
            minWidth: 34,
            padding: "0 8px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
            cursor: activeState.link ? "pointer" : "not-allowed",
            opacity: activeState.link ? 1 : 0.45,
            fontSize: 16,
          }}
        >
          <span aria-hidden="true">↗̸</span>
        </button>
        {media && (
          <>
            <button
              title="Insert image"
              onClick={insertImage}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              🖼️ Image
            </button>
            {mediaManager && (
              <button
                title="Open media manager"
                onClick={() => setShowMediaManager(true)}
                style={{
                  height: 32,
                  padding: "0 10px",
                  border: "1px solid var(--srte-input-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                }}
              >
                📁 Media
              </button>
            )}
            <button
              title="Import PDF"
              onClick={() => pdfInputRef.current?.click()}
              disabled={loadingPdf}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
                opacity: loadingPdf ? 0.5 : 1,
              }}
            >
              {loadingPdf ? '⌛ Importing...' : '📄 PDF'}
            </button>
            <button
              title="Import DOCX"
              onClick={() => docxInputRef.current?.click()}
              disabled={loadingDocx}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
                opacity: loadingDocx ? 0.5 : 1,
              }}
            >
              {loadingDocx ? '⌛ Importing...' : '📝 DOCX'}
            </button>
            <button
              title="Import HTML"
              onClick={() => htmlInputRef.current?.click()}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              HTML
            </button>
            <button
              title="Import Markdown"
              onClick={() => mdInputRef.current?.click()}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              MD
            </button>
            <button
              title="Export HTML"
              onClick={exportHtml}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Export HTML
            </button>
            <button
              title="Export Markdown"
              onClick={exportMarkdown}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Export MD
            </button>
            <button
              title="Export DOCX"
              onClick={exportDocx}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Export DOCX
            </button>
            <button
              title="Export PDF"
              onClick={exportPdf}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid var(--srte-input-border)",
                borderRadius: 6,
                background: "var(--srte-input-bg)",
                color: "var(--srte-input-text)",
              }}
            >
              Export PDF
            </button>
            <div
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                marginLeft: 6,
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.7 }}>Image align:</span>
              <button
                onClick={() => {
                  const img = selectedImage;
                  if (!img) return;
                  img.style.display = "block";
                  img.style.margin = "0 auto";
                  img.style.float = "none";
                  scheduleImageOverlay();
                  handleInput();
                }}
                title="Center"
                style={{
                  height: 28,
                  minWidth: 28,
                  padding: "0 6px",
                  border: "1px solid var(--srte-input-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                }}
              >
                ⊙
              </button>
              <button
                onClick={() => {
                  const img = selectedImage;
                  if (!img) return;
                  img.style.display = "inline";
                  img.style.float = "left";
                  img.style.margin = "0 8px 8px 0";
                  scheduleImageOverlay();
                  handleInput();
                }}
                title="Float left"
                style={{
                  height: 28,
                  minWidth: 28,
                  padding: "0 6px",
                  border: "1px solid var(--srte-input-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                }}
              >
                ⟸
              </button>
              <button
                onClick={() => {
                  const img = selectedImage;
                  if (!img) return;
                  img.style.display = "inline";
                  img.style.float = "right";
                  img.style.margin = "0 0 8px 8px";
                  scheduleImageOverlay();
                  handleInput();
                }}
                title="Float right"
                style={{
                  height: 28,
                  minWidth: 28,
                  padding: "0 6px",
                  border: "1px solid var(--srte-input-border)",
                  borderRadius: 6,
                  background: "var(--srte-input-bg)",
                  color: "var(--srte-input-text)",
                }}
              >
                ⟹
              </button>
            </div>
          </>
        )}
        {table && (
          <button
            title="Insert table"
            onClick={() => setShowTableDialog(true)}
            style={{
              height: 32,
              padding: "0 10px",
              border: "1px solid var(--srte-input-border)",
              borderRadius: 6,
              background: "var(--srte-input-bg)",
              color: "var(--srte-input-text)",
            }}
          >
            ➕ Table
          </button>
        )}
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            alignItems: "center",
            marginLeft: 6,
          }}
        >
          <span style={{ fontSize: 12, opacity: 0.7 }}>Move:</span>
          <button
            title="Move selected block up"
            onClick={() => moveCurrentElement("up")}
            style={activeButtonStyle(false, { height: 28, minWidth: 28, padding: "0 6px" })}
          >
            ↑
          </button>
          <button
            title="Move selected block down"
            onClick={() => moveCurrentElement("down")}
            style={activeButtonStyle(false, { height: 28, minWidth: 28, padding: "0 6px" })}
          >
            ↓
          </button>
          <button
            title="Move selected block left"
            onClick={() => moveCurrentElement("left")}
            style={activeButtonStyle(false, { height: 28, minWidth: 28, padding: "0 6px" })}
          >
            ←
          </button>
          <button
            title="Move selected block right"
            onClick={() => moveCurrentElement("right")}
            style={activeButtonStyle(false, { height: 28, minWidth: 28, padding: "0 6px" })}
          >
            →
          </button>
        </div>
        <button
          title="Undo"
          onClick={() => exec("undo")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
          }}
        >
          ⎌ Undo
        </button>
        <button
          title="Redo"
          onClick={() => exec("redo")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid var(--srte-input-border)",
            borderRadius: 6,
            background: "var(--srte-input-bg)",
            color: "var(--srte-input-text)",
          }}
        >
          ⤾ Redo
        </button>
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
             if (pdfInputRef.current) pdfInputRef.current.value = "";
             if (docxInputRef.current) docxInputRef.current.value = "";
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
                    onClick={() => processImport(pendingImport.file, pendingImport.type, 'replace')}
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
                    onClick={() => processImport(pendingImport.file, pendingImport.type, 'append')}
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
                        if (pdfInputRef.current) pdfInputRef.current.value = "";
                        if (docxInputRef.current) docxInputRef.current.value = "";
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
              const list = item?.closest('[data-srte-checklist="true"]') as HTMLElement | null;
              if (item && list) {
                pushEditorHistory();
                const checked = item.dataset.checked !== "true";
                item.dataset.checked = checked ? "true" : "false";
                t.textContent = checked ? "☑" : "☐";
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
            if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k") {
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
            // Keep Tab for indentation in lists; otherwise insert 2 spaces
            if (e.key === "Tab") {
              e.preventDefault();
              const selection = getSelectionRangeInEditor();
              const selectedListItems = selection && !selection.collapsed
                ? getSelectedListItems(getSelectedBlocks(selection))
                : [];
              if (selectedListItems.length > 0) {
                if (!e.shiftKey) {
                  nestListSelection();
                  return;
                }
                pushEditorHistory();
                exec("outdent");
                return;
              }
              const currentBlock = getCurrentBlock();
              if (currentBlock?.closest("li")) {
                pushEditorHistory();
                exec(e.shiftKey ? "outdent" : "indent");
              } else {
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
              onMouseDown={(e) => {
                e.preventDefault();
                if (!selectedImage) return;
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
              onMouseDown={(e) => {
                e.preventDefault();
                if (!selectedImage) return;
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
                  onChange={(e) => {
                    runTableCellAction(tableMenu.cell, (cell) => applyBgToSelection(e.target.value, cell));
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
                    imageMenu.img.remove();
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
