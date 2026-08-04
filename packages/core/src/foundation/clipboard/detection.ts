import { NATIVE_CLIPBOARD_MIME, type ClipboardDetection, type RawClipboardPayload } from "./types.js";

const markdownPattern = /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|\|.+\|)/m;

/** Detection selects an optimization/normalizer only; generic parsing remains the fallback. */
export const detectClipboardSource = (payload: RawClipboardPayload): ClipboardDetection => {
  const html = payload.html || "";
  const types = new Set(payload.types || []);
  if (payload.native || types.has(NATIVE_CLIPBOARD_MIME)) return { source: "native", signals: [NATIVE_CLIPBOARD_MIME] };
  const wordSignals = [
    /\bmso-[\w-]+\s*:/i.test(html) && "mso-style",
    /<!--\[if\s+gte\s+mso/i.test(html) && "mso-conditional-comment",
    /xmlns:(?:o|w)\s*=/i.test(html) && "office-namespace",
  ].filter((value): value is string => Boolean(value));
  if (wordSignals.length) return { source: "word", signals: wordSignals };
  if (/\bid=["']docs-internal-guid-/i.test(html)) return { source: "google-docs", signals: ["docs-internal-guid"] };
  if (/<table\b/i.test(html) && /(?:google-sheets|excel|mso-number-format|docs-internal-guid)/i.test(html)) {
    return { source: "spreadsheet", signals: ["table-with-spreadsheet-marker"] };
  }
  if (html) return { source: "html", signals: ["text/html"] };
  if (markdownPattern.test(payload.plainText || "")) return { source: "markdown", signals: ["plain-text-structure"] };
  return { source: "plain-text", signals: ["text/plain"] };
};
