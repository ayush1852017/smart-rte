import { parseFragment, serialize } from "parse5";

type HtmlAttribute = { name: string; value: string };
type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: HtmlAttribute[];
  namespaceURI?: string;
  childNodes?: HtmlNode[];
};

const marker = /⟦SRTE_(FORMULA|IMAGE):([^⟧]+)⟧/g;

export const portableFormulaMarker = (value: string, displayText?: string) =>
  `⟦SRTE_FORMULA:${encodeURIComponent(JSON.stringify({ value, displayText }))}⟧`;

export const portableImageMarker = (src: string, alt?: string, title?: string) =>
  `⟦SRTE_IMAGE:${encodeURIComponent(JSON.stringify({ src, alt, title }))}⟧`;

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const textNode = (value: string): HtmlNode => ({ nodeName: "#text", value });
const elementNode = (tagName: string, attrs: HtmlAttribute[], childNodes: HtmlNode[] = []): HtmlNode => ({
  nodeName: tagName, tagName, namespaceURI: XHTML_NS, attrs, childNodes,
});

const splitPortableAtoms = (text: string): HtmlNode[] => {
  marker.lastIndex = 0;
  if (!marker.test(text)) return [textNode(text)];
  marker.lastIndex = 0;
  const output: HtmlNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    if (match.index > cursor) output.push(textNode(text.slice(cursor, match.index)));
    try {
      const payload = JSON.parse(decodeURIComponent(match[2])) as {
        value?: string; displayText?: string; src?: string; alt?: string; title?: string;
      };
      if (match[1] === "FORMULA" && payload.value) {
        // Fidelity note: canonical's own native HTML round-trip never
        // preserves formula displayText either (atomToHtml doesn't write
        // it, the parser doesn't read it back) - only source/notation
        // survive. Not a DOCX-specific gap.
        output.push(elementNode("span", [
          { name: "data-smart-type", value: "formula" },
          { name: "data-smart-formula", value: payload.value },
        ], [textNode(payload.displayText || `$${payload.value}$`)]));
      } else if (match[1] === "IMAGE" && payload.src) {
        const attrs: HtmlAttribute[] = [
          { name: "src", value: payload.src },
          { name: "alt", value: payload.alt || "" },
          { name: "data-srte-inline", value: "true" },
        ];
        if (payload.title) attrs.push({ name: "title", value: payload.title });
        output.push(elementNode("img", attrs));
      } else {
        output.push(textNode(match[0]));
      }
    } catch {
      output.push(textNode(match[0]));
    }
    cursor = marker.lastIndex;
  }
  if (cursor < text.length) output.push(textNode(text.slice(cursor)));
  return output;
};

const visit = (node: HtmlNode): HtmlNode => {
  if (!node.childNodes) return node;
  const childNodes = node.childNodes.flatMap((child) =>
    child.nodeName === "#text" && child.value ? splitPortableAtoms(child.value) : [visit(child)]);
  return { ...node, childNodes };
};

/** Restores Smart RTE atom fallback markers retained by DOCX text runs. */
export const restorePortableDocxAtoms = (html: string): string => {
  const fragment = visit(parseFragment(html) as unknown as HtmlNode);
  return serialize(fragment as never);
};
