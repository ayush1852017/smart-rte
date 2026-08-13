# DOCX import is reachable-DoS via mammoth's own bundled, vulnerable `@xmldom/xmldom@0.8.11`

**Status:** Open — finding reported, fix not yet applied (requires explicit confirmation per this project's standing rule for anything with real blast radius)
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

**Not applied.** Recommended fix: force `@xmldom/xmldom` to resolve to `^0.9.11` everywhere in the tree, including inside mammoth's own dependency resolution, via a pnpm override in the root `package.json`:

```json
"pnpm": { "overrides": { "@xmldom/xmldom": "^0.9.11" } }
```

This is a standard, low-risk pattern for exactly this situation (a well-behaved direct dependency bundling a vulnerable transitive one). `0.9.x` is a security-hardening line over `0.8.x`, not an API-breaking change, based on the advisory text describing purely internal traversal-algorithm changes (recursive → iterative) with no public API differences. Confirmed separately that `^0.9.11` remains the correct pin for our own direct usage — it is still npm's current `latest` dist-tag for `@xmldom/xmldom` as of this check, not superseded by anything newer, and not deprecated.

Per this project's standing rule for changes with real blast radius, this fix requires explicit confirmation before being applied — not made unilaterally as part of this audit.

## Regression coverage

None yet — no fix has been applied. Once the override is applied, the existing DOCX import test suite (`packages/core/src/foundation/formats/docx/format.test.ts`) exercises `importDocxDocumentWithMammoth` on every run and would need `pnpm -r why @xmldom/xmldom` re-checked to confirm the override actually took effect (resolving mammoth's copy to `0.9.11`, not just the top-level one).

## Related/similar issues

None with the same root cause. This is the first dependency-supply-chain finding in this project's history — distinct in kind from the application-logic bugs this ledger otherwise records.
