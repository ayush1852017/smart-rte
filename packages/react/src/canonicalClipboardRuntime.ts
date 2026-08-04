import {
  parseClipboardPayload,
  reportParsedClipboard,
  reportRejectedClipboard,
  serializeCanonicalListHtml,
  type ClipboardDiagnosticReport,
  type RawClipboardPayload,
} from "smartrte-core/foundation";

const payloadFromTransfer = (transfer: DataTransfer): RawClipboardPayload => {
  const representations = Object.fromEntries(Array.from(transfer.types)
    .filter((type) => type !== "Files")
    .map((type) => [type, transfer.getData(type)]));
  return {
    html: representations["text/html"], plainText: representations["text/plain"],
    native: representations["application/x-smart-rte+json"], types: Array.from(transfer.types), representations,
  };
};

// MIGRATION_ADAPTER: canonical-clipboard-dom-insert owner=Phase8b
/** Phase 8a product bridge; Phase 8b replaces the final DOM insertion step. */
export const insertCanonicalClipboardData = (
  transfer: DataTransfer,
  ownerDocument: Document,
  onDiagnostic?: (report: ClipboardDiagnosticReport) => void,
): boolean => {
  if (!transfer.types.length) return false;
  const payload = payloadFromTransfer(transfer);
  try {
    const fragment = parseClipboardPayload(payload, { ownerDocument });
    onDiagnostic?.(reportParsedClipboard(payload, fragment));
    const cleanHtml = serializeCanonicalListHtml(fragment.document, { clean: true });
    if (!cleanHtml) return false;
    return ownerDocument.execCommand("insertHTML", false, cleanHtml);
  } catch (error) {
    onDiagnostic?.(reportRejectedClipboard(payload, error));
    return false;
  }
};

export interface CanonicalClipboardRuntimeOptions {
  ownerDocument: Document;
  onFiles?: (files: readonly File[]) => boolean;
  beforeInsert?: () => void;
  afterInsert?: () => void;
  onDiagnostic?: (report: ClipboardDiagnosticReport) => void;
}

/** Owns the product paste listener outside ClassicEditor. */
export const installCanonicalClipboardRuntime = (
  root: HTMLElement,
  options: CanonicalClipboardRuntimeOptions,
): (() => void) => {
  const onPaste = (event: ClipboardEvent) => {
    const transfer = event.clipboardData;
    if (!transfer) return;
    const files = Array.from(transfer.files || []);
    if (files.length && options.onFiles?.(files)) {
      event.preventDefault();
      return;
    }
    if (!transfer.types.length) return;
    event.preventDefault();
    options.beforeInsert?.();
    if (insertCanonicalClipboardData(transfer, options.ownerDocument, options.onDiagnostic)) options.afterInsert?.();
  };
  root.addEventListener("paste", onPaste);
  return () => root.removeEventListener("paste", onPaste);
};
