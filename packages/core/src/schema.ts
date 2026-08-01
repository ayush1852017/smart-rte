import {
  paragraph,
  type Path,
  type SmartBlockNode,
  type SmartDocument,
  type SmartInlineNode,
  type SmartInlineImageNode,
  type SmartListItemNode,
  type SmartMark,
  type SmartTableCellNode,
  type SmartTextNode,
} from "./model.js";
import { isSmartListPreset } from "./listPresets.js";

export interface SchemaIssue {
  path: Path;
  code: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaIssue[];
}

export interface SmartSchemaExtension {
  id: string;
  normalize?: (document: SmartDocument) => SmartDocument;
  validate?: (document: SmartDocument) => SchemaIssue[];
}

export interface SmartSchema {
  extensions: readonly SmartSchemaExtension[];
}

export const createSmartSchema = (
  extensions: readonly SmartSchemaExtension[] = [],
): SmartSchema => {
  const ids = new Set<string>();
  extensions.forEach((extension) => {
    if (!extension.id.trim()) throw new Error("Schema extension id cannot be empty.");
    if (ids.has(extension.id)) throw new Error(`Duplicate schema extension id "${extension.id}".`);
    ids.add(extension.id);
  });
  return { extensions: [...extensions] };
};

export const defaultSmartSchema = createSmartSchema();

const listStyles = new Set([
  "disc",
  "circle",
  "square",
  "decimal",
  "decimal-leading-zero",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
]);

const markKey = (mark: SmartMark) => JSON.stringify(mark);
const normalizedIndent = (value: number | undefined) =>
  Number.isInteger(value) && (value || 0) > 0 ? Math.min(value || 0, 10) : undefined;

const normalizeMarks = (marks: SmartMark[] | undefined) => {
  if (!marks?.length) return undefined;
  const seen = new Set<string>();
  const normalized = marks.filter((mark) => {
    const key = markKey(mark);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalized.length ? normalized : undefined;
};

const normalizeText = (node: SmartTextNode): SmartTextNode => {
  const marks = normalizeMarks(node.marks);
  return marks ? { type: "text", text: String(node.text ?? ""), marks } : { type: "text", text: String(node.text ?? "") };
};

const normalizeInlineImage = (node: SmartInlineImageNode): SmartInlineImageNode => {
  const width = Number.isFinite(node.width) && (node.width || 0) > 0 ? node.width : undefined;
  const height = Number.isFinite(node.height) && (node.height || 0) > 0 ? node.height : undefined;
  return {
    type: "inlineImage",
    src: String(node.src ?? ""),
    ...(node.alt ? { alt: String(node.alt) } : {}),
    ...(node.title ? { title: String(node.title) } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
};

const normalizeInlineChildren = (children: SmartInlineNode[] | undefined): SmartInlineNode[] => {
  const normalized = (children || []).map((node) => {
    if (node.type === "text") return normalizeText(node);
    if (node.type === "formula") {
      return {
        type: "formula" as const,
        value: String(node.value ?? ""),
        ...(node.displayText ? { displayText: String(node.displayText) } : {}),
      };
    }
    return normalizeInlineImage(node);
  });
  return normalized.length ? normalized : [{ type: "text", text: "" }];
};

const normalizeListItem = (item: SmartListItemNode): SmartListItemNode => {
  const children = (item.children || []).map(normalizeBlock);
  return {
    type: "listItem",
    ...(item.alignment ? { alignment: item.alignment } : {}),
    ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
    children: children.length ? children : [paragraph()],
  };
};

const normalizeCell = (cell: SmartTableCellNode): SmartTableCellNode => {
  const children = (cell.children || []).map(normalizeBlock);
  const colspan = Number.isInteger(cell.colspan) && (cell.colspan || 0) > 1 ? cell.colspan : undefined;
  const rowspan = Number.isInteger(cell.rowspan) && (cell.rowspan || 0) > 1 ? cell.rowspan : undefined;
  return {
    type: cell.type === "tableHeaderCell" ? "tableHeaderCell" : "tableCell",
    ...(colspan ? { colspan } : {}),
    ...(rowspan ? { rowspan } : {}),
    ...(cell.backgroundColor ? { backgroundColor: String(cell.backgroundColor) } : {}),
    ...(cell.textColor ? { textColor: String(cell.textColor) } : {}),
    ...(cell.border ? { border: String(cell.border) } : {}),
    children: children.length ? children : [paragraph()],
  };
};

const normalizeBlock = (block: SmartBlockNode): SmartBlockNode => {
  if (block.type === "paragraph") {
    return {
      type: "paragraph",
      ...(block.alignment ? { alignment: block.alignment } : {}),
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      children: normalizeInlineChildren(block.children),
    };
  }
  if (block.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(block.level) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;
    return {
      type: "heading",
      level,
      ...(block.alignment ? { alignment: block.alignment } : {}),
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      children: normalizeInlineChildren(block.children),
    };
  }
  if (block.type === "list") {
    const children = (block.children || []).map(normalizeListItem);
    return {
      type: "list",
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      style: listStyles.has(block.style) ? block.style : "disc",
      ...(isSmartListPreset(block.preset) ? { preset: block.preset } : {}),
      ...(block.checklist ? { checklist: true } : {}),
      ...(block.checklist && block.strikeCompleted ? { strikeCompleted: true } : {}),
      children: children.length ? children : [normalizeListItem({ type: "listItem", children: [] })],
    };
  }
  if (block.type === "blockquote") {
    const children = (block.children || []).map(normalizeBlock);
    return {
      type: "blockquote",
      ...(block.alignment ? { alignment: block.alignment } : {}),
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      children: children.length ? children : [paragraph()],
    };
  }
  if (block.type === "codeBlock") {
    return {
      type: "codeBlock",
      ...(block.alignment ? { alignment: block.alignment } : {}),
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      text: String(block.text ?? ""),
      ...(block.language ? { language: block.language } : {}),
    };
  }
  if (block.type === "image") {
    const width = Number.isFinite(block.width) && (block.width || 0) > 0 ? block.width : undefined;
    const height = Number.isFinite(block.height) && (block.height || 0) > 0 ? block.height : undefined;
    return {
      type: "image",
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      src: String(block.src ?? ""),
      ...(block.alt ? { alt: String(block.alt) } : {}),
      ...(block.title ? { title: String(block.title) } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    };
  }
  if (block.type === "media") {
    return {
      type: "media",
      ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
      src: String(block.src ?? ""),
      mediaType: block.mediaType === "audio" || block.mediaType === "file" ? block.mediaType : "video",
      ...(block.title ? { title: String(block.title) } : {}),
      ...(block.mimeType ? { mimeType: String(block.mimeType) } : {}),
    };
  }
  const rows = (block.children || []).map((row) => {
    const cells = (row.children || []).map(normalizeCell);
    return {
      type: "tableRow" as const,
      ...(Number.isFinite(row.heightPx) && (row.heightPx || 0) >= 30
        ? { heightPx: Number(row.heightPx) }
        : {}),
      children: cells,
    };
  });
  const normalizedRows = rows.map((row, rowIndex) => {
    if (row.children.length) return row;
    const coveredByRowspan = rows.slice(0, rowIndex).some((previous, previousIndex) =>
      previous.children.some((cell) => (cell.rowspan || 1) > rowIndex - previousIndex));
    return coveredByRowspan
      ? row
      : { ...row, children: [normalizeCell({ type: "tableCell", children: [] })] };
  });
  return {
    type: "table",
    ...(normalizedIndent(block.indent) ? { indent: normalizedIndent(block.indent) } : {}),
    ...(block.columnWidths?.length
      ? { columnWidths: block.columnWidths.map((width) => Math.max(60, Number(width) || 60)) }
      : {}),
    children: normalizedRows.length
      ? normalizedRows
      : [{ type: "tableRow", children: [normalizeCell({ type: "tableCell", children: [] })] }],
  };
};

const normalizeBuiltInDocument = (document: SmartDocument): SmartDocument => {
  const children = (document.children || []).map(normalizeBlock);
  return { type: "doc", children: children.length ? children : [paragraph()] };
};

export const normalizeSmartDocument = (
  document: SmartDocument,
  schema: SmartSchema = defaultSmartSchema,
): SmartDocument => schema.extensions.reduce(
  (current, extension) => normalizeBuiltInDocument(
    extension.normalize ? extension.normalize(current) : current,
  ),
  normalizeBuiltInDocument(document),
);

const issue = (issues: SchemaIssue[], path: Path, code: string, message: string) => {
  issues.push({ path: [...path], code, message });
};

const validateTextChildren = (children: SmartInlineNode[], path: Path, issues: SchemaIssue[]) => {
  if (!children.length) issue(issues, path, "empty-inline-container", "Inline containers require at least one inline node.");
  children.forEach((node, index) => {
    const nodePath = [...path, index];
    if (node.type === "formula") {
      if (!node.value) issue(issues, nodePath, "empty-formula", "Formula atoms require a value.");
      return;
    }
    if (node.type === "inlineImage") {
      if (!node.src) issue(issues, nodePath, "missing-inline-image-source", "Inline images require a source.");
      if (node.width !== undefined && (!Number.isFinite(node.width) || node.width <= 0)) {
        issue(issues, nodePath, "invalid-inline-image-width", "Inline image width must be positive.");
      }
      if (node.height !== undefined && (!Number.isFinite(node.height) || node.height <= 0)) {
        issue(issues, nodePath, "invalid-inline-image-height", "Inline image height must be positive.");
      }
      return;
    }
    if (typeof node.text !== "string") {
      issue(issues, nodePath, "invalid-text-node", "Text nodes require string content.");
    }
    const keys = (node.marks || []).map(markKey);
    if (new Set(keys).size !== keys.length) {
      issue(issues, nodePath, "duplicate-mark", "A text node cannot contain duplicate marks.");
    }
  });
};

const validateBlock = (block: SmartBlockNode, path: Path, issues: SchemaIssue[]) => {
  if (block.type === "paragraph" || block.type === "heading") {
    if (block.type === "heading" && (!Number.isInteger(block.level) || block.level < 1 || block.level > 6)) {
      issue(issues, path, "invalid-heading-level", "Heading level must be between 1 and 6.");
    }
    validateTextChildren(block.children, path, issues);
    return;
  }
  if (block.type === "list") {
    if (!listStyles.has(block.style)) issue(issues, path, "invalid-list-style", "List style is not supported.");
    if (block.preset !== undefined && !isSmartListPreset(block.preset)) issue(issues, path, "invalid-list-preset", "List preset is not supported.");
    if (!block.children.length) issue(issues, path, "empty-list", "Lists require at least one list item.");
    block.children.forEach((item, itemIndex) => {
      const itemPath = [...path, itemIndex];
      if (item.type !== "listItem") issue(issues, itemPath, "invalid-list-child", "Lists may only contain list items.");
      if (!item.children.length) issue(issues, itemPath, "empty-list-item", "List items require block content.");
      item.children.forEach((child, childIndex) => validateBlock(child, [...itemPath, childIndex], issues));
    });
    return;
  }
  if (block.type === "blockquote") {
    if (!block.children.length) issue(issues, path, "empty-blockquote", "Blockquotes require block content.");
    block.children.forEach((child, index) => validateBlock(child, [...path, index], issues));
    return;
  }
  if (block.type === "codeBlock") {
    if (typeof block.text !== "string") issue(issues, path, "invalid-code-text", "Code block text must be a string.");
    return;
  }
  if (block.type === "image") {
    if (!block.src) issue(issues, path, "missing-image-source", "Images require a source.");
    if (block.width !== undefined && (!Number.isFinite(block.width) || block.width <= 0)) {
      issue(issues, path, "invalid-image-width", "Image width must be positive.");
    }
    if (block.height !== undefined && (!Number.isFinite(block.height) || block.height <= 0)) {
      issue(issues, path, "invalid-image-height", "Image height must be positive.");
    }
    return;
  }
  if (block.type === "media") {
    if (!block.src) issue(issues, path, "missing-media-source", "Media requires a source.");
    if (!["audio", "video", "file"].includes(block.mediaType)) {
      issue(issues, path, "invalid-media-type", "Media type is not supported.");
    }
    return;
  }
  if (block.type === "table") {
    if (!block.children.length) issue(issues, path, "empty-table", "Tables require at least one row.");
    block.children.forEach((row, rowIndex) => {
      const rowPath = [...path, rowIndex];
      if (row.type !== "tableRow") issue(issues, rowPath, "invalid-table-child", "Tables may only contain rows.");
      const coveredByRowspan = block.children.slice(0, rowIndex).some((previous, previousIndex) =>
        previous.children.some((cell) => (cell.rowspan || 1) > rowIndex - previousIndex));
      if (!row.children.length && !coveredByRowspan) {
        issue(issues, rowPath, "empty-table-row", "Table rows require a cell or coverage from a rowspan.");
      }
      row.children.forEach((cell, cellIndex) => {
        const cellPath = [...rowPath, cellIndex];
        if (cell.type !== "tableCell" && cell.type !== "tableHeaderCell") {
          issue(issues, cellPath, "invalid-row-child", "Table rows may only contain cells.");
        }
        if (!cell.children.length) issue(issues, cellPath, "empty-table-cell", "Table cells require block content.");
        if (cell.colspan !== undefined && (!Number.isInteger(cell.colspan) || cell.colspan < 1)) {
          issue(issues, cellPath, "invalid-colspan", "Cell colspan must be a positive integer.");
        }
        if (cell.rowspan !== undefined && (!Number.isInteger(cell.rowspan) || cell.rowspan < 1)) {
          issue(issues, cellPath, "invalid-rowspan", "Cell rowspan must be a positive integer.");
        }
        cell.children.forEach((child, childIndex) => validateBlock(child, [...cellPath, childIndex], issues));
      });
    });
  }
};

export const validateSmartDocument = (
  document: SmartDocument,
  schema: SmartSchema = defaultSmartSchema,
): SchemaValidationResult => {
  const issues: SchemaIssue[] = [];
  if (document.type !== "doc") issue(issues, [], "invalid-root", "The document root must have type doc.");
  if (!Array.isArray(document.children) || !document.children.length) {
    issue(issues, [], "empty-document", "The document requires at least one block.");
  } else {
    document.children.forEach((block, index) => validateBlock(block, [index], issues));
  }
  schema.extensions.forEach((extension) => {
    if (extension.validate) issues.push(...extension.validate(document));
  });
  return { valid: issues.length === 0, issues };
};
