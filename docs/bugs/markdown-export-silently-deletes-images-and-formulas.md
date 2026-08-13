# Markdown export silently deleted inline/block images and formulas with zero trace

**Status:** Fixed
**Area:** markdown / export / atom
**First reported:** 2026-08-13, discovered while auditing Phase 9 SS2.2's fidelity table against real behavior for SS2.3's round-trip fixture suite

## Symptom

Exporting any canonical document containing an inline image, inline formula, block image, or block formula to Markdown (`serializeCanonicalListMarkdown`) silently deleted that content entirely - not reformatted, not replaced with a fallback marker, just gone, with no error, warning, or trace. Surrounding text in the same paragraph survived; the atom itself did not.

```ts
serializeCanonicalListMarkdown({
  type: "doc", id: "doc",
  children: [{ type: "block_formula", id: "f", attrs: { source: "x^2", notation: "latex" } }],
});
// => "" (empty string - the entire document vanished)
```

This directly contradicted the fidelity table's existing claims (`images-media/markdown`: "Inline images round-trip"; `formulas/markdown`: "Dollar-delimited formula source round-trips") - neither was true; both were untested assumptions carried forward without a fixture ever having checked them, exactly the gap Phase 9 SS2.2/SS2.3 exist to close.

## Reproduction

```ts
import { serializeCanonicalListMarkdown } from "packages/core/src/foundation/list/formats.ts";
serializeCanonicalListMarkdown({
  type: "doc", id: "doc",
  children: [{ type: "paragraph", id: "p", children: [
    { type: "text", text: "before " },
    { type: "image", id: "i", attrs: { src: "https://x.test/a.png", alt: "A" } },
    { type: "text", text: " after" },
  ] }],
});
// Before fix: "before  after" (image silently gone, note the double space)
```

## Root cause

Two independent gaps in `packages/core/src/foundation/list/formats.ts`, both in code that predates Phase 9:

1. **Export side**: `markdownInlineText`'s per-child handler had `if (!isTextNode(child)) return child.type === "hard_break" ? "  \n" : "";` - any inline atom (image, formula) fell into the `""` branch. `markdownBlock`'s dispatcher had no case for `block_image`/`block_formula`/`video`/`audio` at all, falling through to a default that called `markdownInlineText` on the atom node itself - which has no `children`, so it also produced `""`.
2. **Import side** (found after fixing #1 and testing the full round-trip, not before): even once export correctly emitted `![alt](src)` and `$source$`/`$$\nsource\n$$`, the parser didn't recognize them. `markdownInline` had no case for remark's `image` AST node type. Formula syntax is worse: remark's core parser (no math plugin) never tokenizes `$...$` as anything but literal text, so `$x^2$` survived parsing as an inert text run containing literal dollar signs, not a formula node.

A working, unused reference implementation for the export side already existed: `packages/core/src/foundation/atom/formats.ts`'s `atomToMarkdown` (part of the dormant per-feature semantic layer found during SS2.2 - see `docs/bugs/` history around that phase) already produced correct `![alt](src)` / `$source$` / `$$\nsource\n$$` output, but was never wired into the production serializer.

## Fix

- `list/formats.ts`: `markdownInlineText` now calls `atomToMarkdown` for inline `image`/`formula` children instead of returning `""`. `markdownBlock` now has an explicit case for `block_image`/`block_formula`/`video`/`audio` calling `atomToMarkdown` directly, ahead of the generic fallback.
- `markdownInline` (parse direction) gained a case for remark's `image` node type, constructing a canonical `image` node.
- Formula parsing: added `splitInlineFormulas`, a post-parse regex pass over plain (mark-free) text nodes that extracts `$$\n...\n$$` (block) and `$...$` (inline) regions into `formula` nodes, since no AST-level recognition is available without adding a math-parsing dependency. Block math is matched before inline math so a `$$...$$` region isn't misread as three separate single-`$` matches.
- Video/audio remain unsupported as atoms on re-import (they degrade to a plain `[video: url](url)` link, matching `atomToMarkdown`'s own designed behavior for them) - the URL and readability survive, the atom type does not. This was already the intended fallback for those two types; only image and formula were actually broken (silently deleted, not degraded).

## Regression coverage

`packages/core/src/foundation/list/formats.test.ts`: "round-trips inline images, block images, and formulas through Markdown instead of silently dropping them" - exercises inline image, inline formula, block image, and block formula together, asserting both the exported Markdown syntax and that re-parsing recovers real `image`/`formula` nodes (not text, not nothing).

## Related/similar issues

- The Phase 9 SS2.2 fidelity-table audit (`docs/bugs/list-item-inline-content-double-processed-as-block.md` is a sibling finding from the same general audit pass, a different bug in the same file) - this project's `formatFidelity.ts`/`fidelity.ts` contract had multiple claims that were never actually fixture-verified before this phase; treat any un-flagged cell there as unverified until it's been through this same kind of direct testing.
- If a future report says "pasting/exporting a formula or image to Markdown loses it," check this fix is still present (`atomToMarkdown` wired into both `markdownInlineText` and `markdownBlock`, and `splitInlineFormulas` present in `markdownInline`) before re-investigating from scratch.
