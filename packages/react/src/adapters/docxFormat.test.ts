// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocxDocument, importDocxDocumentWithMammoth, smartDocumentToDocxXml } from "./docxFormat.js";

const blobArrayBuffer = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(blob);
});

describe("DOCX format adapter", () => {
  const onePixelPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  const documentModel = {
    type: "doc" as const,
    children: [
      { type: "heading" as const, level: 2 as const, alignment: "center" as const, children: [{ type: "text" as const, text: "Title", marks: [{ type: "bold" as const }] }] },
      { type: "paragraph" as const, children: [
        { type: "text" as const, text: "Equation " },
        { type: "formula" as const, value: "x^2" },
        { type: "inlineImage" as const, src: "https://example.com/a.png", alt: "diagram" },
        { type: "text" as const, text: " linked", marks: [{ type: "link" as const, href: "https://example.com/docs", target: "_blank" }] },
      ] },
      { type: "list" as const, style: "lower-alpha" as const, children: [
        { type: "listItem" as const, children: [
          { type: "paragraph" as const, children: [{ type: "text" as const, text: "Parent" }] },
          { type: "list" as const, style: "disc" as const, children: [
            { type: "listItem" as const, children: [
              { type: "paragraph" as const, children: [{ type: "text" as const, text: "Child" }] },
            ] },
          ] },
        ] },
      ] },
      { type: "table" as const, columnWidths: [90, 180], children: [
        { type: "tableRow" as const, heightPx: 48, children: [
          {
            type: "tableHeaderCell" as const,
            colspan: 2,
            rowspan: 2,
            backgroundColor: "rgb(18, 52, 86)",
            border: "none",
            children: [{ type: "paragraph" as const, children: [{ type: "text" as const, text: "Cell" }] }],
          },
        ] },
        { type: "tableRow" as const, children: [] },
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
    expect(xml).toContain('<w:tblHeader/>');
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
      type: "doc",
      children: [
        {
          type: "list",
          style: "decimal",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{
                    type: "text",
                    text: "Linked item",
                    marks: [{ type: "link", href: "https://example.com/docs" }],
                  }],
                },
                {
                  type: "list",
                  style: "disc",
                  children: [{
                    type: "listItem",
                    children: [{
                      type: "paragraph",
                      children: [{ type: "text", text: "Nested item" }],
                    }],
                  }],
                },
              ],
            },
          ],
        },
      ],
    });
    const imported = await importDocxDocumentWithMammoth(await blobArrayBuffer(blob), document);
    expect(imported.children[0]).toMatchObject({
      type: "list",
      style: "decimal",
      children: [{
        type: "listItem",
        children: [
          {
            type: "paragraph",
            children: [{
              type: "text",
              text: "Linked item",
              marks: [{ type: "link", href: "https://example.com/docs" }],
            }],
          },
          {
            type: "list",
            children: [{
              type: "listItem",
              children: [{
                type: "paragraph",
                children: [{ type: "text", text: "Nested item" }],
              }],
            }],
          },
        ],
      }],
    });
  });

  it("embeds data images as native DOCX media and round-trips their semantics", async () => {
    const blob = await exportDocxDocument({
      type: "doc",
      children: [{
        type: "paragraph",
        children: [{
          type: "inlineImage",
          src: onePixelPng,
          alt: "pixel",
          title: "One pixel",
          width: 32,
          height: 24,
        }],
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
    expect(await zip.file("[Content_Types].xml")?.async("text")).toContain(
      '<Default Extension="png" ContentType="image/png"/>',
    );

    const imported = await importDocxDocumentWithMammoth(buffer, document);
    expect(imported.children[0]).toMatchObject({
      type: "paragraph",
      children: [{
        type: "inlineImage",
        alt: "pixel",
      }],
    });
    expect((imported.children[0] as { children: Array<{ src?: string }> }).children[0].src)
      .toMatch(/^data:image\/png;base64,/);
  });

  it("emits native OMML while preserving canonical formula source on import", async () => {
    const blob = await exportDocxDocument({
      type: "doc",
      children: [{
        type: "paragraph",
        children: [{
          type: "formula",
          value: String.raw`\frac{a}{b}`,
          displayText: "a over b",
        }],
      }],
    });
    const buffer = await blobArrayBuffer(blob);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")?.async("text");
    expect(xml).toContain('xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"');
    expect(xml).toContain("<m:oMath>");
    expect(xml).toContain("<m:t>\\frac{a}{b}</m:t>");

    const imported = await importDocxDocumentWithMammoth(buffer, document);
    expect(imported.children[0]).toMatchObject({
      type: "paragraph",
      children: expect.arrayContaining([{
        type: "formula",
        value: String.raw`\frac{a}{b}`,
        displayText: "a over b",
      }]),
    });
  });
});
