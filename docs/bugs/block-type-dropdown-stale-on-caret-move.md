# Block-type toolbar dropdown didn't update when the caret moved to a different block type

**Status:** Fixed
**Area:** toolbar / block
**First reported:** unknown — backfilled from `docs/PHASE_8B_MIXED_SCOPE_DROPDOWN_CHECKLIST_PRESET.md` (§2)

## Symptom

Moving the caret from a paragraph into a heading or code block could leave the toolbar's block-type dropdown still showing "paragraph" (or whatever it showed at mount), rather than updating to reflect the actual block type under the caret.

## Reproduction

Moved the caret through paragraph → heading 2 → code block → paragraph and observed the dropdown's displayed value at each step.

## Root cause

The dropdown used `defaultValue="paragraph"` in React, which is only applied once at initial mount — later caret/selection changes never updated it, since `defaultValue` explicitly does not re-apply on re-render. Not a command or renderer defect; purely a controlled-vs-uncontrolled React component bug.

## Fix

A `blockTypeAt` helper now derives the current block type by walking the model path at the caret, and the `<select>` is now a properly controlled component (`value={currentBlockType}`) in `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"tracks the Block type dropdown with the current caret owner"` — moves the caret paragraph → heading 2 → code block → paragraph, asserts the select value after each move. 3/3 browsers. No equivalent canonical dropdown state exists on the retained path; retained editing code and its suites were not touched.

## Related/similar issues

None identified with the same root cause.
