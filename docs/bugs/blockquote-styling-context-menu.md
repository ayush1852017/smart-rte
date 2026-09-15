# Blockquote styling: background/text colour + left-border options

**Status:** Implemented
**Area:** core (`block/schema.ts`, `surface/renderer.ts`), react (`CanonicalAuthorityEditor.tsx`, new `BlockquoteBorderPopover.tsx`)
**First reported:** "I should be able to change blockquote background color and text color. There should be separate context menu for that too, Add blockquote left border color change option too." (2026-09-15), followed by "We can do use style/width treatment but only use left border" confirming style/width for the border, scoped to left-only.
**Related files:** [table-cell-border-color-width-no-ui](table-cell-border-color-width-no-ui.md) (the direct precedent this mirrors — its addendum's per-side-attrs-plus-one-combined-popover evolution is exactly what's reused here, minus the sides toggle), [table-cell-text-color-not-rendered](table-cell-text-color-not-rendered.md), [color-picker-cell-target-recomputed-live-race](color-picker-cell-target-recomputed-live-race.md) (the captured-scope-at-click-time discipline reused for the blockquote target too).

## What shipped

Right-clicking inside a blockquote now opens a context menu (previously nothing opened at all — the `onContextMenu` handler only ever fired for a table-grid scope or a media atom) with three items:

- **Blockquote background colour** / **Blockquote text colour** — the existing `ColorPickerPopover`, routed through a new third `colorPopover.target` kind (`{ kind: "blockquote", attr, blockId }`), captured at the moment the menu item is clicked rather than re-resolved live (same reasoning as the table-cell case's `TableGridScope` capture).
- **Blockquote border options** — a new, deliberately simpler sibling of `TableBorderPopover`: style + width + colour only, no sides-toggle diagram or "All sides"/"No border" shortcuts, since a blockquote only ever shows one visible border side (left). Reuses `TableBorderPopover`'s `BORDER_WIDTH_PRESETS` and `composeBorderShorthand`/`parseBorderShorthand` helpers rather than duplicating them.

Three new schema attrs on `blockquote` (`backgroundColor`, `textColor`, `borderLeft` — the last a single composed CSS shorthand, not separate width/style/colour fields, since there's no per-side independence to preserve): `packages/core/src/foundation/block/schema.ts`. Renderer wiring landed in the same commit as the schema change (`surface/renderer.ts`'s `syncNodeAttributes`), avoiding this project's recurring "attribute added, never rendered" bug class.

Applied via the existing generic `setBlockAttributes` command (`"block.setAttributes"`), scoped to the blockquote's own node id via a new `findBlockquoteAncestor`/`blockquoteScopeFor` helper pair — extracted out of two pre-existing inline ancestor-walks in `toggleBlockquote`/`currentBlockquoteActive` rather than adding a third copy.

**Scoping rule**: a table cell nested inside a blockquote still shows cell options, not blockquote options — the right-click gate and the menu-items resolver both check table-grid scope first, matching "closest/innermost container wins."

## Regression coverage

`packages/core/src/foundation/surface/renderer.blockquoteStyle.test.ts`: attrs render as real inline CSS; absent attrs leave the theme default untouched; a diff-update correctly clears previously-rendered styling once attrs are removed. Confirmed to fail without the renderer wiring via `git stash`.

`packages/react/e2e/canonical-authority.spec.ts`: "sets blockquote background and text colour via the right-click context menu"; "sets blockquote left-border style, width, and colour via the Border options popover" (confirms no sides-toggle UI exists, live preview before Apply, reopen re-seeds from committed attrs, Cancel reverts a live-previewed change without touching an already-applied one); "blockquote context menu is scoped correctly: no menu over plain text, cell options win inside a quoted table". The two feature-dependent tests confirmed to fail without the fix via a temporary checkout of the pre-feature file versions; the scoping test is a regression guard (passes either way, since the table-cell-wins behavior predates this change) rather than a fail-without-fix case.

Full suites: core 765/765 (+3), react 151/151, full `canonical-authority.spec.ts` suite (136 tests) green on chromium, typecheck and lint clean.
