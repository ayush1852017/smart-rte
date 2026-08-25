# HTML paste: span-wrapped inline content and div-wrapped blocks routed to `[Unsupported: ...]` instead of parsed

**Status:** Fixed
**Area:** clipboard / HTML import / list/formats.ts parser
**First reported:** 2026-08-19, real Sootr export pasted into `?canonicalAuthority=1` (post-Phase-11.5 manual testing), attached as `test-html-sootr.html`.
**Related files:** `docs/PHASE_11_5_COMPLETION_REPORT.md` (the phase this bug was found testing against).

## Symptom

Pasting a real Sootr HTML export produced multiple `[Unsupported: span]` placeholder lines inside a `<blockquote>` instead of the actual quoted text.

## Reproduction

Pasted `packages/react/e2e/fixtures/test-html-sootr.html` (kept permanently — real production content, also the real-document fixture Tier 3's performance-validation gate had been blocked on) into `?canonicalAuthority=1`. The blockquote's content is bare `<span style="...">` runs with no wrapping `<p>` (a common shape from rich-text editors that don't paragraph-wrap quote content). Separately, the fixture's `<table>` is wrapped in nested `<div>`s (`<div align="left"><div data-table-wrapper="true"><table>...`).

## Root cause

**Two related but distinct gaps in `packages/core/src/foundation/list/formats.ts`'s `parseBlock`, both routing recognizable content into the generic "unrecognized tag" fallback (`{type: "unknown", attrs: {originalType: tag, ...}}`, rendered by the surface renderer as `"[Unsupported: <tag>]"`):**

1. **Blockquote had no "direct inline content" fallback.** `td`/`li` already special-case this (a `directInline`/`directText` array built via `textWithMarks`, wrapped in a synthetic paragraph) for exactly this shape — bare inline content sitting directly inside a block container with no wrapping `<p>`. Blockquote's parsing only ever called `elementChildren(node).flatMap(parseBlock)`, so every `<span>` child (not a recognized block tag) hit `parseBlock`'s bottom-of-function fallback and became one `unknown` node per span.
2. **`<div>`/`<section>`/`<article>` wrapping is not a case `parseBlock` (or `textWithMarks`) has ever handled**, at any call site (root document parsing, blockquote, and `li`'s block-child path, which already listed "div"/"figure" in its `blockTags` allowlist without that claim actually being honored by `parseBlock`). A `<div>` wrapping a `<table>` — extremely common in real-world exports (Word, Google Docs, ChatGPT, Sootr all wrap tables in layout/wrapper divs) — became one opaque `unknown` block, losing the entire table's structure, not just formatting.

**Content-loss-vs-formatting-degradation, stated explicitly (per the standing instruction to distinguish these):** the original HTML text was **not permanently lost** — it survived verbatim in the `unknown` node's `attrs.raw.html`, which `serializeBlock`'s own `unknown` branch (`list/formats.ts` "unknown" case) re-emits on export, so a paste→export round trip would recover the exact source markup. But the text was **completely unreadable in the live editor** (replaced by the placeholder string) and, for the div-wrapped table specifically, the table's *structure* (rows/columns as editable cells) was lost outright, not merely its formatting — a user could not read what they pasted, edit table cells, or do anything with that content without going through export. This is a real, severe practical defect even though it is not silent, permanent data loss.

**A third, related gap found investigating the same fixture** (not itself part of the `[Unsupported: ...]` symptom, but the same class — style-only formatting silently dropped rather than surfaced as a mark): `textWithMarks` (the inline parser) only read `color`/`background-color`/`font-size`/`font-family` off an element's `style` attribute. `font-weight: bold`/`bolder`, `font-style: italic`, and `text-decoration: underline`/`line-through` were not recognized at all — a `<span style="font-weight: bolder">` (no `<strong>` tag) silently became plain unmarked text. This is not blockquote-specific: it demonstrably affects (a) this repo's own DOCX import (`formats/docx/styledImport.ts`'s `runStyle` already *emits* `font-weight:700`/`font-style:italic`/`text-decoration:underline` for `<w:b>`/`<w:i>`/`<w:u>` runs, on the unverified assumption this would parse back into marks — it didn't) and (b) real captured clipboard corpus fixtures (`google-docs-clipboard.clipboard.json` has one genuine `font-weight:700` run among many `font-weight:400` ones; `native-smart-rte-clipboard.clipboard.json`, a real browser-DOM copy of this product's own output, has 13 `font-weight: bold` style runs) — both were silently downgrading real bold text to plain text before this fix.

## Fix

`packages/core/src/foundation/list/formats.ts`:
- New `TRANSPARENT_CONTAINER_TAGS = ["div", "section", "article"]` and `parseBlockList(nodes)` — recurses into a transparent container's own children (flattened, not wrapped) instead of handing it to `parseBlock` directly. Used at root document parsing, blockquote's block-child extraction, `li`'s block-child extraction (making its pre-existing but non-functional "div"/"figure" `blockTags` entries actually work), and `td`'s block-child extraction (extended to recognize transparent containers the same way, for consistency — not evidenced by this specific fixture, but the same gap class).
- Blockquote's parsing gained the same `directInline`/synthetic-paragraph fallback `td`/`li` already had, now also treating `TRANSPARENT_CONTAINER_TAGS` as block-like (routed to `parseBlockList`, not `textWithMarks`) so a div-wrapped table inside a blockquote also parses correctly.
- `textWithMarks` gained `font-weight` (→ bold, for `"bold"`/`"bolder"`/numeric `>=700`), `font-style` (→ italic, for `"italic"`/`"oblique"`), and `text-decoration` (→ underline/strike) style-attribute recognition, guarded against duplicating a mark already present from a tag match.

## Regression coverage

- `packages/core/src/foundation/list/formats.test.ts` — "parses span-wrapped blockquote content and div-wrapped tables instead of falling back to unknown nodes" (minimal, self-contained reproduction: span-wrapped bold blockquote text + div-wrapped table).
- `packages/react/e2e/canonical-authority.spec.ts` — "pastes a real Sootr export without losing the blockquote or the div-wrapped table" (the full real fixture, all 3 browsers): asserts no `"Unsupported"` text anywhere, the blockquote's full text matches the source exactly (including previously-split text runs), the bold mark on "What you have to learn:" survived, the table has all 8 real rows, and the model has zero `unknown` nodes / 4 `image` atoms.
- `packages/core/src/foundation/clipboard/corpus.test.ts` — 2 pre-existing locked structural-hash tests (`google-docs-clipboard.clipboard.json`, `native-smart-rte-clipboard.clipboard.json`) changed hash as a direct, verified consequence (inspected each fixture's raw HTML directly to confirm real `font-weight:700`/`font-weight: bold` runs, not an assumption from the diff alone) — updated with an explanatory comment, not silently accepted.

## Related/similar issues

None prior in the ledger for HTML-import block/inline routing specifically. The general "real code exists but doesn't handle a real-world shape" pattern recurs across this project (see `docs/bugs/table-column-width-not-rendered.md` for the same "worked in theory, never actually reached by real content" shape in a different subsystem).
