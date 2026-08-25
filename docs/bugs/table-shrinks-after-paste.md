# Pasted table rendered much narrower than its copied content

**Status:** Fixed
**Area:** core / HTML import / list/formats.ts
**First reported:** 2026-08-19, user report immediately after the post-Phase-11.5 bug batch.
**Related files:** `packages/core/src/foundation/list/formats.ts`, `packages/core/src/foundation/surface/renderer.ts`.

## Symptom

A table looked correctly sized in its source, but shrank noticeably after being pasted into the editor.

## Reproduction

Confirmed directly: a table whose `<col>` elements have no real pixel width data (empty `<col>` tags - exactly what `packages/react/e2e/fixtures/test-html-sootr.html`'s table has) previously fell back to an arbitrary `120` per column in `parseCanonicalListHtml`'s table parsing. Once `docs/bugs/table-resize-moves-unrelated-columns.md`'s fix started pinning the table's own rendered width to the literal sum of `columnWidths`, that fabricated 120px-per-column fallback became the table's real, visible, far-too-small width (e.g. 240px for a 2-column table) instead of being invisibly overridden by the stylesheet's `width: 100%` default the way it always had been before that fix landed.

A second, related case found investigating the same code: Excel's HTML export puts a real pixel width on the `<col>`'s `width` *attribute* but a **points** value (not pixels) on its `style="width:...pt"` - the old code checked `style` first and read `Number.parseFloat("14pt")` as `14`, a ~25% understatement, silently wrong in the same direction as the fallback bug even when real data existed.

## Root cause

`parseBlock`'s `table` case unconditionally assigned a `120` fallback to any `<col>` lacking a parseable width, and used a bare `Number.parseFloat(styleValue || attribute)` that doesn't check units - `"50%"` or `"14pt"` parse as `50`/`14` with the unit silently discarded, misreading a non-pixel value as if it already were pixels.

## Fix

New `parsePixelWidth` helper only accepts a bare number or an explicit `"Npx"` value, rejecting anything else (percentages, points, `auto`, missing). Table column-width parsing is now all-or-nothing: `columnWidths` is only set on the table when *every* `<col>` has a genuine, parseable pixel width; if any column lacks one, no `columnWidths` is set at all, and the table falls back to its natural stretched (`width: 100%`) rendering exactly as before the width-pinning fix.

## Regression coverage

- `packages/core/src/foundation/list/formats.test.ts` - "only sets table columnWidths when every `<col>` has a real pixel width, not a fabricated fallback": real px widths (kept), empty `<col>`s (rejected), percentage widths (rejected), mixed real/missing (rejected), and Excel's real-attribute-plus-point-style shape (attribute wins, not a misread of the point value).
- `packages/react/e2e/canonical-authority.spec.ts` - "does not shrink a pasted table whose source has no real column pixel widths": pastes a table with empty `<col>`s, asserts it renders at least 80% of the editor's own width.
- `packages/core/src/foundation/clipboard/corpus.test.ts` - the real `excel-clipboard.clipboard.json` capture's locked hash changed as a direct, verified consequence (inspected the fixture's raw HTML directly: real `width="19"` attributes alongside non-pixel `style="width:14pt"` values) - updated with an explanatory comment, not silently accepted.

## Related/similar issues

[table-resize-moves-unrelated-columns](table-resize-moves-unrelated-columns.md) - the fix that exposed this (pinning the table's own width made a previously-invisible bad default visible); both found and fixed in the same investigation window.
