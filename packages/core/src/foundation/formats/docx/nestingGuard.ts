/**
 * Defense-in-depth against pathologically deep XML inside a `.docx` package.
 *
 * Not the real fix for any specific recursion bug - see
 * docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md and
 * docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md for those (an
 * iterative rewrite of mammoth's own XML-to-node conversion, and a pinned/
 * patched @xmldom/xmldom). This exists because verifying those two fixes
 * against the real attack surfaced a *third*, independent unguarded-recursion
 * function elsewhere in mammoth's own code (`office-xml-reader.js`'s
 * `collapseAlternateContent`, out of scope to patch here) - a pattern of
 * multiple such functions, not one isolated bug. A cheap, iterative (never
 * recursive - this guard must not become another instance of the same class
 * of bug) upfront depth check protects against that specific function and
 * any other not-yet-discovered one, without waiting on an exhaustive audit
 * of mammoth's entire codebase.
 *
 * Deliberately coarse, not a real XML parser: a linear scan counting
 * tag-open/tag-close balance. Does not correctly account for `<`/`>`
 * characters inside comments, CDATA sections, or attribute values - for a
 * generously-set threshold, that only risks *under*-counting depth (a
 * false negative, i.e. missing a genuinely deep document), never rejecting
 * a shallow legitimate one, so it stays a safe, one-directional guard.
 */

/** Real Word documents essentially never nest structurally beyond a few
 * dozen levels even in pathological cases (tables nested in tables nested
 * in tracked-change wrappers nested in content controls). The disclosed
 * @xmldom/xmldom recursion advisory measured crash thresholds starting
 * around 5,000 levels for the lightest-per-frame operations tested. 1,000
 * sits an order of magnitude above any plausible real document and a
 * comfortable margin below the lowest crash threshold observed for any
 * function measured so far, leaving room for an undiscovered function with
 * heavier per-frame stack usage than anything tested to date. */
export const MAX_DOCX_XML_NESTING_DEPTH = 1000;

export class DocxNestingTooDeepError extends Error {
  constructor(depth: number, max: number) {
    super(`DOCX document.xml nests ${depth} levels deep, exceeding the ${max}-level safety limit.`);
    this.name = "DocxNestingTooDeepError";
  }
}

const TAG_PATTERN = /<(\/?)([^\s/>!?][^>]*?)(\/?)>/g;

/** Returns the deepest tag-nesting level found, without recursing. */
export const maxXmlNestingDepth = (xml: string): number => {
  let depth = 0;
  let peak = 0;
  TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(xml))) {
    const isClosing = match[1] === "/";
    const isSelfClosing = match[3] === "/";
    if (isClosing) {
      depth = Math.max(0, depth - 1);
    } else if (!isSelfClosing) {
      depth += 1;
      if (depth > peak) peak = depth;
    }
  }
  return peak;
};

export const assertDocxXmlWithinDepthLimit = (xml: string, max: number = MAX_DOCX_XML_NESTING_DEPTH): void => {
  const depth = maxXmlNestingDepth(xml);
  if (depth > max) throw new DocxNestingTooDeepError(depth, max);
};
