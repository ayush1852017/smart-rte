# Mammoth's own XML-to-node-tree conversion has unguarded recursion — separate from the xmldom CVEs

**Status:** Open — newly discovered, not fixed, not the same issue as the xmldom vulnerability it was found while verifying
**Area:** formats / docx / security
**First reported:** 2026-08-14, while verifying the fix for `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`
**Related files:** `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` (the investigation that led here; genuinely different root cause, same externally-visible symptom)

## Symptom

After fixing the disclosed `@xmldom/xmldom@0.8.11` vulnerability (override to `^0.9.11` + a `pnpm patch` fixing two mammoth/xmldom incompatibilities — see the related entry), the fix was verified against the actual disclosed PoC reachability path per this project's standing rigor for security fixes: build a real malicious `.docx` and run it through `importDocxDocumentWithMammoth`, not just re-run the test suite.

**The malicious `.docx` still crashes the import with `RangeError: Maximum call stack size exceeded`**, even with the xmldom fix fully in place and verified working in isolation.

## Reproduction

Isolated test proving `@xmldom/xmldom` itself is fixed (run from `packages/core`, with the override + patch applied):

```js
const xmldom = require("mammoth/lib/xml/xmldom.js");
const depth = 10000;
const deepXml = "<root>" + "<a>".repeat(depth) + "text" + "</a>".repeat(depth) + "</root>";
const doc = xmldom.parseFromString(deepXml, "text/xml"); // succeeds
doc.getElementsByTagName("a"); // succeeds, finds 10000 elements, no crash
```

Full end-to-end reproduction (a real `.docx`, built with `jszip`, containing a paragraph with 10,000 levels of nested `<w:sdt><w:sdtContent>` elements, then run through `mammoth.convertToHtml({ buffer })` — the exact call `importDocxDocumentWithMammoth`, `packages/core/src/foundation/formats/docx/import.ts:16`, makes):

```
THREW: RangeError - Maximum call stack size exceeded
    at optimizeCb (underscore-node-f.cjs:713)
    at _$1.each (underscore-node-f.cjs:1324)
    at convertElement (mammoth/lib/xml/reader.js:38)
    at convertNode (mammoth/lib/xml/reader.js:28)
    ... (repeats)
```

## Root cause

`mammoth/lib/xml/reader.js`'s `convertNode`/`convertElement` (lines 25-51) is mammoth's **own** generic XML-to-internal-node-tree conversion — a plain, mutually-recursive pair of JS functions with no depth guard of any kind, using `underscore`'s `_.forEach` to walk each element's children. This runs on **every** parsed XML document, converting `@xmldom/xmldom`'s DOM into mammoth's own `nodes.Element` representation, before any DOCX-specific interpretation happens.

This is completely independent of `@xmldom/xmldom` and unaffected by which version is installed: `reader.js` was not touched by the patch applied for the xmldom vulnerability (only `xml/xmldom.js`'s `parseFromString` wrapper was patched), and `convertNode`/`convertElement` never call any of the seven `@xmldom/xmldom` operations that library's own fix converted to iterative traversal (`normalize`, `serializeToString`, `getElementsByTagName`/etc., `cloneNode`, `importNode`, `textContent`, `isEqualNode`) — it's a separate JS-level recursion mammoth wrote itself. Confirmed pre-existing and unrelated to any change made this session: this code path is identical regardless of `@xmldom/xmldom` version, so it crashed the same way under the vulnerable `0.8.11` too, whenever the *specific* xmldom recursion bugs didn't get hit first (or a document was deep enough to reach this stage regardless).

## Fix

**Not applied.** This is a genuinely separate problem from the xmldom CVEs and needs its own fix, most likely converting `convertNode`/`convertElement` to an iterative, explicit-stack traversal (the same general pattern `@xmldom/xmldom`'s own `walkDOM` utility uses for its equivalent fix — see `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`'s description of that fix for the pattern). This would require patching mammoth again, beyond what's already been patched, and is a new scope decision.

Options, not evaluated in depth here:
1. Extend the existing `pnpm patch` for mammoth to also convert `convertNode`/`convertElement` to an iterative walk.
2. Impose a maximum-depth guard on parsed DOCX XML before mammoth ever processes it (reject documents past a reasonable nesting depth at the `importDocxDocumentWithMammoth` entry point) — simpler to implement, doesn't touch mammoth's internals, but is a blunter mitigation (a depth limit low enough to be safe might reject some legitimate deeply-nested real-world documents; needs a reasoned threshold).
3. Replace mammoth's DOCX parsing entirely — same large-scope option already on the table for the xmldom finding.

## Regression coverage

None yet. Whichever fix is chosen should be verified against the exact reproduction above (a real crafted `.docx`, not just a raw XML string, run through the actual `importDocxDocumentWithMammoth` entry point) — the isolated xmldom-level test alone is insufficient to prove this is fixed, as this investigation itself demonstrated.

## Related/similar issues

`docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` — the investigation this was found during. Genuinely different root cause (mammoth's own code vs. a bundled dependency), same externally-visible crash symptom (`RangeError: Maximum call stack size exceeded` on deeply-nested input), same practical risk class (DoS via a routine, expected-use feature — DOCX import).
