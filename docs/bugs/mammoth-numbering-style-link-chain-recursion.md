# Mammoth's numbering `numStyleLink` chain resolution has unguarded recursion — unmitigated by the existing depth guard

**Status:** Fixed. Converted to an iterative loop with cycle detection, verified against the exact real-attack reproduction below (no longer crashes) plus a genuine A→B→...→A cycle (resolves cleanly, doesn't hang) and normal short chains (unaffected).
**Area:** formats / docx / security
**First reported:** 2026-08-16, during `docs/PHASE_9_MAMMOTH_RECURSION_AUDIT.md`'s systematic audit for further instances of the bug class found in `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`, `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`, and `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md`
**Related files:** the three entries above (same bug class); `packages/core/src/foundation/formats/docx/nestingGuard.ts` (does **not** cover this attack shape — see Root cause)

## Symptom

A `.docx` whose `word/numbering.xml` and `word/styles.xml` define a long chain of numbering-style redirects (each `w:abstractNum` pointing to the next via `w:numStyleLink`) crashes `importDocxDocumentWithMammoth` with `RangeError: Maximum call stack size exceeded` — **even with the existing `nestingGuard.ts` fully active**. Unlike the three prior findings in this chain, this one is not currently mitigated at all.

## Reproduction

Isolated function-level test (`mammoth/lib/docx/numbering-xml.js`'s exported `Numbering`), confirming the recursion itself:

```js
const { Numbering } = require("mammoth/lib/docx/numbering-xml.js");
// nums[i] -> abstractNums[i]; abstractNums[i] (i < depth-1) has numStyleLink
// "style{i}"; styles.findNumberingStyleById("style{i}") resolves to numId
// i+1, continuing the chain. abstractNums[depth-1] is the base case.
const numbering = /* built as above, depth 10000 */;
numbering.findLevel("0", "0");
// RangeError: Maximum call stack size exceeded (depth 100 succeeds in 0ms)
```

Full end-to-end reproduction: a real `.docx` (built with `jszip`) with a single shallow paragraph referencing `w:numId="0"`, a `word/numbering.xml` with 10,000 chained `w:abstractNum`/`w:numStyleLink` entries, and a matching `word/styles.xml` with 9,999 numbering-type styles each redirecting to the next `numId` in the chain — run through `mammoth.convertToHtml({ buffer })` directly, **and** through the real `importDocxDocumentWithMammoth` (`packages/core/src/foundation/formats/docx/import.ts`) with `nestingGuard.ts` active:

```
--- numStyleLink chain depth 50 ---     SUCCEEDED in 15ms
--- numStyleLink chain depth 10000 ---  THREW after 339ms: RangeError - Maximum call stack size exceeded
=== through importDocxDocumentWithMammoth, guard active ===
CRASHED PAST THE GUARD after 296ms: RangeError - Maximum call stack size exceeded
```

## Root cause

`mammoth/lib/docx/numbering-xml.js`, `Numbering`'s `findLevel(numId, level)` (line 19):

```js
function findLevel(numId, level) {
    var num = nums[numId];
    if (num) {
        var abstractNum = abstractNums[num.abstractNumId];
        if (!abstractNum) {
            return null;
        } else if (abstractNum.numStyleLink == null) {
            return abstractNums[num.abstractNumId].levels[level];
        } else {
            var style = styles.findNumberingStyleById(abstractNum.numStyleLink);
            return findLevel(style.numId, level);  // <-- unguarded recursion
        }
    } else {
        return null;
    }
}
```

Every level-lookup that hits a `w:numStyleLink` redirect recurses once per link in the chain, with no depth limit and no cycle detection (a chain that looped back on itself, e.g. A→B→A, would recurse forever the same way, not just a long-but-finite chain).

**This is a genuinely different attack shape from all three prior findings in this chain**, not just a fourth instance of the same shape:
- The other three (`@xmldom/xmldom`'s internal traversal, `xml/reader.js`'s `convertNode`/`convertElement`, `office-xml-reader.js`'s `collapseAlternateContent`) are all driven by **XML tag-nesting depth** in `word/document.xml` — a single element nested N levels inside itself.
- This one is driven by **reference-chain length between sibling definitions** in `word/numbering.xml` (cross-referenced through `word/styles.xml`) — N flat, shallow `<w:abstractNum>` elements, each pointing to the next by ID. There is no deep XML nesting anywhere in the malicious payload; every element in it is only 1-2 levels deep.

This is exactly why `nestingGuard.ts` — a tag-nesting-depth scan of `word/document.xml` specifically — does not and structurally cannot catch it, regardless of threshold: the attack doesn't nest tags at all, and it doesn't touch `document.xml`'s depth in any way. Confirmed directly: the full end-to-end reproduction crashes with the guard fully active, immediately after it (the guard's own check on the shallow `document.xml` passes cleanly, as it should — that document.xml is not, in fact, deeply nested).

`findLevel` is reached from `readNumberingProperties` (`packages/core`'s earlier finding, `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`, cited `body-reader.js`'s call sites) whenever a paragraph references numbering (`w:numPr`/`w:numId`/`w:ilvl`) — a completely routine, common DOCX feature, not an edge case.

## Fix

**Applied** (option 1 from the list previously here): converted `findLevel` to an iterative loop, extended into the same `patches/mammoth@1.11.0.patch` that already fixes the `@xmldom/xmldom` mimeType/errorHandler incompatibilities and `xml/reader.js`'s `convertNode`/`convertElement` — one patch file for this mammoth version, consistent with every prior fix in this chain, no reason found to split it out.

```js
function findLevel(numId, level) {
    var visitedNumIds = {};
    for (;;) {
        if (Object.prototype.hasOwnProperty.call(visitedNumIds, numId)) {
            return null; // cycle detected
        }
        visitedNumIds[numId] = true;

        var num = nums[numId];
        if (!num) return null;
        var abstractNum = abstractNums[num.abstractNumId];
        if (!abstractNum) return null;
        if (abstractNum.numStyleLink == null) {
            return abstractNums[num.abstractNumId].levels[level];
        }
        var style = styles.findNumberingStyleById(abstractNum.numStyleLink);
        numId = style.numId;
    }
}
```

Includes explicit cycle detection (`visitedNumIds`), not just an iteration cap — a genuine `A → B → ... → A` reference cycle now returns `null` cleanly on revisiting a `numId`, rather than looping (or recursing) forever. Every other branch's behavior — including the original's un-null-checked `style.numId` access, which throws if `styles.findNumberingStyleById` returns nothing for a malformed `numStyleLink` — is preserved exactly; only the recursive call itself became a loop iteration.

**Verification, in order:**
1. `docx/format.test.ts` + `nestingGuard.test.ts`: 18/18, unchanged.
2. Full suites: lint clean; core 501/501; react 97/97; full 3-browser 7-file e2e 253/5/0 — all identical to the pre-fix baseline.
3. **The real attack, rebuilt exactly as in this report** (10,000-link `numStyleLink` chain, real `.docx`, through the actual `importDocxDocumentWithMammoth` entry point): **succeeded in 353ms**, producing correct list output — no longer crashes.
4. **A genuine cycle**, not just a long finite chain (`A → B → ... → A`, both at 50 and 10,000 links): resolved cleanly in single-digit-to-low-hundreds of milliseconds, no hang, no crash — `findLevel` correctly returns `null` for the unresolvable cyclic reference, and the paragraph falls back to plain (non-numbered) content rather than the import failing.
5. A normal, short (depth-3) chain: unaffected, still resolves correctly — confirming the fix doesn't change behavior for realistic documents.

## Regression coverage

`docx/format.test.ts` and `nestingGuard.test.ts` (18 tests) exercise the DOCX import path on every run. The real-attack reproduction (10,000-link chain), the cycle reproduction (`A → B → ... → A`), and the normal-chain case above are all repeatable and are the actual proof of this fix, per the standing lesson of this entire investigation chain (verify against the real attack, not just unit tests) — none of the three was a plausible-looking change accepted on inspection alone.

## Related/similar issues

`docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`, `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`, `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md` — same general bug class (unguarded recursion in mammoth's own code or bundled dependency). This was the first one found **not** incidentally covered by the existing `nestingGuard.ts` mitigation (a fundamentally different attack shape — reference-chain length, not tree-nesting depth), and is now, with `xml/reader.js`, the second of the four confirmed instances fixed at the root rather than only mitigated. See `docs/PHASE_9_MAMMOTH_RECURSION_AUDIT.md` for the full systematic audit this was found during, and `docs/PHASE_9_MAMMOTH_FINAL_DECISION.md` for the closing decision on the remaining candidates that audit left open.
