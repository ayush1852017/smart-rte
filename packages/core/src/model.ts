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
  | { type: "link"; href: string; target?: string };

export interface SmartTextNode {
  type: "text";
  text: string;
  marks?: SmartMark[];
}

export interface SmartParagraphNode {
  type: "paragraph";
  alignment?: TextAlignment;
  children: SmartTextNode[];
}

export interface SmartHeadingNode {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  alignment?: TextAlignment;
  children: SmartTextNode[];
}

export interface SmartListItemNode {
  type: "listItem";
  alignment?: TextAlignment;
  children: SmartBlockNode[];
}

export interface SmartListNode {
  type: "list";
  style: "disc" | "circle" | "square" | "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";
  children: SmartListItemNode[];
}

export interface SmartBlockquoteNode {
  type: "blockquote";
  alignment?: TextAlignment;
  children: SmartBlockNode[];
}

export interface SmartCodeBlockNode {
  type: "codeBlock";
  alignment?: TextAlignment;
  text: string;
  language?: string;
}

export interface SmartTableCellNode {
  type: "tableCell" | "tableHeaderCell";
  colspan?: number;
  rowspan?: number;
  children: SmartBlockNode[];
}

export interface SmartTableRowNode {
  type: "tableRow";
  children: SmartTableCellNode[];
}

export interface SmartTableNode {
  type: "table";
  children: SmartTableRowNode[];
}

export type SmartBlockNode =
  | SmartParagraphNode
  | SmartHeadingNode
  | SmartListNode
  | SmartBlockquoteNode
  | SmartCodeBlockNode
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
