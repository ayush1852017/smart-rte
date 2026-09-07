# HTML import: a div-tagged atom's own round-trip marker (`block_formula`, and the new `page_break`) is silently deleted, not just unwrapped

**Status:** Fixed
**Area:** core / `list/formats.ts`'s HTML parser (`parseMixedBlockContent`)
**First reported:** Found while building the "Horizontal line + page break tools" feature (2026-09-07), verifying `page_break`'s claimed "full" HTML round-trip fidelity - not an end-user report.
**Related files:** `docs/bugs/html-import-bare-inline-content-at-document-root-and-interleaved-with-blocks.md` (the fix this directly builds on and shares the same function with), `docs/bugs/html-import-span-and-div-wrapped-content-lost.md` (the original fix that introduced `TRANSPARENT_CONTAINER_TAGS` and the general "div wrapper" concept this bug is a gap in).

## Symptom

`serializeCanonicalListHtml(doc)` followed immediately by `parseCanonicalListHtml(that html)` on a document containing nothing but a `block_formula` node returned **zero** children back - the formula silently vanished, with no `unknown` placeholder, no error, nothing. Confirmed directly:

```js
const doc = { type: "doc", id: "doc", children: [
  { type: "paragraph", id: "p1", children: [{ type: "text", text: "before" }] },
  { type: "block_formula", id: "bf1", attrs: { source: "y=mx+b", notation: "latex" } },
  { type: "paragraph", id: "p2", children: [{ type: "text", text: "after" }] },
] };
parseCanonicalListHtml(serializeCanonicalListHtml(doc)).children.map(n => n.type);
// ["paragraph", "paragraph"] - block_formula is just gone
```

## Root cause

`atomToHtml` serializes `block_formula` as `<div data-smart-id="..." data-smart-type="block_formula" ...></div>` (`atom/formats.ts`) - a `<div>`, because that's the only reasonable host tag for a block-level KaTeX zone. `"div"` is also one of `TRANSPARENT_CONTAINER_TAGS` (`list/formats.ts`), which `parseMixedBlockContent` checks **first**, unconditionally, before ever looking at the node's own attributes: a transparent container is recursed into and its *children* spliced in, on the theory that a `<div>` wrapping real content (a layout wrapper, a table-wrapper div) carries no meaning of its own. A `block_formula` div has **no children at all** (its formula source lives entirely in the `data-smart-formula` attribute) - so "recurse into this div's children" silently produced nothing, and the atom was gone before `parseBlock`'s own `declaredAtom === "block_formula"` case (which would have parsed it correctly) ever got a chance to run.

This predates the current session entirely - it was already true of the original `parseBlockList` (before `parseMixedBlockContent` existed), for as long as `TRANSPARENT_CONTAINER_TAGS` has included `"div"`. It was never caught because no existing test round-tripped a `block_formula` through `parseCanonicalListHtml`/`serializeCanonicalListHtml` together (only `atomToHtml`/`atomFromHtmlElement` in isolation, or the DOCX/PDF paths, which don't go through this function at all). Building `page_break` - a second div-tagged atom, `data-smart-type="page_break"` - reproduced the identical bug immediately, which is what surfaced it.

## Fix

`parseMixedBlockContent`'s transparent-container check now requires the node to have **no** `data-smart-type` attribute before treating it as a meaningless wrapper:

```ts
if (TRANSPARENT_CONTAINER_TAGS.includes(tag) && !attr(node, "data-smart-type")) { ... recurse ... }
```

A third-party `<div>` (no marker) is still unwrapped exactly as before - this only changes behavior for this app's own round-tripped div-tagged atoms, which now fall through to the ordinary `pushBlock`/`parseBlock` path, where `declaredAtom === "block_formula"` / `declaredAtom === "page_break"` are checked and handled correctly.

## Regression coverage

- `packages/core/src/foundation/list/formats.test.ts` - new page break round-trip test asserts the reparsed document has a real `page_break` node, not an empty gap.
- Directly re-verified `block_formula`'s own round-trip (the fixture above) now returns `["paragraph", "block_formula", "paragraph"]`.
- Full core suite (743/743) passes with no other change in behavior - confirmed no third-party div-wrapper case (the original motivation for `TRANSPARENT_CONTAINER_TAGS`) regressed, since none of those carry a `data-smart-type` attribute.

## Related/similar issues

[html-import-bare-inline-content-at-document-root-and-interleaved-with-blocks](html-import-bare-inline-content-at-document-root-and-interleaved-with-blocks.md) (the fix that introduced `parseMixedBlockContent`, the function this bug lives in) and [html-import-span-and-div-wrapped-content-lost](html-import-span-and-div-wrapped-content-lost.md) (the original fix that introduced `TRANSPARENT_CONTAINER_TAGS` and the div-unwrapping concept this is a gap in).
