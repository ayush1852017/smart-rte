import { buildPdfPrintDocument } from "smartrte-core/foundation";
import type { SmartDocument } from "smartrte-core/foundation";

/**
 * The only genuinely browser-specific piece of PDF export: opening a print
 * window is a windowing operation, not format logic, so it stays here
 * rather than in packages/core. buildPdfPrintDocument (the actual HTML
 * content) is framework-agnostic and lives in core.
 */
export const printSmartDocumentAsPdf = (
  document: SmartDocument,
  hostWindow: Window,
  delayMs = 150,
): boolean => {
  const printWindow = hostWindow.open("", "_blank", "width=900,height=700");
  if (!printWindow) return false;
  printWindow.addEventListener("load", () => {
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, delayMs);
  }, { once: true });
  printWindow.document.open();
  printWindow.document.write(buildPdfPrintDocument(document));
  printWindow.document.close();
  return true;
};
