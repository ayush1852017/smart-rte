/**
 * Test-only snapshot of ClassicEditor's clipboard HTML cleaner.
 *
 * Retained before Phase 8a deletes the production clipboard path so the shadow
 * comparator continues to have a real legacy implementation. This deliberately
 * preserves legacy behavior, including its limitations; do not harden it in
 * place. Source: ClassicEditor.tsx immediately before Phase 8a.
 */
export interface LegacyCleanHtmlOptions {
  preserveColors?: boolean;
  preserveDocumentLayout?: boolean;
  preserveFontFamily?: boolean;
}

export function legacyCleanPastedHtml(
  html: string,
  options: LegacyCleanHtmlOptions = {},
  ownerDocument: Document = document,
): string {
  const shouldPreserveColors = options.preserveColors ?? false;
  const shouldPreserveDocumentLayout = options.preserveDocumentLayout ?? false;
  const template = ownerDocument.createElement("template");
  template.innerHTML = html
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b\u200c\u200d]/g, "");

  template.content.querySelectorAll("meta, link, style, script").forEach((node) => node.remove());

  const allowedStyleNames = new Set([
    "font-weight", "font-style", "text-decoration", "text-align", "vertical-align",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-collapse", "padding", "padding-top", "padding-right", "padding-bottom",
    "padding-left", "list-style-type", "white-space",
  ]);
  if (options.preserveFontFamily) allowedStyleNames.add("font-family");
  if (shouldPreserveColors) {
    allowedStyleNames.add("color");
    allowedStyleNames.add("background");
    allowedStyleNames.add("background-color");
  }
  if (shouldPreserveDocumentLayout) {
    [
      "font-size", "line-height", "margin", "margin-top", "margin-right", "margin-bottom",
      "margin-left", "text-indent", "width", "min-width",
    ].forEach((name) => allowedStyleNames.add(name));
  }

  template.content.querySelectorAll<HTMLElement>("*").forEach((node) => {
    const className = node.getAttribute("class");
    if (className !== "srte-preserve-colors") node.removeAttribute("class");
    node.removeAttribute("id");
    if (!shouldPreserveDocumentLayout) {
      node.removeAttribute("width");
      node.removeAttribute("height");
    }

    const style = node.getAttribute("style");
    if (!style) return;
    const safeRules = style
      .split(";")
      .map((rule) => rule.trim())
      .filter(Boolean)
      .filter((rule) => {
        const separator = rule.indexOf(":");
        if (separator === -1) return false;
        const name = rule.slice(0, separator).trim().toLowerCase();
        const value = rule.slice(separator + 1).trim().toLowerCase();
        if (!allowedStyleNames.has(name)) return false;
        if (value.includes("position") || value.includes("expression") || value.includes("javascript:")) return false;
        if (name === "white-space" && value !== "pre-wrap") return false;
        if ((name === "width" || name === "min-width") && !/^[\d.]+(px|pt|em|rem|%)$/.test(value)) return false;
        return true;
      });

    if (safeRules.length) node.setAttribute("style", safeRules.join("; "));
    else node.removeAttribute("style");
  });

  return template.innerHTML;
}
