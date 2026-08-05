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

/** Legacy rollback-only DOM insertion. The canonical product path never imports this module. */
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
    const selection = ownerDocument.getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element : range.startContainer.parentElement;
    const inlineOwner = startElement?.closest("p,h1,h2,h3,h4,h5,h6,pre,li,td,th");
    const only = fragment.document.children.length === 1 ? fragment.document.children[0] : null;
    let insertionHtml = cleanHtml;
    if (inlineOwner && only && only.type !== "text" && ["paragraph", "heading"].includes(only.type)) {
      const container = ownerDocument.createElement("div");
      container.innerHTML = cleanHtml;
      insertionHtml = container.firstElementChild?.innerHTML || cleanHtml;
    }
    const fragmentNode = range.createContextualFragment(insertionHtml);
    const last = fragmentNode.lastChild;
    range.insertNode(fragmentNode);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
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
