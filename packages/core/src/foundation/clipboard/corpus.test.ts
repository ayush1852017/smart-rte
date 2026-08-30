// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTextNode } from "../identity.js";
import { validate } from "../schema.js";
import { foundationSchema } from "../schema.js";
import { normalizedStructureWithoutIds } from "../list/shadow.js";
import type { SmartNode } from "../types.js";
import { detectClipboardSource } from "./detection.js";
import { ClipboardPayloadTooLargeError, estimateClipboardPayloadBytes, parseClipboardPayload } from "./pipeline.js";
import type { ClipboardSource, RawClipboardPayload } from "./types.js";

interface CapturedFixture {
  source: string;
  types: string[];
  representations: Record<string, string>;
}

const fixtures = [
  ["word-macos-clipboard.clipboard.json", "word"],
  ["google-docs-clipboard.clipboard.json", "google-docs"],
  ["google-sheets-clipboard.clipboard.json", "spreadsheet"],
  ["excel-clipboard.clipboard.json", "spreadsheet"],
  ["markdown-plain-text-clipboard.clipboard.json", "markdown"],
  // Current product copy has no native MIME yet and retains Office markers from
  // its DOM-authoritative HTML, so the honest detected source is Word.
  ["native-smart-rte-clipboard.clipboard.json", "word"],
  ["plain-text-clipboard.clipboard.json", "plain-text"],
  ["generic-web-clipboard.clipboard.json", "plain-text"],
] as const satisfies readonly (readonly [string, ClipboardSource])[];
// google-docs and native-smart-rte updated 2026-08-19: parseCanonicalListHtml
// (list/formats.ts) now recognizes style-based font-weight:bold/bolder,
// font-style:italic/oblique, and text-decoration:underline/line-through as
// real marks instead of silently dropping them (found via the
// [Unsupported: span] investigation - see docs/bugs/
// html-import-span-and-div-wrapped-content-lost.md). Both captures contain
// genuine style-only bold runs (google-docs: one real font-weight:700 run
// among many font-weight:400 runs; native-smart-rte: font-weight:bold on
// browser-DOM-captured copy output) that were previously pasted as
// unstyled plain text - the hash changes reflect those runs now correctly
// carrying a bold mark, verified by inspecting the fixtures' raw HTML
// directly, not assumed from the hash diff alone.
//
// excel updated 2026-08-19 (docs/bugs/table-shrinks-after-paste.md):
// <col>'s width parsing now only trusts a bare number or an explicit
// "Npx" value, rejecting other CSS units instead of misreading them as
// pixels via a bare parseFloat. This fixture's own <col> elements
// (inspected directly) carry both a real pixel `width` attribute (e.g.
// width="19") and a `style="width:14pt"` - 14 *points*, not 14 pixels
// (14pt ~= 18.67px, consistent with the 19px attribute). The old code
// checked style first and read "14pt" as "14", a ~25% understatement;
// the new code correctly rejects the non-px style value and falls back
// to the genuinely-pixel attribute value instead.
// word-macos/google-docs/google-sheets hashes changed once table_cell gained
// per-side border attrs (borderTop/Right/Bottom/Left, for the border-options
// UI's "which sides" control - docs/bugs/table-cell-border-color-width-no-ui.md's
// addendum). All three fixtures express cell borders as separate
// `border-top`/`border-right`/`border-bottom`/`border-left` CSS declarations
// (confirmed by inspecting their captured HTML directly), not the uniform
// `border` shorthand the old parser only ever recognized - previously this
// meant paste from Word/Google Docs/Google Sheets silently dropped ALL cell
// border styling; it's now correctly captured. A genuine fidelity
// improvement, not a regression - hashes updated to match.
const expectedCanonicalHashes: Record<string, string> = {
  "word-macos-clipboard.clipboard.json": "22d879f1",
  "google-docs-clipboard.clipboard.json": "bf053d8d",
  "google-sheets-clipboard.clipboard.json": "ea5704d2",
  "excel-clipboard.clipboard.json": "78a735fa",
  "markdown-plain-text-clipboard.clipboard.json": "fbe7bef8",
  "native-smart-rte-clipboard.clipboard.json": "3f38366d",
  "plain-text-clipboard.clipboard.json": "338a8736",
  "generic-web-clipboard.clipboard.json": "0c01e672",
};

const load = (name: string): CapturedFixture => JSON.parse(readFileSync(`src/foundation/clipboard/fixtures/captured/p0/${name}`, "utf8")) as CapturedFixture;
const payloadOf = (fixture: CapturedFixture): RawClipboardPayload => ({
  html: fixture.representations["text/html"],
  plainText: fixture.representations["text/plain"],
  native: fixture.representations["application/x-smart-rte+json"],
  types: fixture.types,
  representations: fixture.representations,
});
const count = (node: SmartNode, type: string): number => isTextNode(node) ? 0
  : (node.type === type ? 1 : 0) + (node.children || []).reduce((total, child) => total + count(child, type), 0);
const hasSpan = (node: SmartNode): boolean => isTextNode(node) ? false
  : (Number(node.attrs?.rowspan) > 1 || Number(node.attrs?.colspan) > 1) || (node.children || []).some(hasSpan);
const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16).padStart(8, "0");
};

describe("captured Phase 8a corpus", () => {
  it.each(fixtures)("detects and parses real capture %s", (name, expectedSource) => {
    const fixture = load(name);
    const payload = payloadOf(fixture);
    expect(detectClipboardSource(payload).source).toBe(expectedSource);
    const fragment = parseClipboardPayload(payload, { ownerDocument: document });
    expect(validate(fragment.document)).toEqual([]);
    expect(fragment.document.children.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(fragment.document);
    const firstWord = (payload.plainText || "").match(/[A-Za-z]{4,}/)?.[0];
    if (firstWord) expect(serialized).toContain(firstWord);
    expect(serialized).not.toMatch(/<script|onerror\s*=|javascript:/i);
    expect(hash(JSON.stringify(normalizedStructureWithoutIds(fragment.document, foundationSchema)))).toBe(expectedCanonicalHashes[name]);
  });

  it("preserves the captured list and table structures on detected paths", () => {
    const word = parseClipboardPayload(payloadOf(load("word-macos-clipboard.clipboard.json")), { ownerDocument: document }).document;
    const docs = parseClipboardPayload(payloadOf(load("google-docs-clipboard.clipboard.json")), { ownerDocument: document }).document;
    const excel = parseClipboardPayload(payloadOf(load("excel-clipboard.clipboard.json")), { ownerDocument: document }).document;
    const sheets = parseClipboardPayload(payloadOf(load("google-sheets-clipboard.clipboard.json")), { ownerDocument: document }).document;
    expect(count(word, "list")).toBeGreaterThanOrEqual(3);
    expect(count(docs, "list")).toBeGreaterThanOrEqual(3);
    expect(count(word, "table")).toBe(1);
    expect(count(docs, "table")).toBe(1);
    expect(count(excel, "table")).toBe(1);
    expect(count(sheets, "table")).toBe(1);
    expect([word, docs, excel, sheets].some(hasSpan)).toBe(true);
  });

  it.each(fixtures)("keeps real capture %s non-destructive through the generic path", (name) => {
    const payload = payloadOf(load(name));
    const fragment = parseClipboardPayload(payload, { ownerDocument: document, normalizerMode: "generic" });
    expect(validate(fragment.document)).toEqual([]);
    const serialized = JSON.stringify(fragment.document);
    const firstWord = (payload.plainText || "").match(/[A-Za-z]{4,}/)?.[0];
    if (firstWord) expect(serialized).toContain(firstWord);
  });

  it("accepts 10x the largest captured P0 payload and enforces a configured threshold above it", () => {
    const captured = fixtures.map(([name]) => load(name));
    const largest = captured.reduce((left, right) => {
      const bytes = (fixture: CapturedFixture) => Object.values(fixture.representations).reduce((sum, value) => sum + new TextEncoder().encode(value).byteLength, 0);
      return bytes(right) > bytes(left) ? right : left;
    });
    const representations = Object.fromEntries(Object.entries(largest.representations).map(([type, value]) => [type, value.repeat(10)]));
    const stress: RawClipboardPayload = {
      html: representations["text/html"], plainText: representations["text/plain"], types: largest.types, representations,
    };
    const bytes = estimateClipboardPayloadBytes(stress);
    expect(() => parseClipboardPayload(stress, { ownerDocument: document })).toThrow(ClipboardPayloadTooLargeError);
    const started = performance.now();
    expect(parseClipboardPayload(stress, { ownerDocument: document, maxBytes: bytes }).document.children.length).toBeGreaterThan(0);
    const elapsedMs = performance.now() - started;
    console.log(`Phase 8a 10x captured-payload parse: ${bytes} bytes in ${elapsedMs.toFixed(2)}ms`);
    expect(() => parseClipboardPayload(stress, { ownerDocument: document, maxBytes: bytes - 1 })).toThrow(ClipboardPayloadTooLargeError);
  });
});
