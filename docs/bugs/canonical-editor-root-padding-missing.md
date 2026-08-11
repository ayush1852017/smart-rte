# Canonical editor root had no left padding or production-surface visual frame

**Status:** Fixed
**Area:** renderer / toolbar / CSS
**First reported:** 2026-08-05 (canonical product-surface manual testing)
**Related files:** `docs/PHASE_8B_COMPLETION_REPORT.md`

## Symptom

Text in the canonical editor sat against the left edge, and the product editable root did not visually match the surrounding toolbar frame. This was a presentation defect, not a model or selection defect.

## Reproduction

Open `?canonicalAuthority=1` and compare the editable root with the toolbar: the first text line had no expected inset/padding.

## Root cause

The canonical surface was mounted without the production editor class/style contract. The generic contenteditable rules did not provide the root width, padding, border, caret color, or scroll-container frame used by the product surface.

## Fix

`packages/react/src/components/CanonicalAuthorityEditor.tsx` adds the `srte-editor` class to the canonical root. `packages/react/src/theme.ts` supplies the canonical editable-root rule with `padding: 16px 20px`, sizing, border, background, and caret styling. No DOM/model structure changed.

## Regression coverage

The canonical toolbar/surface browser fixtures exercise the production root and its empty-line/caret layout across Chromium, Firefox, and WebKit. This is a visual CSS contract; no retained semantic path is involved.

## Related/similar issues

- [empty-line-caret-not-visible-after-enter](empty-line-caret-not-visible-after-enter.md) — another production-surface presentation issue, with a renderer UI projection rather than root padding.
- [checklist-checkbox-overlaps-content-css](checklist-checkbox-overlaps-content-css.md) — separate CSS sizing/inset issue for projected checklist controls.
