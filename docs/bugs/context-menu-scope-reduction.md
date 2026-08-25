# Context menu scope reduction: table-only, media/link get dedicated overlays

**Status:** Fixed (product-scope decision, not a conventional bug fix - see Root cause)
**Area:** react / core plugin manifest / ContextMenu, LinkEditorPopover, new MediaOverlay
**First reported:** 2026-08-20, as a design decision plus two open reports it was explicitly meant to resolve: "context menu doesn't open at cursor location" and "context menu shows generic mark options for every element type."
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx`, `packages/react/src/components/MediaOverlay.tsx` (new), `packages/react/src/components/LinkEditorPopover.tsx`, `packages/react/src/components/ContextMenu.tsx`, `packages/core/src/foundation/plugin/builtins.ts`, `packages/core/src/foundation/marks/plugin.ts`, `packages/core/src/foundation/atom/plugin.ts`.

## Symptom / decision

The context menu (right-click) previously carried contributions from marks (bold/italic/underline/clear formatting), table, and atom (media) plugins, plus hardcoded link edit/remove items. Decision: the menu becomes table-only. Marks stay toolbar-only (no second route). Media and link get dedicated, non-click-triggered overlays instead of context-menu items.

## §1 investigation (done before any design/implementation, per the work order)

- **`LinkEditorPopover.tsx`**: its positioning (`x,y` + viewport clamp) and apply/remove logic were already fully generic - built for the toolbar's Link button, with no assumption baked in about *how* it gets triggered. No new component needed; only the trigger mechanism changed (see Fix).
- **Anchored-to-a-live-element pattern**: `TableResizeHandles.tsx` already anchors UI to a live DOM element's `getBoundingClientRect()`, re-measuring via `ResizeObserver` + a `scroll` listener. Reused directly for both the new link overlay's positioning (anchored to the link's own `<a>` bounds via `mapping.posToDom(...).closest("a[href]")`, not click coordinates) and the new `MediaOverlay` (anchored to the atom's DOM element via `mapping.nodeToDom(nodeId)`).
- **Atom-selection signal**: `CanonicalAuthorityEditor` already computes `atomSelected` (`currentAtomScope.kind === "atomic-node"`) for the toolbar's Edit/Resize buttons. `MediaOverlay`'s visibility is driven by the exact same value - no new signal needed. Selection moving off the atom naturally unmounts the overlay (conditional render), which is the entire "dismiss when selection moves away" requirement for media, with no extra logic.
- **MediaManager.tsx's existing info panel** (Phase 11.5) has all the owner-requested fields (alt, license, title, size, tags, usage) - but for *library catalog* items (`MediaItem`, keyed by a provider search), not for an atom already placed in the document. There is no existing API to reliably match a placed atom back to its catalog record. `MediaOverlay` therefore shows what the atom node itself directly carries (alt, width/height, src) plus Edit/Resize/Delete - not the full catalog metadata (license/tags/title). Documented here as an explicit, deliberate scope limit, not an oversight: wiring atom-to-catalog matching is real, separate work, out of scope for this pass.

## Root cause (of the two specific reports this decision resolves)

**"Context menu shows generic mark options for every element type"**: literally true before this change - marks contributions (`marks.contextMenu.bold/italic/underline/clearFormatting`) appeared on *any* right-click that resolved `inline-range` scope, which is nearly everywhere. Not a bug in the scoping logic (already verified correct per `context-menu-not-scoped-to-click-target.md`) - it was working exactly as designed, and the design was the complaint. Resolved by removing marks from the context menu entirely.

**"Context menu doesn't open at cursor location"**: investigated directly rather than assumed. `ContextMenu.tsx`'s positioning logic was re-verified against its own click coordinates and found to be **correctly tracking the real click point in every case tested** - there is no separate arithmetic bug. What produces the "doesn't open at cursor" *symptom* is the component's own deliberate, already-documented overflow-avoidance flip (`docs/bugs/context-menu-viewport-overflow.md`): when the menu is tall enough to overflow the viewport below the click point, it flips to open upward, clamped to the top margin if even that doesn't fully fit. Confirmed by direct measurement: a right-click on a table cell with the *old*, mark-inclusive item set (14 items, hitting the 400px height cap) at a mid-viewport Y (325 of 720) computed a flip-and-clamp-to-top position exactly matching the observed "opens at the top" behavior - the arithmetic was correct given that height. The same click position with only the table-only item set (10 items, ~290px, under the cap) does not need to flip. **The fix is the scope reduction itself, not a separate positioning-code change** - fewer contributions (no marks, no atom, no link) means the menu is short enough, for realistic click positions, that the flip triggers far less often. This mirrors exactly how the work order predicted the media/link overlay change would resolve their own two report classes "without needing to fix them within the old design" - the same mechanism turned out to apply to the table case's position complaint too.

## Fix

- **`packages/core/src/foundation/marks/plugin.ts`**: removed `markContextMenuContributions` and `markClearFormattingContextMenuContribution` (and their now-unused `ContextMenuContribution` import) - dead code once nothing registers them.
- **`packages/core/src/foundation/atom/plugin.ts`**: removed `atomContextMenuContributions` (the single `atom.contextMenu.delete` entry) - same reasoning.
- **`packages/core/src/foundation/plugin/builtins.ts`**: marks plugin entry no longer has a `contextMenu` field at all; atom plugin entry likewise. Table plugin's `contextMenu: tableContextMenuContributions` is untouched.
- **`CanonicalAuthorityEditor.tsx`**:
  - `resolveContextMenuItems` no longer builds link items or atom edit/resize items - only the generic table-plugin-contribution loop and the cell-colour items remain.
  - `onContextMenu` now only calls `setContextMenu(...)` (opens the menu) when the click resolves to `table-grid` scope - a right-click anywhere else opens nothing at all, not an empty "No actions here" menu.
  - New derived state: `linkAnchorElement` (the `<a>` DOM element at the current caret, when `description.marks` reports a link there, gated by a `linkOverlayDismissedAt` position so Escape/Apply/Remove don't cause an instant re-open at the same caret position) drives a `useEffect` that calls the existing `setLinkPopover({..., editingExisting: true})` - the same state/component the toolbar's Link button already uses, just triggered automatically and anchored to `linkAnchorElement.getBoundingClientRect()` instead of click coordinates. A second effect closes the popover if the selection leaves the link entirely while it's open.
  - New `deleteSelectedAtom` (calls `atom.delete`, mirroring the removed context-menu item) and `<MediaOverlay>` render, gated on `atomSelected && selectedAtomElement`, wired to `editSelectedAtom`/`deleteSelectedAtom`.
- **`packages/react/src/components/MediaOverlay.tsx`** (new): anchored to the atom's live element via `ResizeObserver` + scroll tracking (`TableResizeHandles.tsx`'s pattern), shows alt text/size/source plus Edit/Resize +/Resize βˆ’/Delete buttons, dismissible via Escape or an outside click.

### Notable gap surfaced by this change

`mark.clearAll` ("Clear formatting") was **only ever reachable via the now-removed context-menu item** - there is no toolbar button for it (confirmed: `CanonicalAuthorityEditor.tsx`'s `labels` map has entries for bold/italic/underline/strike/etc. but none for `clearAll`). Removing marks from the context menu leaves this specific command with no UI path at all. Not fixed in this pass (out of scope - no toolbar-button work was requested), but flagged explicitly rather than silently dropped, per the work order's own accounting requirement.

## Regression coverage

- `packages/core/src/foundation/plugin/contextMenu.test.ts` - rewritten: asserts `marks.contextMenu.*`/`atom.contextMenu.*` are now empty and `table.contextMenu.*` is still populated; removed the `atom.contextMenu.delete`-specific test (the contribution no longer exists).
- `packages/react/e2e/canonical-authority.spec.ts`:
  - **Rewritten**: `"scopes context menu items to what was actually right-clicked"` β†’ `"scopes the context menu to table only - opens nothing for plain text, media, or a link"` (right-click on plain text/media/link all assert zero menus; table right-click still asserts table items present and no mark items).
  - **Rewritten**: `"deletes an inserted image atom via the right-click context menu"` β†’ `"deletes an inserted image atom via the media overlay"`.
  - **Rewritten**: `"resizes and edits a media atom via the right-click context menu"` β†’ `"resizes a media atom via the media overlay"`.
  - **Rewritten**: `"applies bold and then clears formatting on selected text via the right-click context menu"` β†’ `"applies bold to selected text via the toolbar"` (the "clears formatting" half was dropped, not silently - see the gap noted above; there is no surface left to test it against).
  - **New**: `"link overlay auto-appears when the caret enters a link, edits it, and dismisses correctly"` - auto-open, Escape-dismiss-stays-dismissed-at-the-same-position, a genuine caret move reopening it, editing+applying a new href, and dismissal when the selection moves off the link.
  - Unchanged, still passing as-is: `"inserts a table row and deletes the table via the right-click context menu"` (table contributions untouched), the cell-colour context-menu test, viewport-overflow/scroll/outside-click-dismiss tests (all exercised against the now-shorter, table-only menu and still pass).
- Full 3-browser e2e suite and core suite re-run clean after the change (see the batch completion report for counts).

## Related/similar issues

- [context-menu-not-scoped-to-click-target](context-menu-not-scoped-to-click-target.md) - the fix this change partially supersedes (see that file's addendum) for the mark/link item portions; the atom-selection and WebKit caret-repositioning fixes from that entry remain load-bearing.
- [context-menu-viewport-overflow](context-menu-viewport-overflow.md) - the overflow-avoidance flip logic that turned out to be the actual mechanism behind the "doesn't open at cursor location" report, not a separate bug.
- [context-menu-height-not-fixed](context-menu-height-not-fixed.md) - the fixed 400px height cap this menu's positioning still uses; unrelated to this change's own fix, but part of why a mark-inclusive menu reliably hit the cap and needed to flip so often.
- [link-toolbar-editing-route](link-toolbar-editing-route.md) - the original toolbar-only link edit/create routing this change's auto-overlay reuses directly (same `applyLink`/`linkPopover` state, same `editLinkCommand`).
