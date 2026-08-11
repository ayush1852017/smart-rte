# Canonical image, video, and audio atoms were inserted incorrectly or lacked visible media controls

**Status:** Fixed for canonical rendering/routing; real network playback remains environment-dependent and was not claimed by automated tests
**Area:** atom / media / renderer / toolbar
**First reported:** 2026-08-05 (the media/caret repair sequence)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_7_COMPLETION_REPORT.md`

## Symptom

Image/video/audio insertion on the canonical surface could appear missing or appear in the wrong structural location. Audio could render without a usable native control, and images/video were not reliably visible to the product route. The same session also reported that the caret could not move below a trailing media node; that boundary issue is recorded separately in [block-atom-following-caret-unreachable](block-atom-following-caret-unreachable.md).

## Reproduction

On `?canonicalAuthority=1`, insert each media kind through the toolbar and inspect the model and DOM. The failing cases involved inserting relative to structural/cell selections and projecting the atom with missing/incorrect attributes. A fake test URL can verify DOM controls and visibility, but cannot prove that an external server will return playable bytes.

## Root cause

The insertion caller and `insertAtom` disagreed about the selected parent/index, so a media node could be inserted beside the intended owner rather than inside it. The renderer also lacked the complete native media projection contract (sanitized `src`, `controls`, `preload`, `playsinline`, type inference, accessible label, and load/error diagnostics). This was routing/rendering, not an atom schema or upload-provider problem.

## Fix

The canonical runtime and toolbar now resolve the actual parent/index for the selection, including table-cell and structural positions. `packages/core/src/foundation/surface/renderer.ts:199-239` projects image/video/audio attributes and native controls through the shared resource policy; `:242-266` keeps failed resources visible with model-independent diagnostics. The product route uses the host `MediaProvider`; it does not invent a storage backend.

The media prompt was also clarified in commit `0bad685` to request a direct
resource URL rather than a page URL. A page URL is not evidence that the
underlying media is playable.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts:277-300` checks image/video/audio rendering attributes, controls, preload, playsinline, and error presentation. `packages/react/e2e/canonical-toolbar-routing.spec.ts:77-123` checks media insertion, visibility, and URLs in all three browsers. These tests do not assert successful network playback from `example.test`/`playground.test` URLs.

## Related/similar issues

- [block-atom-following-caret-unreachable](block-atom-following-caret-unreachable.md) — trailing editable boundary after a media atom.
- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md) — node-selection state after clicking a rendered atom.
- [stale-dist-build-confusion](stale-dist-build-confusion.md) — stale playground output was a competing explanation for several “still not rendering” reports and must be ruled out first.
