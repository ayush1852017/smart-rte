# Dragging block media duplicates it (Chromium), does nothing (WebKit), or moves it to a coarse spot

**Status:** Fixed in 1.3.0 (pointer-based media drag replaces the native path)
**Area:** atom / drag-and-drop / input / MediaOverlay
**First reported:** 2026-10-12, 1.3.0 plan ("Today media effectively can't be dragged")
**Related files:** `packages/core/src/foundation/surface/input.ts` (`handleDragStart`, `handleDrop`), `packages/react/src/components/MediaOverlay.tsx`, [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md)

## Symptom

Users can't usefully drag an image, video or other block media to a new place in the document.

## Reproduction

Playwright probe on `?canonicalAuthority=1&blocks=1`. The document was `<p>Alpha</p><img width=120 height=80><p>Beta</p><p>Gamma</p>`. The mouse went down on the image's centre, moved 10px, moved onto "Gamma", then went up. Native HTML5 drag events were recorded on `document`, and the model was read before and after.

| Case | Chromium | WebKit |
|---|---|---|
| Image **not selected** (caret elsewhere) | `dragstart`, `drop`, `dragend`. Result: `Alpha \| IMG(a) \| Beta \| Ga \| IMG(b) \| mma`, a **duplicate** with a new id that splits the target paragraph mid-word. The original stays. | `dragstart`, `dragend`, **no `drop`**. Nothing changes. |
| Image **selected** (node selection, 8 resize handles shown) | Moves, same id: `Alpha \| Beta \| Gamma \| IMG(a) \| ¶`. It lands after the whole target block, wherever in "Gamma" it was dropped. | Same as Chromium. |
| Small selected image (30×20) | Same as the selected case. | Same as the selected case. |

Firefox was not probed; it can't launch locally (see the memory note on Playwright Firefox).

## Root cause

The plan listed three hypotheses. Here is how each held up:

1. **Confirmed.** `handleDragStart` (`surface/input.ts:714-715`) returns early when the model selection is collapsed. Pressing on an unselected image starts a native drag *before* the click handler that would node-select it (`input.ts:592-605`, `click` fires only after mouseup). Nothing is written to the `DataTransfer` and `internalDrag` stays null. Each browser then does something different:
   - Chromium fills the transfer with its own image HTML. `handleDrop` (`input.ts:726`) treats that as an **external** drop: `parseClipboardPayload` → `remintClipboardFragmentIds` → `insertClipboardFragment` at the caret under the pointer. The result is a copy with a new id, splitting the paragraph.
   - WebKit never fires `drop` for that drag, so nothing happens.
2. **Not confirmed.** The plan suspected that `MediaOverlay` covers a selected image. It doesn't: it draws eight 10×10 resize handles on the edges plus a menu panel placed beside the image. `elementFromPoint` at the image centre is the `<img>` itself, even for a 30×20 image. A selected image *does* drag, through the internal path.
3. **Partly confirmed.**
   - Rendered `<img>` elements are natively draggable (`draggable === true`; the renderer never sets it). That is why the unselected case starts a browser-owned drag at all.
   - The internal path for a selected image (`input.ts:739-757`) is a `removeNode` + `insertNode` pair, not `moveNode`. It keeps the id, but the drop slot is coarse: "after the block under the pointer" whenever the caret offset is > 0.
   - Native drag can't restyle its preview (no thumbnail) and doesn't run on touch.

## Fix

- **Renderer:** `surface/renderer.ts` sets `draggable="false"` on block media (`blockMediaTypes`), so the browser's own element drag never starts. Inline images and text drag keep the native path in `surface/input.ts`.
- **Moving:** the new `packages/react/src/components/MediaDragController.tsx`, mounted by `CanonicalAuthorityEditor`, does it with Pointer Events. There's a grab handle, direct drag past 6px, a 450ms long press on touch, and keyboard pick-up from the focused handle.
- **Core decides where and how:**
  - `atom/move.ts` `blockDropTargets` lists the legal slots, using schema content matching for the root, table cells, list items and blockquotes.
  - `planBlockMove` turns the chosen slot into a single `moveNode`, so the node keeps its id, undo is one step, and collaboration rebases it like any other move.
  - The old drag path (a delete plus an insert that re-mints ids) is never used for media.
- **Track changes:** media dragging is disabled while track changes is on, and the handle's tooltip says why. There's no move suggestion type; see `suggestions/structural.ts`, which only supports `removeNode`.

## Regression coverage

- **e2e:** `packages/react/e2e/media-drag.spec.ts`, which passes on Chromium and WebKit; Firefox is covered only once the `e2e.yml` CI job runs. It covers:
  - handle drag with thumbnail size, dimmed original, one drop line, same node, size and caption, and one undo;
  - direct drag versus a click under the threshold;
  - drag into a table cell;
  - an invalid target, and Esc mid-drag;
  - auto-scroll below the fold;
  - video and block formula;
  - keyboard-only move;
  - the track-changes-disabled handle;
  - Move block up/down on a selected image;
  - text drag still native;
  - touch: real CDP touch on Chromium, plus synthetic touch pointers.
- **Unit (jsdom):**
  - `packages/react/src/mediaDrag.test.tsx` covers the 5px/7px threshold, the handle, Esc, cancel cases, a second pointer, the touch long press, undo-cancel, a remote delete mid-drag, read-only, the disabled reason, and keyboard with live-region text.
  - `packages/core/src/foundation/atom/move.test.ts` covers drop targets, `moveNode`/history, export equality and collaboration.

## Related/similar issues

- [atom-resize-selection-lost-after-click](atom-resize-selection-lost-after-click.md): the click → node-selection path that the unselected-drag case runs ahead of.
- [block-move-stale-caret-after-reorder](block-move-stale-caret-after-reorder.md): renderer reorder by stable id, which a `moveNode` drop relies on.
