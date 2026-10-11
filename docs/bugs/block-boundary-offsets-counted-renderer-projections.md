# Model/DOM mapping counted renderer projections as block children

**Status:** Fixed (2026-10-11, smartrte-core 1.2.0) - latent; no user report
**Area:** renderer / selection mapping (`modelDom.ts`)
**First reported:** 2026-10-11 - found while spiking the image-caption projection (implementation plan §A5)
**Related files:** `packages/core/src/foundation/modelDom.ts` (`posToDom`, `domToPos`, new `blockBoundaryDomOffset`)

## Symptom

None reported. The image-caption projection (a non-model `<div>` placed right after its `<img>`) would have shifted every block-boundary caret offset after a captioned image by one.

## Reproduction

Root `[p, img, caption, p2]`: the model position "after p2" (`{path: [], offset: 3}`) mapped to DOM offset 3, which is *before* p2. The reverse direction (`domToPos(root, n)`) returned the raw DOM offset as a model offset. The same shape already existed, unnoticed, for other projections inside non-inline owners: a table's `<caption>`/`<colgroup>` projections and a checklist item's check-control button.

## Root cause

For a non-inline owner (document root, table, list item, blockquote…), `posToDom` returned `{ node: element, offset: pos.offset }` and `domToPos` returned the raw DOM offset, treating model child indices and DOM child indices as the same thing. `modelDomChildren` already filtered projections/UI out, but only the inline-owner path used it to translate offsets. The `node !== element` branch of `domToPos` also indexed `element.children` filtered for UI nodes but not projections.

## Fix

`blockBoundaryDomOffset` maps model offset *k* to just before the *k*-th model child; the end offset maps past the last model child and past any image caption trailing it, so a caret "after the image" lands below its caption. `domToPos` counts only model children before a raw DOM offset, and indexes via `modelDomChildren`. A DOM point inside an image-caption projection maps to the boundary right after its image (`captionBoundaryPos`).

## Regression coverage

`packages/core/src/foundation/atom/imageCaptions.test.ts`: "creates, updates and removes the caption projection, outside the model mapping" (posToDom/domToPos assertions around a captioned image). Full core suite (765 before this work) unchanged.

## Related/similar issues

- [figure-wrapper-lost-on-save](figure-wrapper-lost-on-save.md) - same feature.
