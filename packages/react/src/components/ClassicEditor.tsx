import React, { useEffect, useRef, useState } from "react";
import { MediaManager, MediaManagerAdapter, MediaItem } from "./MediaManager";
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

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
}: ClassicEditorProps) {
  const editableRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>("");
  const isComposingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
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
  const [showMediaManager, setShowMediaManager] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerType, setColorPickerType] = useState<'text' | 'background'>('text');
  const savedRangeRef = useRef<Range | null>(null);
  const [currentFontSize, setCurrentFontSize] = useState<string>("");
  const [currentFont, setCurrentFont] = useState<string>("");

  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    // Initialize with provided HTML only when externally controlled value changes
    if (typeof value === "string" && value !== el.innerHTML) {
      el.innerHTML = value || "";
      fixNegativeMargins(el);
      ensureTableWrappers(el);
      addTableResizeHandles();
    }
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

  // Save selection whenever it changes
  useEffect(() => {
    const saveSelection = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const editor = editableRef.current;
        if (editor && editor.contains(range.commonAncestorContainer)) {
          savedRangeRef.current = range.cloneRange();
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
      document.execCommand(command, false, valueArg);
      // Emit after command
      const el = editableRef.current;
      if (el && onChange) {
        const html = el.innerHTML;
        if (html !== lastEmittedRef.current) {
          lastEmittedRef.current = html;
          onChange(html);
        }
      }
    } catch {}
  };

  const applyFormatBlock = (blockName: string) => {
    exec("formatBlock", blockName);
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL", "https://");
    if (!url) return;
    exec("createLink", url);
  };

  const applyFontSize = (size: string) => {
    try {
      // Update current font size state
      setCurrentFontSize(size);
      
      const editor = editableRef.current;
      if (!editor) return;
      
      editor.focus();
      
      // Try to get current selection, or use saved range
      let range: Range | null = null;
      const sel = window.getSelection();
      
      if (sel && sel.rangeCount > 0) {
        const currentRange = sel.getRangeAt(0);
        // Use current range if it's within our editor
        if (editor.contains(currentRange.commonAncestorContainer)) {
          range = currentRange;
        }
      }
      
      // Fallback to saved range if current range is not available
      if (!range && savedRangeRef.current) {
        range = savedRangeRef.current.cloneRange();
      }
      
      // If no range at all, just update state for future typing
      if (!range) return;
      
      // If range is collapsed (cursor position, no selection), insert an invisible span
      if (range.collapsed) {
        // Create a span with zero-width space that will capture future typing
        const span = document.createElement('span');
        span.style.fontSize = size + 'pt';
        span.textContent = '\u200B'; // Zero-width space
        
        range.insertNode(span);
        
        // Position cursor inside the span
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
      
      // If there's selected text, wrap it
      const span = document.createElement('span');
      span.style.fontSize = size + 'pt';
      
      // Extract the selected content and wrap it in the span
      const fragment = range.extractContents();
      span.appendChild(fragment);
      
      // Insert the span at the current position
      range.insertNode(span);
      
      // Update selection to show what was changed
      if (sel) {
        range.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      
      // Trigger change event
      handleInput();
    } catch (error) {
      console.error('Error applying font size:', error);
    }
  };

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

  const applyBackgroundColor = (color: string) => {
    exec("hiliteColor", color);
  };


  const insertImage = () => {
    if (!media) return;
    fileInputRef.current?.click();
  };

  const scheduleImageOverlay = () => {
    const img = selectedImage;
    if (!img) {
      setImageOverlay(null);
      return;
    }
    try {
      const rect = img.getBoundingClientRect();
      setImageOverlay({
        left: rect.left,
        top: rect.top,
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


  const insertImageAtSelection = (src: string) => {
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
      const img = document.createElement("img");
      img.src = src;
      img.draggable = true;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.display = "inline-block";
      img.alt = "image";
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
                const isBold = fontObj?.fontFamily?.toLowerCase().includes('bold') || false;
                // const isItalic = fontObj?.fontFamily?.toLowerCase().includes('italic') || false;

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
                let chunk = item.str;
                if (isBold) chunk = `<strong>${chunk}</strong>`;
                // if (isItalic) chunk = `<em>${chunk}</em>`;
                
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
                    const isBold = fontObj?.fontFamily?.toLowerCase().includes('bold');
                    const styledTxt = isBold ? `<strong>${txt}</strong>` : txt;
                    
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
                    rowHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top;">${content || '&nbsp;'}</td>`;
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
                        html += `<${tag}>${lineHtmlContent}</${tag}>`;
                    } else {
                        html += `<p>${lineHtmlContent}</p>`;
                    }
                }
            }
        }
        
        closeList();
        closeTable();
        
        fullHtml += html;
      }

      const el = editableRef.current;
      if (el) {
        el.focus();
        if (mode === 'replace') {
            // Select all and replace
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            exec("delete"); // Clear content safely
            exec("insertHTML", fullHtml);
        } else {
            // Append
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false); // End
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            exec("insertHTML", "<br>" + fullHtml);
        }
      }
      
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
      const result = await mammoth.convertToHtml({ arrayBuffer });
      let html = result.value;

      if (html) {
        // Process HTML to ensure tables have borders and structure
        const temp = document.createElement('div');
        temp.innerHTML = html;
        const tables = temp.querySelectorAll('table');
        tables.forEach(tbl => {
            tbl.style.borderCollapse = 'collapse';
            tbl.style.minWidth = '100%';
            // Browser parser auto-adds tbody, but we verify styles
            const cells = tbl.querySelectorAll('td, th');
            cells.forEach(cell => {
                (cell as HTMLElement).style.border = '1px solid #000';
                (cell as HTMLElement).style.padding = '8px';
                (cell as HTMLElement).style.verticalAlign = 'top';
            });
        });
        html = temp.innerHTML;

        const el = editableRef.current;
        if (el) {
           el.focus();
           if (mode === 'replace') {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
                exec("delete"); 
                exec("insertHTML", html);
           } else {
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false); 
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
                exec("insertHTML", "<br>" + html);
           }
           
           // Initialize handlers for the new content
           // We use setTimeout to let the DOM settle after execCommand
           setTimeout(() => {
               ensureTableWrappers(el);
               addTableResizeHandles();
               fixNegativeMargins(el);
               handleInput(); 
           }, 10);
        }
      }
    } catch (error) {
      console.error('Error reading DOCX:', error);
    } finally {
      setLoadingDocx(false);
    }
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

  const ensureTableWrappers = (root: HTMLElement) => {
    try {
      const tables = root.querySelectorAll('table');
      tables.forEach((table) => {
        const parent = table.parentElement;
        if (parent && parent.getAttribute('data-table-wrapper') !== 'true') {
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-table-wrapper', 'true');
          wrapper.style.overflowX = 'auto';
          (wrapper.style as any).webkitOverflowScrolling = 'touch';
          wrapper.style.width = '100%';
          wrapper.style.maxWidth = '100%';
          wrapper.style.display = 'block';
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

  const handleInput = () => {
    if (isComposingRef.current) return;
    const el = editableRef.current;
    if (!el) return;
    
    // Auto-fix negative margins that might cause visibility issues
    fixNegativeMargins(el);
    // Ensure tables are wrapped for horizontal scrolling
    ensureTableWrappers(el);
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
          '<td style="border:1px solid #ddd;padding:6px;min-width:60px;">&nbsp;</td>';
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
      // Ensure editor is focused and selection is inside
      el.focus();
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
      range.insertNode(node);
      
      // Add resize handles to the new table
      if (node instanceof HTMLTableElement) {
        const tbody = node.querySelector('tbody');
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

  const getCellPosition = (cell: HTMLTableCellElement) => {
    const row = cell.parentElement as HTMLTableRowElement | null;
    const tbody = row?.parentElement as HTMLTableSectionElement | null;
    const table = tbody?.parentElement as HTMLTableElement | null;
    if (!row || !tbody || !table) return null;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const rIdx = rows.indexOf(row);
    const cells = Array.from(row.children).filter((c) =>
      ["TD", "TH"].includes((c as HTMLElement).tagName)
    );
    const cIdx = cells.indexOf(cell);
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
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        if ((cell as any).__rtePrevBg != null) {
          cell.style.background = (cell as any).__rtePrevBg;
          delete (cell as any).__rtePrevBg;
        }
        cell.style.outline = "";
        cell.style.outlineOffset = "";
      }
    }
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
    const rows = Array.from(tbody.querySelectorAll("tr"));
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        (cell as any).__rtePrevBg =
          (cell as HTMLElement).style.background || "";
        cell.style.background = "rgba(30,144,255,0.15)";
        cell.style.outline = "2px solid #1e90ff";
        cell.style.outlineOffset = "-2px";
      }
    }
  };

  const canMergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return false;
    return sel.sr !== sel.er || sel.sc !== sel.ec;
  };

  const mergeSelection = () => {
    const sel = selectionRef.current;
    if (!sel) return;
    const { tbody, sr, sc, er, ec } = sel;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const anchorRow = rows[sr];
    const anchor = cellsOfRow(anchorRow)[sc];
    if (!anchor) return;
    // Collect content and remove other cells
    const contents: string[] = [];
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = sc; c <= ec; c++) {
        const cell = cells[c];
        if (!cell) continue;
        if (r === sr && c === sc) continue;
        const html = cell.innerHTML.trim();
        if (html) contents.push(html);
      }
    }
    if (contents.length) {
      anchor.innerHTML = (anchor.innerHTML || "") + " " + contents.join(" ");
    }
    // Set spans
    anchor.colSpan = ec - sc + 1;
    anchor.rowSpan = er - sr + 1;
    // Remove other cells
    for (let r = sr; r <= er; r++) {
      const row = rows[r];
      const cells = cellsOfRow(row);
      for (let c = ec; c >= sc; c--) {
        const cell = cells[c];
        if (!cell) continue;
        if (r === sr && c === sc) continue;
        cell.remove();
      }
    }
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
      td.style.border = "1px solid #ddd";
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
      td.style.border = "1px solid #ddd";
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
    const isTh = cell.tagName === "TH";
    const replacement = document.createElement(isTh ? "td" : "th");
    replacement.innerHTML = cell.innerHTML || "&nbsp;";
    replacement.style.border =
      (cell as HTMLElement).style.border || "1px solid #ddd";
    replacement.style.padding = (cell as HTMLElement).style.padding || "6px";
    replacement.style.minWidth = (cell as HTMLElement).style.minWidth || "60px";
    cell.parentElement?.replaceChild(replacement, cell);
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
      td.style.border = "1px solid #ddd";
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
        td.style.border = "1px solid #ddd";
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
    const { tbody } = pos;
    const firstRow = tbody.querySelector("tr") as HTMLTableRowElement | null;
    if (!firstRow) return;
    const cells = cellsOfRow(firstRow);
    const shouldMakeHeader = cells.some((c) => c.tagName !== "TH");
    for (const c of cells) {
      const isTh = c.tagName === "TH";
      if (shouldMakeHeader && !isTh) {
        const th = document.createElement("th");
        th.innerHTML = c.innerHTML || "&nbsp;";
        th.style.border = (c as HTMLElement).style.border || "1px solid #ddd";
        th.style.padding = (c as HTMLElement).style.padding || "6px";
        th.style.minWidth = (c as HTMLElement).style.minWidth || "60px";
        firstRow.replaceChild(th, c);
      } else if (!shouldMakeHeader && isTh) {
        const td = document.createElement("td");
        td.innerHTML = c.innerHTML || "&nbsp;";
        td.style.border = (c as HTMLElement).style.border || "1px solid #ddd";
        td.style.padding = (c as HTMLElement).style.padding || "6px";
        td.style.minWidth = (c as HTMLElement).style.minWidth || "60px";
        firstRow.replaceChild(td, c);
      }
    }
  };

  const applyBgToSelection = (
    hex: string,
    fallbackCell?: HTMLTableCellElement
  ) => {
    const sel = selectionRef.current;
    if (sel) {
      const rows = Array.from(sel.tbody.querySelectorAll("tr"));
      for (let r = sel.sr; r <= sel.er; r++) {
        const row = rows[r];
        const cells = cellsOfRow(row);
        for (let c = sel.sc; c <= sel.ec; c++) {
          const cell = cells[c];
          if (cell) (cell as HTMLElement).style.background = hex;
        }
      }
    } else if (fallbackCell) {
      (fallbackCell as HTMLElement).style.background = hex;
    }
  };

  const toggleBorderSelection = (fallbackCell?: HTMLTableCellElement) => {
    const applyToggle = (cell: HTMLTableCellElement) => {
      const cur = (cell as HTMLElement).style.border;
      (cell as HTMLElement).style.border =
        cur && cur !== "none" ? "none" : "1px solid #000";
    };
    const sel = selectionRef.current;
    if (sel) {
      const rows = Array.from(sel.tbody.querySelectorAll("tr"));
      for (let r = sel.sr; r <= sel.er; r++) {
        const row = rows[r];
        const cells = cellsOfRow(row);
        for (let c = sel.sc; c <= sel.ec; c++) {
          const cell = cells[c];
          if (cell) applyToggle(cell);
        }
      }
    } else if (fallbackCell) {
      applyToggle(fallbackCell);
    }
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


  return (
    <div style={{ 
      border: "1px solid #ddd", 
      borderRadius: 6, 
      width: "100%", 
      maxWidth: "100vw",
      overflow: "hidden", 
      display: "flex", 
      flexDirection: "column", 
      background: "#fff", 
      boxSizing: "border-box" 
    }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          maxWidth: "100%",
          gap: 8,
          padding: 8,
          borderBottom: "1px solid #eee",
          position: "sticky",
          top: 0,
          zIndex: 1,
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
        <select
          defaultValue="p"
          onChange={(e) => {
            const val = e.target.value;
            if (val === "p") applyFormatBlock("<p>");
            else if (val === "h1") applyFormatBlock("<h1>");
            else if (val === "h2") applyFormatBlock("<h2>");
            else if (val === "h3") applyFormatBlock("<h3>");
          }}
          title="Paragraph/Heading"
          style={{
            height: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <button
          title="Bold"
          onClick={() => exec("bold")}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          <span style={{ fontWeight: 700 }}>B</span>
        </button>
        <button
          title="Italic"
          onClick={() => exec("italic")}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            fontStyle: "italic",
            color: "#111",
          }}
        >
          I
        </button>
        <button
          title="Underline"
          onClick={() => exec("underline")}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            textDecoration: "underline",
            color: "#111",
          }}
        >
          U
        </button>
        <button
          title="Strikethrough"
          onClick={() => exec("strikeThrough")}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            textDecoration: "line-through",
            color: "#111",
          }}
        >
          S
        </button>
        <select
          value={currentFontSize}
          onMouseDown={() => {
            // Save selection before dropdown interaction
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              const editor = editableRef.current;
              if (editor && editor.contains(range.commonAncestorContainer) && !range.collapsed) {
                savedRangeRef.current = range.cloneRange();
              }
            }
          }}
          onChange={(e) => applyFontSize(e.target.value)}
          title="Font Size"
          style={{
            height: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          <option value="" disabled>Size</option>
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10</option>
          <option value="11">11</option>
          <option value="12">12</option>
          <option value="14">14</option>
          <option value="18">18</option>
          <option value="24">24</option>
          <option value="30">30</option>
          <option value="36">36</option>
          <option value="48">48</option>
          <option value="60">60</option>
          <option value="72">72</option>
          <option value="96">96</option>
        </select>
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
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
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
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
            position: "relative",
          }}
        >
          <span style={{ fontWeight: 700 }}>A</span>
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
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          <span style={{ fontWeight: 700, padding: "2px 4px" }}>A</span>
        </button>
        <button
          title="Bulleted list"
          onClick={() => exec("insertUnorderedList")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          • List
        </button>
        <button
          title="Numbered list"
          onClick={() => exec("insertOrderedList")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          1. List
        </button>
        <button
          title="Blockquote"
          onClick={() => exec("formatBlock", "<blockquote>")}
          style={{
            height: 32,
            minWidth: 32,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          ❝
        </button>
        <button
          title="Code block"
          onClick={() => exec("formatBlock", "<pre>")}
          style={{
            height: 32,
            minWidth: 36,
            padding: "0 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo",
            color: "#111",
          }}
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
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
              color: "#111",
            }}
          >
            ∑
          </button>
        )}
        <button
          title="Insert link"
          onClick={insertLink}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          Link
        </button>
        <button
          title="Remove link"
          onClick={() => exec("unlink")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
          }}
        >
          Unlink
        </button>
        {media && (
          <>
            <button
              title="Insert image"
              onClick={insertImage}
              style={{
                height: 32,
                padding: "0 10px",
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
                color: "#111",
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
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  color: "#111",
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
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
                color: "#111",
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
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                background: "#fff",
                color: "#111",
                opacity: loadingDocx ? 0.5 : 1,
              }}
            >
              {loadingDocx ? '⌛ Importing...' : '📝 DOCX'}
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
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  color: "#111",
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
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  color: "#111",
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
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  color: "#111",
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
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              background: "#fff",
              color: "#111",
            }}
          >
            ➕ Table
          </button>
        )}
        <button
          title="Undo"
          onClick={() => exec("undo")}
          style={{
            height: 32,
            padding: "0 10px",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
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
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            background: "#fff",
            color: "#111",
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
            if (item?.url) insertImageAtSelection(item.url);
          }}
        />
      )}
      {table && showTableDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowTableDialog(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 280,
            }}
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
                  border: "1px solid #eee",
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
                        border: "1px solid #ccc",
                        background: active ? "#1e90ff" : "#fff",
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
            background: "rgba(0,0,0,0.5)",
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
              background: "#fff",
              padding: 20,
              borderRadius: 8,
              maxWidth: 400,
              width: "90%",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: 18, fontWeight: 600 }}>
                Import Content
            </h3>
            <p style={{ margin: "0 0 20px 0", color: "#4b5563", fontSize: 14 }}>
               The editor already contains content. How would you like to handle the imported document?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                    onClick={() => processImport(pendingImport.file, pendingImport.type, 'replace')}
                    style={{
                        padding: "8px 16px",
                        background: "#dc2626",
                        color: "white",
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
                        background: "#2563eb",
                        color: "white",
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
                        background: "#f3f4f6",
                        color: "#374151",
                        border: "1px solid #d1d5db",
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
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowColorPicker(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 320,
              maxWidth: "90vw",
              color: "#000",
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
                    border: color === '#ffffff' ? '1px solid #ddd' : 'none',
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
                  border: '1px solid #ddd',
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
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: '#fff',
                  color: '#111',
                  cursor: 'pointer',
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
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowFormulaDialog(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 16,
              borderRadius: 8,
              minWidth: 520,
              maxWidth: 720,
              color: "#000",
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
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  color: "#000",
                  background: "#fff",
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
                    border: "1px solid #eee",
                    borderRadius: 6,
                    background: "#fafafa",
                    fontSize: 12,
                    color: "#000",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {p.label}
                  </div>
                  <div style={{ color: "#000" }}>$ {p.tex} $</div>
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    background: "#fff",
                    color: "#000",
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
        style={{
          width: "100%",
          maxWidth: "100%",
          flex: "1 1 auto",
          minHeight: typeof minHeight === "number" ? `${minHeight}px` : minHeight,
          maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          overflowY: "auto",
          overflowX: "hidden",
          boxSizing: "border-box",
          position: "relative",
        }}
      >
        <div
          ref={editableRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={handleInput}
          onCompositionStart={() => (isComposingRef.current = true)}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            handleInput();
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
              }
            }
          }}
          onDragOver={(e) => {
            // Allow dragging images within editor and file drops
            if (
              draggedImageRef.current ||
              e.dataTransfer?.types?.includes("Files")
            ) {
              e.preventDefault();
            }
          }}
          onDrop={(e) => {
            // Move existing dragged image inside editor
            if (draggedImageRef.current) {
              e.preventDefault();
              const x = e.clientX;
              const y = e.clientY;
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
          }}
          style={{
            minHeight: "100%",
            maxWidth: "100%",
            overflowX: "hidden",
            padding: "16px",
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
          }}
          onKeyDown={(e) => {
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
              if (
                document.queryCommandState("insertUnorderedList") ||
                document.queryCommandState("insertOrderedList")
              ) {
                exec(e.shiftKey ? "outdent" : "indent");
              } else {
                document.execCommand("insertText", false, "  ");
              }
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
      </div>
      {selectedImage && imageOverlay && (
        <div
          style={{
            position: "fixed",
            left: imageOverlay.left,
            top: imageOverlay.top,
            width: imageOverlay.width,
            height: imageOverlay.height,
            pointerEvents: "none",
            zIndex: 49,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              outline: "2px solid #1e90ff",
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
              left: -6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 8,
              height: 24,
              background: "#1e90ff",
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
              right: -6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 8,
              height: 24,
              background: "#1e90ff",
              borderRadius: 2,
              cursor: "ew-resize",
              pointerEvents: "auto",
            }}
          />
        </div>
      )}
      {tableMenu && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
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
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 6,
              width: 200,
              maxHeight: 260,
              overflowY: "auto",
              color: "#111",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{ fontWeight: 600, fontSize: 11, margin: "2px 6px 6px" }}
            >
              Table
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <button
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => setShowTableDialog(true)}
              >
                <span>➕</span>
                <span>Insert table…</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
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
                  defaultValue="#ffffff"
                  onChange={(e) => {
                    applyBgToSelection(e.target.value, tableMenu.cell);
                    setTableMenu(null);
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => {
                  toggleBorderSelection(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>▦</span>
                <span>Toggle border</span>
              </button>
              <hr style={{ margin: "4px 0" }} />
              <button
                disabled={!canMergeSelection()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  opacity: canMergeSelection() ? 1 : 0.5,
                  cursor: canMergeSelection() ? "pointer" : "default",
                }}
                onClick={() => {
                  mergeSelection();
                  setTableMenu(null);
                }}
              >
                <span>⇄</span>
                <span>Merge cells</span>
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
                  splitCell(tableMenu.cell);
                  setTableMenu(null);
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
                  addRow(tableMenu.cell, "above");
                  setTableMenu(null);
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
                  addRow(tableMenu.cell, "below");
                  setTableMenu(null);
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
                  addCol(tableMenu.cell, "left");
                  setTableMenu(null);
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
                  addCol(tableMenu.cell, "right");
                  setTableMenu(null);
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
                  deleteRow(tableMenu.cell);
                  setTableMenu(null);
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
                  deleteCol(tableMenu.cell);
                  setTableMenu(null);
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
                  toggleHeaderCell(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>H</span>
                <span>Toggle header</span>
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
                  toggleHeaderRow(tableMenu.cell);
                  setTableMenu(null);
                }}
              >
                <span>H₁</span>
                <span>Toggle header row</span>
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
                  deleteTable(tableMenu.cell);
                  setTableMenu(null);
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
          style={{ position: "fixed", inset: 0, zIndex: 60 }}
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
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              padding: 8,
              width: 220,
              color: "#111",
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    color: "#111",
                    background: "#fff",
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    background: "#fff",
                    color: "#111",
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    color: "#111",
                    background: "#fff",
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    color: "#111",
                    background: "#fff",
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
                    border: "1px solid #eee",
                    borderRadius: 4,
                    color: "#111",
                    background: "#fff",
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
                  style={{ color: "#b00020" }}
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
