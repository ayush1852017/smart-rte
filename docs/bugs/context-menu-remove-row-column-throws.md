# "Delete row"/"Delete column" (and other static-params items) threw and left the context menu stuck open

**Status:** Fixed
**Area:** react / CanonicalAuthorityEditor / context menu dispatch
**First reported:** 2026-08-20, "table delete row, delete column not working."
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`resolveContextMenuItems`).

## Symptom

Right-clicking a table cell and choosing "Delete row" (or "Delete column") did nothing to the table, and the context menu itself stayed open afterward, blocking further clicks ("intercepts pointer events" on any subsequent interaction until dismissed).

## Reproduction

Confirmed directly: a real `pageerror` fired on click - `TypeError: Cannot read properties of undefined (reading 'rowIndex')` inside `removeTableRowCommand`. Since the item's `onSelect` threw, `ContextMenu.tsx`'s `onClick={() => { item.onSelect(); onDismiss(); }}` never reached `onDismiss()` - the exception aborted the handler mid-call, which is why the menu stayed stuck open as a visible symptom alongside the row not actually being deleted.

This was **pre-existing, not introduced by the context-menu scope reduction** - confirmed by checking existing e2e coverage: `table.removeRow`/`table.removeColumn` were only ever exercised via the **toolbar** buttons ("Remove row"/"Remove column"), never via the context-menu items with the same underlying command, so this path had no working regression test to catch it before now.

## Root cause

`resolveContextMenuItems`'s generic contribution-dispatch loop passed `contribution.params` straight through as the command's `params` argument. For a static contribution with no `params` field at all (`removeRow`, `removeColumn`, `mergeCells`, `removeTable` - anything not `table.insertRow`/`table.insertColumn`, which get their params constructed dynamically a few lines above), `contribution.params` is `undefined`. `removeTableRowCommand`/`removeTableColumnCommand` read `params.rowIndex ?? <fallback>` - a property access on `undefined`, which throws instead of safely evaluating to `undefined`. The toolbar's equivalent buttons already called these commands with `{}` for exactly this reason (`removeTableRowCommand(document, scope, {}, context)`); the context-menu loop was the one place that didn't match that convention.

## Fix

`resolveContextMenuItems`'s params computation now falls back to `{}` instead of raw `contribution.params` for every contribution that isn't `table.insertRow`/`table.insertColumn`, matching the toolbar's existing convention.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "deletes a row, deletes a column, and merges cells via the right-click context menu": exercises `removeRow`, `removeColumn`, and `mergeCells` (the three static-params contributions not already covered by the existing insert/removeTable test) via the real right-click menu, asserting both the row/column counts change correctly and the menu closes normally afterward (proving `onDismiss` is reached, not just that the operation ran).

## Related/similar issues

None prior - a straightforward missing-default gap, not related to the context-menu scope reduction that happened to surface it via more thorough manual testing.
