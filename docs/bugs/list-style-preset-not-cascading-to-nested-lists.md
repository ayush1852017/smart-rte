# Changing a list's style/preset didn't cascade into its own nested sub-lists

**Status:** Fixed
**Area:** list / commands
**First reported:** 2026-08-10 (this session)
**Related files:** `docs/PHASE_8B_MIXED_SCOPE_DROPDOWN_CHECKLIST_PRESET.md` (§4, an earlier related discoverability pass) — see also [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) for a distinct, earlier-round cause of "preset change doesn't visually apply."

## Symptom

Selecting a new list preset/style from the toolbar only changed the directly-selected list's own marker — any nested sub-lists inside it kept their old marker family, producing visually inconsistent nesting (e.g. outer list becomes upper-roman, inner sub-list still shows the old diamond bullets).

## Reproduction

Built a 2-3 level nested list, applied a new style/preset via the toolbar while selection covered the outer list, inspected both the model (`attrs.preset`/`attrs.style` per list node) and the rendered DOM/`::marker` content per nesting level.

## Root cause

`setListStyle`/`setListPreset` in `packages/core/src/foundation/list/commands.ts` only rewrote the directly-selected list node's own `attrs` via `replaceLists`. Marker CSS in `packages/react/src/theme.ts` is keyed on `[data-srte-list-preset][data-srte-list-depth]` per list element individually — nothing about the DOM inherits a preset from an ancestor, so an untouched nested list kept projecting its own stale `data-srte-list-preset`.

## Fix

`packages/core/src/foundation/list/commands.ts` — new `withNestedListsRestyled` helper recursively walks into every nested list inside the selected list's subtree and applies the same preset/style change, preserving all node IDs (only `attrs` change). `checkable` deliberately does **not** cascade — converting an outer list to a checklist should not silently make every nested sublist checkable too; that stays scoped to the directly-selected list only.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: `"cascades preset and style changes into nested lists so their markers stay consistent"` — 3-level nested list, asserts preset/style propagate to all levels while `checkable` stays scoped to the outer list only.

## Related/similar issues

- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — an earlier, distinct bug in the same area (renderer didn't project preset/depth attributes at all, so even a single-level change didn't render).
- [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md) — the companion fix: this cascades *downward* from whatever list is selected; that fix makes the toolbar select the *true root* list regardless of cursor depth, so the two together make a style/preset change from anywhere in the tree affect the whole tree.
