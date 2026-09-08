# "Bulleted list"/"Numbered list" clarified: preset picker needed to be a split control, not the silent-remember-only toggle first built

**Status:** Fixed (a scope correction, not a regression — the original request was ambiguous and the first implementation, while itself correct and shipped, wasn't what was actually wanted)
**Area:** react - `CanonicalAuthorityEditor.tsx` toolbar (Bulleted list / Numbered list controls), `theme.ts`
**First reported:** 2026-09-08 — "Let both bullet and number list tool icon work as toggle and on click text should option respective prelist," clarified via follow-up as "Have you implemented opening dropdown of preset list by clicking on Bulleted List and Numbered list?"

## What happened

The original request ("on click ... should [adopt] respective preset list") was clarified via AskUserQuestion, and the answer received ("the last preset the user picked") was implemented faithfully: clicking Bulleted list/Numbered list silently reapplies whichever preset was last picked from "More list tools," instead of always resetting to the plain marker. This shipped, was tested, and reported as done.

The user's later question — "have you implemented opening dropdown of preset list by clicking on Bulleted List and Numbered list?" — revealed the actual want was different: a way to open a preset **picker** directly from the button, not a silent remembered-value reapply. These are genuinely different behaviors (one is invisible/automatic, the other is an explicit choice UI), and the mismatch only surfaced once the user asked a pointed clarifying question about the concrete UI shape rather than the abstract behavior.

## Why not just make the whole button open a dropdown

Checked before implementing: the plain one-click toggle (create/remove a list on a single click) is depended on by 40+ existing e2e assertions across `canonical-authority.spec.ts` and `canonical-toolbar-routing.spec.ts`, plus presumably real usage — converting the entire button into a dropdown-only trigger would have required a second click just to get a plain list, breaking that affordance everywhere. Surfaced this tradeoff explicitly rather than picking a side silently; the confirmed answer was a **split control** (icon: same one-click toggle as before; a separate small arrow: opens the preset picker) — the same shape Google Docs/Word use for their own list buttons.

## Implementation

Reused an existing-but-unused CSS pattern (`theme.ts`'s `.srte-split-control`, defined but never wired to any JSX before this) — a plain button plus a native `<select>` styled into a chevron-only affordance. Chose a native `<select>` over a custom-positioned dropdown panel deliberately: this project has hit three separate real positioning bugs this session alone in the custom-panel pattern (`toolbar-overlay-misplaced-inside-contain-ancestor.md`, `toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md`, plus the original `toolbar-dropdown-clipped-by-host-overflow-hidden.md`) — a native `<select>`'s own dropdown is positioned entirely by the browser and is immune to all of them by construction.

`applyListPreset(preset)` (new) mirrors the existing shared "List preset" select's logic but also handles the case that select never did: applying a preset when nothing is a list yet (creates a new one via `createList` with `preset` set), not just editing an already-existing list. Remembers the choice via the same `lastListPreset` state the plain-toggle feature already uses, so the two features (silent remember-on-toggle, explicit pick-from-select) share one source of truth and can't drift apart.

## A real regression caught during verification

Adding the two selects (~27px each) to the always-visible "Bulleted list / Numbered list / Checklist / More list tools" toolbar group pushed its total width over what fits at the narrowest tested container width (340px) — since `.srte-toolbar-group` is an `inline-flex` that doesn't wrap internally (only the outer `.srte-toolbar` does, per-group), the group had no way to shed the extra width except shrinking a child below its own content size, which flagged the existing "continuous sweep, 340px–2300px" no-squeeze test on the Checklist button (`shrunk=["Checklist:content52/box45.8"]`). Root-caused and fixed by hiding the split-control select under the same `@container srte-editor (max-width: 639px)` query "More list tools" already collapses at — the presets stay fully reachable there via the pre-existing shared select, so nothing is lost, matching this codebase's established `widePromote` convention (an extra convenience copy that only exists at wider widths, with the full feature always reachable another way regardless of width).

## Regression coverage

New test in `e2e/canonical-toolbar-routing.spec.ts`, "the Bulleted/Numbered list split-control select applies a specific preset directly from the button itself": picks a bullet preset with no list yet selected (confirms list creation, not just editing), converts to an ordered preset via the other select (confirms whole-list conversion + independent per-kind remembering), and confirms the plain toggle button's existing behavior (tested separately above this one) still works and now reapplies the just-picked preset. Passed 3/3 browsers.

Full verification after the fix: core 747/747 (unaffected, no core changes), react unit 151/151, `canonical-toolbar-routing.spec.ts` 99/99 (3 browsers × 33 tests, including the previously-failing squeeze test), `canonical-authority.spec.ts` 361 passed / 8 skipped across all 3 browsers (covers all 40+ existing "Bulleted list"/"Numbered list" one-click call sites — none needed to change), axe scan clean, typecheck clean.

## Related/similar issues

- [toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint](toolbar-overlay-clamped-to-wrong-viewport-inside-contain-paint.md) and [toolbar-overlay-misplaced-inside-contain-ancestor](toolbar-overlay-misplaced-inside-contain-ancestor.md) - the custom-positioned-dropdown bug class this fix deliberately avoided by using a native `<select>` instead.
