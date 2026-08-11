# Typing multiple consecutive spaces reported as collapsing/failing

**Status:** Needs re-verification (current source does not reproduce it)
**Area:** input
**First reported:** unknown — backfilled from `docs/PHASE_8B_SELECTION_INPUT_ENTER_DEFECTS.md`

## Symptom

Historical report that typing multiple consecutive spaces failed or the spaces collapsed incorrectly in the editor.

## Reproduction

Not reproducible on the canonical surface at time of investigation. Four consecutive `insertText` space events remain four literal spaces in the live model; the caret advances correctly after every input.

## Root cause

None found. There is no whitespace-collapsing normalizer anywhere on the editing path in this codebase — whitespace collapsing (where it exists at all, e.g. for HTML export) is correctly a serialization-time concern, not an editing-path concern. Disposition at the time: "stale/manual-surface observation rather than a currently reproducible model defect" — i.e. most likely tested against an old build or a different (e.g. legacy) surface.

## Fix

None needed.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts` (4× `beforeinput` space events, asserts literal spaces preserved plus correct final caret offset); `packages/react/e2e/canonical-authority.spec.ts` (browser-level, 3/3 passed).

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — this report's likely explanation, given the "not reproducible, looks like a stale observation" disposition.
