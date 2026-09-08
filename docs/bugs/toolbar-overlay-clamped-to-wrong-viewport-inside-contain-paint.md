# A toolbar overlay near the edge of a `contain: paint` host renders outside it and never paints at all - invisible, not just misplaced

**Status:** Fixed
**Area:** react (`components/fixedPositioning.ts`, `ToolbarPrimitives.tsx`, `ColorPickerPopover.tsx`, `TableBorderPopover.tsx`)
**First reported:** 2026-09-08, same Sootr "Create PYEQ" dialog as [toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md): "more paragrah tools overlay showing at the right edge of editor. When I try opening More to insert overlay it doesn't even show overlay ... rendering beyound the dialog edge. Not visible."
**Related files:** [toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md) - the coordinate-origin fix this report's own dialog was already running; this is a second, independent gap in the same general area, not a regression of that fix.

## Investigation

The previous fix corrected *where the coordinate origin is* for a `contain: paint` ancestor - necessary, but not sufficient. Every overlay in this codebase (`ToolbarDropdown`, `MobileMoreMenu`, `ColorPickerPopover`, `TableBorderPopover`) also clamps its own computed position so a menu never renders off-screen, and **every one of those clamps was computed against `window.innerWidth`/`window.innerHeight`** - the full browser viewport, not the actual space available.

That's a second, independent bug once a `contain: paint`/`strict`/`content` ancestor is in play: CSS Containment doesn't just move the coordinate origin, it makes the browser **refuse to paint anything a descendant renders outside that ancestor's own border box**, full stop, regardless of what `left`/`top` says. A trigger positioned close to the middle of a `contain: paint` dialog ("More paragraph tools") computed a menu position that just barely stayed inside the dialog - rendering hugging its right edge. A trigger further right ("More to insert") computed a position that landed *entirely* outside the dialog's box - and since nothing paints there, the menu was completely invisible, exactly matching "it doesn't even show overlay."

Confirmed by measuring the real "More to insert" trigger position at increasing host widths: at the toolbar's own natural (unwrapped) layout, its right edge sits at ~802px from the editor's left edge. A `contain: paint` host any narrower than that, with the old code, always positioned the menu past the host's own right edge (verified directly: menu computed to extend to x≈874 inside an 812px-wide host).

## Fix

New `getPositioningBounds(el)` in `fixedPositioning.ts`: returns the viewport, intersected with the nearest containing-block ancestor's own box **only when that ancestor's `contain` includes `paint`/`strict`/`content`** (i.e., only when something will actually refuse to paint outside it). All four overlay components now clamp against these bounds instead of the raw viewport.

Deliberately scoped to `contain` specifically, not any containing-block ancestor generally: verified directly that clamping against a containing block established only by a bare `transform` (no `contain`) actively breaks a case that was already correct - a mobile "More tools" menu, genuinely taller than its transformed host, is perfectly fine extending past that host's edge (nothing there clips it), and forcing it to fit inside the host's bounds instead made it overlap its own trigger. The two mechanisms differ in a way that matters here: `transform` alone only changes where fixed coordinates are measured *from*; only `contain` (or an actual `overflow` that clips, not investigated here since no report of it exists yet) changes what's visually clipped.

## Regression coverage

New test in `canonical-toolbar-routing.spec.ts`'s `contain:paint` describe block, "a dropdown near the host's own right edge stays visible and inside the host, not clipped to invisible": a `contain: paint` host sized just narrower than the "More to insert" trigger's natural right edge, asserting the opened menu never extends past the host's own right edge. Verified failing without the fix (menu computed to extend ~62px past the host) and passing with it, confirmed the specific host width needed by directly measuring the trigger's real position rather than guessing. Re-ran the full existing overlay-positioning suite (both this file's `contain`/`transform` describes, the priority-collapse suite, and the overflow:hidden-host suite) - 45/45 passed, confirming the narrower (`contain`-only) scope didn't regress any of the already-fixed cases, in particular the transformed-but-not-containing mobile menu case this investigation's own bisection caught as a real regression risk before landing.

## Related/similar issues

[toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md) - the coordinate-origin half of this same underlying CSS Containment gap; both were needed together for a `contain: paint` host to work correctly, and both were found from the same live Sootr report, one message apart.
