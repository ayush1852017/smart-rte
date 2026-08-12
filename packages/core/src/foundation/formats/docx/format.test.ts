import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { SmartDocument } from "../../types.js";
import { exportDocxDocument, smartDocumentToDocxXml } from "./export.js";
import { importDocxDocumentWithMammoth } from "./import.js";
import { importStyledDocxDocument } from "./styledImport.js";

const blobArrayBuffer = (blob: Blob) => blob.arrayBuffer();

describe("canonical DOCX format codec", () => {
  const onePixelPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  const documentModel: SmartDocument = {
    type: "doc", id: "doc",
    children: [
      { type: "heading", id: "h1", attrs: { level: 2, align: "center" }, children: [{ type: "text", text: "Title", marks: [{ type: "bold" }] }] },
      { type: "paragraph", id: "p1", children: [
        { type: "text", text: "Equation " },
        { type: "formula", id: "f1", attrs: { source: "x^2", notation: "latex" } },
        { type: "image", id: "img1", attrs: { src: "https://example.com/a.png", alt: "diagram" } },
        { type: "text", text: " linked", marks: [{ type: "link", attrs: { href: "https://example.com/docs", target: "_blank" } }] },
      ] },
      { type: "list", id: "l1", attrs: { style: "lower-alpha" }, children: [
        { type: "list_item", id: "li1", children: [
          { type: "paragraph", id: "p2", children: [{ type: "text", text: "Parent" }] },
          { type: "list", id: "l2", attrs: { style: "disc" }, children: [
            { type: "list_item", id: "li2", children: [
              { type: "paragraph", id: "p3", children: [{ type: "text", text: "Child" }] },
            ] },
          ] },
        ] },
      ] },
      { type: "table", id: "t1", attrs: { columnWidths: [90, 180] }, children: [
        { type: "table_row", id: "r1", attrs: { height: 48 }, children: [
          { type: "table_cell", id: "c1", attrs: { colspan: 2, rowspan: 2, header: true, background: "rgb(18, 52, 86)", borders: "none" },
            children: [{ type: "paragraph", id: "p4", children: [{ type: "text", text: "Cell" }] }] },
        ] },
        { type: "table_row", id: "r2", children: [] },
      ] },
    ],
  };

  it("serializes canonical structure and portable atoms to WordprocessingML", () => {
    const xml = smartDocumentToDocxXml(documentModel);
    expect(xml).toContain('w:pStyle w:val="Heading2"');
    expect(xml).toContain('w:jc w:val="center"');
    expect(xml).toContain("⟦SRTE_FORMULA:");
    expect(xml).toContain("<m:oMath><m:r><m:t>x^2</m:t></m:r></m:oMath>");
    expect(xml).toContain("<w:vanish/>");
    expect(xml).toContain("⟦SRTE_IMAGE:");
    expect(xml).toContain('<w:hyperlink r:id="rId2" w:history="1">');
    expect(xml).toContain('<w:ilvl w:val="0"/><w:numId w:val="5"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/><w:numId w:val="1"/>');
    expect(xml).not.toContain("a. Parent");
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:gridCol w:w="1350"/>');
    expect(xml).toContain('<w:gridCol w:w="2700"/>');
    expect(xml).toContain('<w:trHeight w:val="720" w:hRule="atLeast"/>');
    expect(xml).toContain("<w:tblHeader/>");
    expect(xml).toContain('<w:vMerge w:val="restart"/>');
    expect(xml).toContain("<w:vMerge/>");
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="123456"/>');
    expect(xml).toContain('<w:top w:val="nil"/>');
  });

  it("creates a valid DOCX package around the canonical document", async () => {
    const blob = await exportDocxDocument(documentModel);
    const buffer = await blobArrayBuffer(blob);
    const zip = await JSZip.loadAsync(buffer);
    expect(await zip.file("word/document.xml")?.async("text")).toContain("<w:document");
    expect(await zip.file("word/numbering.xml")?.async("text")).toContain('<w:numFmt w:val="lowerLetter"/>');
    expect(await zip.file("word/numbering.xml")?.async("text")).toContain('<w:lvl w:ilvl="8">');
    const relationships = await zip.file("word/_rels/document.xml.rels")?.async("text");
    expect(relationships).toContain('relationships/numbering" Target="numbering.xml"');
    expect(relationships).toContain('relationships/hyperlink" Target="https://example.com/docs" TargetMode="External"');
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("_rels/.rels")).toBeTruthy();
  });

  it("round-trips native lists and hyperlinks through the DOCX importer", async () => {
    const blob = await exportDocxDocument({
      type: "doc", id: "doc",
      children: [{
        type: "list", id: "l1", attrs: { style: "decimal" },
        children: [{
          type: "list_item", id: "li1",
          children: [
            { type: "paragraph", id: "p1", children: [{ type: "text", text: "Linked item", marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }] }] },
            { type: "list", id: "l2", attrs: { style: "disc" }, children: [{
              type: "list_item", id: "li2",
              children: [{ type: "paragraph", id: "p2", children: [{ type: "text", text: "Nested item" }] }],
            }] },
          ],
        }],
      }],
    });
    const imported = await importDocxDocumentWithMammoth(await blobArrayBuffer(blob));
    expect(imported.children[0]).toMatchObject({
      type: "list",
      attrs: { style: "decimal" },
      children: [{
        type: "list_item",
        children: [
          { type: "paragraph", children: [{ type: "text", text: "Linked item", marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }] }] },
          { type: "list", children: [{ type: "list_item", children: [{ type: "paragraph", children: [{ type: "text", text: "Nested item" }] }] }] },
        ],
      }],
    });
  });

  it("embeds data images as native DOCX media and round-trips their semantics", async () => {
    const blob = await exportDocxDocument({
      type: "doc", id: "doc",
      children: [{
        type: "paragraph", id: "p1",
        children: [{ type: "image", id: "img1", attrs: { src: onePixelPng, alt: "pixel", title: "One pixel", width: 32, height: 24 } }],
      }],
    });
    const buffer = await blobArrayBuffer(blob);
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    const relationships = await zip.file("word/_rels/document.xml.rels")?.async("text");
    expect(documentXml).toContain('<wp:extent cx="304800" cy="228600"/>');
    expect(documentXml).toContain('descr="pixel"');
    expect(documentXml).toContain('<a:blip r:embed="rId2"/>');
    expect(documentXml).not.toContain("⟦SRTE_IMAGE:");
    expect(relationships).toContain('relationships/image" Target="media/image1.png"');
    expect(zip.file("word/media/image1.png")).toBeTruthy();
    expect(await zip.file("word/media/image1.png")?.async("base64")).toBe(onePixelPng.split(",")[1]);
    expect(await zip.file("[Content_Types].xml")?.async("text")).toContain('<Default Extension="png" ContentType="image/png"/>');

    const imported = await importDocxDocumentWithMammoth(buffer);
    expect(imported.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "image", attrs: { alt: "pixel" } }] });
    expect((imported.children[0] as { children: Array<{ attrs?: { src?: string } }> }).children[0].attrs?.src)
      .toMatch(/^data:image\/png;base64,/);
  });

  it("emits native OMML while preserving canonical formula source on import", async () => {
    const blob = await exportDocxDocument({
      type: "doc", id: "doc",
      children: [{
        type: "paragraph", id: "p1",
        children: [{ type: "formula", id: "f1", attrs: { source: String.raw`\frac{a}{b}`, notation: "latex", displayText: "a over b" } }],
      }],
    });
    const buffer = await blobArrayBuffer(blob);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")?.async("text");
    expect(xml).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:t>\\frac{a}{b}</m:t>");

    // displayText doesn't survive: canonical's own native HTML round-trip
    // never preserves it either (atomToHtml doesn't write it), so this
    // isn't a DOCX-specific gap - only source/notation round-trip.
    const imported = await importDocxDocumentWithMammoth(buffer);
    const paragraph = imported.children[0] as { children: Array<{ type: string; attrs?: { source?: string } }> };
    expect(paragraph.children[0]).toMatchObject({ type: "formula", attrs: { source: String.raw`\frac{a}{b}` } });
  });

  it("prefers styled wordprocessingml reconstruction over the plain mammoth path", async () => {
    const blob = await exportDocxDocument({
      type: "doc", id: "doc",
      children: [{ type: "paragraph", id: "p1", attrs: { align: "center" }, children: [{ type: "text", text: "Styled", marks: [{ type: "bold" }] }] }],
    });
    const styled = await importStyledDocxDocument(await blobArrayBuffer(blob));
    expect(styled.source).toBe("wordprocessingml");
    expect(styled.layoutHtml).toContain("text-align: center");
    expect(styled.document.children[0]).toMatchObject({ type: "paragraph" });
  });

  it("falls back to mammoth when word/document.xml yields no usable content", async () => {
    const blob = await exportDocxDocument({ type: "doc", id: "doc", children: [] });
    const zip = await JSZip.loadAsync(await blobArrayBuffer(blob));
    // An empty <w:body> (no paragraphs/tables) leaves rawHtml blank, which
    // should trigger the mammoth fallback rather than returning an empty document.
    zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sectPr/></w:body></w:document>');
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const fallback = await importStyledDocxDocument(buffer);
    expect(fallback.source).toBe("mammoth");
  });
});
