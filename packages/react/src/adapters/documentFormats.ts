import {
  compatibilityHtmlToMarkdown,
  markdownToCompatibilityHtml,
  normalizeSmartDocument,
  type SmartDocument,
} from "smartrte-core";
import { serializeSmartDocument, smartDocumentFromHtml } from "./domSmartDocument.js";

export type TextDocumentFormat = "html" | "markdown";

export interface DocumentImportContext {
  ownerDocument: Document;
}

export interface DocumentFormatAdapter {
  id: string;
  mediaType: string;
  extension: string;
  importDocument: (source: string, context: DocumentImportContext) => SmartDocument;
  exportDocument: (document: SmartDocument) => string;
}

const htmlAdapter: DocumentFormatAdapter = {
  id: "html",
  mediaType: "text/html;charset=utf-8",
  extension: "html",
  importDocument: (source, context) =>
    normalizeSmartDocument(smartDocumentFromHtml(source, context.ownerDocument)),
  exportDocument: (document) => serializeSmartDocument(normalizeSmartDocument(document)),
};

const markdownAdapter: DocumentFormatAdapter = {
  id: "markdown",
  mediaType: "text/markdown;charset=utf-8",
  extension: "md",
  importDocument: (source, context) =>
    normalizeSmartDocument(
      smartDocumentFromHtml(markdownToCompatibilityHtml(source), context.ownerDocument),
    ),
  exportDocument: (document) =>
    compatibilityHtmlToMarkdown(serializeSmartDocument(normalizeSmartDocument(document))),
};

export class DocumentFormatRegistry {
  private readonly adapters = new Map<string, DocumentFormatAdapter>();

  constructor(adapters: readonly DocumentFormatAdapter[] = []) {
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter: DocumentFormatAdapter) {
    if (!adapter.id.trim()) throw new Error("Document format adapter id cannot be empty.");
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Duplicate document format adapter "${adapter.id}".`);
    }
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  has(format: string) {
    return this.adapters.has(format);
  }

  get(format: string): DocumentFormatAdapter {
    const adapter = this.adapters.get(format);
    if (!adapter) throw new Error(`Unknown document format "${format}".`);
    return adapter;
  }

  list(): readonly DocumentFormatAdapter[] {
    return [...this.adapters.values()];
  }
}

export const createDocumentFormatRegistry = (
  adapters: readonly DocumentFormatAdapter[] = [htmlAdapter, markdownAdapter],
) => new DocumentFormatRegistry(adapters);

export const defaultDocumentFormatRegistry = createDocumentFormatRegistry();

export const getDocumentFormatAdapter = (format: TextDocumentFormat): DocumentFormatAdapter =>
  defaultDocumentFormatRegistry.get(format);

export const importTextDocument = (
  format: TextDocumentFormat,
  source: string,
  context: DocumentImportContext,
): SmartDocument => getDocumentFormatAdapter(format).importDocument(source, context);

export const exportTextDocument = (
  format: TextDocumentFormat,
  document: SmartDocument,
): string => getDocumentFormatAdapter(format).exportDocument(document);

export const roundTripTextDocument = (
  format: TextDocumentFormat,
  document: SmartDocument,
  context: DocumentImportContext,
): SmartDocument =>
  importTextDocument(format, exportTextDocument(format, document), context);
