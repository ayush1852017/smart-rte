# Block Move Up/Down on a paragraph nested inside a list is a no-op

**Status:** Not a bug (working as designed)
**Area:** list / block
**First reported:** unknown — backfilled from `docs/PHASE_8B_BLOCK_MOVE_SELECTION_DEFECT.md`

## Symptom

An initial test attempted Block Up/Down on a paragraph nested inside a list item and found it did nothing.

## Reproduction

Confirmed the no-op is intentional: list items use a separate `list.move` ("Move item") command route entirely; `block.move` deliberately does not apply to a paragraph that's a child of a `list_item`.

## Root cause

N/A — not a defect. `block.move` and `list.move` are different commands with different applicability, by design (they share an underlying implementation, `moveContiguousSiblings`, but different callers/scopes decide which one applies).

## Fix

None. The original test that exercised this was discarded because it represented an unsupported command usage, not a removed regression test.

## Regression coverage

No dedicated regression test for the no-op itself; covered implicitly by `list.move`'s own test coverage (see [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md)'s regression coverage, which includes list-item move).

## Related/similar issues

- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md) — the real bug found in the same investigation era, on the actual `block.move`/`list.move`/table-move shared implementation.
- Cross-referenced in a later Gate-13 retained-vs-canonical parity classification as "the previously reported list-item UI regression" for `block.move`, and as a "parity finding, not an exclusion" for `list.move` — same underlying no-op behavior, not a new issue.
