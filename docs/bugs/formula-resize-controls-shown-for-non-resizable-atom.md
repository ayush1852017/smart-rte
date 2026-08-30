# Resize controls (toolbar "Enlarge/Shrink selected media" + MediaOverlay's resize buttons/drag handle) shown for formula, which has no width/height concept

**Status:** Fixed
**Area:** atom / toolbar
**First reported:** 2026-08-30 — user question ("Why there is resize buttons for formula?") after the formula library feature landed
**Related files:** `formula-library-and-special-character-picker-added.md` (the feature that made formula selection reachable via the toolbar in the first place), `media-overlay-no-drag-resizer.md` (added the drag handle this bug also exposed for formula)

## Symptom

Selecting a formula atom (inserted via the formula library, or an existing one) showed the same "Enlarge selected media"/"Shrink selected media" toolbar items and the same `MediaOverlay` Resize +/− buttons and corner drag handle that image/video/audio get — even though a formula has no width/height: KaTeX sizes its own rendering purely from the LaTeX source and ambient font-size, there is nothing for a stored dimension to control.

## Root cause

`CanonicalAuthorityEditor.tsx`'s `mediaAtomSelected` gate (line ~463) already excludes `"divider"` from the media-specific Edit/Resize UI, with a doc comment explaining exactly why: "a divider... has no src/alt/width/height at all - MediaOverlay and the media-specific Edit/Resize actions assume every atom is a real media item." Formula fits that same description (no src/alt/width/height — only `source`/`notation`/`error`), but the exclusion list was never extended to it when formula support was added, because until the formula-library feature, formula was never reachable as a *selected* atom from the toolbar/overlay path (the old flow was a blind `window.prompt`, never leaving the inserted atom selected).

Consequence beyond the visible UI clutter: clicking "Resize +"/"Resize −" (or dragging the handle) called `editSelectedAtom(by)` → `resizeAtom(...)` → `updateAtom(document, scope, { attrs: { width, height } })` unconditionally. `formulaValid` (the formula declaration's schema validator) only checks `source`/`notation`, so it doesn't reject the extra `width`/`height` keys — the operation succeeded and silently persisted meaningless dimension attrs onto the formula node (invisible in rendering, since the renderer never reads them for formula, but real junk in the serialized document/JSON/DOCX export).

## Fix

`CanonicalAuthorityEditor.tsx`: added `resizableAtomSelected = mediaAtomSelected && selectedAtomNode?.type !== "formula" && selectedAtomNode?.type !== "block_formula"`, alongside the existing `mediaAtomSelected`. "Enlarge selected media"/"Shrink selected media" toolbar items now gate on `resizableAtomSelected` instead of `mediaAtomSelected`. `MediaOverlay.tsx` gained a `resizable?: boolean` prop (default `true`) that hides the Resize +/− buttons and the corner drag handle when `false`; `CanonicalAuthorityEditor.tsx` passes `resizable={resizableAtomSelected}`. "Edit"/"Delete" stay available for formula in both places — `editSelectedAtom()` already branches on `node.type.includes("formula")` for its own correct "Formula source" prompt, unaffected by this change.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` — "a selected formula atom hides resize controls but keeps edit/delete" (all 3 browsers): inserts a formula, confirms the auto-selected atom's `MediaOverlay` shows Edit/Delete but not Resize +/−/the drag handle, and confirms "Enlarge selected media"/"Shrink selected media" are disabled in the toolbar dropdown.

## Related/similar issues

Same shape as the pre-existing `divider` exclusion this fix extends — a new atom type (formula) added without revisiting the "which atoms are real media" gate. Worth checking again if a future atom type is added.
