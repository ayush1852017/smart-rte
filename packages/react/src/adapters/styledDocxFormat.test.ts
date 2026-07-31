// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importStyledDocxDocument } from "./styledDocxFormat.js";

describe("styled DOCX format adapter", () => {
  it("returns canonical content separately from Word layout HTML", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>Hello</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`);
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const result = await importStyledDocxDocument(buffer, document);
    expect(result.source).toBe("wordprocessingml");
    expect(result.document.children[0]).toMatchObject({ type: "paragraph", alignment: "center" });
    expect(result.layoutHtml).toContain("margin-bottom: 12pt");
    expect(result.layoutHtml).toContain("color: #FF0000");
    expect(result.layoutHtml).toContain("border:");
  });
});
