# Blockquote (and unwrap) crashed on a selection spanning a list item and its own nested sub-list item

**Status:** Fixed
**Area:** core - `foundation/block/commands.ts` (`wrapBlocks`, `unwrapBlocks`)
**First reported:** 2026-09-10, with a screenshot — "selected partially nested list item and clicked on blockquote it gives this error and does nothing" — a numbered list (roman numerals, with alpha and decimal sub-levels), selection spanning from partway into a top-level item's text through partway into a nested sub-item's text, several levels of nesting deep.
**Related files:** [blockquote-wraps-each-list-item-separately](blockquote-wraps-each-list-item-separately.md) — the earlier fix this one builds on; it correctly dedupes *identical* list ancestors but didn't anticipate two selected blocks resolving to two *different, nested* list ancestors.

## Symptom

Selecting text that starts in one list item's own paragraph and ends in a paragraph belonging to that item's own nested sub-list, then clicking Blockquote, threw an uncaught error and applied nothing:

```
Error: replaceNode before payload does not match document node.
    at applyToSession (operations.ts:175)
    ...
    at toggleBlockquote (CanonicalAuthorityEditor.tsx:613)
```

## Reproduction

Confirmed directly (real browser, `?canonicalAuthority=1`): build a numbered list with a top-level item whose own paragraph has text, followed immediately by a nested sub-list item with its own paragraph. Select from partway through the top-level item's text to partway through the nested item's text. Click Blockquote.

## Root cause

`wrapBlocks` calls `ancestorTargets(scope, "list", ctx)` to find, for every selected block, its *nearest* list ancestor, then de-duplicates by ancestor id before building one `replaceNode` per distinct target. The selection above touches two different blocks whose nearest list ancestors are **different but nested inside each other**: the top-level item's own paragraph resolves to the *outer* list, while the nested sub-item's paragraph resolves to the *inner* (nested) list — a genuinely different node id, so the existing identical-ancestor dedup doesn't catch it.

`wrapBlocks` then built two independent `replaceNode` operations — one wrapping the inner list, one wrapping the outer list — both carrying a `before` snapshot captured from the *same* pre-edit document. Since `applyOperations` applies operations sequentially against an evolving document, the second operation to run found that its captured `before` node no longer matched current state: the first operation had already replaced a node nested inside what the second operation was about to replace, and no code accounted for the outer target's subtree already containing the inner one.

## Fix

New shared helper `dropNestedTargets(targets, ctx)` — after collecting candidate ancestors (in both `wrapBlocks`'s `ancestorTargets` and `unwrapBlocks`'s own `wrappers` map), removes any target whose own ancestor chain contains *another* candidate target. Wrapping/unwrapping the outermost target already covers everything nested inside it, so the inner one is simply dropped rather than treated as a second, conflicting operation. Verified the schema explicitly allows nested blockquotes (`nestable: true`) — `unwrapBlocks` has the exact same latent vulnerability for a selection spanning an outer and inner blockquote, even though no live report surfaced it yet, so it got the same fix rather than leaving a known-identical gap unpatched.

## Regression coverage

`packages/core/src/foundation/block/commands.test.ts`: two new tests — one for `wrapBlocks` (selection spans an outer list item and its own nested sub-item; confirms no throw, confirms the *whole outer list* wraps in one blockquote with zero data loss, matching the existing "a list wraps as a whole" policy), one for `unwrapBlocks` (selection spans an outer and nested blockquote; confirms no throw, confirms only the outer one unwraps and the nested one is left fully intact). Both confirmed to actually fail without the fix (reverted `commands.ts` via `git stash`, re-ran, got the exact real errors — `block.wrap requires 2 caller-provided wrapper ID(s)` and `replaceNode before payload does not match document node` respectively — then restored and confirmed both pass).

`packages/react/e2e/canonical-authority.spec.ts`: new test "applies Blockquote to a selection spanning a list item and its own nested sub-list item without throwing" — builds the list via real typing/Tab-indent, selects via native Range/Selection APIs spanning the two text nodes, clicks the real Blockquote toolbar button, asserts zero page errors and the correct resulting DOM (one `blockquote`, both list items with their full original text intact). Passed 3/3 browsers.

Full suites: core 749/749 (+2 from the new unit tests), react unit 151/151, typecheck clean.

## Related/similar issues

- [blockquote-wraps-each-list-item-separately](blockquote-wraps-each-list-item-separately.md) — the original fix that introduced `ancestorTargets`'s ancestor-resolution/dedup approach; correct for its own case (identical ancestors), but didn't anticipate the ancestor-of-ancestor shape this bug is about.
