# Pasted images lost their copied size (parsed with no width/height at all)

**Status:** Fixed
**Area:** core / clipboard / list/formats.ts (HTML→canonical parsing)
**First reported:** 2026-08-20, "I am coping the content which have table, list, blockquote, images etc. and pasting to editor. Everything is working fine images size isn't matching with copied one."
**Related files:** `packages/core/src/foundation/list/formats.ts` (`textWithMarks`'s inline-image branch, `parseBlock`'s `block_image` branch), `packages/core/src/foundation/atom/formats.ts` (`atomToHtml`, unchanged - already writes width/height on copy).

## Symptom

Copying content containing images (tables, lists, blockquotes, images) from another source and pasting into the editor inserted every image, but never at its original size - the pasted `image`/`block_image` atom ended up with no `width`/`height` attrs at all, so it rendered at the browser's unconstrained natural size instead of the size it had in the source.

## Reproduction

Confirmed directly by reading the paste-time HTML→canonical parser (`parseCanonicalListHtml`, the actual path `handlePaste` uses - not `atomFromHtmlElement`, a different function used only by the feature-codec plugin conversion path, whose own round-trip test gave false confidence this was covered). Two independent gaps, both in `list/formats.ts`:

1. **`block_image`'s parser** (`parseBlock`, the `declaredAtom === "block_image"` branch) built the atom from `src`/`alt`/`status`/`decorative` only - it never read `width`/`height` at all, attribute or style, unconditionally dropping any size the source specified.
2. **The inline `image` parser** (`textWithMarks`, the `tag === "img"` branch) did read `width`/`height`, but only the legacy HTML attributes (`Number(attr(node, "width"))`) - never inline `style="width:...;height:...;"`, which is how most real-world sources actually size an image: confirmed against the repo's own captured real-world fixture (`packages/react/e2e/fixtures/test-html-sootr.html`), where all 4 `<img>` tags specify size exclusively via `style="...width: 400px"`, none via the `width`/`height` attributes.

The self-copy/self-paste case is a clean, isolated instance of gap 1: this app's own outbound serializer (`atomToHtml`, `packages/core/src/foundation/atom/formats.ts`) already writes `width="…" height="…"` as HTML attributes for both `image` and `block_image` atoms, but the matching `block_image` inbound parser never read them back - so copying an image *out of this editor* and pasting it back in already lost the size, independent of any third-party source's markup conventions.

## Root cause

Two parsing gaps in `list/formats.ts`, as above - neither reads inline CSS, and one (`block_image`) reads no size source whatsoever. `naturalWidth`/`naturalHeight` were never a viable fallback: paste parsing is synchronous and the pasted image hasn't loaded yet at that point, so there's nothing to read from the decoded bitmap even if the code tried.

The codebase already had the right pattern for exactly this class of problem elsewhere - table row height (`styleValue(node, "height") || attr(node, "height")`) and column width (`parsePixelWidth(styleValue(col, "width")) ?? parsePixelWidth(attr(col, "width")))`) both already prefer inline style over the legacy attribute - it just hadn't been applied to images.

## Fix

Both image-parsing branches now compute width/height as `parsePixelWidth(styleValue(node, "width")) ?? parsePixelWidth(attr(node, "width"))` (and the same for height), reusing the existing `parsePixelWidth` helper (rejects percentages/`auto`/unitless-non-numeric values rather than silently misreading `"50%"` as `50` real pixels - the same reasoning that already applies to table column widths) and the existing `styleValue` helper. Style wins when both a legacy attribute and an inline style are present, matching the table dimension parsers' precedence.

## Regression coverage

- `packages/core/src/foundation/list/formats.test.ts`:
  - "preserves a pasted image's size from inline style or legacy width/height attributes, for both inline and block images": covers style-only, attribute-only, style-wins-over-attribute, block_image style/attribute, no-size-specified (must stay absent, not `0`/`NaN`), and percentage-rejection cases.
  - "round-trips a pasted image's size through this app's own copy output": serializes an `image` + `block_image` doc via `serializeCanonicalListHtml`, re-parses it, and asserts the result matches the original - the concrete self-copy/self-paste reproduction.
  - Confirmed both fail deterministically (3/3 new-or-updated assertions) with the fix reverted, before restoring it.
- `packages/react/e2e/canonical-authority.spec.ts` - "pastes a real Sootr export without losing the blockquote or the div-wrapped table" (existing test, extended): now also asserts the 4 pasted images' parsed widths are `[400, 400, 400, 370]`, matching the real-world fixture's inline-style-only sizing exactly - all 3 browsers.

## Related/similar issues

- [table-shrinks-after-paste](table-shrinks-after-paste.md) - a different atom class (tables) hitting a related but distinct problem (missing `columnWidths` causing `table-layout: fixed` to misinterpret column proportions), already fixed; not the same code path, but the `styleValue`/`parsePixelWidth` pattern this fix reuses originates from that one.
- [html-import-span-and-div-wrapped-content-lost](html-import-span-and-div-wrapped-content-lost.md) - the same real-world Sootr fixture, a different (already-fixed) parsing gap (span/div-wrapped content falling into `unknown` nodes) found via the same fixture.
