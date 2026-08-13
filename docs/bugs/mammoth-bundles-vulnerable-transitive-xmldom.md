# DOCX import is reachable-DoS via mammoth's own bundled, vulnerable `@xmldom/xmldom@0.8.11`

**Status:** Open — the originally recommended fix (a pnpm override) was tried and found to break DOCX import entirely; reverted. A different fix is needed; none applied yet.
**Area:** formats / docx / security
**First reported:** 2026-08-13, Phase 9 closeout item 3 (dependency vulnerability scan)
**Related files:** `docs/bugs/published-npm-versions-predate-canonical-rebuild.md` (unrelated cause, same area)

## Symptom

Phase 9's completion report disclosed that no vulnerability scan had been run against the 5 runtime dependencies added that phase (`katex`, `jszip`, `mammoth`, `pdfjs-dist`, `@xmldom/xmldom`). Running `pnpm audit` closed that gap and found a real, reachable finding specifically in `mammoth`.

## Reproduction

`pnpm audit --json` from the repo root; cross-referenced with `pnpm -r why @xmldom/xmldom` to confirm the exact resolved versions and dependency paths.

```
pnpm -r why @xmldom/xmldom
```
shows **two separate resolutions** in the tree:
- `packages/core`'s own direct dependency: `@xmldom/xmldom@0.9.11` (the version explicitly pinned in Phase 9 §2.1 to avoid a deprecated `0.8.11` resolution — this one is fine).
- `mammoth@1.11.0`'s **own internal** dependency: `@xmldom/xmldom@0.8.11` — completely independent of the top-level pin, present in every package that depends on `mammoth` (`packages/core`, `packages/react`, and transitively `packages/react/playground`).

## Root cause

`mammoth@1.11.0` declares its own `@xmldom/xmldom` dependency (resolving to `0.8.11`) rather than accepting whatever version the consuming project provides. Pinning our own direct usage to `^0.9.11` (`packages/core/src/foundation/formats/docx/styledImport.ts:2`, which imports `DOMParser` directly) does not affect mammoth's private copy — pnpm's non-hoisted resolution gives each package its own dependency tree unless explicitly overridden.

`0.8.11` is vulnerable to 5 advisories, all fixed in `>=0.8.12`/`>=0.8.13`:
- GHSA-wh4c-j3r5-mjhp — XML injection via unsafe CDATA serialization
- GHSA-2v35-w6hq-6mfw — uncontrolled recursion in XML traversal/serialization, DoS
- GHSA-f6ww-3ggp-fr8h — XML injection via unvalidated DocumentType serialization
- GHSA-x6wf-f3px-wcqx — XML node injection via unvalidated processing-instruction serialization
- GHSA-j759-j44w-7fr8 — XML node injection via unvalidated comment serialization

**Reachability triage** (not just raw audit output): checked mammoth's actual source (`node_modules/.pnpm/mammoth@1.11.0/node_modules/mammoth/lib/`) for which xmldom operations it actually calls.
- Mammoth uses `xmldom.DOMParser` exactly once (`lib/xml/xmldom.js:7`) and **never** calls `XMLSerializer` anywhere in its codebase — confirmed via `grep -rn "XMLSerializer" lib/`, zero matches. This means the 4 *serialization*-injection advisories (CDATA/DocumentType/PI/comment) are **not reachable** through mammoth's usage: they all require the application to construct DOM nodes from attacker content and then serialize them, and mammoth never serializes.
- The 5th advisory (uncontrolled recursion) **is reachable**: its own text explicitly lists `DOMParser.parseFromString()` as a reported trigger vector (via cross-referenced GHSA-fwmp-8wwc-qhv6), and separately confirms `Element.getElementsByTagName()` is one of seven affected recursive operations. Mammoth's own DOCX-parsing code (`lib/docx/numbering-xml.js`, `styles-reader.js`, `body-reader.js`, `comments-reader.js`, `notes-reader.js`) calls `.getElementsByTagName()` extensively and unconditionally on every parsed document — this is not an edge case, it is mammoth's normal, always-executed parsing path.
- Our entry point is `importDocxDocumentWithMammoth` (`packages/core/src/foundation/formats/docx/import.ts:13`), which calls `mammoth.convertToHtml({ arrayBuffer, ... })` directly on caller-supplied bytes. A `.docx` file is a ZIP of XML; an attacker who can get a user to import a crafted `.docx` (a routine, expected use of this feature) can trivially construct XML nested ~10,000 levels deep (the disclosed PoC is literally `'<a>'.repeat(depth) + 'text' + '</a>'.repeat(depth)`) and crash the import with `RangeError: Maximum call stack size exceeded` — in a browser context, an uncaught error in the import flow; if this code ever runs server-side, a process-level crash.

## Fix

**Attempted and reverted; still open.** The originally recommended fix — a pnpm override forcing `@xmldom/xmldom` to `^0.9.11` everywhere, including inside mammoth's resolution — was applied, confirmed effective at the dependency-resolution level, and then found to break DOCX import completely.

```json
"pnpm": { "overrides": { "@xmldom/xmldom": "^0.9.11" } }
```

**Verification that the override itself worked correctly:** after `pnpm install`, `pnpm -r why @xmldom/xmldom` showed exactly one resolved version (`0.9.11`) everywhere in the tree, including inside `mammoth@1.11.0`'s own dependency (previously `0.8.11`). `pnpm audit` confirmed all 5 `@xmldom/xmldom` advisories gone (high-severity count dropped from 33 to 28, an exact match). The override mechanism is not the problem.

**What actually broke:** every DOCX import test failed with `TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.` Root cause, confirmed by reading both sides directly:
- Mammoth's own internal call site (`node_modules/mammoth/lib/xml/xmldom.js:13`, `exports.parseFromString`) calls `domParser.parseFromString(string)` with a **single argument** — it never passes a `mimeType`.
- `@xmldom/xmldom`'s `DOMParser.prototype.parseFromString` (`lib/dom-parser.js`) validates `mimeType` with `isValidMimeType(mimeType)` **before** applying its own documented default (the JSDoc directly above it states `@param {string} [mimeType='application/xml']`). Passing `undefined` does not fall through to that default — it throws a `TypeError` immediately. This directly contradicts the function's own documentation.
- Confirmed via direct testing (`npm pack @xmldom/xmldom@0.9.0`, inspecting `lib/dom-parser.js`) that this validate-before-default behavior exists starting at `0.9.0` and is present in every 0.9.x release, not a `0.9.11`-specific issue — no other 0.9.x version would avoid this. Picking a different patch version within 0.9.x is a confirmed dead end, not just an untried option.
- Our own direct `@xmldom/xmldom` usage (`packages/core/src/foundation/formats/docx/styledImport.ts:197`) was never affected, since it always passes an explicit `"text/xml"` as the second argument. The incompatibility is specific to mammoth's calling convention, not a general problem with our own code.

The override was reverted (`package.json`, `pnpm-lock.yaml` restored to their pre-override committed state, `pnpm install` re-run); confirmed `pnpm -r why @xmldom/xmldom` shows mammoth back on `0.8.11` and the full DOCX/core/react test suites pass again at their prior counts (see completion note below). This means the DoS finding above is **still live and unfixed** — reverting restored the vulnerable-but-working state, not a fixed one.

**Real options, none applied — all need explicit confirmation, none is a small/obvious choice:**
1. Patch mammoth's own dependency (a `pnpm.packageExtensions` entry forcing mammoth's `package.json` to depend on a version range compatible with its calling convention is not viable here, since the incompatibility is a behavior change in `@xmldom/xmldom` itself, not a version-range mismatch — no version of `@xmldom/xmldom` both fixes the 5 advisories and accepts a bare `parseFromString(string)` call).
2. Vendor or monkeypatch mammoth's `lib/xml/xmldom.js` to pass an explicit `"application/xml"` mimeType (a `patch-package`-style fix) — would need mammoth's upstream behavior verified unaffected by forcing that default explicitly rather than relying on xmldom's (broken) implicit default.
3. Replace `mammoth` with a different DOCX-to-HTML library entirely — a much larger change, affecting `importDocxDocumentWithMammoth`'s whole implementation, not just a dependency version.
4. Accept the DoS as a documented, tracked residual risk and do not fix it in this dependency this way — matches the pattern already used for other owner-waived residual risks in this project (e.g. the native Windows Word capture gap), but for a security finding rather than a coverage gap, which is a materially different kind of risk to accept.
5. Report the mimeType-validation inconsistency upstream to `@xmldom/xmldom` (their own JSDoc contradicts their own implementation) — doesn't fix anything in this repo directly, but is worth doing regardless since it affects every consumer of the library that calls `parseFromString` with a single argument, not just mammoth.

## Regression coverage

None — no fix is in place. `packages/core/src/foundation/formats/docx/format.test.ts` already exercises `importDocxDocumentWithMammoth` on every run and is exactly what caught the override's breakage; it will also catch a regression from whichever real fix is eventually chosen.

## Related/similar issues

None with the same root cause. This is the first dependency-supply-chain finding in this project's history — distinct in kind from the application-logic bugs this ledger otherwise records.
