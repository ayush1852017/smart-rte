# Closing the mammoth recursion investigation: Part 1 fix, Step A follow-up, and the decision that ends it

This closes the loop deliberately rather than letting "find and fix the next instance" continue indefinitely. Four rounds found four independent unguarded-recursion instances across two structurally different attack shapes (tag-nesting depth; reference-chain length); this document fixes the one remaining live gap, resolves the audit's own open question about the rest, and hands the final call to the owner rather than making it unilaterally.

## Part 1 — `findLevel` fixed

`docs/bugs/mammoth-numbering-style-link-chain-recursion.md`'s `docx/numbering-xml.js`'s `findLevel` — the one confirmed, currently-unmitigated crash (a `numStyleLink` reference-chain recursion, reachable via routine numbered-paragraph content, not covered by `nestingGuard.ts` at all since it doesn't touch `document.xml`'s tag-nesting depth) — is fixed. Converted to an iterative loop with explicit cycle detection, extended into the same `patches/mammoth@1.11.0.patch` as the three prior fixes in this chain.

Verified in full:
- `docx/format.test.ts` + `nestingGuard.test.ts`: 18/18, unchanged.
- Full suites: lint clean; core 501/501; react 97/97; full 3-browser 7-file e2e 253/5/0 — all identical to the pre-fix baseline.
- **The real attack, rebuilt exactly as disclosed** (10,000-link chain, real `.docx`, through `importDocxDocumentWithMammoth`): now succeeds in 353ms instead of crashing.
- **A genuine cycle** (`A → B → ... → A`, both 50 and 10,000 links, not just a long finite chain): resolves cleanly, no hang, no crash.
- A normal short chain: unaffected.

Full detail: `docs/bugs/mammoth-numbering-style-link-chain-recursion.md`, now marked Fixed.

## Part 2, Step A — resolving the audit's "is the masking coincidental?" question

`docs/PHASE_9_MAMMOTH_RECURSION_AUDIT.md` listed 9 further candidates (grouped across `body-reader.js`, `document-to-html.js`, `transforms.js`, `html/simplify.js`) as "reachable-but-guarded" without confirming, per candidate, whether that's structural or coincidental. This step resolves exactly that — no new candidate-hunting beyond what the audit already listed.

**Method:** for each masked candidate, the same reasoning used to distinguish `findLevel` from the guard-covered ones — does triggering deep recursion require deep tag-nesting in `document.xml` specifically, or is there another path in?

- **`readXmlElement`/`readXmlElements`, `elementToHtml`/`convertElements`, `walkHtml`, `replaceDeferred`, `transformElement`, `visitDescendants`, `collapse`/`collapseNode`/`collapseElement`, `removeEmpty`/`elementEmptier`** (8 of the 9): each recurses by walking `.children` one level at a time — the document-model tree these operate on is built directly from the parsed XML tree, and (confirmed during the original audit, re-confirmed here) "pass-through" element types never add a model-tree level beyond their source XML nesting. Reaching pathological depth in any of these requires pathological depth in `document.xml` itself. Structurally guard-covered — no alternate trigger shape exists for these.
- **`appendChild`** (`html/simplify.js:36`), the one candidate the audit itself flagged as "not independently verified": this one warranted an actual check rather than the same reasoning by inspection alone, because merging *adjacent same-tag elements* sounded plausibly width-driven (many sibling runs) rather than depth-driven — which would have been a second independent-attack-shape finding, the same category as `findLevel`. Ran a quick, cheap empirical check (not a full crafted `.docx` — a direct call to `html/simplify.js`'s exported `simplify()` with two synthetic node trees): **100,000 adjacent same-tag siblings at one level succeeded with no crash**; **10,000 same-tag elements nested one inside another crashed** with the same `RangeError`. This confirms `appendChild`'s recursion is genuinely depth-driven (merging only recurses when a mergeable element's *own children* are themselves deeply-nested mergeable elements), not sibling-count-driven — structurally guard-covered after all, same as the other 8.

**Result: 0 of the 9 previously-masked candidates are independent-attack-shape. All 9 are genuinely guard-covered-for-real**, not just incidentally protected by chance. `findLevel` remains the only candidate found in this entire investigation (across the original three rounds plus the systematic audit) whose trigger shape the existing guard doesn't cover — and it's now fixed.

No new candidate functions were searched for in this step, per the explicit scope. No source, patch, or guard code was modified (`git status` before and after this step showed zero additional changes beyond Part 1's).

## Part 2, Step B — the decision

**Current state, precisely:** of the 13 candidates found across this entire investigation — 2 fixed at the root (`xml/reader.js`'s `convertNode`/`convertElement`; `numbering-xml.js`'s `findLevel`, this pass), 9 confirmed genuinely protected by `nestingGuard.ts` (root cause still open, but Step A confirmed the protection is structural, not coincidental), 1 not reachable from our usage at all, and 1 (`office-xml-reader.js`'s `collapseAlternateContent`) also in the "guard-covered" 9. **There is no known, currently-exploitable gap as of this pass.**

That is a materially better position than existed when this closing step began (which had one confirmed-live hole) or right after the original audit (which had nine candidates of genuinely uncertain status). The systemic-pattern finding from the audit — recursive, unguarded tree-walking scattered across six files, evidence of an authorship style rather than a few isolated bugs — remains true and remains a real concern for *undiscovered* functions with an *as-yet-unconsidered* trigger shape (the way `findLevel`'s reference-chain shape was, until it was specifically found). Nothing in Step A changes that broader risk; it only confirms that everything *already found* is currently handled.

**Recommendation: (c), accept the current state as sufficient for now**, with this document serving as the explicit record of what's accepted and why:
- **Layers 1 and 2** (the `@xmldom/xmldom` CVEs; `xml/reader.js`'s recursion) are fixed at the root, verified against the real attack.
- **Layer 3** (`collapseAlternateContent`) and the **8 further candidates found in the systematic audit** are root-cause-open but confirmed (not just assumed) practically mitigated by `nestingGuard.ts`, which Step A established is a structural protection for all of them, not a lucky coincidence.
- **`findLevel`** is fixed at the root, this pass.
- **The residual, accepted risk:** a not-yet-discovered function elsewhere in mammoth's codebase, with a trigger shape neither `nestingGuard.ts` nor any future extension of it happens to cover — exactly the class of gap `findLevel` was until this specific investigation found it. This risk is real but is now bounded to "unknown unknowns," not "known, unaddressed gaps."

Reasoning against the alternatives, stated plainly:
- **(a), fixing/guarding the remaining 9 individually** is not justified right now — they're not live gaps, and converting nine more functions to iterative/guarded forms for candidates that are already provably unreachable in the current shipped state is effort spent on a risk that's already closed, not one that's open. Revisit this specifically if any of the nine is later found reachable through a shape the guard doesn't cover (the same way `appendChild` was checked and ruled out here).
- **(b), replacing mammoth**, is not something this pass recommends starting now, precisely *because* there is no live gap forcing the decision — doing a multi-week dependency replacement under no active pressure risks being worse-scoped and worse-prioritized than doing it later as a deliberate initiative (candidate library evaluation, migration effort, whether `importDocxDocumentWithMammoth`'s public behavior can stay compatible — none of that has been scoped, and none of it should be started in this pass or without separate, explicit authorization). The evidence gathered across this whole investigation (13 candidates, 6 files, a demonstrated pattern) is real and worth taking seriously — it just doesn't require acting *today*, given nothing found is currently exploitable.

**Revisit trigger, so this isn't left open indefinitely with no return point:** before any `latest`-tag publish (already the standing criterion in `docs/PHASE_9_RELEASE_POLICY.md`, which this document doesn't relax), and independently, before Phase 11's security review if one is planned. Either occasion should re-open this specific question — has anything changed about mammoth's reachable surface, has a new candidate been found through routine use or further investigation — rather than assuming this document's "no live gap" finding stays true forever without re-checking it.

## Is Phase 9's security work done?

**Yes, pending only the decision recorded above** (which is explicitly the owner's to make, not executed in this pass) **and the still-open, unrelated items already tracked in `docs/PHASE_9_RELEASE_POLICY.md`** (the 29 deferred e2e tests, NVDA+Chrome validation, the native Windows Word capture — none of which this investigation touched or was ever in scope to touch).

Specifically for the mammoth/dependency-security thread this document closes: no further mammoth-specific investigation is planned or recommended as part of Phase 9. This is the last report in that thread. `docs/PHASE_9_RELEASE_POLICY.md`'s item 8 should be read alongside this document as the final word on it, not superseded by a future round of the same investigation, unless the revisit trigger above is hit.

## Test counts

- **Part 1:** real diff, as expected — core 495→501 was already the case before this pass (the `nestingGuard.test.ts` addition from the prior round); this pass's fix added no new tests of its own (verified via the isolated reproduction scripts described above, run directly, not added to the committed suite) but did not change the 501/97/253 counts either. Confirmed identical before and after Part 1's fix: lint clean, core 501/501, react 97/97, e2e 253/5/0.
- **Step A:** zero diff, as required — `git status` showed no changes beyond Part 1's before Step A began, and none after it completed. Step A was pure investigation (code reading) plus one inline, not-committed Node script for the `appendChild` check.

No test was added, removed, or renamed by either part.
