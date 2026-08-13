# Changelog

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
