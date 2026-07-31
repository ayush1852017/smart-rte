import type { SmartDocument } from "smartrte-core";
import { createBuiltInFormatDefinitions } from "./builtInFormatDefinitions.js";

export type BuiltInDocumentFormat = "html" | "markdown" | "docx" | "pdf";
export type EditorDocumentFormat = BuiltInDocumentFormat | (string & {});
export type EditorFormatConfig = Partial<Record<EditorDocumentFormat, boolean>>;

export interface EditorFormatImportContext {
  ownerDocument: Document;
}

export interface EditorFormatImportResult {
  document: SmartDocument;
  layoutHtml?: string;
  preserveColors?: boolean;
  preserveDocumentLayout?: boolean;
}

export type EditorFormatExportResult =
  | { kind: "text"; filename: string; mediaType: string; content: string }
  | { kind: "blob"; filename: string; content: Blob }
  | { kind: "handled" };

export interface EditorFormatExportContext {
  ownerDocument: Document;
  hostWindow: Window;
}

export interface EditorFormatDefinition {
  id: EditorDocumentFormat;
  label: string;
  extension: string;
  accept?: string;
  canImport: boolean;
  canExport: boolean;
  confirmImportWhenNotEmpty?: boolean;
  importFile?: (file: File, context: EditorFormatImportContext) => Promise<EditorFormatImportResult>;
  exportDocument?: (
    document: SmartDocument,
    context: EditorFormatExportContext,
  ) => EditorFormatExportResult | Promise<EditorFormatExportResult>;
}

export interface EditorFormatRuntime {
  formats: readonly EditorFormatDefinition[];
  imports: readonly EditorFormatDefinition[];
  exports: readonly EditorFormatDefinition[];
  has: (format: string) => boolean;
  get: (format: string) => EditorFormatDefinition | undefined;
  canImport: (format: string) => boolean;
  canExport: (format: string) => boolean;
}

export const createEditorFormatRuntime = (
  config: EditorFormatConfig = {},
  replacements: readonly EditorFormatDefinition[] = createBuiltInFormatDefinitions(),
): EditorFormatRuntime => {
  const seen = new Set<string>();
  replacements.forEach((format) => {
    if (seen.has(format.id)) throw new Error(`Duplicate editor format "${format.id}".`);
    seen.add(format.id);
  });
  const formats = replacements.filter((format) => config[format.id] !== false);
  const byId = new Map(formats.map((format) => [format.id, format]));
  return {
    formats,
    imports: formats.filter((format) => format.canImport),
    exports: formats.filter((format) => format.canExport),
    has: (format) => byId.has(format),
    get: (format) => byId.get(format),
    canImport: (format) => Boolean(byId.get(format)?.canImport),
    canExport: (format) => Boolean(byId.get(format)?.canExport),
  };
};
