# Mark toolbar buttons (Bold/Italic/etc.) have no `aria-pressed` at all — not just missing the "mixed" case

**Status:** Fixed (2026-08-29, as part of the Direction B toolbar redesign's accessibility pass — not a dedicated fix, but the redesign's rebuild of the mark-button row touched exactly this code and the prescribed fix was small enough to fold in rather than defer again).
**Area:** toolbar / marks / accessibility
**First reported:** 2026-08-19, discovered while attempting to close `docs/PHASE_8B_FINAL_CLOSEOUT.md` GAP #20 ("bold on mixed selection updates toolbar state — `aria-pressed="mixed"` never asserted for any mark button") during Phase 11 Tier 2's deferred-e2e-test batch.
**Related files:** `packages/react/src/components/CanonicalAuthorityEditor.tsx` (`markCoverage` helper, `Format` toolbar group and its "More text styles" dropdown), `packages/react/src/components/ToolbarPrimitives.tsx` (`ToolbarButton`/`ToolbarMenuItem`'s `pressed?: boolean | "mixed"` prop)

## Symptom

The closeout's GAP #20 was filed as "the mixed-selection tri-state (`aria-pressed="mixed"`) is untested." Investigating to write the missing test found the gap is more fundamental: mark toolbar buttons (Bold, Italic, Underline, Strike, Code, Superscript, Subscript, TextColor, BackgroundColor, FontSize, FontFamily, Link) have **no `aria-pressed` attribute at all**, in any state — not "true," not "false," not "mixed." A screen reader user has no way to tell, from the toolbar alone, whether the current selection is already bold.

This is a real accessibility and discoverability gap, structurally the same class of issue `list-toggle-buttons-missing-aria-pressed.md` fixed for the Bullets/Numbering/Checklist buttons — but that fix never extended to marks.

## Reproduction

`packages/react/src/components/CanonicalAuthorityEditor.tsx:562-574`: the mark-button render loop (`inlineToolDeclarations.filter(...).map(...)`) sets `aria-label`, `title`, `disabled`, `onClick` — no `aria-pressed` anywhere in the JSX. Confirmed by direct read; no code path sets it conditionally either.

## Root cause

Never implemented. List buttons (`listStyleActive(style, checkable)`, `:613-615`) and the "Check selected items" button (`:629`) both have a dedicated active-state helper wired to `aria-pressed`; no equivalent `markActive(markType)` helper (or its three-state extension for "mixed") was ever built for the mark-button loop.

## Fix

Implemented exactly the recipe this file already prescribed:
1. `markCoverage(id)` (`CanonicalAuthorityEditor.tsx`) resolves `SelectionDescription.marks` for the current selection, finds the entry for that tool's `markType`, and returns `false` (no entry), `true` (`coverage === "all"`), or `"mixed"` (`coverage === "partial"`).
2. `ToolbarButton`/`ToolbarMenuItem` (`ToolbarPrimitives.tsx`) accept `pressed?: boolean | "mixed"` and pass it straight through to `aria-pressed` — React stringifies `"mixed"` as-is and booleans as `"true"`/`"false"`, giving the exact three ARIA tokens this file called for.
3. Wired into every mark button that has a real toggle notion: Bold/Italic/Underline/Strikethrough (always-visible in the Format group) and Code/Superscript/Subscript (in the Format group's "More text styles" dropdown). TextColor/BackgroundColor/FontSize/FontFamily are attribute pickers rather than binary toggles and still have no `aria-pressed`, matching how `listStyleActive` was never applied to non-toggle list controls either — not a gap, a scope boundary this file's own fix list never claimed to cover (it named the same 7 as "Bold, Italic, ... Superscript, Subscript" toggles explicitly, plus TextColor/BackgroundColor/FontSize/FontFamily/Link only in its introductory symptom list, not in its numbered fix steps).
4. E2e test coverage deferred — see Regression coverage below; the toolbar redesign this fix rode in on is already restructuring most e2e toolbar selectors in the same pass (see `docs/bugs/README.md`-adjacent toolbar-redesign completion report), so a dedicated mixed-coverage assertion was left for a follow-up rather than adding one more moving part to that same pass.

## Regression coverage

Manual verification only in this pass (typecheck + lint clean, tri-state logic exercised by hand in a running dev server): select a fully-bold range → Bold shows pressed; select a mixed bold/plain range → Bold shows `aria-pressed="mixed"`; select an all-plain range → Bold shows unpressed. No new automated test added yet — a real Playwright assertion (per this file's own original item 4) is still open follow-up work, tracked here rather than silently dropped.

## Related/similar issues

[list-toggle-buttons-missing-aria-pressed](list-toggle-buttons-missing-aria-pressed.md) — the same fix, already done for list buttons; this is the mark-button equivalent, not yet built.
[toolbar-pressed-state-insufficient-color-contrast](toolbar-pressed-state-insufficient-color-contrast.md) — a different pressed-state bug (contrast, not presence) found in the same investigation area.
