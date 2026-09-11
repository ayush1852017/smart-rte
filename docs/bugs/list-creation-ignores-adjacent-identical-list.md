# Converting a paragraph right after an existing list always started a second, independently-numbered list

**Status:** Fixed
**Area:** core - `foundation/list/commands.ts` (`createList`)
**First reported:** 2026-09-11 — "I create a number list and press enter twice to takes cursor out from list then again type something there and clicked on number list tool which create new list again instead of becoming one with previous."

## Symptom

1. Create a numbered list, type "abcd" (item 1).
2. Press Enter twice — the second Enter exits the list, leaving the caret in a plain paragraph directly after it (existing, correct behavior).
3. Type "efgh" in that paragraph.
4. Click "Numbered list" again to turn it back into a list item.

**Expected:** "efgh" joins the existing list as item 2 (`1. abcd`, `2. efgh`).
**Actual:** a brand-new, separate list is created starting over at `1.` (`1. abcd` / `1. efgh` as two independent lists), rather than one continuous list.

## Root cause

`createList` (`packages/core/src/foundation/list/commands.ts`) always built a fresh `list` node and `replaceNode`'d it in, with no check for whether the block being converted already sits directly next to a list of the same kind. Nothing about the command considered document context beyond the blocks actually being converted.

## Fix

Before building a new list wrapper, `createList` now checks the immediately preceding sibling (same parent, same nesting level) of the content being converted. If that sibling is already a `list` node whose `style`/`preset`/`checkable` exactly match what's being created (`start` deliberately excluded — appending to an already-numbered list should keep counting from wherever it is, not require an exact `start` match), the new item(s) are appended to that existing list instead of wrapping them in a new one.

Deliberately scoped to the **preceding** sibling only, matching exactly what was reported — merging with a *following* adjacent list (typing a new line just before an existing list and converting it) is a plausible, symmetric enhancement but wasn't reported and isn't handled by this fix; worth revisiting if it comes up.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: "joins an identical adjacent list instead of creating a second, independently-numbered one" (the exact reported shape) and "does not join an adjacent list of a different style, checkable state, or preset" (a style mismatch, and a checkable mismatch, both confirmed to still create a separate list — the merge is conservative, not "any adjacent list will do"). Both new tests confirmed to fail without the fix (reverted `commands.ts` via `git stash`, reran, got the real pre-fix failure — a second list with id `"unused"` instead of joining `"l"` — restored and confirmed passing).

`packages/react/e2e/canonical-authority.spec.ts`: "re-applying Numbered list to a paragraph right after an existing numbered list joins it instead of starting a second one" — reproduces the exact reported interaction (type, Enter, Enter, type, click Numbered list) via the real toolbar and confirms one `<ol>` with two `<li>`s. Passed 3/3 browsers.

Full suites: core 751/751 (+3), react unit 151/151, typecheck clean.
