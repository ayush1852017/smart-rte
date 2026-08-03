import {
  foundationSchema,
  applyOperations,
  createMarkNormalizer,
  isTextNode,
  normalizedStructureWithoutIds,
  parseCanonicalListHtml,
  runNormalization,
} from "smartrte-core";
import { executeCanonicalInlineTool, type CanonicalInlineToolId } from "../adapters/canonicalInlineCommandBridge.js";
import { runLegacyInlineTool, type LegacyInlineToolId } from "./legacyInlineEngine.js";

export type InlineShadowDivergence =
  | "expected-normalization" | "equivalent-serialization" | "selection-only"
  | "visual-only" | "semantic" | "data-loss" | "unknown";

export interface InlineShadowComparison {
  readonly equivalent: boolean;
  readonly structuralHash: string;
  readonly legacyHash: string;
  readonly canonicalHash: string;
  readonly classification?: InlineShadowDivergence;
  readonly selectionEquivalent: boolean;
}

const hash = (input: string) => {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) value = Math.imul(value ^ input.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16).padStart(8, "0");
};

const legacyId = (tool: CanonicalInlineToolId): LegacyInlineToolId =>
  tool === "strikethrough" ? "strike" : tool === "inlineCode" ? "code" : tool;

const inputs = (tool: CanonicalInlineToolId) => {
  if (tool === "textColor") return { legacy: "#ff0000", canonical: { value: "#ff0000" } };
  if (tool === "backgroundColor") return { legacy: "#ffff00", canonical: { value: "#ffff00" } };
  if (tool === "fontSize") return { legacy: 16, canonical: { valuePx: 16 } };
  if (tool === "fontFamily") return { legacy: "Inter", canonical: { value: "Inter" } };
  if (tool === "link") return { legacy: { href: "https://example.com" }, canonical: { href: "https://example.com" } };
  return { legacy: undefined, canonical: undefined };
};

const textPoint = (root: HTMLElement, requested: number) => {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = requested;
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (remaining <= current.data.length) return { node: current, offset: remaining };
    remaining -= current.data.length;
    current = walker.nextNode() as Text | null;
  }
  return { node: root, offset: root.childNodes.length };
};

const selectOffsets = (root: HTMLElement, anchor: number, head: number) => {
  const left = textPoint(root, anchor);
  const right = textPoint(root, head);
  root.ownerDocument.getSelection()?.setBaseAndExtent(left.node, left.offset, right.node, right.offset);
};

const globalOffset = (root: HTMLElement, node: Node | null, offset: number) => {
  if (!node) return -1;
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  try { range.setEnd(node, offset); } catch { return -1; }
  return range.toString().length;
};

const normalized = (html: string) => {
  const parsed = parseCanonicalListHtml(html);
  const run = runNormalization({
    document: parsed,
    originatingOperations: [{ type: "insertText", pos: { path: [0], offset: 0 }, text: "" }],
    schema: foundationSchema,
    normalizers: [createMarkNormalizer()],
  });
  return JSON.stringify(normalizedStructureWithoutIds(applyOperations(parsed, run.operations), foundationSchema));
};

const boundaryAffinityDifference = (html: string, offset: number, tool: CanonicalInlineToolId) => {
  const markType = tool === "strikethrough" ? "strike" : tool === "inlineCode" ? "code" : tool;
  const owner = parseCanonicalListHtml(html).children[0];
  if (!owner || isTextNode(owner)) return false;
  let cursor = 0;
  for (let index = 0; index < (owner.children || []).length - 1; index += 1) {
    const left = owner.children![index];
    cursor += isTextNode(left) ? left.text.length : 1;
    const right = owner.children![index + 1];
    if (cursor === offset && isTextNode(left) && isTextNode(right)) {
      return !left.marks?.some((mark) => mark.type === markType) && Boolean(right.marks?.some((mark) => mark.type === markType));
    }
  }
  return false;
};

/**
 * Test-only dual-engine comparator. Equivalence is normalized document
 * structure with IDs stripped plus semantic selection offsets. Operation
 * streams are deliberately not compared because the engines legitimately use
 * different operation vocabularies and legacy has no stable IDs.
 */
export const compareLegacyCanonicalInline = (args: {
  readonly html: string;
  readonly tool: CanonicalInlineToolId;
  readonly anchor: number;
  readonly head: number;
}): InlineShadowComparison => {
  const ownerDocument = document;
  const legacyRoot = ownerDocument.createElement("div");
  const canonicalRoot = ownerDocument.createElement("div");
  legacyRoot.innerHTML = args.html;
  canonicalRoot.innerHTML = args.html;
  ownerDocument.body.append(legacyRoot, canonicalRoot);
  const input = inputs(args.tool);

  selectOffsets(legacyRoot, args.anchor, args.head);
  const legacy = runLegacyInlineTool(legacyRoot, legacyId(args.tool), input.legacy);
  if (!legacy) throw new Error(`Legacy inline tool "${args.tool}" was not enabled for the corpus case.`);

  selectOffsets(canonicalRoot, args.anchor, args.head);
  const toggled = ["bold", "italic", "underline", "strikethrough", "inlineCode", "superscript", "subscript"].includes(args.tool);
  executeCanonicalInlineTool(canonicalRoot, args.tool, toggled ? "toggle" : "apply", input.canonical);
  const native = ownerDocument.getSelection();
  const selectionEquivalent = Boolean(native?.anchorNode && native.focusNode)
    && args.anchor === globalOffset(canonicalRoot, native?.anchorNode || null, native?.anchorOffset || 0)
    && args.head === globalOffset(canonicalRoot, native?.focusNode || null, native?.focusOffset || 0);
  const legacyStructure = normalized(legacy.html);
  const canonicalStructure = normalized(canonicalRoot.innerHTML);
  const equivalent = legacyStructure === canonicalStructure && selectionEquivalent;
  const boundaryDifference = !equivalent && boundaryAffinityDifference(args.html, Math.min(args.anchor, args.head), args.tool);
  const canonicalAttributeDifference = !equivalent && ["textColor", "backgroundColor", "fontSize", "fontFamily", "link"].includes(args.tool);
  const output = {
    equivalent,
    structuralHash: hash(`${legacyStructure}:${canonicalStructure}`),
    legacyHash: hash(legacyStructure),
    canonicalHash: hash(canonicalStructure),
    selectionEquivalent,
    ...(!equivalent ? { classification: legacyStructure === canonicalStructure ? "selection-only" as const
      : boundaryDifference || canonicalAttributeDifference ? "expected-normalization" as const : "semantic" as const } : {}),
  };
  legacyRoot.remove();
  canonicalRoot.remove();
  return output;
};

export const runInlineShadowCorpus = (scenarios = 1_000, initialSeed = 0x1A4F2026) => {
  let seed = initialSeed >>> 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const fixtures = [
    "<p>plain formatting fixture</p>",
    "<p><strong>bold</strong> and plain text</p>",
    "<p><em>italic</em> and <u>underlined</u></p>",
    "<p><a href=\"https://old.example\">linked text</a> after</p>",
    "<p><span style=\"color:#0000ff\">colored text</span> after</p>",
  ];
  const tools = ["bold", "italic", "underline", "strikethrough", "inlineCode", "superscript", "subscript", "textColor", "backgroundColor", "fontSize", "fontFamily", "link"] as const;
  const divergences: Partial<Record<InlineShadowDivergence, number>> = {};
  const logs: Array<{ structuralHash: string; classification: InlineShadowDivergence }> = [];
  let equivalent = 0;
  for (let run = 0; run < scenarios; run += 1) {
    const fixture = fixtures[Math.floor(random() * fixtures.length)];
    const text = fixture.replace(/<[^>]+>/g, "");
    const from = Math.floor(random() * Math.max(1, text.length - 1));
    const to = from + 1 + Math.floor(random() * Math.max(1, text.length - from - 1));
    const comparison = compareLegacyCanonicalInline({ html: fixture, tool: tools[run % tools.length], anchor: from, head: Math.min(text.length, to) });
    if (comparison.equivalent) equivalent += 1;
    else {
      const classification = comparison.classification || "unknown";
      divergences[classification] = (divergences[classification] || 0) + 1;
      logs.push({ structuralHash: comparison.structuralHash, classification });
    }
  }
  return { scenarios, seed: initialSeed >>> 0, equivalent, divergences, logs };
};
