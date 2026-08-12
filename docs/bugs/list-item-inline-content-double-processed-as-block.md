# `parseCanonicalListHtml` duplicates `<li>` content when the item's direct content is a bare inline element (not wrapped in `<p>`)

**Status:** Fixed
**Area:** list / HTML import (canonical parser, product-wide — not specific to any one import path)
**First reported:** 2026-08-13, discovered incidentally while porting DOCX import to canonical types for Phase 9 §2.1

## Symptom

Parsing `<li>` content produced duplicate nodes when the item's direct children included a bare inline element (e.g. `<a href="...">text</a>`, `<span>`, `<b>`) not wrapped in a block tag like `<p>`. The inline content was correctly extracted into a synthetic paragraph, **and** separately re-processed as if it were a block-level child, producing a second `unknown` node wrapping the same raw HTML. Real-world impact confirmed against a captured Word/macOS clipboard fixture already in this repo's corpus (`word-macos-clipboard.clipboard.json`): parsing it produced **19 spurious duplicate `unknown` nodes** (mostly bold `<span>`/`<b>` runs) before the fix, zero after — meaning real paste-from-Word content has been silently duplicating formatted text in the canonical model since at least whenever this fixture was captured.

## Reproduction

```ts
import { parseCanonicalListHtml } from "packages/core/src/foundation/list/formats.ts";
parseCanonicalListHtml('<ol><li><a href="https://example.com/docs">Linked item</a></li></ol>');
```
Produces a `list_item` with **two** children: a correct `paragraph` (containing "Linked item" with a `link` mark) and a spurious `unknown` node wrapping `<a href="...">Linked item</a>` as raw HTML.

Also reproduced against the real captured fixture: `pnpm --filter smartrte-core exec vitest run src/foundation/clipboard/corpus.test.ts` — `word-macos-clipboard.clipboard.json`'s expected structural hash changed from `c4346141` to `18c70f20` once fixed (confirmed via before/after diff: 19 `unknown` nodes with `originalType` of `span`/`b` before, 0 after).

## Root cause

`packages/core/src/foundation/list/formats.ts`, `parseBlock`'s `<li>` handling (~line 378-396). Two passes over the item's children ran independently and overlapped:
1. `inlineNodes` (children NOT in `blockTags`) → extracted via `textWithMarks` into a synthetic `paragraph`. Correct, and this is what makes bare inline `<li>` content work at all.
2. `elementChildren(node).forEach(...)` → iterated **all** element children (no `blockTags` filter) and called `parseBlock` on each, to pick up genuine block children (nested `<ul>`/`<ol>`/`<p>` etc).

Any inline element (like `<a>`) satisfies neither exclusion, so it was consumed by both passes: once correctly (as inline content) and once incorrectly (as an unrecognized "block", falling into the `unknown`-node fallback with the raw HTML preserved).

This path is used by every consumer of `parseCanonicalListHtml`, including real HTML import, paste (`parseClipboardPayload`), and now the canonical-native DOCX importer built in Phase 9 §2.1 — it is not specific to any one format.

## Fix

`packages/core/src/foundation/list/formats.ts`: the second pass now filters to `blockTags` before calling `parseBlock`, so it only processes genuine block children, not the same inline nodes already consumed by the first pass.

## Regression coverage

- `packages/core/src/foundation/formats/docx/format.test.ts` ("round-trips native lists and hyperlinks through the DOCX importer") exercises this exact shape (an `<a>` as the direct content of an `<li>`) and would fail without the fix.
- `packages/core/src/foundation/clipboard/corpus.test.ts`'s golden-hash assertion for `word-macos-clipboard.clipboard.json` now pins the corrected (duplicate-free) structure; a regression would change the hash again.
- No dedicated unit test was added directly in `list/formats.test.ts` for the isolated case — worth adding if this file is touched again.

## Related/similar issues

- None known yet in this family. Flag here if a future "pasted/imported content has duplicated bold/linked text" report comes in — check this fix is still present before re-investigating from scratch.
