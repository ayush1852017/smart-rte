# Checklist: pressing Space anywhere in item text toggled the checkbox instead of inserting a space

**Status:** Fixed
**Area:** list / input pipeline / checklist
**First reported:** 2026-08-10 (this project's ongoing list-toolbar bug hunt)
**Related files:** `docs/PHASE_8B_MIXED_CHECKBOX_PRESET_REOPEN.md`

## Symptom

Typing multi-word text into a checklist item (e.g. "Buy milk") never produced the space character between words — instead, every Space keystroke toggled the item's checked state and the space was never inserted.

## Reproduction

- Create a checklist item via the toolbar, type text containing a space anywhere in the item.
- Confirmed via a real `Space` key dispatch through `packages/core/src/foundation/surface/input.ts`'s keydown handler in a checkable list item, at any caret offset — not just item-start.
- No test in the suite exercised this path at all (`key === " "` / `"Spacebar"`), which is why it shipped unnoticed.

## Root cause

An unconditional Space-key handler in `handleKeyDown` (surface/input.ts) matched `event.key === " " || event.key === "Spacebar"` whenever the caret was inside any checkable list item, with no check on caret position or whether the item was otherwise empty. It called `setListChecked` and `event.preventDefault()` on every press, unconditionally swallowing the space.

## Fix

Removed as part of making the projected checkbox a real `<button>` that uses native button activation (Space/Enter on a focused button toggles it natively) instead of a global text-input interceptor. The click/toggle route lives at `packages/core/src/foundation/surface/input.ts` (`check-control` handling in the click listener) and `packages/core/src/foundation/surface/renderer.ts` (renders the checkbox as `<button>`). This fix landed via a parallel work session (Codex) mid-project; independently confirmed gone from `surface/input.ts` by grepping for the old handler pattern — no match.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"preserves spaces typed inside checklist text"` — real keyboard `Space` presses while typing inside a checklist item, asserts spaces are present in the model. Passes in all three browsers.

## Related/similar issues

- [checklist-checkbox-border-ring-artifact](checklist-checkbox-border-ring-artifact.md) — same projected-checkbox lifecycle, different symptom (CSS), fixed in the same investigation round.
- [tab-key-loses-editor-focus-when-indent-declines](tab-key-loses-editor-focus-when-indent-declines.md) — same class of bug (a keyboard handler not correctly owning/preventing default for a key it should fully control), found independently, different key.
