# Toolbar dropdowns still misplaced inside a fourth Sootr dialog — the standalone CSS `translate` property was never checked

**Status:** Fixed
**Area:** react - `fixedPositioning.ts` (`findFixedPositioningContainer`)
**First reported:** 2026-09-09, with screenshots — "these dropdown overlay still showing in wrong position. It's way right to the linked element" — the "More paragraph tools" and "Line spacing" menus inside a Sootr "Create MCQ" dialog rendered far from their own triggers, after the `transform`, `contain: paint`, and `contain: layout` fixes had all already shipped (`smartrte-react@1.0.0-beta.13`, confirmed freshly installed and rebuilt before re-investigating).
**Related files:** `toolbar-menu-misplaced-inside-transformed-ancestor.md`, `toolbar-overlay-misplaced-inside-contain-ancestor.md`, `toolbar-overlay-misplaced-inside-contain-layout-ancestor.md` — same function, same general bug class, a fourth independent gap.

## Symptom

Identical shape to the very first report in this whole series: a shadcn/Radix-style dialog, `translate-x-[-50%] translate-y-[-50%]` centering classes, menu landing ~250-290px from its own trigger with no error. The first fix (`toolbar-menu-misplaced-inside-transformed-ancestor.md`) was written for exactly this symptom and exactly these Tailwind classes — yet it recurred.

## Root cause

Confirmed via a live console diagnostic run directly against the real Sootr page (walking the DOM ancestor chain from the trigger and reading each one's computed style) rather than guessing: the dialog's own content panel — `fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] ...` — had **`getComputedStyle(el).transform === "none"`**. The centering was real and visually correct, but implemented via the CSS Transforms Level 2 **standalone `translate` property** (`getComputedStyle(el).translate === "-50% -50%"`), not the legacy composite `transform` property `findFixedPositioningContainer` checks.

Confirmed directly in a minimal real-Chromium reproduction before touching any code: an element with only `translate` set (its own `transform` reading `none`) still fully establishes a `position: fixed` containing block for its descendants, per spec — `rotate` and `scale` are the same family of property and behave identically. The first fix's own reasoning was right about *what* was centering the dialog (a Tailwind translate) but wrong about *which CSS property* that compiles to on this host's Tailwind/browser combination — modern Tailwind (and modern browsers) can emit `translate`/`rotate`/`scale` as independent properties instead of composing them into `transform`.

## Fix

`findFixedPositioningContainer` now also checks `style.translate`, `style.rotate`, `style.scale` (each `!== "none"`), and the `will-change` regex now also matches those three names. `getPositioningBounds`'s separate clamping check is unchanged (translate/rotate/scale don't clip painted content, same as bare `transform` never did) — only the origin-detection side needed the addition.

## Regression coverage

New `test.describe("toolbar overlays: correctly positioned inside an ancestor using standalone CSS translate (not the transform property)")` in `e2e/canonical-toolbar-routing.spec.ts`: wraps the editor in a host with `position: fixed; top: 50%; left: 50%` plus the standalone `translate: -50% -50%` property (no `transform` set at all) — the exact shape confirmed on the live page — and asserts a dropdown lands adjacent to its trigger. Confirmed the test fails without the fix (reverted the three added checks, got a real failure — `Expected: < 250, Received: 290` — then restored and confirmed it passes) before considering it real coverage.

Full suites after the fix: react unit 151/151, `canonical-toolbar-routing.spec.ts` 107/108 (1 pre-existing WebKit flake, confirmed 3/3 clean in isolation and unrelated to this change), typecheck clean.

## Related/similar issues

- [toolbar-menu-misplaced-inside-transformed-ancestor](toolbar-menu-misplaced-inside-transformed-ancestor.md) — the original fix, written for the right symptom but checking a property that doesn't always apply.
- [toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md) and [toolbar-overlay-misplaced-inside-contain-layout-ancestor](toolbar-overlay-misplaced-inside-contain-layout-ancestor.md) — the second and third independent gaps in the same function.
- This is the fourth real Sootr dialog to surface a gap here. Standing lesson for next time: `findFixedPositioningContainer` intentionally enumerates every *known* CSS containing-block trigger, but "known" has grown four times now purely from live reports, not from re-reading the spec proactively. Before assuming a fifth report is a duplicate of one of these four, get the actual computed styles from the live page (a console diagnostic, not a guess) — the failure mode is always the same shape (menu lands far from trigger, no error) regardless of which CSS property is the actual cause.
