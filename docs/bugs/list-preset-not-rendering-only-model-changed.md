# List preset changed correctly in the model but the browser kept showing the old marker

**Status:** Fixed
**Area:** list / renderer
**First reported:** unknown — backfilled from `docs/PHASE_8B_MIXED_CHECKBOX_PRESET_REOPEN.md`
**Related files:** `docs/PHASE_8B_MIXED_CHECKBOX_PRESET_REOPEN.md`

## Symptom

Applying a list preset via the toolbar correctly updated the model's `preset` attribute, but the browser continued to render the default disc/decimal markers — the visual marker never changed even though the underlying data did.

## Reproduction

Confirmed the model attribute changed correctly on preset application; confirmed via DOM inspection that the rendered `<ul>`/`<ol>` never received the attributes the theme's CSS selectors depend on.

## Root cause

A round of prior work (see [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md) and [list-type-selection-not-reproducible-round2](list-type-selection-not-reproducible-round2.md)) had fixed command *routing* for presets, but missed the live renderer contract: the theme's custom marker CSS selectors key off `data-srte-list-preset` and `data-srte-list-depth`, while the renderer was only projecting the `data-smart-*` attribute names — and no depth attribute at all. So the model was correct, the command was correct, and the CSS rules were correct, but nothing ever wrote the specific attribute names/values the CSS was actually waiting for.

## Fix

The renderer's attribute-sync step now projects both attribute name variants (`data-smart-list-preset`/`data-srte-list-preset`) plus the live nested-list depth (`data-smart-list-depth`/`data-srte-list-depth`) — `packages/core/src/foundation/surface/renderer.ts`. The theme gained marker rules for decimal, upper-alpha, upper-roman, decimal-leading-zero, bullet-disc/circle, and the existing custom bullet presets, all depth-aware (`packages/react/src/theme.ts`).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: checks model attrs, DOM depth, and computed `::marker` content for all configured presets including nested lists. All 12 preset cases passed in all three browsers at time of fix.

## Related/similar issues

This is the third distinct "list marker doesn't show right" bug in this project's history — see [list-marker-competing-style-and-preset-signals](list-marker-competing-style-and-preset-signals.md) (dual attrs both rendering, much earlier round) for the second. Three unrelated causes across three rounds, all presenting as some version of "the marker looks wrong." Also related:
- [list-nested-preset-selection-resolves-to-outer-list](list-nested-preset-selection-resolves-to-outer-list.md) — the fix that came *before* this one in the same "list type/preset" saga; that fix's own regression coverage didn't catch this bug because it only checked the model, not the rendered DOM.
- [list-style-preset-not-cascading-to-nested-lists](list-style-preset-not-cascading-to-nested-lists.md) — the *next* bug found after this one, once presets actually started rendering: a change to an outer list's preset didn't propagate into nested sub-lists' own attributes.
- [list-preset-invalid-bullet-circle-option](list-preset-invalid-bullet-circle-option.md) — a related but separate defect fixed in the same investigation round as this file (an invalid preset ID in the toolbar dropdown).
