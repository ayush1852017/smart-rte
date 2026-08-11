# Applying a list type/preset from a selection inside a nested list applied to the outer list instead

**Status:** Fixed
**Area:** list / toolbar / selection (scope resolution)
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_ENTER_LIST_TYPES_CODE_CHECKLIST.md`
**Related files:** `docs/PHASE_8B_LIST_ENTER_LIST_TYPES_CODE_CHECKLIST.md`

## Symptom

Two compounding, independently-discovered symptoms under one report: (1) applying a list-type/preset change to a selection made *inside* a nested (child) list applied the change to the outer/parent list instead; (2) the toolbar's preset control only exposed six list types even though more were configured.

## Reproduction

Confirmed on the canonical surface. Pure command-layer unit tests were unaffected by the underlying resolver bug, which ruled out a command-layer regression early and pointed the investigation at scope resolution instead.

## Root cause

Two distinct, compounding causes — not one bug wearing two symptoms:
1. **Scope resolution**: the scope index's ancestor intervals include descendant content by design (needed elsewhere for legitimate promotion cases), and the traversal that finds "which list does this selection touch" was promoting a selection made inside a child list up to its parent list unconditionally.
2. **Toolbar exposure**: separately, the canonical toolbar's preset `<select>` was hardcoded to only six of the twelve configured presets, rather than being generated from the shared preset registry.

## Fix

For a ranged selection whose endpoints both belong to the same nearest list, the scope resolver now filters to that list specifically rather than promoting to an ancestor (`packages/core/src/foundation/scope/resolveScope.ts`) — selections whose endpoints genuinely cross list levels still retain the broader promotion behavior, since that's a legitimate different case. The canonical toolbar now generates its preset options from the shared `SMART_LIST_PRESETS` registry instead of a hardcoded six-item list (`packages/react/src/components/CanonicalAuthorityEditor.tsx`). No preset-specific command logic was added — this was purely a scope-resolution and toolbar-exposure fix.

## Regression coverage

`packages/core/src/foundation/scope/scope.test.ts` (direct nested ranged scope resolves to the inner list, not the outer one); `packages/react/e2e/canonical-authority.spec.ts` (nested toolbar routing, all 12 presets, 3/3 browsers; top-level preset routing also 6/6). Retained engine already recursed correctly via its own hierarchy-aware preset application and showed no equivalent failure.

## Related/similar issues

This bug is one link in a longer chain of "list type/preset selection not working" reports across this project's history — read the whole chain before investigating a new one, since several genuinely different bugs share this surface-level description:

- [list-marker-competing-style-and-preset-signals](list-marker-competing-style-and-preset-signals.md) — an earlier, unrelated bug (dual style+preset attrs both rendering at once).
- [list-type-selection-not-reproducible-round2](list-type-selection-not-reproducible-round2.md) — a re-check *after* this fix landed, found nothing wrong at that point.
- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — a still-later round where the model changed correctly but the renderer never projected the attributes needed to show it, a genuinely new and different bug discovered after round 2 found nothing.
- [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md) and [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md) — the most recent round, fixing a *related but distinct* problem (a type change not propagating to nested sub-lists, and not targeting the whole tree from a nested cursor) that only became visible once this file's bug and the two above were already fixed.
