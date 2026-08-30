# List toggle-off silently failed (needed two clicks) after a preset had been applied

**Status:** Fixed (2026-08-29)
**Area:** react / CanonicalAuthorityEditor.tsx (`listStyleActive`, `toggleList`)
**First reported:** "once a list's type has been changed (e.g. from Bullets to Numbering), there's no way to deactivate the list back to plain text — Bullets/Numbering toggle on/off individually but changing type first seems to break the toggle-off path."
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx`, `docs/bugs/list-marker-competing-style-and-preset-signals.md`, `docs/bugs/list-type-change-not-targeting-whole-tree-from-nested-cursor.md`.

## Symptom

Investigated the literal "Bullets → Numbering → toggle off" flow first (via the toolbar buttons) - that case actually worked correctly in one click, for both flat and multi-item lists, and for the Checklist path too. The real, reliably reproducible case is choosing a **preset** (the "List preset" select in "More list tools" - e.g. "bullet-diamond" or "ordered-upper-alpha") rather than changing style via the plain Bullets/Numbering/Checklist buttons: after picking any preset, clicking the toolbar button that visually matches the list's own current type showed as **not pressed** (`aria-pressed="false"`) even though the list still visually was a bullet/ordered list, and clicking it didn't remove the list - it silently swapped the preset out for a bare disc/decimal style instead. A user had to click the same button a **second** time to actually get back to plain text.

## Reproduction

Confirmed directly: create a bulleted list, apply the "bullet-diamond" preset, check the "Bulleted list" button's `aria-pressed` (false) and click it once (result: list survives as plain `disc`, not removed) - then click it a second time (result: now correctly removed). Same two-click pattern confirmed for an ordered preset ("ordered-upper-alpha") and the "Numbered list" button.

## Root cause

`setListPreset` clears a list's literal `.attrs.style` in favor of `.attrs.preset` (see `list-marker-competing-style-and-preset-signals.md`, which established exactly this "one authoritative signal at a time" behavior for the renderer's sake). But `listStyleActive`/`toggleList`'s "is this button's style already active" check (`CanonicalAuthorityEditor.tsx`) compared `list.attrs.style` against the literal string `"disc"`/`"decimal"` directly - once `.attrs.style` was cleared by a preset, that comparison could never be true again, regardless of whether the preset was itself a bullet-family or ordered-family preset. `toggleList`'s "toggle off" branch is only ever reached when this same-style check is true, so a preset-styled list could never be recognized as "the button's own type already active" and the toggle-off path was unreachable on the first click - only reachable after a first click reset the list to a literal style the comparison *could* match.

## Fix

Added `listActiveKind(list)`: resolves a list's effective *kind* (`"bullet" | "ordered"`) by checking `.attrs.style` first (classifying the known raw CSS keywords - `disc`/`circle`/`square` as bullet, everything else as ordered), falling back to looking up `.attrs.preset` in `SMART_LIST_PRESETS` for its own `kind` field when no literal style is set. Both `listStyleActive` (the toolbar's pressed-state display) and `toggleList`'s toggle-off decision now compare by kind instead of by literal string - so a preset-styled list is correctly recognized as "the matching button is already active" and toggles off in one click, exactly like a plain-style list already did.

## Regression coverage

`packages/react/e2e/canonical-toolbar-routing.spec.ts` - new: "toggling a list style off works in one click after a preset was applied, for both bullet and ordered presets" - applies a bullet preset, confirms the toolbar button reads pressed, confirms one click removes the list entirely; repeats for an ordered preset and the Numbered list button. One pre-existing test's own intermediate step needed updating as a direct, expected consequence of this fix: `canonical-authority.spec.ts`'s "replays generated complete command sessions..." had a `list.setStyle` intent that clicked "Bulleted list" *while already on a bullet-family preset* - previously that reset the preset to plain disc (a real style change), but is now correctly a toggle-*off* instead, per this fix's own stated purpose. Changed that intent to click "Numbered list" instead (a genuine kind change, keeping the list intact) so it continues to exercise "change list style," not "remove the list," matching what its name and the subsequent `list.indent` intent expect.

## Related/similar issues

- [list-marker-competing-style-and-preset-signals](list-marker-competing-style-and-preset-signals.md) - established the exact style/preset mutual-exclusivity this bug's root cause depends on.
- [list-type-change-not-targeting-whole-tree-from-nested-cursor](list-type-change-not-targeting-whole-tree-from-nested-cursor.md) - a different, already-fixed bug in the same toolbar toggle area (scope/depth, not style/preset comparison); both concern the same `toggleList`/`listStyleActive` functions but at different points in their logic.
- Investigated but **not** changed: a genuinely *nested* multi-level list (type-changed at the tree root, then toggled off from a deeply nested cursor) only unwraps one level per click, requiring one click per nesting depth to fully remove. This is a real, separate limitation rooted in `unwrapList`'s own documented gap ([unwraplist-deepest-first-gap-multi-depth-toggle-off](unwraplist-deepest-first-gap-multi-depth-toggle-off.md), already open, explicitly deferred pending a larger "progressively-updated document" architecture change) - not attempted here to avoid re-opening that already-scoped-out architectural work as a side effect of this smaller, more common preset-comparison fix.
