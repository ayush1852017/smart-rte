# Saving a document with a pasted `<figure>` flattened it to a loose `<img>` + `<figcaption>`

**Status:** Fixed (2026-10-11, smartrte-core 1.2.0)
**Area:** HTML import / export / list/formats.ts parser
**First reported:** 2026-10-11 - found while verifying the image-captions implementation plan's §1 claims against source, not a user report
**Related files:** [pasted-web-images-and-hr-render-as-unsupported](pasted-web-images-and-hr-render-as-unsupported.md) (where the figcaption gap was originally deferred)

## Symptom

Content containing `<figure><img …><figcaption>Caption</figcaption></figure>` (pasted from the web, or loaded from a CMS) showed the image plus an `[Unsupported: figcaption]` placeholder in the editor. After one save, the stored HTML no longer had the `<figure>` at all: it read `<img data-smart-type="block_image" …><figcaption>Caption</figcaption>` as two loose siblings. That flattened markup is still sitting in hosts' stored content.

## Reproduction

`serializeCanonicalListHtml(parseCanonicalListHtml('<figure><img src="https://example.com/a.png" alt="A"><figcaption>Cap</figcaption></figure>'))` on 1.1.x returns the `<img>` followed by a bare `<figcaption>Cap</figcaption>`.

## Root cause

`figure` was a `TRANSPARENT_CONTAINER_TAGS` entry, so its children were parsed separately: the image became a `block_image`, and the `<figcaption>` (no `parseBlock` case) became an `unknown` node holding `raw.html`. `serializeBlock` writes an `unknown` node's raw HTML back verbatim, so the caption *text* survived, but the wrapper that tied it to the image did not.

## Fix

Part of the 1.2.0 image-captions feature (`block_image.attrs.caption`):
- `parseFigure` (`list/formats.ts`) turns a one-image figure into a single captioned `block_image`; `atomToHtml` (`atom/formats.ts`) writes a captioned image back as `<figure data-smart-figure="true">…<figcaption>…</figcaption></figure>`, so new saves are never flattened.
- **Legacy repair**: in `parseMixedBlockContent`, a `<figcaption>` directly after a still-uncaptioned `block_image` (only whitespace in between) becomes that image's caption, so already-flattened stored content is repaired on load, and the next save rewrites it as a `<figure>`. Not applied inside a figure the parser already declined to treat as one captioned image (e.g. two images), where the caption describes the group. That figcaption, and any other figcaption with nothing to attach to, becomes a paragraph.

**Known remaining gap:** hosts that persist the JSON document (`PersistedEditorDocument`) rather than HTML still have the old `unknown` figcaption node in their stored model, and it still renders as `[Unsupported: figcaption]`. The repair runs on HTML parsing only.

## Regression coverage

`packages/core/src/foundation/atom/imageCaptions.test.ts`: "repairs legacy flattened output (img followed by a loose figcaption) into a caption", "applies figure parsing and legacy repair inside blockquote, list item and table cell", "round-trips SmartRTE's own captioned export, link, alignment and all".

## Related/similar issues

- [pasted-web-images-and-hr-render-as-unsupported](pasted-web-images-and-hr-render-as-unsupported.md) - same parser, the original figure/img fix.
- [html-import-span-and-div-wrapped-content-lost](html-import-span-and-div-wrapped-content-lost.md) - same `unknown`-node raw-HTML round-trip mechanism ("text survives verbatim, structure doesn't").
- [block-image-align-lost-on-html-reload](block-image-align-lost-on-html-reload.md) - found in the same pass, same parser branch.
