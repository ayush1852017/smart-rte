# Tab-indenting an item with its own nested children dragged the whole subtree one level deeper, instead of hoisting the children to siblings

**Status:** Fixed
**Area:** list / commands
**First reported:** 2026-08-11 (this session, with explicit before/expected/actual screenshots)

## Symptom

Pressing Tab on a list item that itself had nested children moved the entire subtree (item + its own nested list) one level deeper, as one unit. The reporter's expectation, confirmed via exact before/expected/actual screenshots: only the *directly indented item* should move; if it has its own nested children, those children should become siblings of the moved item at its new position (in order), not stay nested one level deeper than they were before.

## Reproduction

Reproduced the exact reported document structure and Tab sequence via Playwright, matching the reporter's screenshots precisely at both the "before" and "actual" (wrong) states. Confirmed via a second construction with a 2-level-deep child (a child that itself has its own nested grandchild) that a naive full-flatten would be wrong — only the directly-indented item's own list should unwrap; a hoisted child's *own* further nesting must stay intact.

## Root cause

`indentList` (`packages/core/src/foundation/list/commands.ts`) moved the selected item's full subtree — including its own nested list child, if any — as one unit under the preceding sibling, with no logic to separate "the item's own content" from "content nested inside it."

## Fix

New `flattenMovedItem` helper: for each item being indented, if it has its own nested list child, that list's *direct* children are hoisted out to become siblings of the item at its new position, in document order — but each hoisted child's own further nesting (if it has any) is left untouched, since only the directly-indented item's own list unwraps, not a recursive flatten of the whole subtree. `packages/core/src/foundation/list/commands.ts`.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: `"indents only the selected line, hoisting its own nested children to siblings"` — covers both the single-level hoist and a case with a grandchild to confirm deeper structure isn't over-flattened. An existing test that had encoded the old whole-subtree-move behavior (`"indents a whole subtree and outdents it back"`) was rewritten to match the new intended behavior, since it directly contradicted this fix. `packages/react/e2e/canonical-authority.spec.ts`: `"Tab hoists an indented item's own nested children to siblings instead of moving the whole subtree"`, 3/3 browsers.

## Related/similar issues

- [tab-key-loses-editor-focus-when-indent-declines](tab-key-loses-editor-focus-when-indent-declines.md) — a separate, unrelated Tab-key bug found immediately after this fix, in the keyboard handler rather than the command logic.
