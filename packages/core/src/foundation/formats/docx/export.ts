import JSZip from "jszip";
import { isTextNode } from "../../identity.js";
import { occupancyGridFor } from "../../table/grid.js";
import { foundationListStyleForPresetDepth, isFoundationSmartListPreset, type FoundationSmartListStyle } from "../../list/presets.js";
import type { SmartDocument, SmartElementNode, SmartMark, SmartNode } from "../../types.js";
import { portableFormulaMarker, portableImageMarker } from "./portableAtoms.js";

export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const xmlEscape = (value: unknown) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colorValue = (value: string) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) return hex[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim());
  return rgb
    ? rgb.slice(1, 4).map((part) =>
        Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("").toUpperCase()
    : "";
};

const runProperties = (marks: readonly SmartMark[] = []) => marks.map((mark) => {
  if (mark.type === "bold") return "<w:b/>";
  if (mark.type === "italic") return "<w:i/>";
  if (mark.type === "underline") return '<w:u w:val="single"/>';
  if (mark.type === "strike") return "<w:strike/>";
  if (mark.type === "superscript") return '<w:vertAlign w:val="superscript"/>';
  if (mark.type === "subscript") return '<w:vertAlign w:val="subscript"/>';
  if (mark.type === "textColor") {
    const color = colorValue(String(mark.attrs?.value || ""));
    return color ? `<w:color w:val="${color}"/>` : "";
  }
  if (mark.type === "backgroundColor") {
    const color = colorValue(String(mark.attrs?.value || ""));
    return color ? `<w:shd w:val="clear" w:color="auto" w:fill="${color}"/>` : "";
  }
  if (mark.type === "fontSize") return `<w:sz w:val="${Math.max(2, Math.round(Number(mark.attrs?.valuePx || 0) * 1.5))}"/>`;
  return "";
}).join("");

const textRun = (text: string, properties = "") =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;

type DocxRelationship =
  | { id: string; target: string; kind: "hyperlink" }
  | { id: string; target: string; kind: "image" };
type DocxMedia = {
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif";
  base64: string;
};
type DocxSerializationContext = {
  relationships: DocxRelationship[];
  hyperlinkIds: Map<string, string>;
  media: DocxMedia[];
  drawingId: number;
};

const createSerializationContext = (): DocxSerializationContext => ({
  relationships: [], hyperlinkIds: new Map(), media: [], drawingId: 1,
});

const hyperlinkRelationshipId = (context: DocxSerializationContext, href: string) => {
  const existing = context.hyperlinkIds.get(href);
  if (existing) return existing;
  const id = `rId${context.relationships.length + 2}`;
  context.hyperlinkIds.set(href, id);
  context.relationships.push({ id, target: href, kind: "hyperlink" });
  return id;
};

const embeddableImage = (src: string) => {
  const match = /^data:(image\/(?:png|jpeg|gif));base64,([a-z0-9+/=\s]+)$/i.exec(src);
  if (!match) return;
  return { mimeType: match[1].toLowerCase() as DocxMedia["mimeType"], base64: match[2].replace(/\s/g, "") };
};

const imageRun = (node: SmartElementNode, context: DocxSerializationContext) => {
  const src = String(node.attrs?.src || "");
  const alt = node.attrs?.alt !== undefined ? String(node.attrs.alt) : undefined;
  const title = node.attrs?.title !== undefined ? String(node.attrs.title) : undefined;
  const image = embeddableImage(src);
  if (!image) return textRun(portableImageMarker(src, alt, title));
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
  const filename = `image${context.media.length + 1}.${extension}`;
  const relationshipId = `rId${context.relationships.length + 2}`;
  const drawingId = context.drawingId++;
  context.media.push({ filename, ...image });
  context.relationships.push({ id: relationshipId, target: `media/${filename}`, kind: "image" });
  const widthEmu = Math.max(1, Math.round(Number(node.attrs?.width || 96) * 9525));
  const heightEmu = Math.max(1, Math.round(Number(node.attrs?.height || 96) * 9525));
  const name = xmlEscape(title || alt || filename);
  const description = xmlEscape(alt || "");
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${drawingId}" name="${name}" descr="${description}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}" descr="${description}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
};

const formulaRun = (node: SmartElementNode) => {
  const source = xmlEscape(String(node.attrs?.source || ""));
  const displayText = node.attrs?.displayText !== undefined ? String(node.attrs.displayText) : undefined;
  const marker = xmlEscape(portableFormulaMarker(String(node.attrs?.source || ""), displayText));
  return `<m:oMath><m:r><m:t>${source}</m:t></m:r></m:oMath><w:r><w:rPr><w:vanish/></w:rPr><w:t>${marker}</w:t></w:r>`;
};

/** Fidelity: media type "file" (a legacy concept) has no canonical atom equivalent and is skipped. */
const inlineRun = (node: SmartNode, context: DocxSerializationContext): string => {
  if (isTextNode(node)) {
    const properties = runProperties(node.marks);
    const runs = node.text.split("\n").map((part, index) =>
      `${index ? "<w:r><w:br/></w:r>" : ""}${part ? textRun(part, properties) : ""}`).join("");
    const link = node.marks?.find((mark) => mark.type === "link");
    if (!link || !runs) return runs;
    return `<w:hyperlink r:id="${hyperlinkRelationshipId(context, String(link.attrs?.href || ""))}"${link.attrs?.target ? ' w:history="1"' : ""}>${runs}</w:hyperlink>`;
  }
  if (node.type === "hard_break") return "<w:r><w:br/></w:r>";
  if (node.type === "formula") return formulaRun(node);
  if (node.type === "image") return imageRun(node, context);
  return "";
};

const alignmentOf = (node: SmartElementNode) => typeof node.attrs?.align === "string" ? node.attrs.align : undefined;
const indentLevelOf = (node: SmartElementNode) => Number(node.attrs?.indentLevel) || 0;

const paragraphProperties = (block: SmartElementNode, extra = "") => [
  alignmentOf(block) ? `<w:jc w:val="${xmlEscape(alignmentOf(block))}"/>` : "",
  indentLevelOf(block) ? `<w:ind w:left="${indentLevelOf(block) * 480}"/>` : "",
  extra,
].join("");

const paragraphXml = (children: readonly SmartNode[], block: SmartElementNode, context: DocxSerializationContext, extraProperties = "") => {
  const properties = paragraphProperties(block, extraProperties);
  const content = children.map((node) => inlineRun(node, context)).join("") || textRun("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${content}</w:p>`;
};

const listStyleNumId: Record<FoundationSmartListStyle, number> = {
  disc: 1, circle: 2, square: 3, decimal: 4,
  "decimal-leading-zero": 4,
  "lower-alpha": 5, "upper-alpha": 6, "lower-roman": 7, "upper-roman": 8,
};

const orderedList = (node: SmartElementNode) => {
  const marker = String(node.attrs?.style || node.attrs?.preset || "");
  return /^(?:decimal|lower-|upper-|ordered)/.test(marker) || node.attrs?.start !== undefined;
};

const effectiveStyle = (node: SmartElementNode, depth: number): FoundationSmartListStyle => {
  if (typeof node.attrs?.style === "string") return node.attrs.style as FoundationSmartListStyle;
  if (isFoundationSmartListPreset(node.attrs?.preset)) return foundationListStyleForPresetDepth(node.attrs.preset, depth);
  return "disc";
};

const blockChildren = (node: SmartElementNode) => (node.children || []) as readonly SmartNode[];
const elementChildren = (node: SmartElementNode) => blockChildren(node).filter((child): child is SmartElementNode => !isTextNode(child));

const tableXml = (block: SmartElementNode, context: DocxSerializationContext): string => {
  const grid = occupancyGridFor(block);
  const widths = Array.from({ length: grid.columns }, (_, index) =>
    Number((block.attrs?.columnWidths as unknown[] | undefined)?.[index]) || 96);
  const gridXml = `<w:tblGrid>${widths.map((widthPx) =>
    `<w:gridCol w:w="${Math.max(1, Math.round(widthPx * 15))}"/>`).join("")}</w:tblGrid>`;
  const borderNone = '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>';
  const rows = elementChildren(block).map((row, rowIndex) => {
    const header = Array.from({ length: grid.columns }, (_, column) => grid.at(rowIndex, column)?.node.attrs?.header === true).every(Boolean);
    const rowProperties = [
      header ? "<w:tblHeader/>" : "",
      Number(row.attrs?.height) > 0 ? `<w:trHeight w:val="${Math.round(Number(row.attrs?.height) * 15)}" w:hRule="atLeast"/>` : "",
    ].join("");
    let cells = "";
    for (let column = 0; column < grid.columns;) {
      const cell = grid.at(rowIndex, column);
      if (!cell || cell.left !== column) { column += 1; continue; }
      const rowspan = cell.bottom - cell.top;
      const colspan = cell.right - cell.left;
      const continuation = cell.top < rowIndex;
      const shade = colorValue(String(cell.node.attrs?.background || ""));
      const properties = [
        colspan > 1 ? `<w:gridSpan w:val="${colspan}"/>` : "",
        rowspan > 1 ? (continuation ? "<w:vMerge/>" : '<w:vMerge w:val="restart"/>') : "",
        shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : "",
        cell.node.attrs?.borders === "none" ? borderNone : "",
      ].join("");
      const content = continuation ? "<w:p/>" : elementChildren(cell.node).map((child) => blockXml(child, context)).join("") || "<w:p/>";
      cells += `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
      column += colspan;
    }
    return `<w:tr>${rowProperties ? `<w:trPr>${rowProperties}</w:trPr>` : ""}${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/></w:tblBorders></w:tblPr>${gridXml}${rows}</w:tbl>`;
};

/** Fidelity: DOCX export is `semantic` for structure; formulas fall back to a portable text marker (`lossy`), matching Phase 7's explicit decision not to build partial OMML. */
const blockXml = (block: SmartElementNode, context: DocxSerializationContext, listLevel = 0): string => {
  if (block.type === "paragraph") return paragraphXml(blockChildren(block), block, context);
  if (block.type === "heading") return paragraphXml(blockChildren(block), block, context, `<w:pStyle w:val="Heading${Number(block.attrs?.level) || 1}"/>`);
  if (block.type === "code_block") {
    const text = blockChildren(block).map((child) => isTextNode(child) ? child.text : child.type === "hard_break" ? "\n" : "").join("");
    return paragraphXml([{ type: "text", text, marks: [{ type: "code" }] }], block, context);
  }
  if (block.type === "blockquote") {
    return elementChildren(block).map((child) => child.type === "paragraph"
      ? paragraphXml(blockChildren(child), child, context, '<w:ind w:left="720"/>')
      : blockXml(child, context, listLevel)).join("");
  }
  if (block.type === "list") {
    const style = effectiveStyle(block, listLevel);
    return elementChildren(block).flatMap((item) => elementChildren(item).map((child) => child.type === "paragraph"
      ? paragraphXml(blockChildren(child), child, context, `<w:numPr><w:ilvl w:val="${Math.min(listLevel, 8)}"/><w:numId w:val="${listStyleNumId[style]}"/></w:numPr>`)
      : blockXml(child, context, listLevel + 1))).join("");
  }
  if (block.type === "table") return tableXml(block, context);
  if (block.type === "block_image") return paragraphXml([{ ...block, type: "image" } as SmartElementNode], block, context);
  if (block.type === "block_formula") return paragraphXml([{ ...block, type: "formula" } as SmartElementNode], block, context);
  return paragraphXml([{ type: "text", text: String(block.attrs?.title || block.attrs?.src || "") }], block, context);
};

const numberingLevelXml = (level: number, format: string, text: string, font?: string) =>
  `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${720 + level * 360}"/></w:tabs><w:ind w:left="${720 + level * 360}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ""}</w:lvl>`;

const numberingXml = () => {
  const definitions = [
    { id: 1, format: "bullet", text: "•", font: "Symbol" },
    { id: 2, format: "bullet", text: "○", font: "Arial" },
    { id: 3, format: "bullet", text: "▪", font: "Arial" },
    { id: 4, format: "decimal", text: "%1." },
    { id: 5, format: "lowerLetter", text: "%1." },
    { id: 6, format: "upperLetter", text: "%1." },
    { id: 7, format: "lowerRoman", text: "%1." },
    { id: 8, format: "upperRoman", text: "%1." },
  ];
  const abstracts = definitions.map(({ id, format, text, font }) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${Array.from({ length: 9 }, (_, level) =>
      numberingLevelXml(level, format, text.replace("%1", `%${level + 1}`), font)).join("")}</w:abstractNum>`).join("");
  const instances = definitions.map(({ id }) => `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstracts}${instances}</w:numbering>`;
};

const serializeDocxDocument = (document: SmartDocument) => {
  const context = createSerializationContext();
  const body = elementChildren(document).map((block) => blockXml(block, context)).join("");
  return {
    documentXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
    relationships: context.relationships,
    media: context.media,
  };
};

export const smartDocumentToDocxXml = (document: SmartDocument) => serializeDocxDocument(document).documentXml;

export const exportDocxDocument = async (document: SmartDocument): Promise<Blob> => {
  const zip = new JSZip();
  const serialized = serializeDocxDocument(document);
  const imageTypes = [...new Set(serialized.media.map(({ filename, mimeType }) => JSON.stringify({
    extension: filename.split(".").pop()!, mimeType,
  })))].map((entry) => JSON.parse(entry) as { extension: string; mimeType: string });
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes.map(({ extension, mimeType }) => `<Default Extension="${extension}" ContentType="${mimeType}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="${DOCX_MEDIA_TYPE}.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")?.file("document.xml", serialized.documentXml);
  zip.folder("word")?.file("numbering.xml", numberingXml());
  serialized.media.forEach(({ filename, base64 }) => {
    zip.folder("word")?.folder("media")?.file(filename, base64, { base64: true });
  });
  const relationships = serialized.relationships.map((relationship) =>
    relationship.kind === "hyperlink"
      ? `<Relationship Id="${relationship.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(relationship.target)}" TargetMode="External"/>`
      : `<Relationship Id="${relationship.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${relationship.target}"/>`).join("");
  zip.folder("word")?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${relationships}</Relationships>`);
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MEDIA_TYPE });
};
