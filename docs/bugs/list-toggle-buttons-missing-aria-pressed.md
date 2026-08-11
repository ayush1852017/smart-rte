# Bullets/Numbering/Checklist toolbar buttons never showed as active — "how do I remove list formatting" was undiscoverable

**Status:** Fixed
**Area:** toolbar / list
**First reported:** 2026-08-10 (this session, in response to a direct user question: "how to toggle list to unlist?")

## Symptom

There was no visible way to tell, from the toolbar, that the cursor was inside a bulleted/numbered/checklist item — the Bullets, Numbering, and Checklist buttons never appeared pressed/active regardless of cursor position. Since the intended UX for removing list formatting from an item is "click the already-active button again," this made that feature undiscoverable even though the underlying logic already worked.

## Reproduction

Placed cursor inside an existing bulleted list item; inspected the toolbar buttons' `aria-pressed` attribute. Only the "Check selected items" button set `aria-pressed` anywhere in this toolbar (`packages/react/src/components/CanonicalAuthorityEditor.tsx`) — Bullets/Numbering/Checklist never did.

## Root cause

`aria-pressed` was simply never wired up on these three buttons. The click handler (`toggleList`) already correctly implemented "if the current list matches this button's style, unwrap instead of restyle" — the underlying command logic was not the problem; the toolbar just never reflected that state visually, so users had no way to discover the interaction.

## Fix

`packages/react/src/components/CanonicalAuthorityEditor.tsx` — added a shared `listStyleActive(style, checkable)` helper, wired to `aria-pressed` on the Bullets/Numbering/Checklist buttons, using the exact same equality check the click handler uses to decide toggle-off vs. restyle — so the displayed active state can never drift from what clicking the button actually does. (`listStyleActive` was later updated to check the outermost list rather than the nearest one — see [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md).)

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"shows the active list toggle and removes only the current item on re-click"` — places cursor in a list item, asserts `aria-pressed="true"`, clicks, asserts the item is unwrapped and `aria-pressed` becomes `"false"`. Passes in all three browsers.

## Related/similar issues

- [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md) — touches the same `listStyleActive`/`toggleList` code, different fix.
- [unwraplist-deepest-first-gap-multi-depth-toggle-off](unwraplist-deepest-first-gap-multi-depth-toggle-off.md) — a related, still-open gap in the same toggle-off feature for multi-depth selections.
