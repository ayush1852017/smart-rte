import { createNodeId } from "../identity.js";
import { parseCanonicalListHtml } from "../list/formats.js";
import { foundationSchema, repair } from "../schema.js";
import { detectClipboardSource } from "./detection.js";
import { capturedSourceNormalizers } from "./normalizers.js";
import { sanitizeClipboardHtml } from "./sanitizer.js";
import { parseNativeClipboardDocument } from "./serialization.js";
import type {
  ClipboardFragment, ClipboardPipelineOptions, NormalizedClipboardPayload,
  RawClipboardPayload, SanitizedClipboardPayload, SourceNormalizer,
} from "./types.js";

export const DEFAULT_MAX_CLIPBOARD_BYTES = 5 * 1024 * 1024;

export class ClipboardPayloadTooLargeError extends Error {
  constructor(readonly actualBytes: number, readonly maximumBytes: number) {
    super(`Clipboard payload is ${actualBytes} bytes; the limit is ${maximumBytes} bytes.`);
    this.name = "ClipboardPayloadTooLargeError";
  }
}

export const estimateClipboardPayloadBytes = (payload: RawClipboardPayload): number => {
  const values = payload.representations
    ? Object.values(payload.representations)
    : [payload.html || "", payload.plainText || "", payload.native || ""];
  return values.reduce((total, value) => total + new TextEncoder().encode(value).byteLength, 0);
};

const genericNormalizer: SourceNormalizer = {
  id: "generic-html",
  sources: ["native", "word", "google-docs", "spreadsheet", "markdown", "html", "plain-text"],
  normalize(payload: SanitizedClipboardPayload): NormalizedClipboardPayload {
    return { html: payload.html, plainText: payload.plainText, repairs: [] };
  },
};

const textAsHtml = (ownerDocument: Document, text: string): string => text.split(/\r?\n\r?\n/).map((paragraph) => {
  const element = ownerDocument.createElement("p");
  element.textContent = paragraph;
  return element.outerHTML;
}).join("");

/**
 * The only public raw-payload entry point. Its call graph fixes the security
 * order as detect -> sanitize -> normalize -> parse -> schema repair.
 */
export const parseClipboardPayload = (
  payload: RawClipboardPayload,
  options: ClipboardPipelineOptions,
): ClipboardFragment => {
  const bytes = estimateClipboardPayloadBytes(payload);
  const maximum = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_CLIPBOARD_BYTES));
  if (bytes > maximum) throw new ClipboardPayloadTooLargeError(bytes, maximum);
  const detection = detectClipboardSource(payload);
  const plainText = payload.plainText || "";
  const rawHtml = payload.html || textAsHtml(options.ownerDocument, plainText);
  const sanitized = sanitizeClipboardHtml(options.ownerDocument, detection.source, rawHtml, plainText);
  const normalizer = options.normalizerMode === "generic" ? genericNormalizer
    : options.normalizers?.find((candidate) => candidate.sources.includes(detection.source))
      || capturedSourceNormalizers.find((candidate) => candidate.sources.includes(detection.source))
      || genericNormalizer;
  const normalized = normalizer.normalize(sanitized);
  const parsed = detection.source === "native" && payload.native
    ? parseNativeClipboardDocument(payload.native)
    : parseCanonicalListHtml(normalized.html);
  const repaired = repair({ ...parsed, id: parsed.id || createNodeId() }, foundationSchema);
  return { source: detection.source, document: repaired.doc, repairs: [...normalized.repairs, ...repaired.repairs] };
};
