# No editable caret below a trailing image, audio, or video atom

**Status:** Fixed
**Area:** atom / selection / block boundary / renderer
**First reported:** 2026-08-05 (the `38ee499` block-atom caret fix)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_8B_BLOCK_MOVE_FOLLOWUP.md`

## Symptom

After inserting an image, audio, or video as the final block, clicking or arrowing below it could not place the caret on a new line. Typing therefore appeared inert even though the atom itself was present.

## Reproduction

On `?canonicalAuthority=1`, insert a block image at document end, select it, press ArrowRight, and type. The expected result is a new editable paragraph after the atom containing the typed text. The same boundary was exercised for the canonical media family; media-specific rendering is tracked in [media-atoms-not-rendered-or-playable](media-atoms-not-rendered-or-playable.md).

## Root cause

Block atoms occupy one indivisible structural unit and expose no native editable outside edge. The insertion/navigation path did not guarantee a following editable block, so the browser could only leave the selection on the atom/root boundary. This was a canonical boundary invariant gap, not a media URL or playback error.

## Fix

`packages/core/src/foundation/boundaries.ts:19-27,75-129` treats atomic block nodes as boundary blocks and inserts a deterministic empty paragraph where needed. `packages/core/src/foundation/surface/input.ts` resolves structural movement through the nearest editable owner. The product media insertion path also preserves the trailing owner when inserting at document end.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts:302-316` asserts a paragraph is created and selected after a trailing block atom. `packages/react/e2e/canonical-toolbar-routing.spec.ts:251-263` inserts an image, arrows past it, types, and verifies the following paragraph. The full three-browser suite passes.

## Related/similar issues

- [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md) — the same shared editable-boundary invariant for quotes.
- [quoted-list-enter-enter-exit-leaves-delete-inert](quoted-list-enter-enter-exit-leaves-delete-inert.md) — another boundary/selection consequence, with list-in-quote structure.
- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — separate node-selection demotion after atom clicks.
