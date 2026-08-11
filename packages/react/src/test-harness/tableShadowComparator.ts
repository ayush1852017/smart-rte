import { compareShadowDocuments, foundationSchema, isTextNode, normalizedStructureWithoutIds, parseCanonicalTableHtml, type SmartSelection, type SmartNode } from "smartrte-core/foundation";
import { executeDomTableCommand, executeDomTableInsert, executeDomTableRemoval, type DomTableCommand } from "../adapters/domTableCommandBridge.js";
import { executeRetainedLegacyTable, executeRetainedLegacyTableInsert } from "./legacyTableEngine.js";

export type TableShadowDivergence =
  | "expected-normalization" | "equivalent-serialization" | "selection-only"
  | "visual-only" | "semantic" | "data-loss" | "unknown";

export interface TableShadowResult {
  readonly equivalent: boolean;
  readonly classification?: TableShadowDivergence;
  readonly legacyStructureHash: string;
  readonly canonicalStructureHash: string;
  readonly selectionCompared?: boolean;
  readonly selectionEquivalent?: boolean;
  readonly legacySelectionHash?: string;
  readonly canonicalSelectionHash?: string;
}

const hash = (value: unknown): string => {
  const input = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) { state ^= input.charCodeAt(index); state = Math.imul(state, 16777619); }
  return (state >>> 0).toString(16).padStart(8, "0");
};

const documentText = (node: SmartNode): string => isTextNode(node) ? node.text : (node.children || []).map(documentText).join("");

export const compareRetainedAndCanonicalTable = (html: string, command: DomTableCommand): TableShadowResult => {
  const legacyHtml = executeRetainedLegacyTable(html, command);
  const host = document.createElement("div");
  host.innerHTML = html;
  const canonicalTable = host.querySelector("table");
  if (command.id === "table.remove") {
    const legacyDocument = parseCanonicalTableHtml(legacyHtml || "");
    const removed = canonicalTable instanceof HTMLTableElement && executeDomTableRemoval(canonicalTable);
    const canonicalDocument = parseCanonicalTableHtml(host.innerHTML);
    const legacy = normalizedStructureWithoutIds(legacyDocument, foundationSchema);
    const current = normalizedStructureWithoutIds(canonicalDocument, foundationSchema);
    const equivalent = removed && JSON.stringify(legacy) === JSON.stringify(current);
    return {
      equivalent,
      legacyStructureHash: hash(legacy), canonicalStructureHash: hash(current),
      ...(!equivalent ? { classification: "semantic" as const } : {}),
    };
  }
  const canonical = canonicalTable instanceof HTMLTableElement ? executeDomTableCommand(canonicalTable, command) : null;
  if (!legacyHtml || !canonical) return { equivalent: false, classification: "semantic", legacyStructureHash: hash(legacyHtml), canonicalStructureHash: hash(canonical?.outerHTML) };
  const legacyDocument = parseCanonicalTableHtml(legacyHtml);
  const canonicalDocument = parseCanonicalTableHtml(canonical.outerHTML);
  const legacy = normalizedStructureWithoutIds(legacyDocument, foundationSchema);
  const current = normalizedStructureWithoutIds(canonicalDocument, foundationSchema);
  const equivalent = JSON.stringify(legacy) === JSON.stringify(current);
  const dataLoss = documentText(canonicalDocument) !== documentText(legacyDocument);
  const intentional = command.id === "table.header.row.toggle" || command.id === "table.header.column.toggle" || command.id === "table.header.cell.toggle"
    ? "visual-only" as const : "expected-normalization" as const;
  return {
    equivalent, legacyStructureHash: hash(legacy), canonicalStructureHash: hash(current),
    ...(!equivalent ? { classification: dataLoss ? "data-loss" as const : intentional } : {}),
  };
};

/**
 * Compares the retained block-level table insertion command with the
 * canonical insertion path.  The insertion caret is a stable semantic point:
 * the first paragraph in the first inserted cell.  This is intentionally
 * separate from the cell-editing comparator above, whose old command surface
 * did not expose a selection result.
 */
export const compareRetainedAndCanonicalTableInsert = (
  html: string,
  rows = 2,
  columns = 2,
  headerRow = false,
): TableShadowResult => {
  const legacyHtml = executeRetainedLegacyTableInsert(html, rows, columns, headerRow);
  const host = document.createElement("div");
  host.innerHTML = html;
  const canonicalTable = executeDomTableInsert(host, 0, rows, columns, headerRow);
  if (!legacyHtml || !canonicalTable) return {
    equivalent: false,
    classification: "semantic",
    legacyStructureHash: hash(legacyHtml),
    canonicalStructureHash: hash(host.innerHTML),
    selectionCompared: true,
    selectionEquivalent: false,
  };
  const legacyDocument = parseCanonicalTableHtml(legacyHtml);
  const canonicalDocument = parseCanonicalTableHtml(host.innerHTML);
  const selection: SmartSelection = {
    type: "text",
    anchor: { path: [1, 0, 0, 0], offset: 0 },
    head: { path: [1, 0, 0, 0], offset: 0 },
  };
  const comparison = compareShadowDocuments({
    legacyDocument,
    legacySelection: selection,
    canonicalDocument,
    canonicalSelection: selection,
    schema: foundationSchema,
  });
  const insertionDataLoss = documentText(legacyDocument) !== documentText(canonicalDocument);
  return {
    equivalent: comparison.equivalent,
    ...(!comparison.documentEquivalent
      ? { classification: insertionDataLoss ? "data-loss" as const : "expected-normalization" as const }
      : comparison.classification ? { classification: comparison.classification as TableShadowDivergence } : {}),
    legacyStructureHash: comparison.legacyStructureHash,
    canonicalStructureHash: comparison.canonicalStructureHash,
    selectionCompared: true,
    selectionEquivalent: comparison.selectionEquivalent,
    legacySelectionHash: comparison.legacySelectionHash,
    canonicalSelectionHash: comparison.canonicalSelectionHash,
  };
};

/** Hash-only comparator record. Document text and HTML are deliberately excluded. */
export const tableShadowLogRecord = (scenarioId: string, result: TableShadowResult) => ({
  scenarioId, equivalent: result.equivalent, legacyStructureHash: result.legacyStructureHash,
  canonicalStructureHash: result.canonicalStructureHash, ...(result.classification ? { classification: result.classification } : {}),
});
