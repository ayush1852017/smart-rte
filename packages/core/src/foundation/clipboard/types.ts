import type { Repair, SmartDocument } from "../types.js";

export const NATIVE_CLIPBOARD_MIME = "application/x-smart-rte+json";

export type ClipboardSource =
  | "native"
  | "word"
  | "google-docs"
  | "spreadsheet"
  | "markdown"
  | "html"
  | "plain-text";

export interface RawClipboardPayload {
  readonly html?: string;
  readonly plainText?: string;
  readonly native?: string;
  readonly types?: readonly string[];
  /** Complete MIME map when available; used by size guards and adapters. */
  readonly representations?: Readonly<Record<string, string>>;
}

export interface ClipboardDetection {
  /** A normalizer-selection hint. Correctness must not depend on this value. */
  readonly source: ClipboardSource;
  readonly signals: readonly string[];
}

declare const sanitizedClipboardBrand: unique symbol;

/** Only the sanitizer stage can construct this input for a source normalizer. */
export interface SanitizedClipboardPayload {
  readonly [sanitizedClipboardBrand]: true;
  readonly source: ClipboardSource;
  readonly html: string;
  readonly plainText: string;
  readonly document: Document;
}

export interface NormalizedClipboardPayload {
  readonly html: string;
  readonly plainText: string;
  readonly repairs: readonly string[];
}

export interface SourceNormalizer {
  readonly id: string;
  readonly sources: readonly ClipboardSource[];
  normalize(payload: SanitizedClipboardPayload): NormalizedClipboardPayload;
}

export interface ClipboardFragment {
  readonly source: ClipboardSource;
  readonly document: SmartDocument;
  readonly repairs: readonly (Repair | string)[];
}

export interface ClipboardRepresentations {
  readonly [NATIVE_CLIPBOARD_MIME]: string;
  readonly "text/html": string;
  readonly "text/plain": string;
}

export interface ClipboardPipelineOptions {
  readonly ownerDocument: Document;
  readonly normalizers?: readonly SourceNormalizer[];
  /** Test/audit switch proving detection is never required for correctness. */
  readonly normalizerMode?: "detected" | "generic";
  readonly maxBytes?: number;
}
