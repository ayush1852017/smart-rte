# insertImage from a host panel pulled focus into the editor despite `focus: false`

**Status:** Fixed before release (2026-10-11, smartrte-react 1.2.0 development)
**Area:** renderer / runtime / host APIs
**First reported:** 2026-10-11 - caught by the new `image-captions.spec.ts` e2e test on Chromium; the jsdom unit test for the same behaviour passed, because jsdom never moves focus on selection changes
**Related files:** `packages/core/src/foundation/surface/renderer.ts` (`render`, `restoreSelection`), `packages/react/src/canonicalEditorRuntime.ts` (`executeOperations`, `mount`)

## Symptom

A host button calling `insertImage(...)` (default `focus: false`) inserted the image correctly, but focus ended up in the editor instead of staying on the host's button.

## Reproduction

`packages/react/e2e/image-captions.spec.ts`, "a host button outside the editor inserts a captioned image at the caret without taking focus": click into editor text, click a host input, click a host button whose handler calls `insertImage`. On the first implementation, `expect(button).toBeFocused()` failed with "inactive".

## Root cause

Skipping `runtime.focus()` was not enough. Every transaction re-renders through the runtime's `editor.subscribe` callback, and `FoundationSubtreeRenderer.render` ends with `restoreSelection`, which calls `selection.setBaseAndExtent` inside the contenteditable root. In real browsers, moving the document selection into an editing host moves focus there.

Rejected alternative: skip `restoreSelection` whenever focus is outside the editor. Toolbar commands render while the toolbar button has focus and only call `focus()` afterwards. Without the restore, `focus()` would surface a stale DOM selection that `syncSelectionFromDom` would then import over the correct model selection.

## Fix

`CanonicalSubtreeRenderer.render` takes an optional `{ syncDomSelection?: boolean }` (default true). With `false` it still renders and scrolls the selection into view, but leaves the browser selection alone. `ExecuteOperationsOptions.focus: false` sets a runtime flag for exactly that one `transact`, and the subscribe callback passes `syncDomSelection: !flag`. Every other path is unchanged.

**Applies to any future host-facing write API**: route it through `executeOperations(..., { focus: false })` instead of calling `editor.transact` directly, or it will steal focus the same way.

## Regression coverage

`packages/react/e2e/image-captions.spec.ts` (all 3 browsers); `packages/react/src/insertImage.test.tsx` "does not steal focus from the host's panel unless asked…" (jsdom; covers the `focus()` call only, not the selection mechanism).

## Related/similar issues

- [link-overlay-autofocus-steals-editor-focus-on-plain-click](link-overlay-autofocus-steals-editor-focus-on-plain-click.md) - focus stolen in the opposite direction.
- [color-preview-render-steals-focus-from-popover](color-preview-render-steals-focus-from-popover.md) - the same "a render/commit moves focus" family; that fix skipped `focus()` for preview commits.
