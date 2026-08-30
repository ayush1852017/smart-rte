# Toggling a mark off at a collapsed cursor silently did nothing — every keystroke after kept the mark

**Status:** Fixed (2026-08-29)
**Area:** core / foundation/editor.ts (`FoundationEditor.setStoredMarks`), marks
**First reported:** "apply Superscript, type, click Superscript again to turn it off — doesn't turn off. Same for Italic." Investigated whether this shared a cause with the just-closed [mark-toolbar-buttons-no-pressed-state](mark-toolbar-buttons-no-pressed-state.md) fix — it does not; that fix only touched React-layer *display* logic (`markCoverage` in `CanonicalAuthorityEditor.tsx`), never the toggle command itself, and this bug is entirely in core.
**Related files:** `packages/core/src/foundation/editor.ts` (`FoundationEditor.setStoredMarks`), `packages/core/src/foundation/marks/editor.ts` (`executeMarkTool`'s collapsed-cursor branch, `updateCollapsed`), `packages/core/src/foundation/marks/stored.ts` (`marksAtInsertion`).

## Symptom

Toggle Bold/Italic/Underline/Strikethrough/Code/Superscript/Subscript on at a collapsed cursor, type some text, click the same toggle again to turn it off, type more: the second run of text kept the mark, as if the toggle-off had no effect. Confirmed this affects every toggleable mark type uniformly, not just Superscript/Italic as originally reported.

## Reproduction

Real browser: toggle Superscript on via the toolbar, type "AB", toggle Superscript off, type "CD" — resulting HTML was `<sup>ABCD</sup>`, not `<sup>AB</sup>CD`. Confirmed via `git stash` that this predates the Direction B toolbar redesign entirely (identical result with the redesign's `CanonicalAuthorityEditor.tsx` changes fully reverted) — a pre-existing, core-only bug, not a regression of any recent work.

## Root cause

`executeMarkTool`'s collapsed-cursor branch computes `current = editor.storedMarks || marksAtInsertion(editor.document, editor.selection.head, editor.schema)`, then calls `editor.setStoredMarks(updateCollapsed(current, declaration, "toggle", attrs), ...)`. Toggling off the *only* active mark makes `updateCollapsed` return `[]` (empty array) — but `FoundationEditor.setStoredMarks(marks, options)` had `marks?.length ? canonicalMarkOrder(marks) : undefined`, which collapses an *explicitly-set* empty array down to `undefined` - indistinguishable, downstream, from "no override was ever set, infer from surrounding text." The next keystroke's mark computation (`editor.storedMarks || marksAtInsertion(...)`) then falls through to `marksAtInsertion`, whose inclusive-boundary rule sees the cursor sitting right after the just-typed marked text and correctly (by its own logic) re-includes that mark as a candidate for continuation - silently overriding the user's explicit toggle-off, since nothing distinguished "explicitly toggled to no marks" from "never touched, ask the surrounding text."

No existing test caught this: the core property test covering the stored-mark toggle/undo/redo cycle (`marks.test.ts`, 500 seeded cases) only ever toggled a mark **on** from an empty document and typed once - it never toggled a mark back **off** after typing and asserted the next run was plain.

## Fix

`FoundationEditor.setStoredMarks`: changed `marks?.length ? canonicalMarkOrder(marks) : undefined` to `marks !== undefined ? canonicalMarkOrder(marks) : undefined` - an explicitly-passed empty array now survives as a real (truthy in every downstream falsy-check) empty array through the transaction pipeline, so `editor.storedMarks || marksAtInsertion(...)` correctly resolves to the explicit `[]` instead of falling through. Confirmed every other read site of `editor.storedMarks` (`typeText`, `surface/input.ts`'s insert-text paths) already treats a truthy empty array correctly with no further change needed - the single coercion point was the only bug.

## Regression coverage

`packages/core/src/foundation/marks/marks.test.ts` - new: "toggles a mark back off at a collapsed cursor after typing, for every toggleable mark type" - for every mark with simple on/off toggle semantics (excludes link and the attributed marks textColor/backgroundColor/fontSize/fontFamily, which have different collapsed-cursor handling), toggles on, types "on", toggles off, types "off", asserts two separate text runs with the mark only on the first. Full core suite: 721/721 (was 720). Verified against real typing/clicking in a real browser for Superscript, Subscript, Bold, Italic, Underline, Strikethrough.

## Related/similar issues

[mark-toolbar-buttons-no-pressed-state](mark-toolbar-buttons-no-pressed-state.md) - investigated as a possible shared cause (display logic added in the same batch) and explicitly ruled out; unrelated, both now fixed.
