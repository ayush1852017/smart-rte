# Enter created a new line but the empty-line caret was not visibly projected

**Status:** Fixed
**Area:** renderer / selection / input / CSS
**First reported:** 2026-08-05 (the canonical interaction repair sequence)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_8B_COMPLETION_REPORT.md`

## Symptom

After pressing Enter, the model contained a new empty paragraph, but the caret was not visibly below the previous line until text was typed. At the bottom of the editor, the new line also needed to be brought into view automatically.

## Reproduction

On `?canonicalAuthority=1`, place the caret in a paragraph, press Enter, and inspect the empty line before typing. Repeat at the last visible line in a scrollable editor and verify the new line is visible without a manual scroll.

## Root cause

An empty canonical paragraph has no text node for the browser to draw a line box/caret against. The model and selection were correct, but the renderer had no UI projection for an empty inline owner and did not reveal the selection head after rendering.

## Fix

`packages/core/src/foundation/surface/renderer.ts:347-365` projects a renderer-only `<br data-smart-empty-line data-smart-ui="empty-line">` and marks the owner as a caret boundary. `:542-552` reveals the selection head within the editable root after projection. `packages/react/src/theme.ts:447-449` gives the empty owner a visible minimum line height. These nodes are UI-only and never enter the canonical model.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` covers immediate empty-line caret visibility and scrolling at the bottom; `packages/react/e2e/canonical-toolbar-routing.spec.ts:265-275` checks the projected empty-line marker and contextual toolbar state. The full three-browser suite passes.

## Related/similar issues

- [quote-boundary-no-editable-position-after-final-blockquote](quote-boundary-no-editable-position-after-final-blockquote.md) — structural boundary positions, a model invariant rather than an empty-line renderer projection.
- [block-atom-following-caret-unreachable](block-atom-following-caret-unreachable.md) — following-line creation after atomic blocks.
