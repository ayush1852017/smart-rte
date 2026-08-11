# Changing list type/preset from a deeply nested cursor only affected that nested sub-list, not the whole tree

**Status:** Fixed
**Area:** list / toolbar
**First reported:** 2026-08-10/11 (this session)

## Symptom

Placing the cursor on a deeply nested list item and applying a new list type (Bullets/Numbering/Checklist buttons, or the preset dropdown) only changed the immediate nested sub-list the cursor was in — not the whole list tree from its true root. Reported expectation, matching real-world editor conventions: a type change from anywhere in a list should apply to the entire list, regardless of cursor depth.

## Reproduction

Confirmed by reading `resolveScope`'s list-selection resolution: for a collapsed caret with no cross-list-boundary selection, the resolved `listId` is always the *nearest* containing list, not the tree's true root. Confirmed live via a 3-level nested-list construction, applying a preset from the deepest cursor position, checking that only that innermost list changed.

## Root cause

The toolbar always operated on whatever list the scope resolver handed it (the nearest list to the cursor) — there was no step that walked further up to the tree's actual root before applying a style/preset change.

## Fix

New `outermostListId` helper in `packages/react/src/components/CanonicalAuthorityEditor.tsx` walks from the cursor's resolved list up to the true root before applying a style/preset change — used by the toggle buttons' "apply a different type" branch and the preset `<select>`. Single-item toggle-*off* (clicking an already-active button on one item) deliberately stays scoped to just the current item, unchanged — this fix only affects "apply a genuinely different type," not the toggle-off feature. Depends on and composes with [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md)'s downward cascade — together, a change from anywhere in the tree now reaches the true root and cascades back down through every level.

An existing test that explicitly asserted the *old*, now-superseded "stays scoped to nearest list" behavior (`"applies every exposed list preset to a nested list through toolbar routing"`) was rewritten to assert the new whole-tree behavior instead, since the old assertion directly contradicted the new intended behavior.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"applies a preset chosen from a nested cursor to the whole list tree"` (3-level-deep construction, all 12 presets, asserts every level updates), plus `"shows the active list toggle and removes only the current item on re-click"` (confirms toggle-off did *not* regress into whole-tree scope). 3/3 browsers each.

## Related/similar issues

- [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md) — the companion fix (cascading *downward* into nested lists); this file is the companion fix for reaching the correct *starting point* (the true root) regardless of cursor depth. Both were needed together for "change type from anywhere in the tree" to fully work.
- [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md) — an earlier, different bug in the same general area (a *ranged selection* inside a nested list incorrectly promoting to the outer list) — opposite direction of error from this file's bug (that one over-promoted; this one under-promoted for a collapsed cursor), different root cause, different round.
