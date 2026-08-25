# Ctrl/Cmd+click on a link looked like it only opened the edit overlay

**Status:** Fixed
**Area:** react / CanonicalAuthorityEditor / link overlay
**First reported:** 2026-08-20, "clicking link not opening link. Even with ctrl or cmd. It's only open overlay."
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Symptom

Ctrl/Cmd+clicking a link (the existing gesture for opening it in a new tab) appeared to do nothing but pop the link-edit overlay open.

## Reproduction

Confirmed directly with Playwright: `window.open` **did** fire and a real new tab opened with the correct URL on Ctrl/Cmd+click in every engine - the link-open mechanism itself was never broken. The auto-triggered link overlay (added in `context-menu-scope-reduction.md`, which makes `LinkEditorPopover` appear automatically whenever the caret is inside a link) also opened at the same time, in the current tab, because the same click that opens the link in a new tab also moves the caret into it via native browser behavior. Since a background tab doesn't steal focus by default, the user stays on the original tab looking at an overlay that just appeared - reading, from their seat, as "the link didn't open, I only got this box."

## Root cause

The first fix attempted was a flag (`suppressLinkOverlayRef`) set in `onClick`'s Ctrl/Cmd-open branch and read by the auto-overlay effect - and it failed in Firefox and WebKit specifically. Instrumenting both the effect and the click handler with timestamps showed why: **native mousedown's own default action is the caret-repositioning into the link, and mousedown fires - and its default action resolves, through a React re-render, through the auto-overlay effect - before `click` ever does.** By the time `onClick` ran, Chromium/Firefox/WebKit had each already carried that caret-move through to a completed render (in a differing number of passes per engine), meaning the overlay could already be open before any flag set inside `onClick` was ever read. A `setTimeout(0)` reset and a "clear on next pointerdown" reset were both tried and both still lost the race on Firefox/WebKit - the problem was never really about *when* the flag got cleared, it was that setting it in `onClick` was already too late to prevent the first, un-suppressed effect firing.

## Fix

Moved the modifier-key check to `onMouseDown` (before `onClick`), calling `event.preventDefault()` there when a link is under the cursor and Ctrl/Cmd is held - blocking native mousedown's caret-repositioning default action outright. The caret never enters the link for this specific gesture, so the auto-overlay effect (keyed off the caret being inside a link) never has a reason to fire at all - root-caused at the source instead of racing a flag against an already-completed render. `onClick`'s existing `window.open` call is unchanged.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "Ctrl/Cmd+click on a link opens it without the edit overlay also popping open": confirms a real new tab opens (`context.waitForEvent("page")`, asserts its URL) and the overlay never appears in the current tab, in all three browsers; then confirms a plain click on the same link immediately after still auto-opens the overlay normally (the mousedown guard is specific to the modifier gesture, not a standing change to click behavior).

## Related/similar issues

[context-menu-scope-reduction](context-menu-scope-reduction.md) - the change that introduced the auto-triggered link overlay this interacts with.
