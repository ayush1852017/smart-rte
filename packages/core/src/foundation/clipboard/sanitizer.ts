import createDOMPurify, { type WindowLike } from "dompurify";
import { sanitizeLinkHref, sanitizeResourceUrl } from "../security/urlPolicy.js";
import type { ClipboardSource, SanitizedClipboardPayload } from "./types.js";

const allowedClipboardImageData = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const dangerousCss = /(?:expression\s*\(|url\s*\(|@import\b|behavior\s*:|-moz-binding\s*:)/i;

const parseSanitizedDocument = (ownerDocument: Document, html: string): Document => {
  const parser = new ownerDocument.defaultView!.DOMParser();
  return parser.parseFromString(html, "text/html");
};

/** Security boundary. Source normalizers can only receive the branded result. */
export const sanitizeClipboardHtml = (
  ownerDocument: Document,
  source: ClipboardSource,
  html: string,
  plainText: string,
): SanitizedClipboardPayload => {
  if (!ownerDocument.defaultView) throw new Error("Clipboard sanitization requires a DOM window.");
  const purifier = createDOMPurify(ownerDocument.defaultView as unknown as WindowLike);
  purifier.addHook("uponSanitizeAttribute", (_node, event) => {
    const name = event.attrName.toLowerCase();
    if (name.startsWith("on")) {
      event.keepAttr = false;
      return;
    }
    if (name === "style" && dangerousCss.test(event.attrValue)) {
      event.keepAttr = false;
      return;
    }
    if (name === "href" || name === "xlink:href") {
      const safe = sanitizeLinkHref(event.attrValue);
      if (safe) event.attrValue = safe;
      else event.keepAttr = false;
      return;
    }
    if (name === "src" || name === "poster") {
      const safe = sanitizeResourceUrl(event.attrValue, { allowedDataMimeTypes: allowedClipboardImageData });
      if (safe) event.attrValue = safe;
      else event.keepAttr = false;
    }
  });
  const sanitized = purifier.sanitize(html, {
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml", "http://www.w3.org/1998/Math/MathML"],
    ALLOW_DATA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style", "svg"],
    FORBID_CONTENTS: ["script", "iframe", "object", "embed", "form", "style", "svg"],
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: /^x-[a-z0-9-]+$/,
      attributeNameCheck: null,
      allowCustomizedBuiltInElements: false,
    },
  });
  return {
    source,
    html: sanitized,
    plainText,
    document: parseSanitizedDocument(ownerDocument, sanitized),
  } as SanitizedClipboardPayload;
};
