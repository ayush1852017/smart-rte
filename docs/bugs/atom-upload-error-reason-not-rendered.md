# Atom `attrs.error` (specific upload-failure reason) is written but never read by the canonical renderer

**Status:** Open
**Area:** atom / surface renderer / media
**First reported:** 2026-08-25, found during the Phase 9–12a independent audit's systematic "written, never rendered" schema sweep (`packages/core/src/foundation/{atom,table,block,list,marks}/schema.ts` cross-referenced against `packages/core/src/foundation/surface/renderer.ts` and `packages/core/src/foundation/marks/dom.ts`).
**Related files:** `packages/core/src/foundation/atom/schema.ts` (`error: optionalString` on `image`/`block_image`/`video`/`audio`/`formula`/`block_formula`), `packages/core/src/foundation/atom/lifecycle.ts:30` (`failAtomUpload`/`completeAtomUpload` write it), `packages/core/src/foundation/surface/renderer.ts` (canonical renderer, never reads it), `packages/react/src/adapters/domInlineAtomCommandBridge.ts:172` (legacy bridge, reads it into an inert dataset attribute)

## Symptom

When a media upload fails, `completeAtomUpload`/`failAtomUpload` (`atom/lifecycle.ts:30`) correctly set `node.attrs.status = "error"` and `node.attrs.error = <specific reason string>` (e.g. whatever message the host's `MediaProvider.upload()` rejected with, or `"Upload failed"` as a fallback). The canonical renderer (`FoundationSubtreeRenderer` in `surface/renderer.ts`) reads `attrs.status` (sets `data-smart-status`) but never reads `attrs.error` anywhere — confirmed by `grep -n "attrs?.error\|attrs\.error" packages/core/src/foundation/surface/renderer.ts` returning zero matches. The only error text a user ever sees is a generic, hardcoded string ("Image could not be loaded" / "Video could not be loaded" / "Audio could not be loaded") set by `installMediaDiagnostics`'s native DOM `error` event listener — the specific, potentially actionable reason the model actually carries (e.g. "File exceeds 10MB limit", a real message from a real host backend) is silently discarded.

This is the same "written, never rendered" shape as `docs/bugs/table-column-width-not-rendered.md` and `docs/bugs/table-cell-text-color-not-rendered.md`: an attribute with a real writer and no renderer consumer for the promoted canonical path.

## Reproduction

Direct source inspection (no live repro needed — this is a static gap, same methodology as the two prior instances):
1. `grep -n "error" packages/core/src/foundation/atom/lifecycle.ts` — confirms `attrs.error` is written on upload failure (line 30) with a real, potentially specific message.
2. `grep -n "attrs?.error\|attrs\.error" packages/core/src/foundation/surface/renderer.ts` — zero matches; the canonical renderer's `image`/`block_image`/`video`/`audio`/`formula`/`block_formula` branches (lines ~276-322) apply `src`, `alt`, `width`, `height`, `data-smart-status`, `poster`, etc., but never `attrs.error`.
3. The one place that *does* read `attrs.error` is the legacy `domInlineAtomCommandBridge.ts:172`, which stuffs it into `atom.dataset.smartError` — but nothing reads that dataset attribute either (`grep -rn "smartError\|data-smart-error"` across `packages/` turns up only that one write site, no CSS rule, no JS consumer). So even the legacy path's "consumption" is itself a dead end. `ClassicEditorAuthority.tsx` confirms the legacy DOM-authoritative path (and this bridge with it) was fully retired at Phase 8b closeout (2026-08-12) — `CanonicalAuthorityEditor`/`FoundationSubtreeRenderer` is unconditionally the only rendering path in the current product, so the legacy read path is moot regardless.

## Root cause

`atom/schema.ts`'s `error` attribute and `atom/lifecycle.ts`'s upload-failure handling were built to carry a specific, potentially host-provided failure reason, but no renderer branch (canonical or otherwise, in practice) was ever wired to surface it to the user — the same category of gap as the table `columnWidths`/`textColor` cases: two ends of a pipe (writer, and a plausible display surface) built in different work items with nothing connecting them, and no UI ever exercised the failure path visibly enough to notice the specific message never appears.

## Fix

Not attempted in this pass — this audit is read-only per its scope. A correct fix would have the canonical renderer's atom branches (or `installMediaDiagnostics`) prefer `node.attrs.error` as the `title`/`aria-label` text when `attrs.status === "error"` and `attrs.error` is a non-empty string, falling back to the current generic message only when the model has no specific reason recorded.

## Regression coverage

None — not yet fixed. A future fix should add a renderer test asserting that a node with `attrs.status = "error"` and `attrs.error = "<specific reason>"` produces a `title`/`aria-label` containing that exact reason, not just the generic fallback string.

## Related/similar issues

- [table-column-width-not-rendered](table-column-width-not-rendered.md) — the first instance of this exact "written, never rendered" shape.
- [table-cell-text-color-not-rendered](table-cell-text-color-not-rendered.md) — the second instance, found the same way (building UI that would have exposed the gap).
- This is the **third** confirmed instance of the pattern, found this time by a systematic schema-vs-renderer sweep rather than incidentally while building a feature — worth treating "does every schema attribute have a renderer consumer" as a standing check for future phases, per this audit's recommendation.
