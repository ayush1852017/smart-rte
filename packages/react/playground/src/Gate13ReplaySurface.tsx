import { useEffect, useRef, useState } from "react";
import { runAtomShadowCorpus } from "../../src/test-harness/atomShadowComparator";
import { compareRetainedAndCanonicalTable, compareRetainedAndCanonicalTableInsert } from "../../src/test-harness/tableShadowComparator";
import { runDualEngineListShadowCorpus, runNamedListIntentCorpus } from "../../src/adapters/legacyListShadowComparator";

type Gate13Result = {
  browserReady: true;
  comparableIntents: number;
  intentResults: Array<{ intent: string; equivalent: boolean; selectionCompared: boolean; classification?: string; hash: string }>;
  listCorpus: { scenarios: number; equivalent: number; divergences: Record<string, number> };
  atomCorpus: { scenarios: number; equivalent: number; divergences: Record<string, number> };
};

const hash = (value: unknown) => {
  const input = JSON.stringify(value);
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) state = Math.imul(state ^ input.charCodeAt(index), 16777619);
  return (state >>> 0).toString(16).padStart(8, "0");
};

/**
 * Browser-hosted retained/canonical command replay. This route is test-only;
 * it never appears in the product toolbar. It deliberately runs the retained
 * snapshots and canonical adapters in the browser selected by Playwright so
 * browser-specific DOM/parser behaviour is not hidden behind Node/jsdom.
 */
export default function Gate13ReplaySurface() {
  const [result, setResult] = useState<Gate13Result | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const intentResults: Gate13Result["intentResults"] = [];
    // mark.* intents were retired with canonicalInlineCommandBridge.ts, and
    // block.* intents with domBlockCommandBridge.ts (Phase 8b closeout,
    // 2026-08-12) - there is no remaining DOM-authoritative bridge to
    // compare canonical inline or block commands against.
    const tableCommands = [
      { intent: "table.insertRow", command: { id: "table.row.add" as const, input: { index: 1 } } },
      { intent: "table.removeRow", command: { id: "table.row.remove" as const, input: { index: 1 } } },
      { intent: "table.insertColumn", command: { id: "table.column.add" as const, input: { index: 1 } } },
      { intent: "table.removeColumn", command: { id: "table.column.remove" as const, input: { index: 1 } } },
      { intent: "table.mergeCells", command: { id: "table.cell.merge" as const, input: { start: { row: 0, column: 0 }, end: { row: 1, column: 1 } } } },
      { intent: "table.splitCell", command: { id: "table.cell.split" as const, input: { row: 1, column: 0 } } },
      { intent: "table.setHeader", command: { id: "table.header.row.toggle" as const, input: { row: 0, column: 0 } } },
      { intent: "table.remove", command: { id: "table.remove" as const, input: {} } },
    ] as const;
    const tableHtml = "<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>";
    const mergedTableHtml = "<table><tbody><tr><td rowspan=\"2\"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></tbody></table>";
    tableCommands.forEach(({ intent, command }) => {
      const comparison = compareRetainedAndCanonicalTable(intent === "table.splitCell" ? mergedTableHtml : tableHtml, command);
      intentResults.push({ intent, equivalent: comparison.equivalent, selectionCompared: comparison.selectionCompared === true, classification: comparison.classification, hash: hash([comparison.legacyStructureHash, comparison.canonicalStructureHash, comparison.legacySelectionHash, comparison.canonicalSelectionHash]) });
    });
    const tableInsert = compareRetainedAndCanonicalTableInsert("<p>anchor</p>", 2, 2, false);
    intentResults.push({ intent: "table.insert", equivalent: tableInsert.equivalent, selectionCompared: tableInsert.selectionCompared === true, classification: tableInsert.classification, hash: hash([tableInsert.legacyStructureHash, tableInsert.canonicalStructureHash, tableInsert.legacySelectionHash, tableInsert.canonicalSelectionHash]) });
    const atom = runAtomShadowCorpus(7, document);
    ["atom.resize", "atom.update", "atom.delete", "atom.insert.formula"].forEach((intent, index) => {
      const equivalent = atom.divergences.semantic === undefined && atom.divergences["data-loss"] === undefined && atom.divergences.unknown === undefined;
      intentResults.push({ intent, equivalent, selectionCompared: false, classification: equivalent ? undefined : "semantic", hash: hash([atom.scenarios, index]) });
    });
    // The full 1,000-case list corpus remains a Node/Vitest gate (the same
    // seed is recorded in the report).  The browser route runs a bounded
    // browser smoke corpus so one main-thread replay cannot starve Playwright
    // or hide the per-browser command results below.
    const listCorpus = runDualEngineListShadowCorpus(5);
    runNamedListIntentCorpus().forEach((comparison) => intentResults.push(comparison));
    setResult({ browserReady: true, comparableIntents: intentResults.length, intentResults, listCorpus: { scenarios: listCorpus.scenarios, equivalent: listCorpus.equivalent, divergences: { ...listCorpus.divergences } }, atomCorpus: { scenarios: atom.scenarios, equivalent: atom.equivalent, divergences: { ...atom.divergences } } });
  }, []);
  useEffect(() => {
    if (result) (window as Window & { __smartGate13Replay?: Gate13Result }).__smartGate13Replay = result;
  }, [result]);
  return <pre data-gate13-replay="true">{result ? JSON.stringify(result) : "running"}</pre>;
}
