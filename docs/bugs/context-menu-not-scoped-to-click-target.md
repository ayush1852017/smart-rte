# Context menu showed the same options regardless of what was right-clicked

**Status:** Fixed
**Area:** react / core scope resolution / ContextMenu dispatch
**First reported:** 2026-08-19, post-Phase-11.5 manual testing.
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`onContextMenu`, `resolveContextMenuItems`), `packages/core/src/foundation/scope/resolveScope.ts` (`marksForRange`).

## Symptom

Right-clicking a table cell, a link, and plain text all produced the same (or an unexpectedly generic) set of context-menu items instead of options scoped to what was actually clicked.

## Reproduction

Confirmed table-cell vs plain-text scoping was already correct (mark items always present when a caret can be placed, table items added only inside a table - verified directly against `resolveScope` before assuming a bug). Two genuinely distinct, confirmed defects:

1. **Atom (image) right-clicked directly, with no preceding left-click**: no "Delete" item appeared.
2. **Link text right-clicked**: no "Edit link"/"Remove link" items appeared (these didn't exist at all before this fix - see root cause 2 below) and, independently, `description.marks` failed to report the link mark for most collapsed-caret positions inside it.

## Root cause

**1. Atom selection is not native browser behavior.** It's `InputController`'s `clickListener` (`surface/input.ts:551`), bound to the native `"click"` DOM event - which never fires for a right-click (button=2) in any browser. A direct right-click on an atom (the realistic case - no user reflexively left-clicks first) left whatever selection existed before untouched, so `atomic-node` scope never resolved and the atom's "Delete" contribution never matched.

**2. Two separate gaps for links:**
   - **No link-specific context-menu items existed at all.** Editing a link needs `LinkEditorPopover` UI (matching why the toolbar's own Link button isn't a generic command-dispatch contribution either) - Phase 11.5 §2.3 built table/atom/marks contributions but never added link items.
   - **A real, general, previously-unnoticed bug in `marksForRange`** (`packages/core/src/foundation/scope/resolveScope.ts`), the function `resolveScope({want:"describe"}).marks` (and therefore both the toolbar's Link button and this new context-menu check) uses to detect "is there a mark at the collapsed caret." Its collapsed-caret branch only ever found a run at an *exact run boundary* (`candidate.to <= offset` or `candidate.from >= offset`) - a caret strictly inside a run's interior (the overwhelmingly common real case: any single-run paragraph at any offset except its two extreme edges, or any run past the first in a multi-run paragraph) satisfied neither condition, so `marks` silently came back `[]`. Confirmed via direct `resolveScope` calls: offsets 1 through 10 of an 11-character single-run link returned no marks; only offsets 0 and 11 (the exact edges) worked. This is a genuine pre-existing defect in a function the toolbar's Link button already depended on, not something introduced by this phase.

**3. A third, WebKit-specific issue found while writing the regression test:** Chromium and Firefox reposition the native caret to the click point on a bare right-click (the same as a left-click); WebKit does not - a WebKit right-click leaves the previous selection completely untouched. Confirmed directly (`editor.selection` unchanged after a WebKit right-click on a link, but correctly updated after a left-click on the same element). This meant scope resolution after a WebKit right-click was checking stale selection state, not the click target - which would have made the link items (and, in principle, any right-click) unreliable specifically on WebKit/Safari even after fixing 1 and 2.

## Fix

- `CanonicalAuthorityEditor.tsx`'s `onContextMenu`: for atom targets, select the atom as a node selection (mirrors `clickListener`'s exact logic). For everything else, when the current selection is already collapsed, explicitly resolve the caret from the click point via `caretPositionFromPoint`/`caretRangeFromPoint` + `mapping.domToPos` - the same pattern `InputController`'s own `selectionForPoint` already uses for drag/drop - so the right-click path is correct on every engine instead of relying on inconsistent native repositioning. Guarded to skip repositioning when a genuine non-collapsed selection already exists (right-clicking deliberately-selected text to apply Bold from the menu must never collapse it out from under the user - this guard was added after it broke exactly that pre-existing Phase 11.5 test).
- `resolveScope.ts`'s `marksForRange`: collapsed-caret branch now finds the run that actually *contains* the offset (`from <= offset <= to`), falling back to preferring the preceding run only at an exact shared boundary between two runs (preserving the original tie-break convention there).
- `resolveContextMenuItems` gained "Edit link"/"Remove link" items when `description.marks` reports a link at the current selection, reusing the toolbar Link button's own popover-opening logic and `removeLink`.

## Regression coverage

- `packages/core/src/foundation/scope/scope.test.ts` - "describe's collapsed-caret marks find the run the caret is actually inside, not only at a run boundary": every interior offset of a single-run paragraph, the interior of a second run in a multi-run paragraph (the case the old logic silently got wrong), and the boundary-preference behavior.
- `packages/react/e2e/canonical-authority.spec.ts` - "scopes context menu items to what was actually right-clicked": plain text (mark items, no table items), a table cell (table items present), an atom right-clicked with no preceding left-click ("Delete" present), and a link (`Edit link`/`Remove link` present) - all 3 browsers, including the WebKit-specific caret-repositioning path.
- The pre-existing "applies bold and then clears formatting..." test (Phase 11.5 item 5) continues to pass, confirming the collapsed-selection guard doesn't regress the deliberate-selection case.

## Related/similar issues

[context-menu-outside-click-dismiss-untested](context-menu-outside-click-dismiss-untested.md) - investigated in the same batch, different mechanism (dismiss listener vs. scope resolution).

## Addendum (2026-08-20): superseded by a later scope reduction, not re-broken

A later product decision made the context menu table-only - see
[context-menu-scope-reduction](context-menu-scope-reduction.md). The atom
right-click fix (root cause 1 above) and the WebKit caret-repositioning fix
(root cause 3) are both still load-bearing and unchanged - atom right-clicks
still need correct selection so `MediaOverlay` (atom-selection-driven) shows
up, and the WebKit fix still matters for the table-cell right-click case
that remains. Root cause 2 (the link-specific "Edit link"/"Remove link"
*context-menu items*) is intentionally removed, not regressed - link editing
moved to an auto-triggered `LinkEditorPopover` overlay instead. The
underlying `marksForRange` fix (a general `description.marks` correctness
fix, not context-menu-specific) remains in place and is exactly what the new
link overlay's auto-detection depends on. The regression test this file
originally pointed to (`"scopes context menu items to what was actually
right-clicked"`) was rewritten to `"scopes the context menu to table only -
opens nothing for plain text, media, or a link"` - the mark/atom/link item
assertions moved to the new overlay-specific tests referenced in
`context-menu-scope-reduction.md`.
