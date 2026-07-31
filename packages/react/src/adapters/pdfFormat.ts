import type { SmartDocument } from "smartrte-core";
import { normalizeSmartDocument } from "smartrte-core";
import { exportTextDocument } from "./documentFormats.js";
import { smartDocumentFromHtml } from "./domSmartDocument.js";

export const PDF_MEDIA_TYPE = "application/pdf";

export interface PdfTextItemSnapshot {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily?: string;
}

export interface PdfPageSnapshot {
  width: number;
  items: readonly PdfTextItemSnapshot[];
}

export interface PdfImportResult {
  document: SmartDocument;
  layoutHtml: string;
  pages: number;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const spanFor = (item: PdfTextItemSnapshot) => {
  const family = item.fontFamily?.toLowerCase() || "";
  const styles = [
    `font-size:${Math.max(8, Math.round(item.height))}px`,
    family.includes("bold") ? "font-weight:700" : "",
    family.includes("italic") || family.includes("oblique") ? "font-style:italic" : "",
  ].filter(Boolean).join(";");
  return `<span style="${styles}">${escapeHtml(item.text)}</span>`;
};

const lineContent = (items: readonly PdfTextItemSnapshot[]) => {
  let previousRight: number | undefined;
  let text = "";
  let html = "";
  const starts: number[] = [];
  const gaps: number[] = [];
  items.forEach((item, index) => {
    const gap = previousRight === undefined ? 0 : item.x - previousRight;
    if (index === 0 || gap > 20) starts.push(item.x);
    if (gap > 2) {
      text += " ";
      html += " ";
      if (gap > 20) gaps.push(gap);
    }
    text += item.text;
    html += spanFor(item);
    previousRight = item.x + item.width;
  });
  return { text, html, starts, gaps };
};

const alignmentForLine = (items: readonly PdfTextItemSnapshot[], pageWidth: number) => {
  const first = items[0]?.x || 0;
  const last = items[items.length - 1];
  const right = last ? last.x + last.width : first;
  const center = (first + right) / 2;
  if (Math.abs(center - pageWidth / 2) < pageWidth * 0.12) return "center";
  if (first > pageWidth * 0.55) return "right";
  return "";
};

export const reconstructPdfPages = (
  pages: readonly PdfPageSnapshot[],
  ownerDocument: Document,
): PdfImportResult => {
  let layoutHtml = "";
  pages.forEach((page) => {
    const heights = page.items.map((item) => item.height).filter((height) => height > 0).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
    const lines: Array<{ y: number; items: PdfTextItemSnapshot[] }> = [];
    page.items.filter((item) => item.text.trim()).forEach((item) => {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) < medianHeight * 0.5);
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    });
    lines.sort((left, right) => right.y - left.y);
    lines.forEach((line) => line.items.sort((left, right) => left.x - right.x));

    let pageHtml = "";
    let activeList: "ul" | "ol" | undefined;
    let tableColumns: number[] = [];
    let tableRows: string[] = [];
    const closeList = () => {
      if (activeList) pageHtml += `</${activeList}>`;
      activeList = undefined;
    };
    const closeTable = () => {
      if (tableRows.length) {
        pageHtml += `<table style="border-collapse:collapse;width:100%"><tbody>${tableRows.join("")}</tbody></table>`;
      }
      tableRows = [];
      tableColumns = [];
    };

    lines.forEach((line) => {
      const content = lineContent(line.items);
      const alignsWithTable = tableColumns.length > 0
        && content.starts.some((x) => tableColumns.some((column) => Math.abs(column - x) < 20));
      const beginsTable = content.starts.length >= 2 && content.gaps.some((gap) => gap > 30);
      if (beginsTable || alignsWithTable) {
        closeList();
        if (!tableColumns.length) tableColumns = [...content.starts];
        const cells = new Array(tableColumns.length).fill("");
        line.items.forEach((item) => {
          let column = 0;
          tableColumns.forEach((start, index) => {
            if (item.x >= start - 10) column = index;
          });
          cells[column] += `${cells[column] ? " " : ""}${spanFor(item)}`;
        });
        tableRows.push(`<tr>${cells.map((cell) => `<td style="border:1px solid #d1d5db;padding:8px;vertical-align:top">${cell || "&nbsp;"}</td>`).join("")}</tr>`);
        return;
      }
      closeTable();
      const bullet = /^[•\-*]\s/.test(content.text);
      const numbered = /^\d+[.)]\s/.test(content.text);
      if (bullet || numbered) {
        const type = bullet ? "ul" : "ol";
        if (activeList !== type) {
          closeList();
          activeList = type;
          pageHtml += `<${type}>`;
        }
        const listItems = line.items.map((item, index) => index === 0
          ? { ...item, text: item.text.replace(bullet ? /^[•\-*]\s*/ : /^\d+[.)]\s*/, "") }
          : item);
        pageHtml += `<li>${lineContent(listItems).html.trim()}</li>`;
        return;
      }
      closeList();
      const largest = Math.max(...line.items.map((item) => item.height));
      const heading = largest > medianHeight * 1.2;
      const tag = heading ? (largest > medianHeight * 1.5 ? "h2" : "h3") : "p";
      const alignment = alignmentForLine(line.items, page.width);
      const indent = !alignment && line.items[0]?.x > 40 ? `margin-left:${Math.round(line.items[0].x)}px` : "";
      const style = [alignment ? `text-align:${alignment}` : "", indent].filter(Boolean).join(";");
      pageHtml += `<${tag}${style ? ` style="${style}"` : ""}>${content.html}</${tag}>`;
    });
    closeList();
    closeTable();
    layoutHtml += pageHtml;
  });
  return {
    document: normalizeSmartDocument(smartDocumentFromHtml(layoutHtml, ownerDocument)),
    layoutHtml,
    pages: pages.length,
  };
};

export const importPdfDocument = async (
  arrayBuffer: ArrayBuffer,
  ownerDocument: Document,
): Promise<PdfImportResult> => {
  const pdfjsLib = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: PdfPageSnapshot[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles as Record<string, { fontFamily?: string }>;
    pages.push({
      width: viewport.width,
      items: (content.items as any[]).map((item) => ({
        text: item.str || "",
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: Math.abs(item.transform[3]) || 0,
        fontFamily: styles[item.fontName]?.fontFamily,
      })),
    });
  }
  return reconstructPdfPages(pages, ownerDocument);
};

export const buildPdfPrintDocument = (document: SmartDocument) => {
  const html = exportTextDocument("html", document);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Smart RTE PDF Export</title>
  <style>
    @page { margin: 18mm; }
    html, body { background: #fff; }
    body {
      color: #111;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      padding: 32px;
    }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; break-inside: auto; }
    tr, img, blockquote, pre { break-inside: avoid; }
    td, th { border: 1px solid #d1d5db; padding: 8px; vertical-align: top; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 4px solid #d1d5db; padding-left: 12px; color: #374151; }
    pre, code { background: #f3f4f6; }
    pre { padding: 12px; white-space: pre-wrap; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>${html || "<p></p>"}</body>
</html>`;
};

export const printSmartDocumentAsPdf = (
  document: SmartDocument,
  hostWindow: Window,
  delayMs = 150,
): boolean => {
  const printWindow = hostWindow.open("", "_blank", "width=900,height=700");
  if (!printWindow) return false;
  printWindow.addEventListener("load", () => {
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, delayMs);
  }, { once: true });
  printWindow.document.open();
  printWindow.document.write(buildPdfPrintDocument(document));
  printWindow.document.close();
  return true;
};
