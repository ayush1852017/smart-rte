import {
  parseClipboardPayload,
  serializeCanonicalListHtml,
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

/** Phase 8a product bridge; Phase 8b replaces the final DOM insertion step. */
export const insertCanonicalClipboardData = (transfer: DataTransfer, ownerDocument: Document): boolean => {
  if (!transfer.types.length) return false;
  const fragment = parseClipboardPayload(payloadFromTransfer(transfer), { ownerDocument });
  const cleanHtml = serializeCanonicalListHtml(fragment.document, { clean: true });
  if (!cleanHtml) return false;
  return ownerDocument.execCommand("insertHTML", false, cleanHtml);
};
