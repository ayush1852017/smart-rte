import { isTextNode } from "../identity.js";
import { serializeCanonicalListHtml } from "../list/formats.js";
import type { SmartDocument, SmartNode } from "../types.js";
import { NATIVE_CLIPBOARD_MIME, type ClipboardRepresentations } from "./types.js";

interface NativeClipboardEnvelope {
  readonly format: "smartrte-canonical-fragment";
  readonly version: 1;
  readonly document: SmartDocument;
}

const nodeText = (node: SmartNode): string => {
  if (isTextNode(node)) return node.text;
  if (node.type === "hard_break") return "\n";
  if (node.type === "image" || node.type === "block_image") return String(node.attrs?.alt || "");
  if (node.type === "formula" || node.type === "block_formula") return String(node.attrs?.source || "");
  const separator = node.type === "table_cell" ? "\t" : node.type === "paragraph" || node.type === "heading"
    || node.type === "code_block" || node.type === "list_item" || node.type === "table_row" ? "\n" : "";
  return (node.children || []).map(nodeText).join(separator === "\t" ? "" : "") + separator;
};

export const serializeNativeClipboardDocument = (document: SmartDocument): string => JSON.stringify({
  format: "smartrte-canonical-fragment",
  version: 1,
  document,
} satisfies NativeClipboardEnvelope);

export const parseNativeClipboardDocument = (value: string): SmartDocument => {
  const envelope = JSON.parse(value) as Partial<NativeClipboardEnvelope>;
  if (envelope.format !== "smartrte-canonical-fragment" || envelope.version !== 1 || envelope.document?.type !== "doc") {
    throw new Error("Invalid native Smart RTE clipboard fragment.");
  }
  return structuredClone(envelope.document);
};

export const serializeClipboardRepresentations = (document: SmartDocument): ClipboardRepresentations => ({
  [NATIVE_CLIPBOARD_MIME]: serializeNativeClipboardDocument(document),
  "text/html": serializeCanonicalListHtml(document, { clean: true }),
  "text/plain": document.children.map(nodeText).join("").replace(/\n+$/g, ""),
});
