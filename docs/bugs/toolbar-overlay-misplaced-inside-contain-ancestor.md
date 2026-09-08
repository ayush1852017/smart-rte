# Toolbar overlays still land far from their trigger inside a Sootr Dialog, despite already running the transform-fix version

**Status:** Fixed
**Area:** react (`components/fixedPositioning.ts`)
**First reported:** 2026-09-08, screenshots from real Sootr usage ("Create PYEQ" dialog): "More list Tools, More to Insert, Save a Copy, More text Style ... All overlay showing up way right side of actual place is clicked."
**Related files:** [toolbar-menu-misplaced-inside-transformed-ancestor](toolbar-menu-misplaced-inside-transformed-ancestor.md) - the original fix for this exact symptom class, which this report turned out to have a real, independent gap in, not a resurfacing of the same bug.

## Investigation

Per project convention, checked this file's own predecessor first, since the symptom (every toolbar dropdown - "More list tools", "More to insert", "Save a copy", "More text styles" - landing far to the right of its trigger) is a near-exact match for the earlier, already-fixed report. Confirmed Sootr's `package.json` pins `smartrte-react@^1.0.0-beta.10`, which is **already at or above** `1.0.0-beta.9` - the version that shipped `fixedPositioning.ts`'s original fix. So this is not a stale-version artifact; either a genuine regression or a real gap in that fix.

The original fix's `findFixedPositioningContainer` walks up the DOM looking for an ancestor with a non-`none` `transform`, `perspective`, `filter`, `backdrop-filter`, or a `will-change` naming one of those - all CSS Transforms-spec mechanisms for creating a new containing block for `position: fixed` descendants. But that is not an exhaustive list: **CSS Containment** (`contain: paint | strict | content`) *also* makes an element the containing block for fixed-positioned descendants, entirely independent of `transform`. A modal/dialog that uses `contain` (a common perf/isolation technique on large scrollable containers, and increasingly common in modern dashboard component libraries like the one shown in Sootr's own "31Gauge" admin screenshots) would trigger the exact same silent-miscalculation bug the original fix targeted, but go completely undetected by it.

Also investigated (and explicitly ruled out) `container-type` (CSS Containers) as a second candidate, since it implies `contain: layout style` per spec and seemed like an equally plausible culprit for a modern component library. Verified directly, in real Chromium: `container-type: inline-size` alone does **not** actually change `position: fixed` behavior relative to that ancestor in practice - a toolbar dropdown that was already correctly positioned under it stayed correctly positioned without any special-casing, and adding a check for `container-type` to `findFixedPositioningContainer` actively **broke** that already-correct case (shifted a dropdown that used to land 6px below its trigger to instead overlap it by 66px). Not every CSS Containment implication holds in every engine's actual rendering behavior; verified rather than assumed for both candidates before deciding which to ship.

## Answering "is it Sootr or the editor" directly

**The editor** - a real, verifiable gap in `fixedPositioning.ts`'s own stated goal ("find the real containing block ancestor, whatever mechanism creates it") that this package already committed to solving for `transform`. Nothing about Sootr's own code is incorrect; a host is fully entitled to use `contain: paint` (or any other legitimate CSS containment technique) on an element that happens to be an ancestor of this editor.

## Fix

`fixedPositioning.ts`'s `findFixedPositioningContainer` now also treats a computed `contain` value containing `paint`, `strict`, or `content` as establishing the containing block, exactly like the existing `transform`/`perspective`/`filter`/`backdrop-filter`/`will-change` checks. No other code changes needed - every overlay component (`ToolbarDropdown`, `MobileMoreMenu`, `ColorPickerPopover`, `TableBorderPopover`) already calls through this single shared function via `getFixedPositioningOrigin`, so all four are fixed by this one change, matching how the original fix was structured.

## Regression coverage

New `test.describe("toolbar overlays: correctly positioned inside a contain:paint ancestor (no transform at all)", ...)` in `canonical-toolbar-routing.spec.ts`, wrapping the editor in a host with `contain: paint` and deliberately **no** `transform` at all (to isolate this specific mechanism from the already-covered transform case): a desktop `ToolbarDropdown` ("More text styles") lands adjacent to its own trigger. Verified this test fails without the fix (menu computed against the wrong origin) and passes with it, across all 3 engines - 12/12 passed alongside the 3 pre-existing transform-based tests in the same describe block, confirming no regression to the original fix. React unit 151/151 unchanged.

## Related/similar issues

[toolbar-menu-misplaced-inside-transformed-ancestor](toolbar-menu-misplaced-inside-transformed-ancestor.md) - the original fix this one extends; both share the exact same root mechanism (a `position: fixed` overlay's coordinates computed against the wrong containing block) and the exact same fix shape (extend `findFixedPositioningContainer`'s detection list), just for a different CSS trigger. Any *future* report of this same symptom should extend this same function again, not re-diagnose the whole class of bug from zero - and should verify any new candidate CSS property actually changes rendering in a real browser before adding it, per the `container-type` false-lead in this investigation.
