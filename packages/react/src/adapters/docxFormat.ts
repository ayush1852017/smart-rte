import JSZip from "jszip";
import mammoth from "mammoth";
import { normalizeSmartDocument, type SmartBlockNode, type SmartDocument, type SmartInlineNode, type SmartMark } from "smartrte-core";
import { portableFormulaMarker, portableImageMarker, restorePortableDocxAtoms } from "./portableDocxAtoms.js";
import { smartDocumentFromHtml } from "./domSmartDocument.js";

export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const xmlEscape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
    const color = colorValue(mark.value);
    return color ? `<w:color w:val="${color}"/>` : "";
  }
  if (mark.type === "backgroundColor") {
    const color = colorValue(mark.value);
    return color ? `<w:shd w:val="clear" w:color="auto" w:fill="${color}"/>` : "";
  }
  if (mark.type === "fontSize") return `<w:sz w:val="${Math.max(2, Math.round(mark.valuePx * 1.5))}"/>`;
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
  relationships: [],
  hyperlinkIds: new Map(),
  media: [],
  drawingId: 1,
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
  return {
    mimeType: match[1].toLowerCase() as DocxMedia["mimeType"],
    base64: match[2].replace(/\s/g, ""),
  };
};

const imageRun = (
  node: Extract<SmartInlineNode, { type: "inlineImage" }>,
  context: DocxSerializationContext,
) => {
  const image = embeddableImage(node.src);
  if (!image) return textRun(portableImageMarker(node.src, node.alt, node.title));
  const extension = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType.split("/")[1];
  const filename = `image${context.media.length + 1}.${extension}`;
  const relationshipId = `rId${context.relationships.length + 2}`;
  const drawingId = context.drawingId++;
  context.media.push({ filename, ...image });
  context.relationships.push({
    id: relationshipId,
    target: `media/${filename}`,
    kind: "image",
  });
  const widthEmu = Math.max(1, Math.round((node.width || 96) * 9525));
  const heightEmu = Math.max(1, Math.round((node.height || 96) * 9525));
  const name = xmlEscape(node.title || node.alt || filename);
  const description = xmlEscape(node.alt || "");
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="${drawingId}" name="${name}" descr="${description}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${name}" descr="${description}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
};

const formulaRun = (node: Extract<SmartInlineNode, { type: "formula" }>) => {
  const source = xmlEscape(node.value);
  const marker = xmlEscape(portableFormulaMarker(node.value, node.displayText));
  return `<m:oMath><m:r><m:t>${source}</m:t></m:r></m:oMath><w:r><w:rPr><w:vanish/></w:rPr><w:t>${marker}</w:t></w:r>`;
};

const inlineRun = (node: SmartInlineNode, context: DocxSerializationContext): string => {
  if (node.type === "formula") return formulaRun(node);
  if (node.type === "inlineImage") return imageRun(node, context);
  const properties = runProperties(node.marks);
  const runs = node.text.split("\n").map((part, index) =>
    `${index ? "<w:r><w:br/></w:r>" : ""}${part ? textRun(part, properties) : ""}`).join("");
  const link = node.marks?.find((mark) => mark.type === "link");
  if (!link || !runs) return runs;
  return `<w:hyperlink r:id="${hyperlinkRelationshipId(context, link.href)}"${link.target === "_blank" ? ' w:history="1"' : ""}>${runs}</w:hyperlink>`;
};

const paragraphProperties = (block: { alignment?: string; indent?: number }, extra = "") => [
  block.alignment ? `<w:jc w:val="${xmlEscape(block.alignment)}"/>` : "",
  block.indent ? `<w:ind w:left="${block.indent * 480}"/>` : "",
  extra,
].join("");

const paragraphXml = (
  children: readonly SmartInlineNode[],
  block: { alignment?: string; indent?: number },
  context: DocxSerializationContext,
  extraProperties = "",
) => {
  const properties = paragraphProperties(block, extraProperties);
  const content = children.map((node) => inlineRun(node, context)).join("") || textRun("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${content}</w:p>`;
};

const tableXml = (block: Extract<SmartBlockNode, { type: "table" }>, context: DocxSerializationContext): string => {
  type Placement = {
    row: number;
    column: number;
    rowspan: number;
    colspan: number;
    cell: Extract<SmartBlockNode, { type: "table" }>["children"][number]["children"][number];
  };
  const grid: (Placement | undefined)[][] = [];
  const placements: Placement[] = [];
  block.children.forEach((row, rowIndex) => {
    grid[rowIndex] ||= [];
    let column = 0;
    row.children.forEach((cell) => {
      while (grid[rowIndex][column]) column += 1;
      const placement = {
        row: rowIndex,
        column,
        rowspan: cell.rowspan || 1,
        colspan: cell.colspan || 1,
        cell,
      };
      placements.push(placement);
      for (let rowOffset = 0; rowOffset < placement.rowspan; rowOffset += 1) {
        grid[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < placement.colspan; columnOffset += 1) {
          grid[rowIndex + rowOffset][column + columnOffset] = placement;
        }
      }
      column += placement.colspan;
    });
  });
  const width = Math.max(1, ...grid.map((row) => row.length));
  const widths = Array.from({ length: width }, (_, index) => block.columnWidths?.[index] || 96);
  const gridXml = `<w:tblGrid>${widths.map((widthPx) =>
    `<w:gridCol w:w="${Math.max(1, Math.round(widthPx * 15))}"/>`).join("")}</w:tblGrid>`;
  const borderNone = '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>';
  const rows = block.children.map((row, rowIndex) => {
    const header = grid[rowIndex]?.every((placement) =>
      placement?.cell.type === "tableHeaderCell");
    const rowProperties = [
      header ? "<w:tblHeader/>" : "",
      row.heightPx ? `<w:trHeight w:val="${Math.round(row.heightPx * 15)}" w:hRule="atLeast"/>` : "",
    ].join("");
    let cells = "";
    for (let column = 0; column < width;) {
      const placement = grid[rowIndex]?.[column];
      if (!placement || placement.column !== column) {
        column += 1;
        continue;
      }
      const continuation = placement.row < rowIndex;
      const shade = colorValue(placement.cell.backgroundColor || "");
      const properties = [
        placement.colspan > 1 ? `<w:gridSpan w:val="${placement.colspan}"/>` : "",
        placement.rowspan > 1
          ? continuation ? "<w:vMerge/>" : '<w:vMerge w:val="restart"/>'
          : "",
        shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : "",
        placement.cell.border === "none" ? borderNone : "",
      ].join("");
      const content = continuation
        ? "<w:p/>"
        : placement.cell.children.map((child) => blockXml(child, context)).join("") || "<w:p/>";
      cells += `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
      column += placement.colspan;
    }
    return `<w:tr>${rowProperties ? `<w:trPr>${rowProperties}</w:trPr>` : ""}${cells}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideV w:val="single" w:sz="4" w:color="D1D5DB"/></w:tblBorders></w:tblPr>${gridXml}${rows}</w:tbl>`;
};

const listStyleNumId: Record<Extract<SmartBlockNode, { type: "list" }>["style"], number> = {
  disc: 1, circle: 2, square: 3, decimal: 4,
  "lower-alpha": 5, "upper-alpha": 6, "lower-roman": 7, "upper-roman": 8,
};

const blockXml = (block: SmartBlockNode, context: DocxSerializationContext, listLevel = 0): string => {
  if (block.type === "paragraph") return paragraphXml(block.children, block, context);
  if (block.type === "heading") {
    return paragraphXml(block.children, block, context, `<w:pStyle w:val="Heading${block.level}"/>`);
  }
  if (block.type === "codeBlock") return paragraphXml([{ type: "text", text: block.text, marks: [{ type: "code" }] }], block, context);
  if (block.type === "blockquote") {
    return block.children.map((child) => {
      if (child.type === "paragraph") return paragraphXml(child.children, child, context, '<w:ind w:left="720"/>');
      return blockXml(child, context, listLevel);
    }).join("");
  }
  if (block.type === "list") {
    return block.children.map((item) => item.children.map((child) => {
      if (child.type === "paragraph") {
        return paragraphXml(child.children, child, context, `<w:numPr><w:ilvl w:val="${Math.min(listLevel, 8)}"/><w:numId w:val="${listStyleNumId[block.style]}"/></w:numPr>`);
      }
      return blockXml(child, context, listLevel + 1);
    }).join("")).join("");
  }
  if (block.type === "table") return tableXml(block, context);
  if (block.type === "image") return paragraphXml([{
    type: "inlineImage",
    src: block.src,
    alt: block.alt,
    title: block.title,
    width: block.width,
    height: block.height,
  }], block, context);
  return paragraphXml([{ type: "text", text: block.title || block.src }], block, context);
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
  const instances = definitions.map(({ id }) =>
    `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstracts}${instances}</w:numbering>`;
};

const serializeDocxDocument = (document: SmartDocument) => {
  const normalized = normalizeSmartDocument(document);
  const context = createSerializationContext();
  const body = normalized.children.map((block) => blockXml(block, context)).join("");
  return {
    documentXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
    relationships: context.relationships,
    media: context.media,
  };
};

export const smartDocumentToDocxXml = (document: SmartDocument) =>
  serializeDocxDocument(document).documentXml;

export const exportDocxDocument = async (document: SmartDocument): Promise<Blob> => {
  const zip = new JSZip();
  const serialized = serializeDocxDocument(document);
  const imageTypes = [...new Set(serialized.media.map(({ filename, mimeType }) => ({
    extension: filename.split(".").pop()!,
    mimeType,
  })).map((entry) => JSON.stringify(entry)))].map((entry) => JSON.parse(entry) as {
    extension: string;
    mimeType: string;
  });
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

export const importDocxDocumentWithMammoth = async (
  arrayBuffer: ArrayBuffer,
  ownerDocument: Document,
): Promise<SmartDocument> => {
  // Mammoth's browser entry reads `arrayBuffer`, while its Node entry reads
  // `buffer`. Supplying both keeps the adapter portable across bundlers/tests.
  const result = await mammoth.convertToHtml({ arrayBuffer, buffer: arrayBuffer } as Parameters<typeof mammoth.convertToHtml>[0]);
  const html = restorePortableDocxAtoms(result.value, ownerDocument);
  return normalizeSmartDocument(smartDocumentFromHtml(html, ownerDocument));
};
