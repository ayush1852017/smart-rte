# Changelog

## 1.1.0

- Add `backgroundColor`, `textColor`, and `borderLeft` attrs to `blockquote` (the last a single composed CSS shorthand, since a blockquote only ever shows one visible border side, unlike `table_cell`'s 4-sided borders) — rendered as real CSS in the same change, alongside the existing `align`/`indentLevel`/`lineHeight` block attrs. See `docs/bugs/blockquote-styling-context-menu.md`.

## 1.0.0

General availability of the canonical/foundation architecture introduced in `1.0.0-beta.1` — promoted from the `beta` npm dist-tag to `latest`. No functional changes beyond the `1.0.0-beta.2`–`beta.9` entries below; see those for the full list of changes across the beta cycle.

## 1.0.0-beta.9

- Fix converting a paragraph sitting directly after an existing list into a list of the same kind always creating a second, independently-numbered list instead of continuing the existing one — e.g. typing after exiting a numbered list (Enter twice) and clicking "Numbered list" again now correctly appends as the next item rather than restarting at "1." next to it. See `docs/bugs/list-creation-ignores-adjacent-identical-list.md`.
- Fix pressing Enter at the end of a code-block list item never being able to create a new sibling list item — it previously only ever added lines inside the current item's own code block, with the only way "out" leaving a permanent stray empty paragraph behind. The same "type, Enter, Enter" rhythm already used to exit an empty list item now correctly starts a genuine new item instead. See `docs/bugs/code-block-list-item-cannot-exit-to-new-sibling-item.md`.
- Fix a further Enter pressed on that newly escaped (necessarily empty) item immediately exiting the list again instead of letting you type into it — indistinguishable from the editor's own separate "empty item + Enter exits the list" convention, so one extra keystroke silently undid the escape above and produced only stray paragraphs afterward. See `docs/bugs/code-block-list-item-cannot-exit-to-new-sibling-item.md`.
- Fix pressing Enter at the end of a code block's own content looking like it did nothing — a trailing "\n" with no following content rendered at zero extra height under `white-space:pre-wrap` (the model was correct; only the visible box failed to grow). See `docs/bugs/code-block-trailing-newline-invisible.md`.
- Fix any color or border live-preview (e.g. dragging the color picker, table-cell background/text colour) throwing "Children do not match 'text*'" and getting permanently stuck — unable to apply, unable to close by any means — the moment the document contained a multi-line code block anywhere in it, not just the target being colored. See `docs/bugs/checkpoint-restore-crashes-with-multiline-code-block.md`.
- Fix Shift+ArrowLeft/Shift+ArrowRight moving a collapsed caret instead of extending the selection (outside of a table cell, where this already worked) — the same gap already fixed once for Shift+Home/End, never carried over to plain arrows. See `docs/bugs/shift-arrow-left-right-does-not-extend-selection.md`.

## 1.0.0-beta.8

- Fix Blockquote (and unwrap) throwing an uncaught error ("replaceNode before payload does not match document node.") and applying nothing, for a selection spanning a list item's own text and a nested sub-list item's text — two selected blocks resolving to two different, nested "list" ancestors were treated as independent (and mutually conflicting) wrap targets instead of recognizing the inner one is already covered by the outer one. Also fixed the identical latent issue for unwrapping nested blockquotes (the schema allows blockquote nesting), even though no live report had surfaced it yet. See `docs/bugs/blockquote-crashes-on-selection-spanning-outer-and-nested-list.md`.

## 1.0.0-beta.7

- Fix copy, cut, and native drag throwing an uncaught error ("Clipboard copy is clamped to one structural parent.") for any selection whose two endpoints weren't immediate siblings — e.g. starting in a plain paragraph and dragging into a nested list item, or spanning two list items at different nesting depths. This was not an exotic shape: any selection reaching into a list, table, or blockquote from outside it hit this, and the failure was a silent no-op (nothing copied) with a console error, not a graceful fallback. See `docs/bugs/clipboard-copy-cut-throws-across-differently-nested-endpoints.md`.

## 1.0.0-beta.6

- Fix pasting a long, list-free document (many short paragraphs, no images) being slow enough to look broken — the Office/Google Docs list normalizers recursed into every paragraph hunting for nested lists a `<p>` can never structurally contain. Pasting a few thousand blocks now completes in well under a second instead of multiple seconds to tens of seconds. See `docs/bugs/clipboard-paste-slow-on-large-list-free-documents.md` for the full investigation, including a known remaining limitation for very large (10,000+ block) pastes.

## 1.0.0-beta.5

- Add a per-block `lineHeight` attribute (paragraph, heading, blockquote, code block) — a unitless multiplier matching CSS `line-height`'s own unitless mode (`1`, `1.5`, `2`, ...), consistent with how `align`/`indentLevel` are represented. Absence means no override (the browser/font's own natural line-height), not a forced `1`. Full HTML round-trip fidelity via a dedicated `data-smart-line-height` marker — deliberately does **not** fall back to reading a bare CSS `line-height` value on import (unlike `align`/`indentLevel`'s own CSS fallbacks): real captured clipboard fixtures show `line-height` is frequently an ambient, whole-document default baked onto every paragraph, not a deliberate per-paragraph choice, and recognizing it would have silently misattributed that default as an explicit override on every pasted document. Real Word line spacing (`w:spacing`/`w:line`/`w:lineRule="auto"`) on DOCX export; declared `lossy` there (confirmed empirically that DOCX reimport via mammoth drops it) and `unsupported` (content preserved) in Markdown. Inherits `full` PDF fidelity for free, since this package's "Save as PDF" prints the same HTML export.
- Add a `page_break` atom node — a print/export pagination marker, distinct from the existing `divider` (horizontal rule) node. Exports to a real paginating marker in HTML (and this package's own "Save as PDF", which prints that same HTML) and a real native Word page break in DOCX; declared `unsupported` in Markdown (no pagination concept there), preserved as an inert comment rather than silently dropped. Add an `AtomDeclaration` for `divider` so it can be inserted via the standard atom-insertion command, not just recovered from pasted `<hr>`. Fix `divider` silently exporting as an empty paragraph in DOCX (no visible line at all).
- Fix a real HTML round-trip bug found while building the above: a div-tagged atom's own round-trip marker (`block_formula`, and the new `page_break`) was silently deleted on reimport — treated as a meaningless transparent wrapper div and recursed into (destroying it) before ever reaching the atom-parsing logic. See `docs/bugs/html-import-div-atom-markers-treated-as-transparent-wrapper.md`.
- Fix formulas rendering as invisible empty placeholders in "Save as PDF" output — the print document never baked real KaTeX HTML (the same gap already fixed once for a different static-HTML consumer) and never loaded KaTeX's own CSS at all (a brand-new, isolated print window shares none of the host page's stylesheets). See `docs/bugs/pdf-export-formula-invisible-and-misleading-label.md`.

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
