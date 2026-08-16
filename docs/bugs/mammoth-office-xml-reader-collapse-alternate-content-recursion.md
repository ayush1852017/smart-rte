# Mammoth's collapseAlternateContent has unguarded recursion — a third instance of the same bug class

**Status:** Open at the root cause; **practically mitigated** by the entry-point depth guard added in `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`'s fix. Not patched directly — out of scope for that pass, found only while verifying its fix.
**Area:** formats / docx / security
**First reported:** 2026-08-16, while verifying the fix for `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`
**Related files:** `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md` (the investigation that led here — fixing that bug's `convertNode`/`convertElement` moved the crash to this function, which was previously masked); `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` (the original investigation this whole chain started from)

## Symptom

After converting `mammoth/lib/xml/reader.js`'s `convertNode`/`convertElement` to an iterative traversal (fixing `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`) and verifying that fix in isolation (succeeds up to 500,000 nesting levels), the exact same real-attack reproduction — a `.docx` with 10,000 levels of nesting, run through `mammoth.convertToHtml` — **still crashed**, with a different stack trace than before:

```
RangeError: Maximum call stack size exceeded
    at Array.map (<anonymous>)
    at Boolean.collapseAlternateContent (mammoth/lib/docx/office-xml-reader.js:67)
    at Array.map (<anonymous>)
    at Boolean.collapseAlternateContent (mammoth/lib/docx/office-xml-reader.js:67)
    ... (repeats)
```

## Reproduction

Same construction as the two prior entries in this chain: a real `.docx` built with `jszip`, containing a paragraph with 10,000 levels of nested `<w:sdt><w:sdtContent>` elements in `word/document.xml`, run through `mammoth.convertToHtml({ buffer })` (the exact call `importDocxDocumentWithMammoth`, `packages/core/src/foundation/formats/docx/import.ts`, makes).

## Root cause

`mammoth/lib/docx/office-xml-reader.js:63-72`:

```js
function collapseAlternateContent(node) {
    if (node.type === "element") {
        if (node.name === "mc:AlternateContent") {
            return node.firstOrEmpty("mc:Fallback").children;
        } else {
            node.children = _.flatten(node.children.map(collapseAlternateContent, true));
            return [node];
        }
    } else {
        return [node];
    }
}
```

Called from `read()` (`office-xml-reader.js:38-42`) immediately after `xml.readString(...)` resolves — i.e. it walks the *already-converted* node tree that `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`'s now-fixed `reader.js` produces, looking for `<mc:AlternateContent>` elements (a real, common OOXML construct: "try this modern markup, fall back to this older markup if the reader doesn't support it" — not an obscure edge case, and present in many real-world Word documents, e.g. anything authored with a recent Word version that uses newer markup with an older-Word fallback). For every non-`AlternateContent` element it recurses into `node.children.map(collapseAlternateContent, true)` — one JS call-stack frame per level of nesting, via `Array.prototype.map`'s own internal call mechanism rather than a hand-written loop, but functionally the identical unguarded-recursion pattern as the two bugs already found and fixed in this investigation chain.

This function is called unconditionally as part of `office-xml-reader.js`'s `read()` — mammoth's actual DOCX-specific top-level XML reader, used for `word/document.xml` and other DOCX XML parts — so it is exactly as reachable and exactly as "always executed" as the two prior bugs in this chain.

## Fix

**Not applied at the root.** This is now the third instance of the same bug class found in mammoth's own code (bundled `@xmldom/xmldom@0.8.11`, then `reader.js`'s `convertNode`/`convertElement`, now this) — each fix uncovering the next, previously-masked one. This pattern is itself the key finding: it suggests further, not-yet-discovered instances may exist elsewhere in mammoth's codebase, and continuing to fix them one at a time as each is uncovered by re-running the real attack is not an efficient way to reach confidence that *all* instances are closed.

**Practically mitigated, not fixed:** `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`'s fix pass added `packages/core/src/foundation/formats/docx/nestingGuard.ts`, a depth check run on `word/document.xml` before `importDocxDocumentWithMammoth` ever calls into mammoth. A `.docx` deep enough to reach *this* function's crash threshold is, by construction, far deeper than the guard's 1,000-level limit — the guard rejects it before mammoth (and therefore this function) ever runs. Verified: the same 10,000-level reproduction that crashed here is now rejected cleanly by the guard with a `DocxNestingTooDeepError`, not a `RangeError`.

**This mitigation is not the same as a fix, and that distinction matters going forward:**
- The guard only covers `word/document.xml`. If `collapseAlternateContent` (or another undiscovered instance) is reachable through a different XML part mammoth reads (`word/numbering.xml`, `word/styles.xml`, headers/footers, `word/comments.xml`, etc.) that the guard doesn't check, this bug's root cause remains directly exploitable through that path. Not investigated in this pass — scoping which other parts mammoth reads and whether any are similarly reachable is unstarted.
- If the guard is ever removed, relaxed, or bypassed (e.g. a future refactor that stops routing DOCX import through `importDocxDocumentWithMammoth`, or a threshold increase without re-examining why 1,000 was chosen), this bug's root cause is immediately live again with no independent protection.
- The guard's 1,000-level threshold is well below this function's actual crash depth (unmeasured precisely, but the reproduction's 10,000-level payload crashed it, same general order of magnitude as the other two now-fixed functions) — there is real margin, but it has not been used to establish a *safety* margin specific to this function, since the guard was sized against the general problem, not this function individually.

Options for a real fix, not evaluated in depth here (a new scope decision):
1. Convert `collapseAlternateContent` to an iterative walk, the same pattern used for `reader.js`'s fix — the natural next step, and likely the smallest unit of remaining work given the established pattern, but should prompt a broader question first (see 3).
2. Extend the nesting guard's coverage to every XML part mammoth reads, not just `word/document.xml` — closes the "guard doesn't cover this path" gap without touching mammoth's internals again, but doesn't address the "guard removed later" risk.
3. **A systematic audit of mammoth's entire codebase for other unguarded recursive functions**, rather than continuing to find them one at a time via the real-attack-reproduction method that surfaced these three. Given the pattern established across this investigation (three found so far, each masking the next), this is worth seriously considering before assuming the codebase is otherwise clean.
4. Replace mammoth's DOCX parsing entirely — same large-scope option already on the table for the other two findings in this chain, now with more evidence behind it (three independent bugs of the same class found in one library, discovered incidentally rather than via a deliberate audit).

## Regression coverage

None directly for this function (unfixed at the root). Indirectly covered by the depth guard's own tests (`nestingGuard.test.ts`) and by the fact that the real-attack reproduction used to find this bug is now documented and repeatable — any future fix attempt should be verified against it directly, not just against unit tests, per the standing lesson this entire investigation chain demonstrates.

## Related/similar issues

`docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` and `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md` — the first two instances of this exact bug class found in mammoth's dependency and own code respectively, both now fixed. This is the third. See the "systematic audit" option above for the implication of three independent instances found this way.
