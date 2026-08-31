# Images had no drag-to-resize handle, only +/- buttons

**Status:** Fixed (new capability, not a broken-feature fix - see Root cause)
**Area:** react / MediaOverlay
**First reported:** 2026-08-20, "Images doesn't have a resizer."
**Related files:** `packages/react/src/components/MediaOverlay.tsx`, `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Symptom

The only way to resize an inserted image was the "Resize +"/"Resize βˆ’" buttons (fixed 20px increments) on the toolbar and, since the context-menu scope reduction, on `MediaOverlay`. Tables already had a direct drag handle for column/row resize; media never had an equivalent.

## Reproduction

Confirmed current behavior first, per this project's standing practice of checking "broken vs. never built" before assuming a fix shape: no drag-corner-handle component or logic existed anywhere for atoms - only the button-based `editSelectedAtom(resizeBy)` path (toolbar and `MediaOverlay` both call it). **This is a real capability gap, not a regression.**

## Root cause

N/A (new capability) - see Symptom/Reproduction.

## Fix

Added a small circular drag handle to `MediaOverlay.tsx`, positioned at the selected atom's own bottom-right corner (recomputed via the same `ResizeObserver`/scroll-tracking pattern the overlay panel itself already uses for anchoring to a live element). Dragging it live-previews by mutating the real atom element's `style.width`/`style.height` directly (mirroring `TableResizeHandles.tsx`'s live-preview-during-drag, commit-on-release pattern exactly, rather than inventing a different interaction model for the second resizable thing in this codebase), computing height proportionally from the larger of the horizontal/vertical drag delta to preserve aspect ratio. Commits via a new `resizeSelectedAtomTo(width, height)` in `CanonicalAuthorityEditor.tsx`, which calls the existing `resizeAtom` command directly with explicit values (distinct from `editSelectedAtom`'s fixed +/-20 increment path, which is unchanged and still available).

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "resizes a media atom by dragging its corner handle, preserving aspect ratio": drags the handle diagonally, asserts both width and height grew and the aspect ratio stayed close to the original (160:90).

## Related/similar issues

None prior - the first drag-resize affordance for atoms in this codebase, deliberately reusing `TableResizeHandles.tsx`'s established pattern rather than a new one.

## Addendum (2026-08-30): its own e2e test is flaky on Firefox specifically

While verifying an unrelated change (the formula-resize-controls fix, `formula-resize-controls-shown-for-non-resizable-atom.md`), this test's regression coverage ("resizes a media atom by dragging its corner handle, preserving aspect ratio") failed intermittently on `[firefox]` only - repeat-run confirmed a ~75% failure rate (3/4) on firefox, both with and without that day's unrelated changes present (confirmed via `git stash` isolating the unrelated diff), so it's a pre-existing flake in the test/drag-simulation itself, not a product regression. Chromium and webkit were not observed to flake on this test. Left open/undiagnosed - out of scope for the change being verified at the time; root cause (likely Firefox's synthetic `page.mouse.move`/`pointermove` event timing relative to the drag handler's `pointermove` listener) not yet investigated.

## Addendum (2026-08-31): chromium also flaked once, but only under full-suite parallel load

During the post-packaging-fix full 3-browser e2e re-run (`docs/PHASE_PRE_PUBLISH_AUDIT.md`), this test failed on both `[chromium]` and `[firefox]` in the same run - the first time chromium was seen to fail here. Re-ran isolated (`--repeat-each=5`, no other tests competing for CPU/event-loop time): chromium **5/5 passed**, firefox **2/5 passed** (3/5 failed, consistent with the previously-recorded ~75% rate). Confirms chromium's single full-run failure was parallel-load timing contention exacerbating the same underlying drag-simulation flake, not a new regression - and not caused by the packaging changes (`build`/`exports`/`files` in both packages' `package.json`) being verified in that pass, which don't touch runtime drag/pointer-event code at all. The prior "chromium not observed to flake" claim above should be read as "not observed under isolated conditions" - under full-suite load it can occur too, just far less often than on firefox.
