# Mark toolbar buttons (Bold/Italic/etc.) have no `aria-pressed` at all — not just missing the "mixed" case

**Status:** Open — tracked gap, not fixed in this pass.
**Area:** toolbar / marks / accessibility
**First reported:** 2026-08-19, discovered while attempting to close `docs/PHASE_8B_FINAL_CLOSEOUT.md` GAP #20 ("bold on mixed selection updates toolbar state — `aria-pressed="mixed"` never asserted for any mark button") during Phase 11 Tier 2's deferred-e2e-test batch.
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx:562-574` (mark button rendering), `packages/react/src/components/CanonicalAuthorityEditor.tsx:613-615,629` (list buttons, for comparison — these already have `aria-pressed`)

## Symptom

The closeout's GAP #20 was filed as "the mixed-selection tri-state (`aria-pressed="mixed"`) is untested." Investigating to write the missing test found the gap is more fundamental: mark toolbar buttons (Bold, Italic, Underline, Strike, Code, Superscript, Subscript, TextColor, BackgroundColor, FontSize, FontFamily, Link) have **no `aria-pressed` attribute at all**, in any state — not "true," not "false," not "mixed." A screen reader user has no way to tell, from the toolbar alone, whether the current selection is already bold.

This is a real accessibility and discoverability gap, structurally the same class of issue `list-toggle-buttons-missing-aria-pressed.md` fixed for the Bullets/Numbering/Checklist buttons — but that fix never extended to marks.

## Reproduction

`packages/react/src/components/CanonicalAuthorityEditor.tsx:562-574`: the mark-button render loop (`inlineToolDeclarations.filter(...).map(...)`) sets `aria-label`, `title`, `disabled`, `onClick` — no `aria-pressed` anywhere in the JSX. Confirmed by direct read; no code path sets it conditionally either.

## Root cause

Never implemented. List buttons (`listStyleActive(style, checkable)`, `:613-615`) and the "Check selected items" button (`:629`) both have a dedicated active-state helper wired to `aria-pressed`; no equivalent `markActive(markType)` helper (or its three-state extension for "mixed") was ever built for the mark-button loop.

## Fix

Not attempted in this pass — this is real feature work, not a test-writing task, and building it properly needs:
1. A `markCoverage(markType, scope)` helper: for the current selection, determine whether the mark is applied to all/none/some of the covered text (reusing `scope/resolveScope.ts`'s existing coverage concepts, per its `SelectionDescription.marks: { mark, coverage: "all" | "partial" }[]` shape, which already computes exactly this).
2. Map that to `aria-pressed`: `"true"` for all-covered, `"false"` for none, `"mixed"` for partial (a valid ARIA token for tri-state toggle buttons).
3. Wire it into the mark-button render loop the same way `listStyleActive` is wired into the list buttons.
4. A real e2e test: select a range covering both bold and non-bold text, assert `aria-pressed="mixed"` on the Bold button; select an all-bold range, assert `"true"`; select an all-plain range, assert `"false"`.

## Regression coverage

None yet — this file exists to track the gap, not close it.

## Related/similar issues

[list-toggle-buttons-missing-aria-pressed](list-toggle-buttons-missing-aria-pressed.md) — the same fix, already done for list buttons; this is the mark-button equivalent, not yet built.
[toolbar-pressed-state-insufficient-color-contrast](toolbar-pressed-state-insufficient-color-contrast.md) — a different pressed-state bug (contrast, not presence) found in the same investigation area.
