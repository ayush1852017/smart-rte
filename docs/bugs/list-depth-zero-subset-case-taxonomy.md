# Indent/Outdent state for a subset selection reaching depth zero — three cases, two confirmed not-a-bug, one unconfirmed

**Status:** Needs re-verification (cases (a) and (b) are closed as correct; case (c) was never reproduced)
**Area:** list / toolbar
**First reported:** unknown — backfilled from `docs/PHASE_8B_INDENT_CODE_BOUNDARY.md`

## Symptom

A report structured around three distinct cases (from an earlier ticket) about Indent/Outdent button state when a *subset* of nested list items reaches depth zero via repeated Outdent:
- **(a)** items are at depth zero but still structurally children of the outer list (not yet unwrapped) — reported issue with control state.
- **(b)** items have been outdented one step further, fully unwrapping into plain blocks.
- **(c)** an unspecified third variant, never precisely pinned down from the original report.

## Reproduction

- **Case (a)**: reproduced exactly — select two items while nested, press Outdent twice. After the second press, selected items are at depth zero but still children of the outer list. Resolved scope remained a valid list-selection; outer list retained its sibling/selected-item IDs. Both Indent and Outdent were enabled in this state, 3/3 browsers. **Concluded: this is correct, not a defect** — the implementation correctly distinguishes "depth zero, still in a list" from "the list has already been unwrapped."
- **Case (b)**: not separately reproduced here, but recognized as the same scenario already investigated and confirmed not-a-bug in [list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug](list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug.md) — Indent correctly disables once content is no longer in a list at all.
- **Case (c)**: **not reproduced.** If the originally-observed state doesn't match (a) or (b), there wasn't enough information in the original report to construct it.

## Root cause

No production defect found for the two confirmed cases. Indent-enabled and Outdent-enabled are computed independently in the toolbar (Indent checks for a preceding sibling in the current scope; Outdent checks only that the scope is a valid list-selection, including the depth-zero-unwrap case) — there is no "both disabled together at max depth" coupling anywhere in the toolbar or command layer. A subset selection whose first item is already the list's first child also correctly disables Indent (nothing to indent under), independent of this investigation.

## Fix

None — no defect confirmed to fix in cases (a) or (b).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: constructs a nested list, selects a subset, verifies intermediate depth states, asserts that at depth zero (still in the list) both controls remain enabled and the list's item IDs are preserved — 6/6 across 3 browsers × 2 scenarios.

## Related/similar issues

- [indent-outdent-max-depth-disabled-together-not-a-bug](indent-outdent-max-depth-disabled-together-not-a-bug.md) — the simpler, single-item version of this same general concern, also not a bug.
- [list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug](list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug.md) — covers this file's case (b) in full detail.
- [mixed-list-scope-indent-outdent-disabled-incorrectly](mixed-list-scope-indent-outdent-disabled-incorrectly.md) — the one **confirmed real** bug in this whole "indent/outdent disabled" family, found in a later round, for a scenario none of cases (a)/(b)/(c) here describe (a mixed list+plain-block selection, not a pure-list subset). If a new report sounds like this family, check that file first — it's the one genuine defect among many "not a bug" outcomes.
