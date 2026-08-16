# Mammoth's own XML-to-node-tree conversion has unguarded recursion — separate from the xmldom CVEs

**Status:** **Fixed.** `convertNode`/`convertElement` converted to an iterative traversal, verified against the actual disclosed reproduction up to 500,000 nesting levels with no crash. **Important:** verifying this fix surfaced a *third*, separate unguarded-recursion function elsewhere in mammoth (`office-xml-reader.js`'s `collapseAlternateContent`) — see `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md`. A defense-in-depth nesting-depth guard added in the same pass (`packages/core/src/foundation/formats/docx/nestingGuard.ts`) closes the practical attack surface for that finding too, even though its own root cause remains unfixed.
**Area:** formats / docx / security
**First reported:** 2026-08-14, while verifying the fix for `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`
**Related files:** `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` (the investigation that led here); `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md` (found while verifying this fix, same pattern, still open at the root)

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

**Applied: option 1 (converted to iterative traversal), extended into the same `pnpm patch` for mammoth that already fixed the xmldom-compatibility issues** (`patches/mammoth@1.11.0.patch`, `mammoth/lib/xml/reader.js`). Kept in one patch file covering this mammoth version, per the explicit instruction — no reason found to split it into a second patch.

The mutually-recursive `convertNode`/`convertElement` pair was rewritten as a single `convertNode(rootNode)` doing an iterative, explicit-stack post-order walk: each stack frame tracks one DOM element, an index cursor into its `childNodes` (an index cursor rather than `Array.prototype.shift()`, to avoid an O(n²) cost on wide sibling lists — nesting *depth* was the vulnerability, but breadth still needed to stay cheap), and the already-converted children collected so far in document order. When a frame has processed all its children, it builds the `Element` and either returns it (root) or pushes it onto its parent frame's `convertedChildren` (matching the original recursive version's exact document-order, filter-non-element/text-nodes behavior).

**§2 — unit-level verification (output shape unchanged for real documents):** `docx/format.test.ts`'s 12 tests assert exact structural/content output for a variety of real DOCX fixtures (marks, headings, lists, tables, images, formulas, links, blockquote/code_block, checklists, Unicode) and all pass unchanged — confirms the iterative rewrite produces identical output to the original recursive version for legitimate input, not just "doesn't crash." Full suites: lint clean; core 501/501 (+6, the new `nestingGuard.test.ts`); react 97/97; full 3-browser, 7-file, no-filter e2e suite 250 passed / 5 expected skips / 0 failures — all identical to baseline.

**§3 — verification against the real attack, not just green tests, per the standing lesson from this exact investigation:**
- Re-ran the exact end-to-end reproduction above (the 10,000-level `.docx` through `mammoth.convertToHtml`, called from `importDocxDocumentWithMammoth`'s own patched flow) — see below re: the new entry-point guard, which now intercepts first. To isolate and verify *this specific* fix on its own, called `reader.js`'s exported `readString` directly (bypassing mammoth's DOCX-specific layers, which is where the *next* recursion point turned out to live — see below): **succeeded with no crash**, `10000`/`50000`/`100000`/`500000` levels all completed (`61ms` / `304ms` / `532ms` / `2676ms` — roughly linear, consistent with a correct O(n) iterative walk, no observed practical ceiling within this test budget).
- Re-confirmed the isolated `@xmldom/xmldom`-level test from this file's original reproduction still passes unaffected (it was never broken by this bug; confirms nothing in this change touched that layer).
- **Running the real end-to-end reproduction through the actual `mammoth.convertToHtml` entry point still crashed** — but with a *different* stack trace, no longer touching `reader.js` at all:
  ```
  RangeError: Maximum call stack size exceeded
      at Array.map (<anonymous>)
      at Boolean.collapseAlternateContent (mammoth/lib/docx/office-xml-reader.js:67)
      ... (repeats)
  ```
  This confirms the fix here is genuinely correct — `reader.js` is no longer the bottleneck — but surfaced a *third*, independent, previously-undisclosed unguarded-recursion function in mammoth's own DOCX-specific processing layer. New entry: `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md`. Out of scope to patch in this pass (a different file, a different pattern of use — `Array.prototype.map` rather than a hand-written tree-walker — and finding it required first fixing this bug, so it could not have been scoped in advance).

## §4 — the depth-guard question, decided: yes, added

The original framing (before this pass) was that a depth guard was optional defense-in-depth, with a real argument against adding it (the real, iterative fix should make it unnecessary for *this* bug, and a threshold risks rejecting legitimate deep documents). **That calculus changed with the `collapseAlternateContent` discovery.** Finding a *third* independent unguarded-recursion function in mammoth's own code — after two rounds of fixing one and immediately hitting another — is evidence of a pattern (multiple such functions scattered across mammoth's codebase), not a single isolated bug fully characterized by the first two fixes. A guard that protects against *whatever* recursion function is hit next, discovered or not, is now worth more than it looked at the start of this investigation.

**Added:** `packages/core/src/foundation/formats/docx/nestingGuard.ts` — a cheap, deliberately non-recursive (linear scan, explicit depth counter, no risk of becoming another instance of this exact bug class) tag-balance scan of `word/document.xml`, run before `importDocxDocumentWithMammoth` (`packages/core/src/foundation/formats/docx/import.ts`) ever calls `mammoth.convertToHtml`. Threshold: **1,000 levels** — reasoned, not arbitrary: real Word documents essentially never structurally nest beyond a few dozen levels even in pathological legitimate cases (tables nested in tables nested in tracked-change wrappers nested in content controls); the disclosed `@xmldom/xmldom` advisory's own measured crash thresholds started around 5,000 levels for the lightest-per-frame operations tested. 1,000 sits an order of magnitude above any plausible real document and a comfortable margin below the lowest crash threshold observed for any function measured to date, leaving room for an as-yet-undiscovered function with heavier per-frame stack cost than anything tested. Verified: the malicious 10,000/50,000/100,000-level `.docx` files are now rejected cleanly (`DocxNestingTooDeepError`, not a crash) in 10-60ms; all 12 real-document DOCX fixture tests still pass unaffected, confirming the threshold doesn't reject anything legitimate the existing test suite exercises.

This guard is what actually closes the *practical* exploitability of `collapseAlternateContent` right now (mammoth never receives the malicious payload at all), even though that function's own root cause remains unfixed — see that entry for the important caveat this creates.

## Regression coverage

`packages/core/src/foundation/formats/docx/format.test.ts` (12 tests, output-shape assertions for real documents) and the new `packages/core/src/foundation/formats/docx/nestingGuard.test.ts` (6 tests: depth measurement correctness, self-closing-tag handling, attribute-value/XML-declaration exclusion, accept-under-threshold, reject-over-threshold, and a test that computing the depth of a 10,000-level document is itself non-recursive). `patches/mammoth@1.11.0.patch` is the permanent fix artifact for the iterative rewrite; removing it would be caught immediately by re-running the real-attack reproduction (not by the unit suite alone, which is exactly the gap this whole investigation exists to close).

## Related/similar issues

`docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` — the investigation this was found during; both now fixed. `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md` — found while verifying this fix, same pattern, root cause still open (practically mitigated by the depth guard added here). All three share the same externally-visible symptom (`RangeError: Maximum call stack size exceeded` on deeply-nested input) and the same practical risk class (DoS via a routine, expected-use feature — DOCX import), across three genuinely independent code locations.
