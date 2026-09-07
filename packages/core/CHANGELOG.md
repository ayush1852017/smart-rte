# Changelog

## 1.0.0-beta.5

- Add a `page_break` atom node — a print/export pagination marker, distinct from the existing `divider` (horizontal rule) node. Exports to a real paginating marker in HTML (and this package's own "Save as PDF", which prints that same HTML) and a real native Word page break in DOCX; declared `unsupported` in Markdown (no pagination concept there), preserved as an inert comment rather than silently dropped. Add an `AtomDeclaration` for `divider` so it can be inserted via the standard atom-insertion command, not just recovered from pasted `<hr>`. Fix `divider` silently exporting as an empty paragraph in DOCX (no visible line at all).
- Fix a real HTML round-trip bug found while building the above: a div-tagged atom's own round-trip marker (`block_formula`, and the new `page_break`) was silently deleted on reimport — treated as a meaningless transparent wrapper div and recursed into (destroying it) before ever reaching the atom-parsing logic. See `docs/bugs/html-import-div-atom-markers-treated-as-transparent-wrapper.md`.

## 1.0.0-beta.4

- Fix HTML import (paste and loading a document's initial value) rendering real content as unreadable `[Unsupported: ...]` placeholders when a bare `<span>`/`<b>`/other inline-formatting element sits directly at the document root, or is interleaved between real blocks (a `<blockquote>`, `<div>`-wrapped lines, images) with no wrapping `<p>` — a common shape from legacy, pre-migration editor exports. Also fixes the same gap in `<blockquote>`/table cells/list items for content interleaved between blocks (previously only content entirely before any block content was recovered correctly).

## 1.0.0-beta.3

- Add `href`/`target` (a clickable link), `borderRadius` (corner rounding), and license metadata fields (`licenseDescription`, `licenseSourceUrl`, `licenseType`, `licenseVersion`, `licenseAttribution`) to the image atom schema. `href` is validated the same way as the existing `link` mark; exported HTML wraps a linked image in a real `<a>` for portability outside the editor. Fix a pre-existing renderer gap where clearing an image's `align` back to unset never removed the CSS float/display/margin it had previously applied.

## 1.0.0-beta.2

- Add an opt-in `renderFormulaHtml` option to `serializeCanonicalListHtml` that bakes real KaTeX-rendered HTML into exported formula elements, instead of leaving an empty placeholder — for consumers (e.g. a read-only preview) that display this HTML directly without also running KaTeX against it themselves. Off by default; no change for existing consumers.

## 1.0.0-beta.1

**BREAKING CHANGE.** This is the first release built on the canonical, schema-driven document model. Every published version through 0.2.1 was built on the older discriminated-union model; none of the work below has shipped before.

- Introduce the canonical document model and editing engine (`smartrte-core/foundation`): schema-driven nodes with stable IDs, a scope/position API, structural history, and dedicated engines for lists, marks, blocks, tables, and atoms (images, formulas, media).
- Add a clipboard pipeline with source-aware normalization (Word, Google Docs, spreadsheets, Markdown, native) and a sanitize-first security boundary.
- Add DOCX, PDF, and Markdown format codecs with an explicit, tested `FeatureFormatCodec` fidelity contract (`full`/`semantic`/`lossy`/`unsupported`) per feature and format — no fidelity claim ships without a passing round-trip fixture.
- Add live KaTeX rendering for formula atoms (real HTML + MathML output, `trust:false`, `strict:"error"`), replacing plain-text LaTeX source display.
- Make the package genuinely framework-agnostic: no DOM-library dependency in the format codecs (parse5/`@xmldom/xmldom` replace real-DOM usage), zero React imports anywhere in `smartrte-core`.
- **Breaking:** the package root (`.`) no longer re-exports the legacy discriminated-union model, its plugin system, or the HTML/Markdown compatibility layers. That surface is unchanged and still fully available at `smartrte-core/legacy`; only the accidental root-level duplication was removed.
- **Breaking:** `smartrte-core/foundation` now exports `FOUNDATION_SMART_LIST_PRESETS` and related list-preset helpers (previously unreachable from the package's public exports).

## 0.2.1

- Keep superscript and subscript mutually exclusive when converting selected text.

## 0.2.0

- Add block alignment properties and the `setTextAlignment` command.
- Add explicit font-size marks.
- Expand command and compatibility regression coverage.
