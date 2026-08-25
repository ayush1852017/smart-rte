# `table_cell.attrs.textColor` was written but never rendered

**Status:** Fixed
**Area:** core / surface renderer / table
**First reported:** found 2026-08-20 while wiring the new "Cell text colour" context menu item (user request: "why doesn't table context menu have cell style etc").
**Related files:** `packages/core/src/foundation/surface/renderer.ts`, `packages/core/src/foundation/table/commands.ts` (`setTableCellAttributesCommand`), `packages/core/src/foundation/list/formats.ts` (HTML import already parses it).

## Symptom

None reported directly - found before it ever shipped, while building the context-menu feature that would have exposed it.

## Reproduction

`table_cell.attrs.textColor` is a real, already-parseable attribute (`list/formats.ts`'s `td`/`th` case reads a `color` CSS style into `cellAttrs.textColor` on HTML import) and already settable via the generic `table.setCellAttributes` command - but `surface/renderer.ts`'s `table_cell` branch only ever applied `background`, `borders`, and `verticalAlign` to the DOM. `textColor` had no corresponding `element.style.color` assignment anywhere.

## Root cause

The same "written, never rendered" shape as `docs/bugs/table-column-width-not-rendered.md` - an attribute with a real read/write path on both ends (parser and command) but no renderer wiring in between.

## Fix

`surface/renderer.ts`'s `table_cell` branch now applies `element.style.color = node.attrs.textColor` when set, clearing it otherwise - matching the existing `background`/`borders`/`verticalAlign` pattern exactly.

## Regression coverage

`packages/core/src/foundation/surface/tableColumnWidth.test.ts` - "table_cell.attrs.background/textColor are rendered as real CSS": applies both, asserts real computed styles, then clears and asserts the `style` attribute is empty (note: the clearing assertion reads `getAttribute("style")`/outerHTML rather than `.style.color` directly - jsdom's live `CSSStyleDeclaration` getter didn't reflect a `removeProperty` call made through a captured element reference in the same synchronous tick during test development, even though the actual DOM `style` attribute was correctly cleared; this is a jsdom test-environment artifact, not a real rendering difference, confirmed by inspecting `outerHTML` directly). `packages/react/e2e/canonical-authority.spec.ts` - "sets cell background and text colour via the right-click context menu" exercises the real rendered `color` CSS property end-to-end in a real browser, all 3 browsers.

## Related/similar issues

[table-column-width-not-rendered](table-column-width-not-rendered.md) - the identical defect shape in the same renderer, for a different attribute.
