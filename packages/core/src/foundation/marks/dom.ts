import { canonicalMarkOrder, stableValue } from "./canonical.js";
import type { SmartMark, SmartTextNode } from "../types.js";

const elementForMark = (mark: SmartMark, document: Document): HTMLElement => {
  const tag = mark.type === "bold" ? "strong"
    : mark.type === "italic" ? "em"
      : mark.type === "underline" ? "u"
        : mark.type === "strike" ? "s"
          : mark.type === "code" ? "code"
            : mark.type === "superscript" ? "sup"
              : mark.type === "subscript" ? "sub"
                : mark.type === "link" ? "a" : "span";
  const element = document.createElement(tag);
  element.setAttribute("data-smart-mark", mark.type);
  if (mark.attrs) element.setAttribute("data-smart-mark-attrs", stableValue(mark.attrs));
  if (mark.type === "link") {
    element.setAttribute("href", String(mark.attrs?.href || ""));
    if (mark.attrs?.target) element.setAttribute("target", String(mark.attrs.target));
  } else if (mark.type === "textColor") element.style.color = String(mark.attrs?.value || "");
  else if (mark.type === "backgroundColor") element.style.backgroundColor = String(mark.attrs?.value || "");
  else if (mark.type === "fontSize") element.style.fontSize = `${String(mark.attrs?.valuePx || "")}px`;
  else if (mark.type === "fontFamily") element.style.fontFamily = String(mark.attrs?.value || "");
  return element;
};

export const renderMarkedText = (node: SmartTextNode, document: Document): Node => {
  let output: Node = document.createTextNode(node.text);
  [...canonicalMarkOrder(node.marks)].reverse().forEach((mark) => {
    const wrapper = elementForMark(mark, document);
    wrapper.appendChild(output);
    output = wrapper;
  });
  return output;
};
