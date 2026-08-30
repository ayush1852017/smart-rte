# "Insert table" silently does nothing when the caret is already inside another table

**Status:** Open
**Area:** react / core table plugin (`insertTableCommand`, `blockScope`)
**First reported:** found incidentally while verifying the new table-size picker (see the "table row/column count picker" work) - not part of that request's scope, logged here rather than fixed silently or left unrecorded.
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`insertTable`, `blockScope`), core table command/scope resolution.

## Symptom

Insert a table, leave the caret inside one of its cells, then invoke "Insert table" again (any size): nothing happens - no second table is created, no error, no visible feedback. The document is left unchanged.

## Reproduction

Confirmed directly: insert a 2×2 table (caret lands in its first cell via `selectionOwnerId: paragraphIds[0]`), then trigger a second table insert (any dimensions) without moving the caret out first. Document structure before and after the second attempt is byte-for-byte identical (`["paragraph", "table", "paragraph"]` in both cases) - the command silently no-ops rather than either inserting nested/adjacent content or surfacing any indication that the action wasn't possible.

## Root cause

Not investigated - out of scope for the request that surfaced it (a size-picker UI feature, not a table-insertion-scope bug hunt). Likely candidate, not confirmed: `blockScope()` can't resolve a valid `block-range` scope to insert a top-level sibling block when the selection is inside a table cell (an isolating boundary), and `insertTableCommand` (or the scope resolution feeding it) returns no operations rather than falling back to some other valid target.

## Fix

None yet - this is a pre-existing gap, unrelated to and not touched by the size-picker feature that surfaced it (that feature only parameterized the existing `rows: 2, columns: 2` hardcoding to accept a chosen size; the underlying scope-resolution behavior when already inside a table was not modified and behaves identically for every size, including the previously-only-available fixed 2×2).

## Regression coverage

None yet - tracked here so a future investigation starts from this reproduction instead of from zero.

## Related/similar issues

None identified yet.
