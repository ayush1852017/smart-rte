# "Thin" cell border preset silently didn't render on some sides, while Medium/Thick always did

**Status:** Fixed
**Area:** react / table / CSS
**First reported:** 2026-08-30, "thin border not rendering all side while other medium and think shows all side."
**Related files:** `table-cell-border-color-width-no-ui.md` (the feature this preset belongs to)

## Symptom

Applying the "Border options" popover's "Thin" width preset to a cell (all sides) only showed the custom border on some of the cell's sides - typically its bottom/right edges - while its top/left edges kept showing the table's own default light-gray gridline instead. "Medium" and "Thick" always rendered correctly on every side.

## Root cause

`theme.ts`'s table styling uses `border-collapse: collapse` on `<table>`, and gives every `<td>`/`<th>` a `1px solid var(--srte-border)` default border (the visible baseline gridlines). With `border-collapse: collapse`, two adjacent cells' borders on a shared edge don't both render - the browser runs a conflict-resolution algorithm: the **wider** border wins outright; if widths are equal, style priority is compared; if that's also equal, whichever cell is **earlier in the table's row-major order wins** (confirmed empirically, not just per the CSS2.1 text - see below).

"Thin" composed a border at exactly **1px** - identical in width to the ambient default gridline on every unstyled neighboring cell. On any shared edge where the styled cell was NOT the earlier one in table order (its top edge vs. the cell above, its left edge vs. the cell to its left), the width tied, and the position tie-break silently let the neighbor's plain default border win, discarding the custom border on that side. "Medium" (2px) and "Thick" (4px) are strictly wider than the 1px ambient default, so they win unconditionally regardless of table position - which is exactly why only "Thin" was affected.

Confirmed via direct pixel-level screenshot inspection (a 3×3 table, styling the fully-interior center cell so all four of its sides face a real neighbor): at 1px, only 2 of 4 sides (bottom/right - the sides where the styled cell precedes its neighbor) showed the custom colour; the other 2 (top/left) showed the neighbor's default gray. At 2px+, all 4 sides showed the custom colour, in every one of the three browser engines tested.

Two other hypotheses were tested and ruled out before landing on the width fix:
- **Style-priority tie-break** (CSS2.1 §17.6.2.1 documents `solid` as higher-priority than `outset`/`groove`/etc., which in theory should let a `solid` custom border beat an `outset` ambient default at a tied width): changed the ambient default's style to `outset` and re-tested - **it made no difference**; the neighbor's border still won on the same sides. The actual browser behavior did not follow the CSS2.1-documented style-priority order for this comparison, at least not in a way that was reachable here. Reverted.
- **A fractional width bump** (1.5px, strictly wider than 1px per the spec's "widest wins" rule): also **still lost** the tie in every engine tested, suggesting the border-collapse comparison uses a rounded/snapped width rather than the exact specified value. Reverted in favor of an integer width.

## Fix

`packages/react/src/components/TableBorderPopover.tsx`: `BORDER_WIDTH_PRESETS` changed from `{thin: 1, medium: 2, thick: 4}` to `{thin: 2, medium: 3, thick: 4}` - every preset is now strictly wider than the table's 1px ambient default, so all three reliably win the border-collapse conflict on every side regardless of the cell's position in the table. "Thin" no longer means literally 1px, but 2px is the thinnest width that is *actually, reliably renderable* as a real custom border under this table's existing `border-collapse` + ambient-gridline design - a genuinely-1px option would be indistinguishable from "sometimes doesn't work," not a real capability.

No schema/renderer/export change was needed - the underlying per-side border attrs, renderer application, and DOCX/HTML export from `table-cell-border-color-width-no-ui.md`'s addendum were all already correct; this was purely a preset-value choice that didn't account for the ambient default's own width.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "'Thin' border width is not tied with the table's own 1px ambient gridline" (all 3 browsers): asserts the composed width is `2px`, not `1px`, directly encoding the fix and guarding against a future revert. The actual multi-side collapse-tie visual behavior was confirmed manually (pixel-cropped screenshots, all 3 engines, before and after the fix) rather than via a new pixel-sampling test harness - this codebase has no existing visual-regression/screenshot-diffing infrastructure, and introducing one was judged disproportionate to a single preset-value fix.

Suite counts after the fix: core 723/723, react 132/132, `pnpm run lint` clean, full 3-browser Playwright e2e suite 518/528 passed (the 10 non-passes are 7 pre-existing skips plus 3 already-documented, unrelated flakes - 2 Firefox `partial-cross-paragraph-delete` flakes and the Firefox media-drag-resize timing flake noted in `media-overlay-no-drag-resizer.md`'s addendum; no new failures).

## Related/similar issues

`table-cell-border-color-width-no-ui.md` - the border-options feature this preset belongs to. No other cell-style attribute in this codebase interacts with `border-collapse` conflict resolution (background/text colour aren't subject to any analogous cross-cell conflict), so this class of bug is specific to borders.
