# `table.attrs.columnWidths` is written by `setTableColumnWidthCommand` but never rendered

**Status:** Fixed
**Area:** table / renderer
**First reported:** 2026-08-19, found while building table resize-handle UI (Phase 11.5 §2.2) — a resize command that changes the model but produces no visible change would have made the new UI appear completely broken.
**Related files:** `packages/core/src/foundation/surface/renderer.ts` (`syncNodeAttributes`'s `table` branch), `packages/core/src/foundation/table/commands.ts` (`setTableColumnWidthCommand`, unchanged — the bug was renderer-side only)

## Symptom

Calling `setTableColumnWidthCommand` correctly updates `table.attrs.columnWidths` in the model (verified by its own existing unit tests), but the live canonical renderer never read that attribute — no `<col>`/`<colgroup>` element, no per-cell width style, nothing. A column resize had zero visible effect in the running editor even though the command "succeeded" and the model was genuinely updated.

## Reproduction

Confirmed by direct source inspection before writing any fix: `grep -n "columnWidths" packages/core/src/foundation/surface/renderer.ts` returned zero matches, while the same search across `table/commands.ts`, `table/formats.ts` (DOCX export), and the legacy `domTableCommandBridge.ts` all showed real consumers. The canonical renderer was the one gap. Row height, by contrast, was already correctly rendered (`table_row`'s `syncNodeAttributes` branch sets `element.style.height` from `attrs.height`) — this was specifically a column-width gap, not a general "resize doesn't render" gap.

## Root cause

`setTableColumnWidthCommand` and the renderer were built in different phases (table commands in Phase 6/8c, the renderer's table branch earlier) and nothing ever connected them — the renderer's `table` node branch handled `layout` and `caption` but was never extended to also project `columnWidths`. Not caught earlier because no UI ever called `setTableColumnWidthCommand` in the live product before Phase 11.5 (only tests and the DOCX export path exercised it), so the missing visual effect was never observed.

## Fix

`surface/renderer.ts`'s `table` branch now manages a `<colgroup>` (one `<col>` per grid column, positioned after `<caption>` if present, self-correcting on every render regardless of prior DOM state) with each `<col>`'s `style.width` set from `columnWidths[index]`, mirroring the legacy DOM bridge's existing colgroup approach for the same attribute. The colgroup is tagged with the existing `data-smart-projection` attribute so `modelChildren()`'s child-diffing (which already excludes projection/UI elements) doesn't mistake it for a model child, the same mechanism `<caption>` already relies on.

## Regression coverage

`packages/core/src/foundation/surface/tableColumnWidth.test.ts` (new): asserts `<col>` creation with correct widths, width updates across re-renders, column count tracking `columnWidths.length`, and colgroup removal when the attribute is cleared.

## Related/similar issues

None found connecting to this specific gap. Discovered incidentally while building Phase 11.5 §2.2 (table resize UI), not from a user report — the same "build UI, discover the command it calls has no visible effect" shape as several Tier 0/Tier 1-3 findings this project has hit, but this one is a genuine rendering gap rather than a wiring gap.
