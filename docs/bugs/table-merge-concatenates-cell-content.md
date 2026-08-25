# Merging cells with real content silently concatenated it onto one line instead of keeping each cell's content on its own line

**Status:** Fixed (supersedes part of `table-merge-multiplies-row-height.md`'s design - see Root cause)
**Area:** core / table / commands.ts (`mergeTableCellsCommand`)
**First reported:** 2026-08-20, "when I merge cells despite of horizantal and vertical their content shouldn't get mixed. it should wrapped down in new line."
**Related files:** `packages/core/src/foundation/table/commands.ts`.

## Symptom

Merging two or more table cells that each contained real, distinct one-line text (e.g. "Apple" in one cell, "Banana" in the adjacent cell) produced a single merged paragraph reading "AppleBanana" - the two cells' content silently ran together with no space or line break, for both horizontal and vertical merges. The user's expectation, stated explicitly: each source cell's content should land on its own line inside the merged cell, not be mixed into one run.

## Reproduction

Confirmed directly by reading `mergeTableCellsCommand` and its helper `mergedSimpleInlineContent` (`packages/core/src/foundation/table/commands.ts`): whenever every selected cell had exactly one meaningful child block, and all those blocks were the same type (`paragraph`/`heading`), the merge deliberately combined all of their inline children into a single shared paragraph (`blocks.flatMap((block) => (block.children || []).map(cloneNode))`) instead of keeping each cell's block separate. A unit test already encoded this exact behavior as intentional (`table.test.ts`, "keeps row height once when horizontally merging two, three, or four one-line cells" - asserted a merge of cells "1"/"2"/"3"/"4" produced one text node "1234").

## Root cause

This was a deliberate design choice from a previous, different bug fix (`table-merge-multiplies-row-height.md`): merging N one-line cells previously stacked N separate paragraphs (mostly meaningful for N *placeholder* cells, but applied uniformly), visually inflating the merged row's height. That fix's chosen solution - concatenating any "simple" single-paragraph cells' content onto one shared line - avoided the height growth, but at the cost of erasing the boundary between genuinely different cells' content whenever they happened to each be a single short paragraph, which is the common case for real table data (a name in one cell, a value in the next). The user's current report says this trade was wrong: mixing distinct content unreadably is worse than a merged cell legitimately growing taller to fit multiple real lines.

The *actual* original bug (empty placeholder paragraphs stacking up with no real content) has a separate, still-correct fix in the same command: a merge whose every source cell is entirely empty collapses to exactly one empty placeholder block, never one per cell (`packages/core/src/foundation/table/commands.ts`, the `content.length ? content : ...` fallback). That logic was not part of `mergedSimpleInlineContent` and is untouched by this fix.

## Fix

Removed `mergedSimpleInlineContent` and its call site entirely. Merging now always falls through to the general assembly path: every non-empty source cell's blocks become separate blocks (each its own paragraph/line) in the merged cell, in reading order; an entirely-empty source cell contributes nothing; a merge where every source cell was empty still collapses to exactly one placeholder block (unchanged). `table_row.attrs.height` itself was never touched by this content-assembly logic in either version - it stays a row-level attribute independent of how much content the row's cells hold, which is what the original bug report actually needed fixed; a merged cell now visibly containing several real lines of content, and the row growing to fit them, is expected behavior, not a regression of that fix.

## Regression coverage

- `packages/core/src/foundation/table/table.test.ts` - "keeps row height a row-level property, and preserves each source cell's content as its own line, when merging two, three, or four one-line cells" (renamed and rewritten from the prior version): merges of 2/3/4 one-line cells now assert `attrs.height` is unchanged (still correct) *and* that the merged cell has one paragraph per source cell, each with its own un-mixed text, instead of asserting a single concatenated text node.
- `packages/react/e2e/canonical-toolbar-routing.spec.ts` - "merges cells with real content onto separate lines instead of mixing it together, both horizontally and vertically" (new): merges two real-content cells horizontally and, independently, two real-content cells vertically, asserting each source cell's text survives as its own `<p>` in reading order - all 3 browsers.
- Existing empty-cell merge tests (`table.test.ts`'s "does not stack placeholder paragraphs when merging empty cells", `canonical-toolbar-routing.spec.ts`'s "selects canonical cells individually and supports merge/split" and "selects a vertical cell range and merges it") re-verified unaffected, since they exercise only the untouched all-empty-collapse path.

## Related/similar issues

[table-merge-multiplies-row-height](table-merge-multiplies-row-height.md) - the earlier fix whose "concatenate simple cells" behavior this change removes; its other fix (collapsing an all-empty merge to one placeholder, and clearing stale cell-level height/min-height/max-height styles in `renderer.ts`) is untouched and still correct.
