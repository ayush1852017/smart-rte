# Exiting a code block that's a list item's only content never created a new sibling list item

**Status:** Fixed
**Area:** core - `foundation/block/input.ts` (`exitCodeBlock`), `foundation/list/input.ts` (`enterInList`)
**First reported:** 2026-09-11, with a screenshot — "Inside Blockquote I am trying to adding new list item after 4 which is inside code-block. But enter only creating new lines inside of code-block."
**Related files:** [code-block-in-blockquote-enter-handling-not-a-bug](code-block-in-blockquote-enter-handling-not-a-bug.md) — a related, already-closed investigation confirming Enter *correctly* stays a plain newline inside a code block regardless of blockquote nesting. That conclusion is still correct and untouched by this fix; this is a different question (whether a new list item can ever be reached at all, not whether the blockquote boundary is respected).

## Follow-up: a third Enter silently undid the fix (same day)

After the fix below shipped, the same user reported it was still "add[ing] new lines every time." A traced, screenshot-backed replay (5 consecutive Enters, full document/selection dump after each) showed the fix *does* work — a real, visually distinct item 2 appears after exactly two Enters — but that item is necessarily empty, and a bare third Enter (pressed before typing anything) is structurally indistinguishable from `enterInList`'s own separate, pre-existing "empty item + Enter exits the list" convention. That convention fired, popped the paragraph back out of the list, and every further Enter just split plain paragraphs — which reads as "adding new lines every time" if you don't catch the exact moment item 2 appeared.

**Fix:** `enterInList`'s `itemEmpty` branch now checks whether the immediately preceding sibling item ends in a `code_block`; if so, Enter is swallowed (a true no-op — `operations: []`, relying on `commitStructuralResult`'s existing empty-operations guard) instead of exiting the list. This is a purely structural check (no transient "just escaped" state needed): any empty item directly following a code-block item gets one extra keystroke of protection before Enter can exit it, matching exactly the situation `exitCodeBlock` always leaves behind.

## Symptom

A numbered list with 4 items, the last one's content converted to a code block, the whole list wrapped in a blockquote. Pressing Enter at the end of item 4's code never produces a new item 5 — it only ever inserts more lines inside item 4's own code block, with no apparent way to move on to a new item.

## Investigation

`list/input.ts`'s `enterInList` — the function that decides whether Enter should split/exit a list item — only recognizes `paragraph`/`heading` as valid item "owners" (`isInlineOwner`). `code_block` is deliberately excluded, so that typing more lines inside a multi-line code block never accidentally splits into a new list item. Because of that exclusion, `enterInList` returns `null` for any caret inside a code block, and Enter always falls through to the code block's own newline handling (`surface/input.ts`'s `insertParagraph`, which tries `enterInList` first, then `insertCodeBlockNewline`).

That code-block newline handling already has an "exit on trailing empty line" mechanism (type, Enter for a blank line, Enter again to exit) — but `exitCodeBlock` always inserted the escaped paragraph as *another block inside the same list item*, never as a genuinely new list item. Reproduced directly: two Enters left the list item as `[code_block, empty paragraph]` (a permanent stray child), and only a **third** Enter (now landing on that empty paragraph, and matching the ordinary "empty item, Enter exits the whole list" behavior) eventually produced a second list item — but only by exiting the list first, then requiring the paragraph to be manually re-listed, which isn't a usable workflow for "add item 5."

## Fix

`exitCodeBlock` now checks whether the code block is the first/last content of a `list_item` (nothing else before/after it in the exit direction). If so, the escaped content becomes a new **sibling list item** (inserted into the enclosing list, immediately before/after the current item) instead of a second block stuffed inside the current item. This check only reads generic node types (`list_item`) the same way the file's own `codeAt` already checks for `code_block` - no new dependency on the list module.

If the code block isn't at that boundary (something else already follows/precedes it in the same item, e.g. a nested list), behavior is unchanged - the escaped paragraph still lands as a sibling block within the same item, which is the correct place for it in that shape.

## Regression coverage

`packages/core/src/foundation/block/input.test.ts`: three new tests — exiting after a boundary code block creates a new sibling item with the original item left clean (no stray paragraph); exiting before does the symmetric thing; a non-boundary code block (something already follows it in the same item) is confirmed to keep the old, still-correct behavior. All three confirmed to fail without the fix (reverted `input.ts` via `git stash`, reran, got real pre-fix failures, restored and confirmed passing).

`packages/react/e2e/canonical-authority.spec.ts`: "pressing Enter twice at the end of a code-block list item (inside a blockquote) creates a new sibling list item" - reproduces the exact reported shape (numbered list, last item's content is a code block, whole list wrapped in a blockquote) via real toolbar interaction and confirms two Enters produce a genuine second `<li>`, with item 1 staying a single, clean code block. Passed 3/3 browsers.

For the follow-up: `packages/core/src/foundation/list/input.test.ts` - two new tests, "swallows Enter on an empty item that immediately follows a code-block item, instead of exiting the list" (confirmed to fail without the fix via `git stash`) and a control case confirming an ordinary (non-code) preceding sibling still unwraps as before. `packages/react/e2e/canonical-authority.spec.ts`: "a third Enter on the item just escaped from a code block does not exit the list" - two Enters to escape, a third (confirmed via `git stash` + rebuild to fail without the fix, collapsing back to one `<li>`), then types into the still-present item 2. Passed 3/3 browsers.

Full suites: core 754/754 (+3), react unit 151/151, typecheck clean.

## Related/similar issues

- [code-block-in-blockquote-enter-handling-not-a-bug](code-block-in-blockquote-enter-handling-not-a-bug.md) — confirmed Enter's *blockquote-boundary* behavior is correct; this fix doesn't change that at all, since the new sibling list item is still created entirely within the same enclosing list (still inside the same blockquote).
- [list-creation-ignores-adjacent-identical-list](list-creation-ignores-adjacent-identical-list.md) — a different list-continuity gap found and fixed the same day, unrelated cause (that one was about the toolbar's `createList` command, not the code block's own Enter handling).
