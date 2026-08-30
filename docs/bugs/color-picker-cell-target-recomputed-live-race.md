# Table cell color silently applied to the wrong place on WebKit — target was re-resolved live instead of captured at open time

**Status:** Fixed (2026-08-30)
**Area:** react / CanonicalAuthorityEditor.tsx (`colorPopover` state, `applyColorToTarget`)
**First reported:** found during verification of the color picker redesign (`color-picker-redesigned-drag-first-no-apply-button.md`) - 3 e2e tests (cell background/text colour via the context menu, and colour-inheritance-on-row/column-insert) started failing on WebKit only, 100% reproducible, immediately after that redesign.
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Symptom

Right-click a table cell, choose "Cell background colour" from the context menu, pick a color: on WebKit, nothing was applied at all (`background-color` stayed `rgba(0,0,0,0)`), and reopening the picker on the same cell showed `#000000` instead of the color that should have been staged moments earlier.

## Reproduction

Confirmed via `git stash` that this is a genuine regression of the color-picker redesign, not a pre-existing gap: with the redesign's two changed files stashed (reverting to the native-`<input type="color">` picker), the identical WebKit interaction worked correctly - including with a real `.fill()`-driven hex input (ruling out "any input focus inside the popover" as the cause). With the redesign restored, direct instrumentation showed `runtime.editor.selection` had drifted to `{path: [0], offset: 0}` (the very start of the document) by the time a color was staged - nowhere near the right-clicked cell - immediately after the context-menu item's `onSelect` ran, before any drag or typing occurred.

## Root cause

`applyColorToTarget`'s "cell" branch called `tableScope()` - `runtime.editor.resolveScope({want: "table-grid"})` - **fresh, against the live selection**, at preview/commit time, rather than using whatever cell the context menu had actually been opened on. This was already fragile (nothing pinned it to a specific cell), but was masked by timing: WebKit delivers `selectionchange` asynchronously (the same class of race as `docs/bugs/home-end-key-stale-selection-race-after-click.md`), and the old, simpler `ColorPickerPopover` happened to resolve the live selection before any pending async reset caught up. The redesign's larger component (extra effects for the drag surfaces, an additional window-level Escape listener) shifted that timing just enough to consistently lose the race on WebKit - by the time a color was staged, an intervening async selection reset had already moved `runtime.editor.selection` away from the table entirely, and `tableScope()` silently resolved to "no table" (or the wrong one) instead of throwing or falling back visibly.

## Fix

`colorPopover`'s state now captures the actual `TableGridScope` (the exact cell IDs) at the moment the context-menu item is clicked - a synchronous user-gesture handler, immune to any subsequent async selection drift - instead of leaving `applyColorToTarget` to re-derive "what's currently selected" later. `applyColorToTarget`'s cell branch uses `colorPopover.target.scope` directly. The mark case (`{kind: "mark"}`) was not affected and needed no equivalent change - marks apply through `executeMarkTool`'s own scope resolution, which showed no analogous drift in testing.

## Regression coverage

The 3 originally-failing tests (`sets cell background and text colour via the right-click context menu`, `color picker reflects the existing colour when reopened...`, `adding a row or column inherits the adjacent row/column's cell background colour`) now pass on WebKit; re-run 3/3 in isolation after the fix. Full `canonical-authority.spec.ts` (104/104) and the full 3-browser suite re-verified clean as part of the same batch.

## Related/similar issues

[home-end-key-stale-selection-race-after-click](home-end-key-stale-selection-race-after-click.md) - the same underlying class of async-`selectionchange` race, found independently in an unrelated area (Home/End keyboard navigation) earlier in the same work session; this is a second, separate instance of trusting live selection state across an async gap that should instead have captured what it needed synchronously.
[color-picker-redesigned-drag-first-no-apply-button](color-picker-redesigned-drag-first-no-apply-button.md) - the redesign this regression was found in and fixed within, not a separate follow-up pass.
