# Horizontal line (and page break) select but show zero visible feedback - looked "not selectable"

**Status:** Fixed
**Area:** react (`components/CanonicalAuthorityEditor.tsx`, `components/MediaOverlay.tsx`)
**First reported:** 2026-09-07, "Horizontal line is not selectable."
**Related files:** [horizontal-line-and-page-break-tools](horizontal-line-and-page-break-tools.md) (the feature this gap was found in), [formula-resize-controls-shown-for-non-resizable-atom](formula-resize-controls-shown-for-non-resizable-atom.md) (the precedent for gating media-only UI off a non-media atom, which this fix extends rather than reverses).

## Investigation

Checked the model directly first (not assumed): clicking a `divider` (or `page_break`) atom in the live editor **did** set real node selection (`runtime.editor.selection.type === "node"`) and correctly enabled the toolbar's "Delete selected media" action - confirmed via a live debug script. So the atom genuinely was selectable at the model level; the report was about the complete absence of any visible response to that click.

Traced why: `CanonicalAuthorityEditor.tsx`'s `mediaAtomSelected` flag deliberately excludes `divider`/`page_break` (they have no `src`/`alt`/`width`/`height` - see that flag's own doc comment, added in [horizontal-line-and-page-break-tools](horizontal-line-and-page-break-tools.md)), and every place that renders `MediaOverlay` (the component that draws resize handles and/or the floating action menu) is gated on that same flag. The result: for `divider`/`page_break`, **no UI of any kind ever renders on click or right-click** - not because it was designed that way on purpose, but because `mediaAtomSelected`'s exclusion (correctly meant to hide *media-specific* fields like Alt/Size/Source and the Edit button) was also, as a side effect, hiding the *action menu itself*, including its Delete button - the one thing that always applies to any atom.

This is different from `formula`, which is also excluded from resize (`resizableAtomSelected`) but was never excluded from `mediaAtomSelected` itself, so it still gets a right-click action menu (Edit + Delete, no resize) - the intended behavior this fix now extends to `divider`/`page_break` too, minus Edit (neither has an editable field).

## Fix

- `MediaOverlay.tsx`: new `editable` prop (default `true`). When `false`, hides the Alt/Size/Source info block and the Edit button, leaving only Delete (and Resize, already separately gated by the existing `resizable` prop).
- `CanonicalAuthorityEditor.tsx`: new `actionOnlyAtomSelected` flag (`divider`/`page_break`, distinct from `mediaAtomSelected` - it doesn't touch that flag's own semantics or its other consumer, `resizableAtomSelected`, which stays exactly as it was). The context-menu `MediaOverlay` render is now gated on `(mediaAtomSelected || actionOnlyAtomSelected)` and passes `editable={mediaAtomSelected}`. The right-click handler's own exclusion (`mapped.node.type !== "divider" && ... !== "page_break"`) is removed - `divider`/`page_break` now fall through to the exact same `setMediaContextMenu(...)` branch `formula` already used.
- Left-click behavior is unchanged: only real image atoms ever get a left-click-triggered overlay (`mediaResizeTarget`, image-only); `divider`/`page_break`/`formula` all only ever surface a menu via right-click, matching the pattern already established for formula before this fix - not a new interaction paradigm.

## Regression coverage

New e2e test in `canonical-authority.spec.ts`, "right-clicking a horizontal line or page break shows a Delete-only action menu, never Edit/Resize": inserts both, right-clicks each, asserts the action menu is visible with a Delete button, zero Edit buttons, and zero resize handles, then confirms Delete actually removes the node. Updated the existing "inserts a page break via the toolbar..." test's right-click assertion (it previously asserted the overlay never appears at all on right-click - the real invariant it was protecting, that the *full media UI* (details popover, Edit, resize) never appears, is now asserted explicitly instead of conflating it with "no menu at all").

## Verification

Core unaffected (react-only change). React unit 151/151 (unchanged). Full e2e suite unaffected beyond the new test and the one updated assertion - all divider/page-break-related tests pass across chromium/firefox/webkit (15/15, including the pre-existing "selecting a divider does not surface media UI" test, whose own left-click-only assertions remain valid and untouched).

## Related/similar issues

Reported in the same message as "No print popup coming". Investigated separately: a live debug run of the exact "Print / Save as PDF" click flow in this package's own playground opened a real popup with zero console errors - not reproducible in this codebase as it stands. User confirmed on follow-up (same session) that it is now showing fine, without a code change on this side - consistent with a stale dev-server/HMR tab rather than a real defect. No ledger entry created for it: nothing was found to fix, and the report did not stay reproducible long enough to root-cause further.
