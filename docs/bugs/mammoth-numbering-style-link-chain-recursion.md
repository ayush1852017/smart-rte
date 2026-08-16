# Mammoth's numbering `numStyleLink` chain resolution has unguarded recursion — unmitigated by the existing depth guard

**Status:** Open, confirmed exploitable through the real production entry point, **not** protected by the existing mitigation
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

**Not applied — audit-only pass, per explicit scope.** This needs its own decision, and likely its own kind of fix rather than a simple guard extension:
1. Convert `findLevel` to an iterative loop with cycle/length detection (straightforward — it's a simple linear chain-follow, easier to convert than the tree-walkers already fixed) — but this only closes *this* specific function, not the general class.
2. A reference-chain-length guard specific to numbering resolution (cap the number of `numStyleLink` hops `findLevel` will follow) — narrower and more targeted than the existing tag-depth guard, would need its own reasoned threshold (a real document's numbering style chains are essentially never more than 1-2 links deep; a limit in the low tens would be extremely generous).
3. See `docs/PHASE_9_MAMMOTH_RECURSION_AUDIT.md` for the broader question this and the other newly-found candidates raise about whether continuing to guard/fix individual functions is the right approach at all.

## Regression coverage

None yet — no fix applied. The isolated `Numbering.findLevel` test and the full crafted-`.docx` reproduction above are both repeatable and should be the basis for verifying whichever fix is eventually chosen, per the standing lesson of this entire investigation chain (verify against the real attack, not just unit tests).

## Related/similar issues

`docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`, `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`, `docs/bugs/mammoth-office-xml-reader-collapse-alternate-content-recursion.md` — same general bug class (unguarded recursion in mammoth's own code or bundled dependency), but this is the first one **not** incidentally covered by the existing `nestingGuard.ts` mitigation, and the first one driven by a fundamentally different attack shape (reference-chain length, not tree-nesting depth). See `docs/PHASE_9_MAMMOTH_RECURSION_AUDIT.md` for the full systematic audit this was found during, including several further candidates (confirmed vulnerable at the function level, currently masked by the existing guard for the tree-nesting-depth attack shape specifically) not yet individually ledgered.
