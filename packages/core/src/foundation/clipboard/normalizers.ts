import { parseCanonicalListMarkdown, serializeCanonicalListHtml } from "../list/formats.js";
import type { NormalizedClipboardPayload, SanitizedClipboardPayload, SourceNormalizer } from "./types.js";

const listTags = new Set(["UL", "OL"]);
const blockSelector = ":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > ul, :scope > ol, :scope > blockquote, :scope > pre, :scope > table, :scope > div";

const unwrap = (element: Element) => element.replaceWith(...Array.from(element.childNodes));

const normalizeTransparentContainers = (document: Document) => {
  const docsWrapper = document.body.querySelector('[id^="docs-internal-guid-"]');
  if (docsWrapper && docsWrapper.parentElement === document.body) unwrap(docsWrapper);
  [...document.body.querySelectorAll("div")].reverse().forEach((element) => {
    if (element.querySelector(blockSelector)) unwrap(element);
    else if (element.parentElement === document.body || element.parentElement?.tagName === "LI") {
      const paragraph = document.createElement("p");
      paragraph.append(...Array.from(element.childNodes));
      element.replaceWith(paragraph);
    }
  });
  const directNodes = Array.from(document.body.childNodes);
  let paragraph: HTMLParagraphElement | null = null;
  directNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      paragraph ||= document.createElement("p");
      if (!paragraph.parentNode) document.body.insertBefore(paragraph, node);
      paragraph.append(node);
    } else if (node.nodeType === Node.ELEMENT_NODE && !["BR", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "A", "CODE"].includes((node as Element).tagName)) {
      paragraph = null;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      paragraph ||= document.createElement("p");
      if (!paragraph.parentNode) document.body.insertBefore(paragraph, node);
      paragraph.append(node);
    }
  });
};

interface ListEntry {
  level: number;
  list: HTMLElement;
  item: HTMLElement;
}

const declaredLevel = (item: Element): number | null => {
  const value = Number(item.getAttribute("data-aria-level") || item.getAttribute("aria-level"));
  return Number.isInteger(value) && value > 0 ? value : null;
};

const listShell = (source: HTMLElement) => {
  const shell = source.cloneNode(false) as HTMLElement;
  shell.removeAttribute("start");
  return shell;
};

/** Regroups Office/Docs runs that encode each visual item as a sibling list. */
const normalizeDeclaredLevelLists = (document: Document) => {
  const visit = (parent: Element) => {
    const children = Array.from(parent.children);
    for (let index = 0; index < children.length;) {
      const first = children[index] as HTMLElement;
      const firstItems = listTags.has(first.tagName) ? Array.from(first.children).filter((child) => child.tagName === "LI") as HTMLElement[] : [];
      if (!firstItems.some((item) => declaredLevel(item) !== null)) {
        index += 1;
        continue;
      }
      const run: HTMLElement[] = [];
      while (index < children.length && listTags.has(children[index].tagName)) run.push(children[index++] as HTMLElement);
      const entries: ListEntry[] = run.flatMap((list) => Array.from(list.children)
        .filter((child) => child.tagName === "LI")
        .map((item) => ({ level: declaredLevel(item) || 1, list, item: item as HTMLElement })));
      if (!entries.length) continue;

      const roots: HTMLElement[] = [];
      const stacks: HTMLElement[] = [];
      const lastItems: HTMLElement[] = [];
      entries.forEach((entry) => {
        const level = Math.min(entry.level, stacks.length + 1);
        const parentItem = level > 1 ? lastItems[level - 2] : undefined;
        let target = stacks[level - 1];
        const needsList = !target || target.tagName !== entry.list.tagName || (level > 1 && target.parentElement !== parentItem);
        if (needsList) {
          target = listShell(entry.list);
          if (level === 1) roots.push(target);
          else parentItem?.append(target);
          stacks[level - 1] = target;
        }
        stacks.length = level;
        lastItems.length = level;
        entry.item.removeAttribute("aria-level");
        entry.item.removeAttribute("data-aria-level");
        target.append(entry.item);
        lastItems[level - 1] = entry.item;
      });
      run[0].replaceWith(...roots);
      run.slice(1).forEach((list) => list.remove());
    }
    Array.from(parent.children).forEach((child) => visit(child));
  };
  visit(document.body);
};

const normalizedHtml = (payload: SanitizedClipboardPayload, id: string): NormalizedClipboardPayload => {
  normalizeTransparentContainers(payload.document);
  normalizeDeclaredLevelLists(payload.document);
  return { html: payload.document.body.innerHTML, plainText: payload.plainText, repairs: [`${id}:transparent-containers-and-declared-list-levels`] };
};

export const wordClipboardNormalizer: SourceNormalizer = {
  id: "word",
  sources: ["word"],
  normalize: (payload) => normalizedHtml(payload, "word"),
};

export const googleDocsClipboardNormalizer: SourceNormalizer = {
  id: "google-docs",
  sources: ["google-docs"],
  normalize: (payload) => normalizedHtml(payload, "google-docs"),
};

export const spreadsheetClipboardNormalizer: SourceNormalizer = {
  id: "spreadsheet",
  sources: ["spreadsheet"],
  normalize(payload) {
    normalizeTransparentContainers(payload.document);
    return { html: payload.document.body.innerHTML, plainText: payload.plainText, repairs: ["spreadsheet:transparent-containers"] };
  },
};

export const htmlClipboardNormalizer: SourceNormalizer = {
  id: "generic-html",
  sources: ["html", "native"],
  normalize: (payload) => normalizedHtml(payload, "generic-html"),
};

export const markdownClipboardNormalizer: SourceNormalizer = {
  id: "markdown",
  sources: ["markdown"],
  normalize(payload) {
    const document = parseCanonicalListMarkdown(payload.plainText);
    return {
      html: serializeCanonicalListHtml(document, { clean: true, fragment: true }),
      plainText: payload.plainText,
      repairs: ["markdown:gfm-parse"],
    };
  },
};

export const plainTextClipboardNormalizer: SourceNormalizer = {
  id: "plain-text",
  sources: ["plain-text"],
  normalize(payload) {
    return { html: payload.html, plainText: payload.plainText, repairs: [] };
  },
};

export const capturedSourceNormalizers = Object.freeze([
  wordClipboardNormalizer,
  googleDocsClipboardNormalizer,
  spreadsheetClipboardNormalizer,
  markdownClipboardNormalizer,
  htmlClipboardNormalizer,
  plainTextClipboardNormalizer,
]);
