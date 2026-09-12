# Any color/border live-preview crashed once the document contained a multi-line code block

**Status:** Fixed
**Area:** core - `foundation/marks/hardBreak.ts` (`migrateNewlineTextToHardBreaks`)
**First reported:** 2026-09-12, live report + console stack trace — "Inside table by using context menu I tried to change background color and text color. But color dragging not working only clicking to change colors in picker but it doesn't reflect to cell. Couldn't able to close the color picker. Outside click and close button both not working."
**Related files:** [code-block-trailing-newline-invisible](code-block-trailing-newline-invisible.md) — the same-day fix that made a code block's own embedded `"\n"` a normal, everyday occurrence (any Enter inside a code block writes one); this bug turns that ordinary state into a crash the moment a color/border popover previews anything anywhere in the same document. [color-picker-redesigned-drag-first-no-apply-button](color-picker-redesigned-drag-first-no-apply-button.md) — the live-preview mechanism (`previewColor`) this crash fires from; not itself at fault.

## Symptom

Reported from the table-cell color context menu, but not actually table-specific: dragging the color picker appeared to do nothing, clicking a swatch didn't reflect on the target, and once that happened, the popover could no longer be dismissed by any means — outside click, the × button, none of it worked.

## Investigation

A console stack trace accompanying the report pinned the exact call chain:
```
Uncaught Error: Replacement document is invalid: Children do not match "text*".
    at FoundationEditor.replaceState (editor.ts:282)
    at CanonicalEditorRuntime.restoreCheckpoint (canonicalEditorRuntime.ts:372)
    at previewColor (CanonicalAuthorityEditor.tsx:993)
    at stage (ColorPickerPopover.tsx:172)
    at onPointerDown (ColorPickerPopover.tsx:98)
```
`previewColor` lazily captures a checkpoint of the *entire* document on the first preview frame, then calls `restoreCheckpoint` (→ `replaceState`) before reapplying the color on every subsequent frame — the same mechanism `TableResizeHandles` and the border popover both already use. `replaceState` runs every replacement document through `migrateNewlineTextToHardBreaks` (a legacy-document upgrade path that splits a text node containing `"\n"` into `text`/`hard_break` pieces) before validating it. That migration recursed into every element unconditionally, including `code_block` — whose schema is `content: "text*"` and never accepts a `hard_break` child. A code block with any embedded `"\n"` (completely ordinary after the same day's fix above) got its own newline "migrated" into an invalid `hard_break` child, and the very next `validate()` call rejected the resulting document, throwing.

Once the first checkpoint-restore call is poisoned, `colorPreviewCheckpointRef.current` is already set (the ref is assigned *before* the throwing `restoreCheckpoint` call), so every later `applyColor`/`cancelColorPopover` call — Escape, outside click, the × button, Discard — also calls `restoreCheckpoint` on that same doomed checkpoint and throws again, explaining why nothing could close the popover once one drag/click had already failed.

## Root cause

`migrateNewlineTextToHardBreaks` had no exclusion for `code_block`, the one node type in the schema whose content model (`text*`) forbids the `hard_break` atom every other inline owner (`paragraph`, `heading`) uses for line breaks. The function assumed every element it recursed into could accept a `hard_break` child.

## Fix

`hardBreak.ts`'s `visit` now returns a `code_block` node unchanged (no recursion into its children at all) — matching the schema's own restriction and this project's already-established convention that a code block's line breaks are literal `"\n"` text, never `hard_break` nodes.

## Regression coverage

`packages/core/src/foundation/marks/marks.test.ts`: "leaves a code block's own literal newlines untouched - it is not a hard_break-migration target" — confirmed to fail without the fix (splits into 2 pieces instead of 0) via `git stash`.

`packages/react/e2e/canonical-authority.spec.ts`: "dragging the color picker does not crash when the document also contains a multi-line code block" — builds a document with an unrelated multi-line code block, then drags the saturation/value square on separate text, asserting no `pageerror` fires and the color actually applies. Confirmed to fail without the fix (drag silently no-ops, matching the live report) via `git stash` + rebuild. Passed 3/3 browsers. The table-cell color context-menu path shares the identical `previewColor`/`applyColorToTarget` mechanism (only the "cell" vs. "mark" branch differs), so this is not a table-specific fix despite how it was reported.

Full suites: core 761/761 (+1), react 151/151, full 131-test `canonical-authority.spec.ts` chromium run green (one unrelated flake in a parallel run, passed cleanly in isolation), typecheck and lint clean.
