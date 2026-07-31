const marker = /⟦SRTE_(FORMULA|IMAGE):([^⟧]+)⟧/g;

export const portableFormulaMarker = (value: string, displayText?: string) =>
  `⟦SRTE_FORMULA:${encodeURIComponent(JSON.stringify({ value, displayText }))}⟧`;

export const portableImageMarker = (src: string, alt?: string, title?: string) =>
  `⟦SRTE_IMAGE:${encodeURIComponent(JSON.stringify({ src, alt, title }))}⟧`;

/** Restores Smart RTE atom fallback markers retained by DOCX text runs. */
export const restorePortableDocxAtoms = (html: string, ownerDocument: Document): string => {
  const root = ownerDocument.createElement("div");
  root.innerHTML = html;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  textNodes.forEach((textNode) => {
    const text = textNode.data;
    marker.lastIndex = 0;
    if (!marker.test(text)) return;
    marker.lastIndex = 0;
    const fragment = ownerDocument.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(text))) {
      if (match.index > cursor) fragment.append(text.slice(cursor, match.index));
      try {
        const payload = JSON.parse(decodeURIComponent(match[2])) as {
          value?: string;
          displayText?: string;
          src?: string;
          alt?: string;
          title?: string;
        };
        if (match[1] === "FORMULA" && payload.value) {
          const formula = ownerDocument.createElement("span");
          formula.dataset.formula = payload.value;
          formula.textContent = payload.displayText || `$${payload.value}$`;
          fragment.append(formula);
        } else if (match[1] === "IMAGE" && payload.src) {
          const image = ownerDocument.createElement("img");
          image.src = payload.src;
          image.alt = payload.alt || "";
          if (payload.title) image.title = payload.title;
          image.dataset.srteInline = "true";
          fragment.append(image);
        } else {
          fragment.append(match[0]);
        }
      } catch {
        fragment.append(match[0]);
      }
      cursor = marker.lastIndex;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    textNode.replaceWith(fragment);
  });
  return root.innerHTML;
};
