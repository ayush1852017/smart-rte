import type { EditorFormatDefinition } from "./formatRuntime.js";
import { exportTextDocument, importTextDocument } from "./adapters/documentFormats.js";
import { exportDocxDocument, importDocxDocumentWithMammoth } from "./adapters/docxFormat.js";
import { importPdfDocument, printSmartDocumentAsPdf } from "./adapters/pdfFormat.js";
import { enhanceDocxTables, importStyledDocxDocument } from "./adapters/styledDocxFormat.js";
import { serializeSmartDocument } from "./adapters/domSmartDocument.js";

export interface BuiltInFormatDefinitionOptions {
  preserveDocxStyles?: boolean;
}

const standaloneHtmlDocument = (html: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart RTE Export</title><style>
html,body{margin:0;background:#fff;color:#111;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}
body{padding:32px}.srte-export{max-width:960px;margin:0 auto}h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.25em 0 .5em}
p{margin:0 0 .85em}blockquote{border-left:4px solid #1e90ff;margin:.75em 0;padding:.5em 1em;background:#f3f4f6}
ul,ol{margin:.75em 0;padding-left:1.75em;list-style-position:outside}li{display:list-item;margin:.25em 0;padding-left:.25em}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #d1d5db;padding:8px;vertical-align:top;text-align:left}
th{background:#f3f4f6;font-weight:700}img{max-width:100%;height:auto}pre,code{background:#f3f4f6;border-radius:4px}
pre{padding:12px;overflow-x:auto;white-space:pre-wrap}@media print{body{padding:0}.srte-export{max-width:none}}
</style></head><body><main class="srte-export">${html || "<p></p>"}</main></body></html>`;

export const createBuiltInFormatDefinitions = (
  options: BuiltInFormatDefinitionOptions = {},
): readonly EditorFormatDefinition[] => [
  {
    id: "pdf", label: "PDF", extension: "pdf", accept: "application/pdf",
    canImport: true, canExport: true, confirmImportWhenNotEmpty: true,
    importFile: async (file, context) => {
      const result = await importPdfDocument(await file.arrayBuffer(), context.ownerDocument);
      return { ...result, preserveColors: true, preserveDocumentLayout: true };
    },
    exportDocument: (document, context) => {
      printSmartDocumentAsPdf(document, context.hostWindow);
      return { kind: "handled" };
    },
  },
  {
    id: "docx", label: "Microsoft Word", extension: "docx", accept: ".docx",
    canImport: true, canExport: true, confirmImportWhenNotEmpty: true,
    importFile: async (file, context) => {
      const buffer = await file.arrayBuffer();
      if (options.preserveDocxStyles ?? true) {
        const result = await importStyledDocxDocument(buffer, context.ownerDocument);
        return {
          document: result.document,
          layoutHtml: `<div class="srte-preserve-colors">${result.layoutHtml}</div>`,
          preserveColors: true,
          preserveDocumentLayout: true,
        };
      }
      const document = await importDocxDocumentWithMammoth(buffer, context.ownerDocument);
      const container = context.ownerDocument.createElement("div");
      container.innerHTML = serializeSmartDocument(document);
      enhanceDocxTables(container);
      return {
        document,
        layoutHtml: `<div class="srte-preserve-colors">${container.innerHTML}</div>`,
      };
    },
    exportDocument: async (document) => ({
      kind: "blob", filename: "smart-rte-export.docx",
      content: await exportDocxDocument(document),
    }),
  },
  {
    id: "html", label: "HTML", extension: "html", accept: ".html,.htm,text/html",
    canImport: true, canExport: true,
    importFile: async (file, context) => ({
      document: importTextDocument("html", await file.text(), context),
      preserveColors: true, preserveDocumentLayout: true,
    }),
    exportDocument: (document) => ({
      kind: "text", filename: "smart-rte-export.html", mediaType: "text/html;charset=utf-8",
      content: standaloneHtmlDocument(exportTextDocument("html", document)),
    }),
  },
  {
    id: "markdown", label: "Markdown", extension: "md",
    accept: ".md,.markdown,text/markdown,text/plain", canImport: true, canExport: true,
    importFile: async (file, context) => ({
      document: importTextDocument("markdown", await file.text(), context),
      preserveColors: true, preserveDocumentLayout: true,
    }),
    exportDocument: (document) => ({
      kind: "text", filename: "smart-rte-export.md", mediaType: "text/markdown;charset=utf-8",
      content: exportTextDocument("markdown", document),
    }),
  },
];
