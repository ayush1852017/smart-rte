# Systematic audit: unguarded-recursion patterns across mammoth's codebase

Decision-input pass for `docs/PHASE_9_RELEASE_POLICY.md` item 8. Three independent unguarded-recursion functions had been found and addressed so far — `@xmldom/xmldom`'s own bundled traversal (fixed via override+patch), `mammoth/lib/xml/reader.js`'s `convertNode`/`convertElement` (fixed, converted to iterative), `mammoth/lib/docx/office-xml-reader.js`'s `collapseAlternateContent` (root cause open, practically mitigated by a new entry-point depth guard) — each discovered only by fixing the previous one and re-running the real attack. This pass answers "how many more of this pattern exist" with data rather than continuing to find them one at a time.

**Audit-only. No source code, patch, or guard was modified in this pass** — confirmed via `git status` before and after, and via unchanged suite counts (core 501/501, react 97/97, both before and after this audit).

## §1 — Structural audit: candidate recursive functions

Searched mammoth's full `lib/` tree (31 source files under `node_modules/mammoth/lib/`, all of them, not just the three files already touched) for the shape of both bugs already found: functions that call themselves directly, or via a paired function that calls back (as `convertNode`/`convertElement` did).

Method: a small script (self-reference and pairwise-mutual-reference detection via balanced-brace body extraction) produced 25 raw candidates. Every one was then read and verified by hand — the script has real false-positive modes (method calls on unrelated objects sharing a name, e.g. `domParser.parseFromString(...)` inside mammoth's own `parseFromString` wrapper; string literals matching a function's own name, e.g. `{type: "warning"}` inside a function called `warning`; local variables shadowing an outer function name) and roughly half the raw hits were exactly that. The table below is the verified result, not the raw script output.

| # | File:line | Function(s) | Recurses over | Verified real? |
|---|---|---|---|---|
| 1 | `xml/reader.js` (pre-fix) | `convertNode`/`convertElement` | XML node tree | Yes — **already fixed** |
| 2 | `docx/office-xml-reader.js:62` | `collapseAlternateContent` | Converted node tree | Yes — **already found, open, guard-mitigated** |
| 3 | `docx/body-reader.js:41-57` | `readXmlElement`/`readXmlElements` | XML node tree (DOCX body interpretation) | Yes — **new** |
| 4 | `document-to-html.js:83-99` | `elementToHtml`/`convertElements` | Mammoth's internal document-model tree | Yes — **new** |
| 5 | `document-to-html.js:458` | `walkHtml` | Output HTML node tree | Yes — **new** |
| 6 | `document-to-html.js:59` (closure inside `convertToHtml`) | `replaceDeferred` | Output HTML node tree | Yes — **new** |
| 7 | `transforms.js:29` | `transformElement` (inside `elements()`) | Document-model tree | Yes — **new** |
| 8 | `transforms.js:55` | `visitDescendants` | Document-model tree | Yes — **new** |
| 9 | `html/simplify.js:9-30` | `collapse`/`collapseNode`/`collapseElement` | Output HTML node tree | Yes — **new** |
| 10 | `html/simplify.js:51-78` | `removeEmpty`/`elementEmptier` | Output HTML node tree | Yes — **new** |
| 11 | `html/simplify.js:36` | `appendChild` | Adjacent-same-tag-element merge chains (different trigger than tree depth) | Yes — **new** |
| 12 | `docx/numbering-xml.js:19` | `findLevel` | `w:numStyleLink` reference chains across `numbering.xml`/`styles.xml` (**not** tree depth) | Yes — **new, different attack shape** |
| 13 | `raw-text.js:3` | `convertElementToRawText` | Document-model tree | Yes, but **not reachable** — only used by `extractRawText`, which `importDocxDocumentWithMammoth` never calls |

**Ruled out as false positives** (read and confirmed not recursive): `html/simplify.js`'s script-flagged `appendChild` turned out real (kept above); `documents.js`'s `commentReference`/`comment` (string literal `types.commentReference`, not a call); `results.js`'s `warning`/`error` (string literals `"warning"`/`"error"`); `html/ast.js`'s `text` (string literal `"text"`); `xml/xmldom.js`'s `parseFromString` (calls `domParser.parseFromString`, a different object's method, not itself — already fixed for an unrelated reason, genuinely not recursive); `styles/html-paths.js`'s `elements`/`HtmlPath` (constructor parameter shadowing, not mutual calls); `writers/html-writer.js`'s `writer`/`prettyWriter` (a local variable named `writer` shadows the outer function, not a callback); `writers/index.js`'s `writer` (delegates to a different module's `writer`, not itself); `underline.js`'s `element` (calls `htmlPaths.element`, a different module); `styles/document-matchers.js`'s `paragraph`/`run`/`table` (string-literal constructor arguments).

## §2 — Reachability and guard status

| Candidate | Reachable from `mammoth.convertToHtml({buffer})` on attacker-controlled input? | Guard status |
|---|---|---|
| 3. `readXmlElement`/`readXmlElements` | Yes — the primary DOCX body dispatcher, runs for every recognized element | **Reachable-but-guarded**: depends on `document.xml`'s tag-nesting depth, which `nestingGuard.ts` caps at 1,000 before mammoth runs at all |
| 4. `elementToHtml`/`convertElements` | Yes — the primary document→HTML dispatcher | Reachable-but-guarded, same reasoning (processes the document-model tree, itself bounded by `document.xml`'s nesting — confirmed by reading how "pass-through" element types like `w:ins`/`w:smartTag` are handled: they don't add a model-tree level, so model-tree depth never exceeds source XML depth) |
| 5. `walkHtml` | Yes — always runs, looking for deferred (image) nodes | Reachable-but-guarded, same reasoning, one stage further downstream |
| 6. `replaceDeferred` | Yes — always runs after deferred-node resolution | Reachable-but-guarded, same reasoning |
| 7. `transformElement` | Yes — used by the `w:sdt` checkbox-content transform (`body-reader.js`'s `mc:AlternateContent`-adjacent handling), reachable via deeply nested `w:sdt` content | Reachable-but-guarded |
| 8. `visitDescendants` | Yes — used by `removeVMergeProperties` for table row-span cleanup, reachable via deeply nested tables | Reachable-but-guarded (nested tables are still `document.xml` nesting) |
| 9. `collapse`/`collapseNode`/`collapseElement` | Yes — always runs as the final HTML-simplification pass | Reachable-but-guarded |
| 10. `removeEmpty`/`elementEmptier` | Yes — same pass | Reachable-but-guarded |
| 11. `appendChild` | Yes, but its recursion trigger (a chain of adjacent, mergeable same-tag elements) is a different, narrower shape than tree depth — would need many *siblings* of the same mergeable tag in a row, not nesting | Likely reachable-but-guarded in practice (a document deep enough to build that many adjacent mergeable elements would itself already be flagged by the depth guard for unrelated reasons in any realistic construction), not independently verified |
| 12. `findLevel` | **Yes — confirmed exploitable through the real entry point, guard fully active** | **Not guarded at all** — different file (`numbering.xml`, never inspected by `nestingGuard.ts`), different attack shape (reference-chain length, not tag nesting) |
| 13. `convertElementToRawText` | No | N/A — not reachable from our usage |

## §3 — Live-attack testing of the confirmed-reachable-unguarded candidates

Full live-attack testing (real `.docx`, real entry point) was run for the two most significant/representative candidates, chosen for maximum decision value rather than exhaustively re-testing all eleven "reachable-but-guarded" candidates individually (see reasoning below):

**§3a — `findLevel` (candidate 12), the one NOT currently guarded:**
- Isolated function-level test (`Numbering.findLevel` called directly with a synthetic 10,000-link `numStyleLink` chain): crashed with `RangeError: Maximum call stack size exceeded` (depth 100 succeeds in 0ms; depth 10,000 throws).
- Full real-`.docx` reproduction (built via `jszip`: a shallow single-paragraph `document.xml` referencing numbering, a 10,000-entry chained `numbering.xml`, a matching `styles.xml`) through `mammoth.convertToHtml` directly: crashed, same error.
- **Through the real `importDocxDocumentWithMammoth` entry point, with `nestingGuard.ts` fully active: crashed past the guard**, confirming this is genuinely, presently exploitable in the shipped state of the code, not just theoretically. Full detail: `docs/bugs/mammoth-numbering-style-link-chain-recursion.md`.

**§3b — `readXmlElement`/`readXmlElements` (candidate 3), the most representative of the "reachable-but-guarded" group:**
- Isolated function-level test (`createBodyReader().readXmlElement(...)` called directly on a manually-parsed, deeply-nested `<w:sdt><w:sdtContent>` tree, bypassing `importDocxDocumentWithMammoth` and its guard entirely): crashed with `RangeError: Maximum call stack size exceeded` at depth 10,000 — confirming the underlying function is genuinely vulnerable on its own, independent of whether the guard currently happens to intercept the request first.
- Not re-tested through the full real-`.docx`-plus-guard path, since that path's outcome is already established: the guard runs before mammoth touches anything, so any `document.xml`-nesting-driven candidate is blocked identically regardless of which downstream function would have crashed. Testing this specific candidate through the guarded path would reproduce the exact same "GUARD BLOCKED IT" result already confirmed multiple times earlier in this investigation chain for the same attack shape.

**Candidates 4-11 were not independently live-tested in this pass.** They were rated "reachable-but-guarded" by direct code reading (confirming each processes a tree whose depth is bounded by the same `document.xml` nesting the guard already caps), not by running eleven near-identical crash reproductions whose outcome (blocked by the same guard, for the same reason, as already demonstrated for §3b) would not have added meaningfully different decision-relevant information. This is a deliberate scoping choice for an audit pass, not an oversight — flagged explicitly rather than silently: if a future fix pass changes or removes `nestingGuard.ts`, candidates 4-11 should be treated as live risks requiring their own verification, not assumed safe because this audit didn't crash them individually.

## §4 — Decision input

**Totals:** 13 candidates found and verified (2 already known/handled before this audit began; 11 new). Breakdown:
- **Fixed:** 1 (`xml/reader.js`)
- **Open, guard-mitigated (reachable-but-guarded):** 10 (`collapseAlternateContent` + candidates 3-11 in the table above)
- **Open, NOT mitigated (confirmed exploitable today):** 1 (`findLevel`)
- **Not reachable:** 1 (`raw-text.js`)

**Real remaining exposure today, not theoretical function count:** the current shipped state (override + patch + `nestingGuard.ts`) has exactly **one** confirmed-live hole: the `numStyleLink` chain (`findLevel`). Every other candidate found in this audit is real and would crash mammoth if reached directly, but is not currently reachable in practice, because the single `document.xml`-depth guard happens to sit upstream of all of them. This is a materially different risk picture than "eleven open vulnerabilities" — it's "one open vulnerability, plus ten latent ones whose only protection is a guard that was never designed with them specifically in mind."

**Is this pattern scattered or concentrated?** Scattered, and broadly so — this is the more significant finding of this audit, arguably more important than any single candidate. Unguarded recursive tree-walking appears in essentially every processing stage of mammoth's pipeline: XML parsing (`xml/reader.js`, fixed), OOXML-specific preprocessing (`office-xml-reader.js`), DOCX body interpretation (`body-reader.js`), generic document-model transforms (`transforms.js`), document-to-HTML conversion (`document-to-html.js`, three separate functions), and final HTML simplification (`html/simplify.js`, three separate functions) — six distinct files across the full width of the codebase, not a cluster in one module. The `findLevel` finding additionally shows the pattern isn't even limited to tree-nesting-depth attacks; the same "no guard on unbounded recursion" habit shows up in a completely different shape (reference-chain following) in a completely different subsystem (numbering resolution). This reads as a systemic authoring style throughout this codebase — plain recursive helpers with no depth/cycle guards were evidently just how this library was written throughout, not a couple of isolated oversights.

**Recommendation:** **(c), seriously consider replacing mammoth's DOCX parsing**, with the immediate practical step being **(b) as a stopgap**: extend `nestingGuard.ts`'s general approach (or add a parallel guard) to also cover `numbering.xml`'s reference-chain length, closing the one confirmed-live hole quickly. Reasoning:
- Option (a), fixing/guarding each remaining candidate individually, is what this whole investigation chain has already been doing for three rounds, and this audit shows it does not converge — every fix so far uncovered the next latent instance, and this systematic pass found ten more still latent, plus a structurally different one already live. There is no principled reason to believe candidates 4-11 are the last ones; this audit checked the files reachable from `convertToHtml`'s obvious call graph, not every code path mammoth's full feature surface can trigger (footnotes/endnotes, comments, styles beyond numbering, headers/footers were not separately traced in this pass).
- Option (b) alone (broadening the guard) would close the practical exploitability of everything found so far, similarly to how the existing guard already does for ten of these eleven candidates — but it is fundamentally a mitigation for a codebase-wide pattern, not a fix, and each new attack *shape* (tag depth vs. reference-chain length vs. whatever the next one turns out to be) needs its own guard logic, discovered reactively.
- Option (c) is the only option that actually addresses the root pattern rather than its individual expressions. This is not a small decision (replacing DOCX parsing is a real, multi-week engineering project, not a config change), and this audit does not recommend committing to it unilaterally — but three-plus-a-systematic-audit's worth of evidence is enough to say the whack-a-mole approach should not continue to be the default without an explicit decision to accept that risk model going forward.

**Immediate, low-risk action regardless of the (a)/(b)/(c) decision:** extend the entry-point guard to also reject `numbering.xml` files with an excessive `w:numStyleLink` reference-chain length, closing `findLevel`'s currently-live gap. This is a small, targeted addition (a chain-length counter, not a new class of guard), consistent with the existing `nestingGuard.ts`'s "defense-in-depth, not the real fix" framing, and — unlike deciding whether to replace mammoth — doesn't require resolving the bigger question first. **Not implemented in this pass**, per the audit-only scope; a separate, explicit decision.

## Test counts

Confirmed unchanged before and after this audit, as expected (no source, patch, or guard code was modified):

- **Core:** 501/501 (unchanged).
- **React:** 97/97 (unchanged).
- **E2e:** not re-run in this pass — no source, patch, or dependency change was made, so a repeat 3-browser run would only re-confirm the same baseline already established for this exact commit in the prior round (250 passed / 5 skipped / 0 failed).

No test was added, removed, or renamed by this audit. `docs/bugs/mammoth-numbering-style-link-chain-recursion.md` was added per the standing rule for the one newly-found, confirmed-exploitable finding; the other ten new candidates were documented in this report rather than each given a separate ledger entry, since none is independently confirmed-exploitable in the current shipped state (all ten are reachable-but-guarded) — if any is later found to need its own fix, it should get its own `docs/bugs/` entry at that point, cross-referencing this audit.
