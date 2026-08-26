# Color picker always opened blank regardless of current colour, and never dismissed on an outside click

**Status:** Fixed
**Area:** react / ColorPickerPopover.tsx / CanonicalAuthorityEditor.tsx
**First reported:** 2026-08-26 (pasted "Codex prompt," reported alongside the pasted-web-image import gap)
**Related files:** `packages/react/src/components/ColorPickerPopover.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`, `docs/bugs/context-menu-outside-click-dismiss-untested.md` (the pattern this reuses), `docs/bugs/context-menu-not-scoped-to-click-target.md` (the `marksForRange`/collapsed-caret fix this depends on, already in place)

## Symptom

Two independent gaps in `ColorPickerPopover`:
1. Opening the picker with the caret on/inside already-colored text, or right-clicking an already-colored table cell, always showed the picker at its hardcoded default (`#000000`) rather than reflecting the actual current color.
2. Clicking outside the open popover did nothing - only the explicit `×`/Cancel button or Escape closed it.

## Reproduction

Confirmed by direct source inspection before making any change (per the standing "check whether this is the same bug class already fixed elsewhere" instruction):
- `CanonicalAuthorityEditor.tsx`'s three `setColorPopover(...)` call sites (toolbar text/background colour buttons, table-cell context-menu items) never passed an `initialValue` to `<ColorPickerPopover>` at all - the component's own `initialValue = "#000000"` default was always what rendered, regardless of any existing mark or cell attribute.
- `ColorPickerPopover.tsx` had **no outside-click listener whatsoever** - not a broken/stale-closure version of one (checked `LinkEditorPopover.tsx` too; neither popover ever had this, unlike `ContextMenu.tsx`, which got the ref-based fix in `context-menu-outside-click-dismiss-untested.md`).
- The `marksForRange`/collapsed-caret mark-lookup bug named in the report (`context-menu-not-scoped-to-click-target.md`) was **already fixed** as of that entry - confirmed current `resolveScope.ts` already finds a mark anywhere inside a run's interior, not just at its edges - so no further fix was needed there; the color picker's gap was purely that nothing ever called this lookup for its own purposes.

## Root cause

Both gaps are simply missing wiring, not a subtle logic bug in an existing mechanism: (1) no caller ever computed "what color is here right now" before opening the popover, so the component always fell back to its hardcoded default; (2) the popover was built (`ColorPickerPopover.tsx`, Phase 11.5 §2.4) after `ContextMenu.tsx`'s own outside-click fix already existed as a precedent, but that pattern was never carried over to this component.

## Fix

- `CanonicalAuthorityEditor.tsx`: added `currentMarkColor(markId)` (reads `resolveScope({want:"describe"}).marks`, the same lookup the link overlay already depends on) and `currentCellColor(attr)` (reads the table-grid scope's anchor cell's own `attrs`). Both are computed once, at the moment the popover opens, and stored on the `colorPopover` state as `initialValue`, passed through to `<ColorPickerPopover initialValue={...}>`.
- `ColorPickerPopover.tsx`: added the same ref-based outside-click listener `ContextMenu.tsx` already uses (`onCancelRef` read inside a `pointerdown`+`mousedown` capture-phase `window` listener, mounted once for the popover's lifetime rather than depending on a fresh `onCancel` closure every parent re-render). Verified this doesn't reintroduce `color-popover-closes-on-first-native-picker-interaction.md`: a click on the native `<input type="color">` itself lands *inside* `rootRef`, so the dismiss check correctly ignores it, and the OS-level native color picker dialog it opens doesn't dispatch DOM events to the host page at all - confirmed via the existing `pickNativeColor` e2e helper's tests still passing unchanged.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: "color picker reflects the existing colour when reopened, and closes on an outside click" - applies a text colour, reopens the picker on the same text, asserts both the native `<input type="color">` and the hex input now show the applied value (not `#000000`); confirms an outside click on plain editor content closes the popover with no explicit action; repeats the reopened-value assertion for a table cell's background colour via the context menu. All 3 browsers, stable across 2 repeated runs. Pre-existing color tests ("applies text color via the native picker...", "sets cell background and text colour via the right-click context menu") continue to pass unchanged, confirming no regression to the native-picker-interaction fix. Core 699/699 (unchanged), react 130/130 (unchanged), lint clean.

## Related/similar issues

- [context-menu-outside-click-dismiss-untested](context-menu-outside-click-dismiss-untested.md) - the pattern this fix reuses directly.
- [context-menu-not-scoped-to-click-target](context-menu-not-scoped-to-click-target.md) - the `marksForRange` fix this depends on; re-confirmed still correct, not re-fixed.
- [color-popover-closes-on-first-native-picker-interaction](color-popover-closes-on-first-native-picker-interaction.md) - a different mechanism (auto-apply-on-change vs. outside-click dismiss) in the same component; explicitly re-verified not reintroduced by this fix.
