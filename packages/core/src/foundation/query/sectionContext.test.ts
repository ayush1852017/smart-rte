import { describe, expect, it } from "vitest";
import type { SmartDocument, SmartElementNode, SmartSelection } from "../types.js";
import { getSectionContext, listDocumentImages } from "./sectionContext.js";

const text = (value: string) => ({ type: "text" as const, text: value });
const p = (id: string, value: string): SmartElementNode => ({ type: "paragraph", id, children: [text(value)] });
const h = (id: string, level: number, value: string): SmartElementNode => ({ type: "heading", id, attrs: { level }, children: [text(value)] });
const at = (index: number): SmartSelection => ({ type: "text", anchor: { path: [index], offset: 0 }, head: { path: [index], offset: 0 } });

const document: SmartDocument = { type: "doc", id: "d", children: [
  p("intro", "Preamble"),
  h("h1", 1, "Chapter"),
  p("c1", "Chapter text"),
  h("h2a", 2, "Section A"),
  p("a1", "A text"),
  { type: "block_image", id: "img1", attrs: { src: "https://x.test/1.png", alt: "One", status: "ready", caption: "A figure", metadata: { "data-source": "kadal" } } },
  { type: "blockquote", id: "q", children: [{ type: "heading", id: "nested", attrs: { level: 1 }, children: [text("Nested heading")] }, p("q1", "Quoted")] },
  { type: "table", id: "t", children: [
    { type: "table_row", id: "r1", children: [
      { type: "table_cell", id: "c11", attrs: { rowspan: 1, colspan: 1, header: false }, children: [p("x", "R1C1")] },
      { type: "table_cell", id: "c12", attrs: { rowspan: 1, colspan: 1, header: false }, children: [p("y", "R1C2")] },
    ] },
    { type: "table_row", id: "r2", children: [
      { type: "table_cell", id: "c21", attrs: { rowspan: 1, colspan: 1, header: false }, children: [p("z", "R2C1")] },
      { type: "table_cell", id: "c22", attrs: { rowspan: 1, colspan: 1, header: false }, children: [{ type: "paragraph", id: "w", children: [text("R2"), { type: "image", id: "inline", attrs: { src: "https://x.test/i.png", alt: "Inline", status: "ready" } }, text("C2")] }] },
    ] },
  ] },
  { type: "block_image", id: "img2", attrs: { src: "https://x.test/2.png", alt: "Two", status: "ready" } },
  h("h2b", 2, "Section B"),
  p("b1", "B text"),
  h("h1b", 1, "Next chapter"),
] };

describe("getSectionContext", () => {
  it("returns the nearest heading above the cursor and text up to the next heading of the same or higher level", () => {
    expect(getSectionContext(document, at(4))).toEqual({
      heading: { id: "h2a", level: 2, text: "Section A" },
      text: "A text\n\n[Figure: A figure]\n\nNested heading\nQuoted\n\nR1C1\tR1C2\nR2C1\tR2C2",
      truncated: false,
    });
    // A heading-level-1 section spans its level-2 subsections.
    expect(getSectionContext(document, at(2)).text).toBe("Chapter text\n\nSection A\n\nA text\n\n[Figure: A figure]\n\nNested heading\nQuoted\n\nR1C1\tR1C2\nR2C1\tR2C2\n\nSection B\n\nB text");
    // The cursor on a heading belongs to that heading's section.
    expect(getSectionContext(document, at(9)).heading?.id).toBe("h2b");
  });

  it("ignores headings nested in blockquotes/lists/tables, handles no heading and no cursor", () => {
    expect(getSectionContext(document, at(6)).heading?.id).toBe("h2a");
    expect(getSectionContext(document, at(0))).toEqual({ heading: null, text: "Preamble", truncated: false });
    expect(getSectionContext(document, { type: "none", anchor: { path: [], offset: 0 }, head: { path: [], offset: 0 } }).heading).toBeNull();
    expect(getSectionContext(document, null).text).toBe("Preamble");
    expect(getSectionContext(document, at(99)).heading?.id).toBe("h1b");
  });

  it("truncates to maxChars", () => {
    expect(getSectionContext(document, at(4), { maxChars: 5 })).toMatchObject({ text: "A tex", truncated: true });
    expect(getSectionContext(document, at(10), { maxChars: 6 })).toMatchObject({ text: "B text", truncated: false });
  });
});

describe("listDocumentImages", () => {
  it("lists block and inline images in document order with captions and metadata", () => {
    expect(listDocumentImages(document)).toEqual([
      { nodeId: "img1", src: "https://x.test/1.png", alt: "One", caption: "A figure", metadata: { "data-source": "kadal" } },
      { nodeId: "inline", src: "https://x.test/i.png", alt: "Inline" },
      { nodeId: "img2", src: "https://x.test/2.png", alt: "Two" },
    ]);
  });
});
