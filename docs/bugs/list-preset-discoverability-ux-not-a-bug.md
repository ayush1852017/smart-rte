# List preset control was hard to discover/read — assessed as UX, not a functional bug

**Status:** Not a bug (working as designed) — a UX clarity pass was made, not a defect fix
**Area:** toolbar / list
**First reported:** unknown — backfilled from `docs/PHASE_8B_MIXED_SCOPE_DROPDOWN_CHECKLIST_PRESET.md` (§4)

## Symptom

Users reportedly couldn't tell what the "List preset" toolbar control was for, or whether a preset was actually active, from the control's appearance alone.

## Reproduction

Assessed directly as a UX/discoverability question — no new preset-command matrix was written, since prior direct-command and toolbar coverage already exercised the configured presets correctly in three browsers (the underlying functionality was not in question, only its legibility).

## Root cause

Not a functional defect. The control was an unlabeled-looking placeholder `<select>` that didn't reflect the active preset as the caret moved — a legibility problem, not a broken command.

## Fix

The control now carries `aria-label="List preset"` and a clarifying `title="List type / preset"`, and is controlled by the current single-list preset so a selected preset remains visibly reflected while the caret stays within that list (`packages/react/src/components/CanonicalAuthorityEditor.tsx`). Mixed or multi-list selections intentionally still show the placeholder and disable the single-list preset chooser, rather than pretending one value is active when none unambiguously is.

**Deliberate remaining limitation, noted at the time rather than silently left unexplained:** plain Bullets, Numbering, and Checklist are separate buttons, while the preset select is specifically the control for named multi-level marker schemes. A raw-style list without a named preset has no unique preset value to show and correctly falls back to the placeholder. A future product pass could add a visible "Preset" toolbar label or an active-style summary for raw-style lists, but this was assessed as a nice-to-have, not a defect.

## Regression coverage

No new automated coverage was added specifically for the label/title change (a static accessibility/labeling attribute, not new logic). Underlying preset application coverage is unchanged from [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) and [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md).

## Related/similar issues

- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — the actual functional bug found in the same investigation round; this file covers the separate discoverability pass done alongside it.
