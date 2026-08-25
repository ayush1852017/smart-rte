# `setNodeAttributes` silently reorders a node's keys, breaking later exact-match checks on undo

**Status:** Fixed
**Area:** foundation / operations / table
**First reported:** 2026-08-18, during Phase 8c's fine-grained table-operations conversion, when the merge/split/move-column fuzz coverage was widened
**Related files:** `packages/core/src/foundation/operations.ts` (`applyToSession`'s `setNodeAttributes` branch, `sameValue`)

## Symptom

A one-operation-at-a-time undo replay (reversing and inverting a flat list of operations, applying each via `applyOperation`) failed with `"replaceNode before payload does not match document node."`, even though the actual node content matched the expected payload exactly, field for field.

## Reproduction

`table/table.test.ts`'s "preserves a valid single-claim grid and exact undo state across 1,000 generated sequences" fuzz test (seed `0x6A1D2026`), once widened to include `mergeTableCellsCommand`/`splitTableCellCommand`/`moveTableColumnCommand`, hit this at seed run 46: a cell's `attrs` were changed via `setNodeAttributes` (a `rowspan` bump/decrement, from `removeTableRowCommand`'s row-relocation logic), and a *later* operation on the same node (a `replaceNode` from an earlier merge, being undone) then failed to match — despite the node's `type`/`id`/`attrs`/`children` values being identical to what the operation expected.

Manually diffing the expected vs. actual node (normalizing key order) confirmed they were semantically identical; the raw JSON strings differed only in whether `attrs` appeared before or after `children`.

## Root cause

`applyToSession`'s `setNodeAttributes` branch (`operations.ts`) built the updated node as:
```js
const { attrs: _attrs, ...withoutAttrs } = target;
session.replace(operation.pos.path, { ...withoutAttrs, attrs: structuredClone(operation.after) });
```
Destructuring `attrs` out of `target` and then re-adding it via spread always appends it as the object's *last* key, regardless of where it originally sat. This silently changes `JSON.stringify(node)`'s output even when the attrs *value* is otherwise identical in content.

`sameValue` (used by `removeNode`/`replaceNode`/`setNodeAttributes` to validate a captured `before` payload against the live document) compares nodes via `JSON.stringify(left) === JSON.stringify(right)` — a strict, key-order-sensitive comparison. Any node whose `attrs` had been touched by `setNodeAttributes` therefore had its key order silently changed, and any *other* operation whose `before`/`node` payload was captured prior to that reorder (e.g. a `replaceNode` from an earlier command, undone later) would then fail to match, even though the content was unchanged.

This bug predates Phase 8c and is not specific to tables — it affects any node touched by `setNodeAttributes` and later referenced by an exact-match check. It was previously invisible because no existing code path applied `setNodeAttributes` and then later exact-matched the *same* node via a one-operation-at-a-time (non-batched) undo; Phase 8c's fine-grained table operations made `setNodeAttributes` pervasive (every rowspan/colspan bump) and interleaved it with `replaceNode` on the same node across multiple commands within one fuzz-test run, which is what exposed it.

## Fix

`operations.ts`'s `setNodeAttributes` branch now builds the updated node via `{ ...target }` (preserving existing key order) and reassigns/deletes the `attrs` key in place, rather than destructuring it out and re-adding it via a fresh spread:
```js
const next = { ...target } as Record<string, unknown>;
if (Object.keys(operation.after).length) next.attrs = structuredClone(operation.after);
else delete next.attrs;
session.replace(operation.pos.path, next as unknown as SmartElementNode);
```
Reassigning an *existing* object key does not change its position; only genuinely new keys are appended. `SmartElementNode.attrs` is a readonly property, hence the `Record<string, unknown>` intermediate cast to allow in-place reassignment/deletion.

## Regression coverage

The widened `table/table.test.ts` 1,000-seed fuzz test (seed `0x6A1D2026`) is the regression guard — it exercises exactly the interleaving (multiple `setNodeAttributes` and `replaceNode` ops on shared nodes across many random commands, undone one operation at a time) that exposed this. No dedicated unit test was added for the key-order property in isolation; the fuzz test's undo-round-trip assertion (`expect(model).toEqual(before)` after full reverse-and-invert replay) would fail again if this regressed.

## Related/similar issues

[table-row-empty-rowspan-coverage-rejected](table-row-empty-rowspan-coverage-rejected.md) — found via the same fuzz-test-widening pass, a different bug in the same investigation.
