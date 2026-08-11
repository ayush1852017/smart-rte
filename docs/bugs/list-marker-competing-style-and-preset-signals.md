# List marker showed both old and new type after a type change (competing style/preset attrs)

**Status:** Fixed
**Area:** list / renderer
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_TABLE_BLOCKQUOTE_DEFECTS.md` ("bug 1")

## Symptom

Changing a list's type appeared to add a second marker rather than replace the first — both the old and new markers were visible after the change.

## Reproduction

Confirmed directly. Investigated as a possible shared cause with the blockquote-wraps-list-items bug found in the same round, but explicitly **not** the same cause — list-type change operates on list attributes; blockquote wrapping operates on structural ancestor scope. Unrelated commands, coincidentally reported around the same time.

## Root cause

The canonical list node retained its old `preset` attribute while a type change also set a new, concrete `style` attribute — giving the renderer two competing type signals (both a marker-family selector and a CSS marker style) to project at once.

## Fix

`packages/core/src/foundation/list/commands.ts`: `setListPreset` now clears `style` when setting a preset, and `setListStyle` now clears `preset` when setting a style (while preserving `checkable`), making a type change a single-state transition rather than an additive one. The renderer receives one authoritative marker definition per list node.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: numbered → bulleted → checklist → numbered, asserting the inactive marker attribute is absent at every step. Retained engine (which only ever had a single `style` field, never a competing `preset`) was already correct — confirmed no retained regression.

## Related/similar issues

- [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md) — a much later, distinct bug in the same "list type change" feature area: even after this fix, a type change didn't propagate into *nested* sub-lists at all. Different root cause, same general feature.
- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — another distinct bug where the model changed correctly but the renderer never projected the preset/depth attributes needed for custom markers to show at all. Three separate "list marker doesn't show right" bugs across the project's history, three different causes — check all three before assuming a new marker report matches any one of them.
