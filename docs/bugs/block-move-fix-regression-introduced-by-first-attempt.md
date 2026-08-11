# Regression: the first fix for block-move caret loss broke atom composition and list-Enter

**Status:** Fixed (the first implementation's renderer regressions are fixed; the six unrelated disabled-resize failures were separately resolved)
**Area:** renderer / atom / composition / list
**First reported:** unknown — backfilled from `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`, an explicit follow-up to `docs/PHASE_8B_BLOCK_MOVE_SELECTION_DEFECT.md`
**Related files:** `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`

## Symptom

This was not an external report — it was caught by the team's own test run after the first implementation of the [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) fix landed (uncommitted). Two previously-passing test groups started failing across all three browsers: composition before/after/between atoms, and list Enter start/mid/end.

## Reproduction

Since discarding the dirty worktree to get a clean baseline would have lost unrelated in-progress work, the investigation instead ran a fixed 12-test/3-browser matrix three ways: (a) the pre-fix control with only the new stable-ID branch removed, (b) the first stable-ID implementation, (c) a corrected implementation. Results: control = 6 failed/6 passed (6 pre-existing, unrelated failures — a disabled "Grow selected atom" button timeout, present in all three runs); first implementation = 12 failed (broke the 6 that had been passing); corrected implementation = back to 6 failed/6 passed, matching control exactly.

## Root cause

Three distinct sub-bugs in the first implementation, all in the renderer's stable-ID reconciliation:
1. The stable-ID branch used the historical cached model entry as the comparison baseline even when the same ID was already at the same position — a stale comparison that dropped an in-progress IME composition token and made list-Enter reconcile against the wrong split.
2. Reusing an atom node recursed into its rendered DOM payload; for formula nodes, the LaTeX source text lives in that DOM payload as presentation, not as model children, so the child-removal/diff loop erased it.
3. An undefined-predecessor edge case: a type check on the previous sibling was reached even when a new trailing child had no positional predecessor at all.

## Fix

(1) Prefer the immediately-rendered previous DOM node when its ID matches the target, and only fall back to the ID cache for a genuine positional move. (2) Treat `unknown` nodes, schema-atomic payloads, and registered atoms as opaque after syncing their attributes — never recurse into an atom's rendered DOM payload. (3) Removed the undefined-predecessor exception entirely by guarding the ID comparison itself. All three fixes live in `packages/core/src/foundation/surface/renderer.ts`.

The six control-run failures reported in the original follow-up were later
resolved separately: the `Grow selected atom` timeout was a native
`selectionchange` demotion of atom node selection, recorded in
[atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md).
They were not caused by this renderer correction.

## Regression coverage

New unit test in `packages/core/src/foundation/phase2_5.test.ts`: moves a sibling while a different node is actively composing (IME), asserts DOM identity is preserved and zero DOM writes occur to the composing node. Browser composition + list-Enter cases: 6/6 across Chromium/Firefox/WebKit.

## Related/similar issues

- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — the original defect this was a fix-of-a-fix for. Any future change to the renderer's stable-ID sibling reconciliation should re-run both this file's composition/list-Enter matrix and that file's move+type stress test, since this is exactly the code region where a "correct-looking" fix for one symptom broke two unrelated ones.
- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — the six control-run failures were later traced to native `selectionchange` demoting an atom node selection, not to stable-ID reconciliation.
