# Deleting a subset of list items removed the entire list instead

**Status:** Fixed
**Area:** list / selection (scope resolution)
**First reported:** unknown — backfilled from `docs/PHASE_8B_PARTIAL_LIST_DELETE_INDENT_UNWRAP.md`
**Related files:** `docs/PHASE_8B_PARTIAL_LIST_DELETE_INDENT_UNWRAP.md`

## Symptom

Selecting a proper subset of list items (not all of them) and pressing Delete removed the *entire* list instead of just the selected items.

## Reproduction

Confirmed specifically for a range whose *end* was the first editable position of the following (unselected) list item — e.g. selecting from item 1 through the very start of item 2's text, intending to select only item 1. Earlier test coverage had been insufficient to catch this: prior unit and browser cases selected proper subsets but always ended *inside* the last selected item's own text, which can catch an unconditional whole-list-replacement bug but not this specific "endpoint sitting exactly at the next item's content start" over-selection. A new two-item test case was needed to expose it.

## Root cause

The deletion plan itself was already correct (a proper item subset removes just those siblings; a full-children selection replaces the list with an empty paragraph). The bug was upstream, in scope resolution: list items' structural intervals (used for overlap detection) include the item's wrapper and first block — so a range ending at the very start of the *next* item's first text position still overlapped that next item, even though the selection visually never entered it. In the two-item repro, this meant selecting item 1 through the start of item 2 resolved *both* items as touched, and the (otherwise correct) "all children selected" deletion branch then correctly-but-wrongly removed the whole list. Explicitly characterized as a resolver boundary error, not a renderer, normalizer, or command error.

## Fix

The scope resolver now excludes an endpoint item from the touched set when that endpoint sits exactly at the item's first editable content position, for ranges whose endpoints are within the same list (`packages/core/src/foundation/scope/resolveScope.ts`). The endpoint check walks through the item and its first block to find the true first editable entry, so it isn't tied to a specific paragraph shape — an offset-zero endpoint is excluded, an end-of-block endpoint is still included. The deletion plan itself was deliberately left unchanged.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`: a fixture family covering a 5-item forward subset, a 5-item selection ending exactly at the next item's first content position, the same case via Backspace, a 2-item list selecting only the first item, and confirmation that a genuine whole-list selection still fully replaces the list. `packages/core/src/foundation/scope/scope.test.ts`: resolver-specific endpoint assertion. `packages/react/e2e/canonical-authority.spec.ts`: native browser 5-item ordered list, select item 2 through the start of item 4, Delete, assert surviving item IDs/text. Retained comparison: no retained implementation provides an equivalent semantic replay for this specific endpoint case — recorded as a canonical-only resolver regression, not evidence of a legacy-parity gap.

## Related/similar issues

- [multi-block-delete-fails-for-list-quote-code](multi-block-delete-fails-for-list-quote-code.md) — an earlier, more general deletion-path bug in the same area; this bug was only exposed after that one was fixed and existing test coverage still wasn't fine-grained enough to catch it.
