# Indent/Outdent both disabled together at maximum indent depth — not reproducible

**Status:** Not a bug
**Area:** list / toolbar
**First reported:** unknown — backfilled from `docs/PHASE_8B_DELETE_LIST_TYPES_INDENT_DEFECTS.md`
**Related files:** `docs/PHASE_8B_DELETE_LIST_TYPES_INDENT_DEFECTS.md`, `docs/PHASE_8B_INDENT_CODE_BOUNDARY.md`

## Symptom

Report that at maximum indent depth, both Indent and Outdent toolbar buttons became disabled together (expected: only Indent should disable at max depth; Outdent should remain available).

## Reproduction

Not reproducible on the build tested at the time.

## Root cause

None found — investigated and rejected. The two buttons' enabled state is derived **independently** in the toolbar: Indent-enabled only checks whether the selected item has a preceding sibling to nest under; Outdent-enabled only checks whether the resolved scope is a valid list-selection at all. There is no shared/coupled "disable both at max depth" logic anywhere in the toolbar or command layer. Direct command execution of outdent after reaching max indent depth was also confirmed to remain legal.

## Fix

None needed.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: max-depth Indent disabled / Outdent enabled, both for a single item and for a multi-item selection, 6/6 across 3 browsers.

## Related/similar issues

This is one of **two** distinct "Indent/Outdent disabled together" reports in this project's history with different dispositions — don't conflate them:
- **This file**: confirmed not reproducible, no coupling found in the max-depth case.
- [mixed-list-scope-indent-outdent-disabled-incorrectly](mixed-list-scope-indent-outdent-disabled-incorrectly.md) — a **confirmed real bug**, for a different scenario (a selection mixing list items with a plain block sibling, not a max-depth single-list case). If a new report comes in sounding like "indent/outdent disabled when it shouldn't be," check which scenario it actually matches before assuming either disposition.
- [list-depth-zero-subset-case-taxonomy](list-depth-zero-subset-case-taxonomy.md) — a related, more detailed case-by-case investigation of subset selections reaching depth zero, mostly also "not a bug," with one case left unconfirmed.
- [list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug](list-indent-disabled-after-outdent-to-plain-paragraph-not-a-bug.md) — a different "Indent looks disabled" report, also not a bug, also by design.
