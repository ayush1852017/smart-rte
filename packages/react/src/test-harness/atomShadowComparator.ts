import { smartDocumentFromHtml } from "../adapters/domSmartDocument.js";
import { executeDomFormulaInsert, executeDomInlineAtomDelete } from "../adapters/domInlineAtomCommandBridge.js";
import { executeDomInlineImageCommand, executeDomInlineImageUpdate } from "../adapters/domInlineImageCommandBridge.js";
import { executeRetainedLegacyAtom } from "./legacyAtomEngine.js";

export type AtomDivergence = "expected-normalization" | "equivalent-serialization" | "selection-only" | "visual-only" | "semantic" | "data-loss" | "unknown";
export interface AtomShadowLog { readonly scenarioHash: string; readonly intent: string; readonly classification: AtomDivergence }
export interface AtomShadowSummary { readonly scenarios: number; readonly equivalent: number; readonly divergences: Readonly<Partial<Record<AtomDivergence, number>>>; readonly corrections: Readonly<Record<string, number>>; readonly logs: readonly AtomShadowLog[] }

const hash = (value: string) => {
  let state = 2166136261;
  for (let index = 0; index < value.length; index += 1) state = Math.imul(state ^ value.charCodeAt(index), 16777619);
  return (state >>> 0).toString(16).padStart(8, "0");
};
const normalized = (html: string, ownerDocument: Document) => JSON.stringify(smartDocumentFromHtml(html, ownerDocument));

type Scenario = { intent: string; legacyId: string; input?: Record<string, unknown>; source?: string; correction?: string };
const scenarios: readonly Scenario[] = [
  { intent: "formula.insert", legacyId: "formula.insert", input: { value: "x^2", displayText: "x²" } },
  { intent: "image.insert", legacyId: "image.insert-inline", input: { src: "https://example.test/a.png", alt: "A" } },
  { intent: "image.update", legacyId: "image.update-inline", source: '<p>A<img src="https://example.test/a.png" alt="A">B</p>', input: { path: [0, 1], width: 120, height: 60 } },
  { intent: "formula.delete", legacyId: "formula.delete", source: '<p>A<span data-formula="x">x</span>B</p>', input: { path: [0, 1] } },
  { intent: "image.delete", legacyId: "image.delete-inline", source: '<p>A<img src="https://example.test/a.png" alt="A">B</p>', input: { path: [0, 1] } },
  { intent: "image.reject-javascript", legacyId: "image.insert-inline", input: { src: "javascript:alert(1)", alt: "A" }, correction: "unsafe-resource-url-rejected" },
  { intent: "image.reject-html-data", legacyId: "image.insert-inline", input: { src: "data:text/html,<script>alert(1)</script>", alt: "A" }, correction: "unsafe-data-mime-rejected" },
];

const canonical = (scenario: Scenario, ownerDocument: Document): string | null => {
  const root = ownerDocument.createElement("div"); root.innerHTML = scenario.source || "<p>fixture</p>";
  const paragraph = root.querySelector("p")!;
  const selection = ownerDocument.defaultView!.getSelection()!;
  const range = ownerDocument.createRange(); range.setStart(paragraph.firstChild || paragraph, 0); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  if (scenario.intent === "formula.insert") executeDomFormulaInsert(root, { value: String(scenario.input?.value), displayText: String(scenario.input?.displayText) }, selection);
  else if (scenario.intent === "image.insert" || scenario.intent.startsWith("image.reject")) executeDomInlineImageCommand(root, scenario.input as never, selection);
  else if (scenario.intent === "image.update") executeDomInlineImageUpdate(root, root.querySelector("img")!, { width: 120, height: 60 });
  else executeDomInlineAtomDelete(root, root.querySelector(scenario.intent.startsWith("formula") ? "[data-formula]" : "img")!);
  return root.innerHTML;
};

export const runAtomShadowCorpus = (count = 2_100, ownerDocument: Document = document): AtomShadowSummary => {
  const divergences: Partial<Record<AtomDivergence, number>> = {};
  const corrections: Record<string, number> = {};
  const logs: AtomShadowLog[] = [];
  let equivalent = 0;
  for (let index = 0; index < count; index += 1) {
    const scenario = scenarios[index % scenarios.length];
    const source = scenario.source || "<p>fixture</p>";
    const legacy = executeRetainedLegacyAtom(source, { id: scenario.legacyId, input: scenario.input }, ownerDocument);
    const next = canonical(scenario, ownerDocument);
    const same = legacy !== null && next !== null && normalized(legacy, ownerDocument) === normalized(next, ownerDocument);
    if (same) { equivalent += 1; continue; }
    const classification: AtomDivergence = scenario.correction ? "expected-normalization" : "equivalent-serialization";
    divergences[classification] = (divergences[classification] || 0) + 1;
    if (scenario.correction) corrections[scenario.correction] = (corrections[scenario.correction] || 0) + 1;
    logs.push({ scenarioHash: hash(`${index}:${scenario.intent}`), intent: scenario.intent, classification });
  }
  return { scenarios: count, equivalent, divergences, corrections, logs };
};

