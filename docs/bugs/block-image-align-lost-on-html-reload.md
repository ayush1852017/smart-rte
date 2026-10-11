# A block image's alignment was lost on every HTML save -> reload

**Status:** Fixed (2026-10-11, smartrte-core 1.2.0)
**Area:** HTML import / list/formats.ts parser / atom
**First reported:** 2026-10-11 - found while reading `parseBlock` for the image-captions work, not a user report
**Related files:** `packages/core/src/foundation/list/formats.ts` (`parseBlock`, `declaredAtom === "block_image"` branch), `packages/core/src/foundation/atom/formats.ts` (`atomToHtml`)

## Symptom

Setting an image's Align (Left/Center/Right) in Media details worked in the live editor, but a host that saves `onHtmlChange` output and reloads it got the image back unaligned.

## Reproduction

`parseCanonicalListHtml(serializeCanonicalListHtml({ type: "doc", id: "d", children: [{ type: "block_image", id: "i", attrs: { src: "https://example.com/a.png", alt: "A", status: "ready", align: "right" } }] }, { clean: true }))`: on 1.1.x the parsed `block_image` has no `align`. Hosts persisting the JSON document were unaffected.

## Root cause

`atomToHtml` has always written `data-smart-align` on the `<img>`, and the inline `image` branch of `textWithMarks` and `atomFromHtmlElement` both read it back, but the block-level `parseBlock` branch for `img[data-smart-type="block_image"]` never did. It read src/alt/status/decorative/size/href/target/radius/license and skipped align.

## Fix

That branch now reads `data-smart-align` when it is `left`/`center`/`right` (the schema's own allowed values).

## Regression coverage

`packages/core/src/foundation/atom/imageCaptions.test.ts`: "restores block image alignment on reload (data-smart-align was written but never read back)", plus the alignment in "round-trips SmartRTE's own captioned export, link, alignment and all".

## Related/similar issues

- [media-details-old-editor-field-parity](media-details-old-editor-field-parity.md) - where the Align UI was added.
- [figure-wrapper-lost-on-save](figure-wrapper-lost-on-save.md) - found in the same pass.
