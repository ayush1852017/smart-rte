import { describe, expect, it } from "vitest";
import type { SmartDocument } from "../types.js";
import {
  canonicalBlocksPdfText,
  canonicalBlocksToDocx,
  parseCanonicalBlockHtml,
  parseCanonicalBlockMarkdown,
  serializeCanonicalBlockHtml,
  serializeCanonicalBlockMarkdown,
} from "./formats.js";

const fixture: SmartDocument = { type: "doc", id: "doc", children: [
  { type: "heading", id: "h", attrs: { level: 2, align: "center", indentLevel: 1 }, children: [{ type: "text", text: "Title", marks: [{ type: "bold" }] }] },
  { type: "blockquote", id: "q", children: [
    { type: "paragraph", id: "qp", children: [{ type: "text", text: "Quoted" }] },
  ] },
  { type: "code_block", id: "c", attrs: { language: "ts", align: "left" }, children: [{ type: "text", text: "const x = 1;\n" }] },
] };

describe("Phase 5 block format fidelity", () => {
  it("round-trips HTML with hierarchy, language, alignment, and indentation", () => {
    const html = serializeCanonicalBlockHtml(fixture);
    expect(html).toContain('<h2 data-smart-id="h" data-smart-align="center" data-smart-indent="1"');
    expect(html).toContain('<blockquote data-smart-id="q"><p data-smart-id="qp">Quoted</p></blockquote>');
    expect(html).toContain('<pre data-smart-id="c" data-smart-align="left"');
    expect(html).toContain('<code class="language-ts">const x = 1;');
    expect(parseCanonicalBlockHtml(html)).toEqual(fixture);
  });

  it("round-trips Markdown semantically while dropping unsupported align/indent non-destructively", () => {
    const markdown = serializeCanonicalBlockMarkdown(fixture);
    expect(markdown).toContain("## **Title**");
    expect(markdown).toContain("> Quoted");
    expect(markdown).toContain("```ts\nconst x = 1;\n\n```");
    const parsed = parseCanonicalBlockMarkdown(markdown);
    expect(parsed.children).toMatchObject([
      { type: "heading", attrs: { level: 2 }, children: [{ text: "Title", marks: [{ type: "bold" }] }] },
      { type: "blockquote", children: [{ type: "paragraph", children: [{ text: "Quoted" }] }] },
      { type: "code_block", attrs: { language: "ts" }, children: [{ text: "const x = 1;\n" }] },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("align");
    expect(JSON.stringify(parsed)).not.toContain("indentLevel");
  });

  it("maps DOCX heading/quote/alignment/indent semantically and provides a visual PDF projection", () => {
    expect(canonicalBlocksToDocx(fixture)).toEqual([
      { nodeId: "h", kind: "heading", text: "Title", style: "Heading2", outlineLevel: 1, alignment: "center", indentTwips: 720 },
      { nodeId: "qp", kind: "paragraph", text: "Quoted", style: "Quote", quoteDepth: 1 },
      { nodeId: "c", kind: "code", text: "const x = 1;\n", style: "Code", alignment: "left", language: "ts" },
    ]);
    expect(canonicalBlocksPdfText(fixture)).toBe("## Title\n> Quoted\nconst x = 1;\n");
  });
});
