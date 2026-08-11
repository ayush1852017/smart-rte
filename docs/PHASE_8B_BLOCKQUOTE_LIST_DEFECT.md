# Phase 8b blockquote/list defect

## Reproduction

On `?canonicalAuthority=1`, create a list with at least two items, select the
items, and apply Blockquote. The pre-fix canonical path produced one
`blockquote` per selected item instead of one `blockquote` containing the list.

## Root cause

`wrapBlocks` grouped the selected paragraph/block IDs as independent siblings.
It did not promote selected descendants to their containing list node before
building the wrapper (`packages/core/src/foundation/block/commands.ts:124-157`).
That contradicted the Phase 5 rule that a quote containing a list wraps the
whole list.

## Fix

`wrapBlocks` now resolves the nearest `semanticRole: "list"` ancestor for every
selected block, de-duplicates those ancestors, and emits one replacement per
list (`commands.ts:124-139`). Non-list sibling groups retain the existing
grouping behaviour. `unwrapBlocks` now performs the symmetric ancestor lookup,
de-duplicates wrapper targets, and restores the wrapper's children as complete
nodes (`commands.ts:159-182`). IDs are not regenerated.

## Tests

- `packages/core/src/foundation/block/commands.test.ts:76-88` proves a
  multi-item list becomes exactly one quote containing the original list, then
  unwrap restores byte-identical structure and IDs.
- `packages/react/src/test-harness/blockShadowComparator.test.ts:15-30`
  confirms the retained legacy blockquote command already wraps the list once.

Focused results: core block command suite **8/8 passed**; retained block shadow
suite **2/2 passed**. The retained engine did not have this defect, so this was
a canonical-only regression and is now corrected.

## Regression accounting

Across the worktree validation window, no tests were removed: core Vitest was
**51 files / 423 → 424 passed**, React Vitest was **43 files / 237 → 240
passed**, and the three-browser Playwright suite was **243 total / 236 passed,
2 WebKit failures, 5 skipped → 238 passed, 0 failures, 5 skipped**. The WebKit
failures are investigated separately in
[`PHASE_8B_WEBKIT_FLAKE_INVESTIGATION.md`](./PHASE_8B_WEBKIT_FLAKE_INVESTIGATION.md).
