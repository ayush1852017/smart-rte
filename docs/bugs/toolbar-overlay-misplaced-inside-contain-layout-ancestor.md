# Toolbar dropdowns still misplaced inside a third Sootr dialog — `contain: layout` alone was never checked

**Status:** Fixed
**Area:** react - `fixedPositioning.ts` (`findFixedPositioningContainer`)
**First reported:** 2026-09-08, with a screenshot — "Still these dropdown overlay misplaced inside dialog box" — the "More list tools" menu rendered far to the right of and below its own trigger inside a Sootr "Create MCQ" dialog, overlapping content outside the dialog's own right edge, after both the `contain: paint` fix (`toolbar-overlay-misplaced-inside-contain-ancestor.md`) and its follow-up clamping fix (`toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md`) had already shipped.
**Related files:** `toolbar-overlay-misplaced-inside-contain-ancestor.md`, `toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md` — same general area, same root function, a gap the first pass didn't cover.

## Symptom

Different from both prior fixes' symptoms: not invisible/clipped (a `getPositioningBounds` concern), and not "roughly right but a few dozen pixels off at an edge" — the menu rendered ~350-400px away from its own trigger both horizontally and vertically, landing over unrelated page content outside the dialog. A positioning calculation that looked like it was using the *wrong reference point entirely*, not a slightly-wrong one.

## Root cause

`findFixedPositioningContainer`'s `contain` check only matched `paint`, `strict`, or `content`:

```ts
(style.contain && /\b(paint|strict|content)\b/.test(style.contain))
```

Per the CSS Containment spec, **`contain: layout` alone (without `paint`) also establishes a containing block for `position: fixed` descendants** — this was missed in both prior passes, which only tested and fixed the `paint`-bearing composite values. Confirmed directly in a minimal real-Chromium reproduction before touching any code: a `position: fixed` child of a `contain: layout`-only ancestor (no transform, no paint) resolved its `top`/`left` against that ancestor's own box, not the viewport (`fixedBox.x/y` matched `ancestorBox.x/y + the fixed offset`, not the offset alone).

Since the check missed this case, `findFixedPositioningContainer` returned `null` for a `contain: layout` ancestor, and `getFixedPositioningOrigin` fell back to `{ left: 0, top: 0 }` (i.e., "treat the viewport as the origin") — but the browser was actually resolving the menu's `left`/`top` against the dialog's own box. The two disagreed by exactly the dialog's own viewport-relative position, which is why the menu landed dozens to hundreds of pixels away with no error at all: the coordinates were internally consistent, just computed against the wrong origin.

## Why this is a different fix from the `contain: paint` clamping one

`contain: layout` isolates layout calculations only — it does **not** imply paint containment, so a descendant is still free to visually overflow the ancestor's box (CSS never clips it). Only the origin-detection check (`findFixedPositioningContainer`, used by `getFixedPositioningOrigin`) needed `layout` added. `getPositioningBounds`'s own separate check (whether to *clamp* the menu to the ancestor's box) deliberately still checks only `paint|strict|content`, unchanged — clamping against a `contain: layout`-only ancestor would be wrong for the same reason the earlier fix was careful not to clamp against a bare-transform ancestor (verified previously: over-clamping made a menu overlap its own trigger instead of harmlessly extending past a non-clipping ancestor's edge).

## Fix

`findFixedPositioningContainer`'s `contain` regex: `/\b(paint|strict|content)\b/` → `/\b(layout|paint|strict|content)\b/`. One line. `getPositioningBounds`'s own `contain` check is untouched.

## Regression coverage

New `test.describe("toolbar overlays: correctly positioned inside a contain:layout ancestor (no paint, no transform)")` in `e2e/canonical-toolbar-routing.spec.ts`: wraps the editor in a `contain: layout`-only host (no transform, no paint) and confirms a dropdown lands adjacent to its own trigger. Confirmed this test actually fails without the fix (reverted the regex, ran it, got a real failure — `Expected: < 50, Received: 78` on the vertical-adjacency check — then restored the fix and confirmed it passes) before considering it real coverage, not a test that would have passed regardless. Passed 3/3 browsers with the fix in place.

Full suites after the fix: react unit 151/151, `canonical-toolbar-routing.spec.ts` 105/105 (3 browsers), `canonical-authority.spec.ts` 359 passed / 8 skipped / 2 failed — both confirmed via repeat-each=2 in isolation to be pre-existing flakes unrelated to this change (a Firefox seeded command-replay test and a WebKit cell-selection test, neither touching toolbar positioning), typecheck clean.

## Related/similar issues

- [toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md) — the first pass, which added `contain` detection at all but only for `paint`/`strict`/`content`.
- [toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint](toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md) — the second pass, fixing a distinct clamping-not-origin gap in the same area.
- All three reports came from real, different Sootr dialogs — a reminder that "one real embedding fixed" doesn't mean "the whole containing-block surface is covered": each of CSS's independent containing-block triggers (transform-family, then `contain` partially, now `contain` completely) needed its own confirmation in a real browser rather than being inferred from the others.
