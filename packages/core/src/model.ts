export type Path = readonly number[];
export type TextAlignment = "left" | "center" | "right" | "justify";

export type SmartMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "superscript" }
  | { type: "subscript" }
  | { type: "code" }
  | { type: "textColor"; value: string }
  | { type: "backgroundColor"; value: string }
  | { type: "fontSize"; valuePx: number }
  | { type: "fontFamily"; value: string }
  | { type: "formula"; value: string }
  | { type: "link"; href: string; target?: string };

export interface SmartTextNode {
  type: "text";
  text: string;
  marks?: SmartMark[];
}

/** An indivisible inline node. Text commands must treat these as length-one atoms. */
export interface SmartFormulaNode {
  type: "formula";
  value: string;
  displayText?: string;
}

export interface SmartInlineImageNode {
  type: "inlineImage";
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export type SmartInlineNode = SmartTextNode | SmartFormulaNode | SmartInlineImageNode;

export interface SmartParagraphNode {
  type: "paragraph";
  alignment?: TextAlignment;
  indent?: number;
  children: SmartInlineNode[];
}

export interface SmartHeadingNode {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  alignment?: TextAlignment;
  indent?: number;
  children: SmartInlineNode[];
}

export interface SmartListItemNode {
  type: "listItem";
  alignment?: TextAlignment;
  checked?: boolean;
  children: SmartBlockNode[];
}

export interface SmartListNode {
  type: "list";
  indent?: number;
  style: "disc" | "circle" | "square" | "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";
  checklist?: boolean;
  strikeCompleted?: boolean;
  children: SmartListItemNode[];
}

export interface SmartImageNode {
  type: "image";
  indent?: number;
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface SmartMediaNode {
  type: "media";
  indent?: number;
  src: string;
  mediaType: "audio" | "video" | "file";
  title?: string;
  mimeType?: string;
}

export interface SmartBlockquoteNode {
  type: "blockquote";
  alignment?: TextAlignment;
  indent?: number;
  children: SmartBlockNode[];
}

export interface SmartCodeBlockNode {
  type: "codeBlock";
  alignment?: TextAlignment;
  indent?: number;
  text: string;
  language?: string;
}

export interface SmartTableCellNode {
  type: "tableCell" | "tableHeaderCell";
  colspan?: number;
  rowspan?: number;
  backgroundColor?: string;
  textColor?: string;
  border?: string;
  children: SmartBlockNode[];
}

export interface SmartTableRowNode {
  type: "tableRow";
  heightPx?: number;
  children: SmartTableCellNode[];
}

export interface SmartTableNode {
  type: "table";
  indent?: number;
  columnWidths?: number[];
  children: SmartTableRowNode[];
}

export type SmartBlockNode =
  | SmartParagraphNode
  | SmartHeadingNode
  | SmartListNode
  | SmartBlockquoteNode
  | SmartCodeBlockNode
  | SmartImageNode
  | SmartMediaNode
  | SmartTableNode;

export interface SmartDocument {
  type: "doc";
  children: SmartBlockNode[];
}

export const paragraph = (text = ""): SmartParagraphNode => ({
  type: "paragraph",
  children: [{ type: "text", text }],
});

export const getNodeAtPath = (document: SmartDocument, path: Path): unknown => {
  let node: unknown = document;
  for (const index of path) {
    if (!node || typeof node !== "object" || !Array.isArray((node as { children?: unknown[] }).children)) {
      return undefined;
    }
    node = (node as { children: unknown[] }).children[index];
  }
  return node;
};
