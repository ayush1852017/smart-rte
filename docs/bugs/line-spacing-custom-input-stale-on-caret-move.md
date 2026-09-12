# Custom line-spacing input kept showing a stale value after the caret moved elsewhere

**Status:** Fixed
**Area:** react - `CanonicalAuthorityEditor.tsx` (Line spacing dropdown's custom `<input>`)
**First reported:** 2026-09-12, live report — "Line spacing custom not changing when cursor move to something else."
**Related files:** [line-height-support](line-height-support.md) — the feature this input belongs to.

## Symptom

After typing a custom line-spacing value on one block, moving the caret to a different block (a different or no override) and reopening the "Line spacing" dropdown still showed the first block's custom value in the "Custom" field, instead of reflecting whatever the new caret position actually has.

## Investigation

The `<input>` used React's `defaultValue`, computed fresh from `currentLineHeight()` on every render — but `defaultValue` is only ever *applied* by React on an element's initial mount; a changed `defaultValue` prop on a later render of the same element is silently ignored. `ToolbarDropdown` never conditionally unmounts its menu content when closed (confirmed by reading its implementation: only a CSS `visibility` style toggles; `{children}` is always in the tree), so this input mounts exactly once for the lifetime of the toolbar and never gets a chance to re-apply `defaultValue` again, regardless of how many times the dropdown is closed/reopened or the selection changes.

## Fix

Added `key={...}` to the input, derived the same way as `defaultValue` itself (the current non-preset custom value, or `"none"`). Changing the `key` forces React to discard the old DOM node and mount a genuinely new one whenever the resolved line-height at the caret changes — which only happens on a real commit (Enter/blur) or a selection change, never mid-keystroke while typing.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: "the custom line-spacing input updates to reflect a different block once the caret moves there" — sets a custom value on one paragraph, moves the caret to a second (untouched) paragraph and confirms the field clears, applies a preset there and confirms the field still reads blank (not the first paragraph's stale value), then moves back and confirms the first paragraph's own value is still shown correctly. Confirmed to fail without the fix (stuck on the stale value) via `git stash`. Passed 3/3 browsers. The pre-existing "applies a custom line-height value..." test's own reopen-check happened to pass even before this fix, since it never moved the caret away first — it wasn't exercising this gap at all.

Full suites: core unaffected, react 151/151, `canonical-authority.spec.ts` line-height/color test group (33 tests) green across all 3 browsers, typecheck and lint clean.
