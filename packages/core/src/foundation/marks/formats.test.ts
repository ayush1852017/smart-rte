import { describe, expect, it } from "vitest";
import {
  MARKDOWN_UNSUPPORTED_MARKS,
  canonicalMarksPdfText,
  canonicalMarksToDocxRuns,
  normalizedStructureWithoutIds,
  parseCanonicalListHtml,
  parseCanonicalListMarkdown,
  serializeCanonicalListHtml,
  serializeCanonicalListMarkdown,
  foundationSchema,
  type SmartDocument,
  type SmartMark,
} from "../index.js";

const allMarks: SmartMark[] = [
  { type: "bold" }, { type: "italic" }, { type: "underline" }, { type: "strike" }, { type: "code" },
  { type: "superscript" }, { type: "textColor", attrs: { value: "#ff0000" } },
  { type: "backgroundColor", attrs: { value: "#0000ff" } }, { type: "fontSize", attrs: { valuePx: 16 } },
  { type: "fontFamily", attrs: { value: "open sans" } }, { type: "link", attrs: { href: "https://example.com", target: "_blank" } },
];

const documentWith = (marks: SmartMark[]): SmartDocument => ({ type: "doc", id: "doc", children: [{
  type: "paragraph", id: "p", children: [
    { type: "text", text: "formatted", marks },
    { type: "hard_break", id: "br" },
    { type: "text", text: "tail", marks: [{ type: "subscript" }] },
  ],
}] });

describe("Phase 4 mark format fidelity", () => {
  it("round-trips all twelve marks and hard_break through full HTML", () => {
    const source = documentWith(allMarks);
    const html = serializeCanonicalListHtml(source);
    expect(html).toContain("<strong>");
    expect(html).toContain("<a href=\"https://example.com\" target=\"_blank\">");
    expect(html).toContain("font-size:16px");
    expect(html).toContain("data-smart-type=\"hard_break\"");
    const parsed = parseCanonicalListHtml(html);
    expect(normalizedStructureWithoutIds(parsed, foundationSchema)).toEqual(normalizedStructureWithoutIds(source, foundationSchema));
  });

  it("keeps Markdown-supported semantics and degrades unsupported formatting without losing text", () => {
    const source = documentWith(allMarks);
    const markdown = serializeCanonicalListMarkdown(source);
    expect(markdown).toContain("**");
    expect(markdown).toContain("~~");
    expect(markdown).toContain("https://example.com");
    const parsed = parseCanonicalListMarkdown(markdown);
    const text = canonicalMarksPdfText(parsed);
    expect(text).toContain("formatted");
    expect(text).toContain("tail");
    expect(MARKDOWN_UNSUPPORTED_MARKS).toEqual(expect.arrayContaining(["textColor", "fontSize", "fontFamily", "superscript", "subscript"]));
  });

  it("maps all marks to semantic DOCX run properties and declares PDF text-only", () => {
    const source = documentWith(allMarks);
    expect(canonicalMarksToDocxRuns(source)[0]).toEqual({
      text: "formatted",
      properties: {
        backgroundColor: "#0000ff", bold: true, code: true, color: "#ff0000", fontFamily: "open sans",
        fontSizeHalfPoints: 24, italic: true, link: { href: "https://example.com", target: "_blank" },
        strike: true, superscript: true, underline: true,
      },
    });
    expect(canonicalMarksPdfText(source)).toBe("formatted\ntail");
    expect(canonicalMarksPdfText(source)).not.toContain("#ff0000");
  });
});
