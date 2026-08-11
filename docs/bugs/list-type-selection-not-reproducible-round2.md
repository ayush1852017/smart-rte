# List type/preset selection re-checked after the nested-scope fix — nothing wrong at that checkpoint

**Status:** Not a bug (at time of this check — see related issues for what was found later)
**Area:** list / toolbar
**First reported:** unknown — backfilled from `docs/PHASE_8B_DELETE_LIST_TYPES_INDENT_DEFECTS.md`

## Symptom

A report (presumably a re-report or a lingering ticket) that list types beyond plain bullet/numbered were not working or not exposed — checked again after [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md) had already been fixed.

## Reproduction

Re-run against a fresh build and a fresh Playwright dev server — explicitly done to rule out a stale-dev-tab explanation before concluding anything. Both the top-level preset route (six legacy-aliased presets) and the nested preset route (all twelve configured presets) passed cleanly, 3/3 browsers each.

## Root cause

None found at this checkpoint. The toolbar select was confirmed populated directly from the shared preset registry, with no missing wiring or stale state. Explicitly: "no current evidence of a command-layer failure, missing nested-list option, or stale toolbar state."

## Fix

None — no code change was made or needed at this checkpoint.

## Regression coverage

`packages/core/src/foundation/scope/scope.test.ts`; `packages/core/src/foundation/list/commands.test.ts`; the two Playwright routes described above.

## Related/similar issues

**Important:** this file being "not a bug" at its checkpoint does **not** mean the general "list type/preset selection not working" report was fully resolved for good — a later round found a genuinely new, different bug after this check. See:
- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — the renderer-projection bug found in the next round, after this file's "all clear."
- [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md) — the fix that made this checkpoint's "all clear" possible.

This file exists specifically as a checkpoint marker in the arc — if a similar report recurs, don't assume it's automatically the renderer-projection bug or the nested-scope bug; confirm against current source, the same way this checkpoint did.
