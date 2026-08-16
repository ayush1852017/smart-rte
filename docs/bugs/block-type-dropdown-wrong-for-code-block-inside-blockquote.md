# Block-type dropdown shows "Paragraph" for a code block nested inside a blockquote

**Status:** Fixed
**Area:** toolbar / block
**First reported:** 2026-08-16, user report against the canonical editor (`CanonicalAuthorityEditor`)
**Related files:** `docs/bugs/block-type-dropdown-stale-on-caret-move.md` — same dropdown, same `blockTypeAt` helper, but a genuinely different root cause (that fix was about stale values not updating on caret move; this bug is about an incorrect value even when re-computation is fully up to date). Not a regression of that fix — its own reproduction (paragraph → heading → code block → paragraph, all top-level) still works correctly; this gap was never covered by that fix's regression test, which never exercised a nested/wrapped block.

## Symptom

Applying a code block to a paragraph, then applying blockquote to the same block without moving the cursor, correctly produces `<blockquote><pre data-smart-type="code_block">...</pre></blockquote>` in the model/DOM — but the "Block type" toolbar dropdown shows "Paragraph" instead of "Code block", even though the caret is still genuinely inside the code block. Because the dropdown reports the wrong type, the user has no way to select "remove code block" for that content via the dropdown.

## Reproduction

Built a direct reproduction (`packages/react/e2e/canonical-authority.spec.ts`): seed a document with `blockquote > code_block`, place the caret inside the code block's text, and check the "Block type" dropdown's value. Confirmed failing (`"paragraph"` instead of `"code_block"`) against the pre-fix code via a controlled before/after test (temporarily reverted the fix, re-ran, confirmed the test fails; restored the fix, re-ran, confirmed it passes) — not just inferred from reading the code.

## Root cause

`blockTypeAt` (`packages/react/src/components/CanonicalAuthorityEditor.tsx:221-234`) walks down the document tree from the root, following the caret's position path one step at a time. At each step, if the current node is any `group: "block"` schema node, it answered immediately: `code_block` → `"code_block"`, `heading` → `"heading-N"`, **anything else → `"paragraph"`**.

The foundation schema (`packages/core/src/foundation/schema.ts`, `table/schema.ts`, `list/schema.ts`) has several `group: "block"` node types that are **containers** holding further blocks, not leaf content: `blockquote` (`content: "block+"`), `list`, `list_item`, `table`, `table_row`, `table_cell`. `blockTypeAt`'s blanket `return "paragraph"` fired for these exactly the same as for a genuine paragraph — the moment the walk reached the `blockquote` ancestor of the code block, it answered "paragraph" and never continued deeper to find the actual `code_block` node sitting inside it.

## Fix

`blockTypeAt` now only answers immediately for the three node types the dropdown itself actually offers as options — `code_block`, `heading`, and `paragraph` explicitly. Every other `group: "block"` node (the containers listed above, and atomic block types like `block_image`/`block_formula`/`video`/`audio` which have no dropdown answer of their own) falls through to the existing path-walking loop, which either continues into a container's children (correct: keep looking for the real block) or runs out of path and hits the function's own final `"paragraph"` default (correct end state for atomics, same as before this fix, just reached via the loop's fallback rather than an early, wrong return).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"tracks the Block type dropdown for a code block nested inside a blockquote"` — seeds `blockquote > code_block`, places the caret inside, asserts the dropdown reads `"code_block"`. 3/3 browsers, confirmed to fail without the fix and pass with it. The pre-existing `"tracks the Block type dropdown with the current caret owner"` test (top-level paragraph/heading/code_block transitions) continues to pass unchanged.

## Related/similar issues

`docs/bugs/block-type-dropdown-stale-on-caret-move.md` — same dropdown and helper function, different root cause (see Status line above). Worth flagging as a class of gap: `blockTypeAt`'s container list (`blockquote`, `list`, `list_item`, `table`, `table_row`, `table_cell`) was derived from the schema's `content: "block+"` node types at the time of this fix; if a future foundation schema change adds a new block-group container type, `blockTypeAt` will correctly keep walking into it too (since it now only special-cases the three known leaf answers), so this fix should generalize rather than needing a per-container-type update each time.
