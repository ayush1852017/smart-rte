import { expect, test } from "@playwright/test";
import JSZip from "jszip";

const minimalDocx = async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder("_rels")?.file(".rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder("word")?.file("document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX reference text</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: "nodebuffer" });
};

test("clipboard capture page imports genuine JSON and labels DOCX as reference-only", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?clipboardCapture=1");

  const captured = Buffer.from(JSON.stringify({
    fixtureVersion: 1,
    source: "word-macos",
    platform: "macOS reference machine",
    contentDescription: "small genuine fixture import",
    capturedAt: "2026-08-04T00:00:00.000Z",
    userAgent: "fixture",
    types: ["text/html", "text/plain"],
    representations: { "text/html": "<p>Captured</p>", "text/plain": "Captured" },
    files: [],
    provenance: { kind: "clipboard-capture" },
  }));
  await page.getByLabel("Import genuine capture JSON").setInputFiles({
    name: "word-macos.clipboard.json",
    mimeType: "application/json",
    buffer: captured,
  });
  await expect(page.getByRole("status")).toContainText("Imported genuine capture JSON");
  await expect(page.locator("textarea")).toContainText('"source": "word-macos"');

  await page.locator("select").first().selectOption("word-windows");
  await page.getByLabel("Import DOCX reference").setInputFiles({
    name: "word-reference.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await minimalDocx(),
  });
  await expect(page.getByRole("status")).toContainText("not a Windows/macOS clipboard capture");
  await expect(page.locator("textarea")).toContainText('"kind": "docx-reference"');
  await expect(page.locator("textarea")).toContainText('"source": "word-windows-docx-reference"');
  await expect(page.locator("textarea")).toContainText("DOCX reference text");
});
