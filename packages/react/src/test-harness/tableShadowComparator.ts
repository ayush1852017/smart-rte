import { foundationSchema, isTextNode, normalizedStructureWithoutIds, parseCanonicalTableHtml, type SmartNode } from "smartrte-core/foundation";
import { executeDomTableCommand, type DomTableCommand } from "../adapters/domTableCommandBridge.js";
import { executeRetainedLegacyTable } from "./legacyTableEngine.js";

export type TableShadowDivergence =
  | "expected-normalization" | "equivalent-serialization" | "selection-only"
  | "visual-only" | "semantic" | "data-loss" | "unknown";

export interface TableShadowResult {
  readonly equivalent: boolean;
  readonly classification?: TableShadowDivergence;
  readonly legacyStructureHash: string;
  readonly canonicalStructureHash: string;
}

const hash = (value: unknown): string => {
  const input = JSON.stringify(value);
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

/** Hash-only comparator record. Document text and HTML are deliberately excluded. */
export const tableShadowLogRecord = (scenarioId: string, result: TableShadowResult) => ({
  scenarioId, equivalent: result.equivalent, legacyStructureHash: result.legacyStructureHash,
  canonicalStructureHash: result.canonicalStructureHash, ...(result.classification ? { classification: result.classification } : {}),
});
