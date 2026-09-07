# Horizontal line + page break tools

**Status:** Fixed / Implemented
**Area:** core (`atom/`, `list/formats.ts`, `formats/docx/export.ts`, `formats/fidelity.ts`) and react (`toolbarTools.ts`, `CanonicalAuthorityEditor.tsx`, `ToolbarPrimitives.tsx`, `theme.ts`)
**First reported:** "Codex prompt — horizontal line + page break tools (corrected scope)" (2026-09-07), superseding an earlier prompt's item 1 (which had misread the request as exposing `hard_break`/Shift+Enter as a toolbar button - the owner meant straight-line dividers).
**Related files:** [html-import-div-atom-markers-treated-as-transparent-wrapper](html-import-div-atom-markers-treated-as-transparent-wrapper.md) (a real, independent bug found and fixed while verifying this feature's own HTML fidelity), [pasted-web-images-and-hr-render-as-unsupported](pasted-web-images-and-hr-render-as-unsupported.md) (the fix that originally added the `divider` node type), [formula-resize-controls-shown-for-non-resizable-atom](formula-resize-controls-shown-for-non-resizable-atom.md) (the precedent for gating media-only UI off a non-media atom).

## Item 1: Horizontal line - mostly exposing existing capability, with one real gap

**Investigated first, as instructed.** `divider` (`{ type: "divider", group: "block", atomic: true, selectable: true, marks: "" }`, `atom/schema.ts:61`) already existed, added 2026-08-26 specifically for pasted `<hr>` handling.

- **Schema/render/round-trip: confirmed working.** Renders as a real `<hr>` (`surface/renderer.ts`'s `tagForNode`), round-trips through HTML export/import (`atom/formats.ts`'s `atomToHtml`/`atomFromHtmlElement`, `list/formats.ts`'s `parseBlock`'s `tag === "hr"` case) - verified via `list/formats.test.ts`'s existing `<hr>` round-trip test, still green.
- **Insertion paths: paste was the only one.** No `AtomDeclaration` existed for `"divider"` in `atom/declarations.ts` - `insertAtom` (the generic command every other atom, image/video/audio/formula, goes through) had no way to construct a divider at all. This is real, if small, new work, not merely wiring up a UI button to an already-complete command.
- **A genuine, separate gap found and fixed along the way:** `divider` had **no DOCX representation whatsoever** - `formats/docx/export.ts`'s `blockXml` had no case for it, so it fell to the generic fallback (`paragraphXml([{ type: "text", text: String(block.attrs?.title || block.attrs?.src || "") }], ...)`), which for a divider (no `title`/`src`) produced a **silent empty paragraph** - a horizontal line completely disappeared on DOCX export with no visible trace. Fixed: `blockXml` now emits a bottom-bordered empty paragraph (`<w:pBdr><w:bottom .../></w:pBdr>`), exactly what Word's own Insert > Horizontal Line command produces.

**Built:** Added `{ type: "divider", kind: "divider", group: "block", validate: () => true }` to `atomDeclarations`, widened `CanonicalAuthorityEditor.tsx`'s `insertBlockAtom`'s type union, and added a "Horizontal line" toolbar tool (`t.horizontalLine`) in the "More to insert" dropdown plus its wide-viewport-promoted standalone copy - reusing `insertBlockAtom`/`insertAtom`, the exact same atom-insertion pattern image/video/audio already use, not new insertion logic.

## Item 2: Page break - genuinely new capability

### Design decision

A **new, distinct atomic node type**, `page_break` (`atom/schema.ts`), never overloading `divider` - same architectural shape (atomic, selectable, no attrs), but a conceptually different thing: a horizontal line is decorative content; a page break's entire meaning is what happens at export/print time. In the live editor it renders as a dashed line with an explicit "Page break" label (`theme.ts`, targeting `[data-smart-type="page_break"]`), never visually confusable with a plain `<hr>`.

**A load-bearing implementation fact, confirmed by reading the real code before designing around it:** this package's actual "Save as PDF" (`react/src/adapters/pdfPrint.ts`'s `printSmartDocumentAsPdf`) is **a real browser print of the same HTML export** (`formats/pdf/format.ts`'s `buildPdfPrintDocument` calls `serializeCanonicalListHtml`, i.e. `atomToHtml`) - not a separate PDF-generation library. This means the HTML marker and the PDF pagination are **the same mechanism**, not two things to build separately.

### Format round-trip fidelity, declared explicitly (new `"page-break"` row in `formats/fidelity.ts`)

| Format | Level | Why |
|---|---|---|
| HTML | **full** | `atomToHtml` emits a marker `<div>` with both `break-before: page` and `page-break-before: always` (current + legacy CSS Fragmentation properties). Round-trips exactly through `parseCanonicalListHtml`/`serializeCanonicalListHtml`. |
| PDF | **full** | Inherits the HTML row's real pagination exactly, since "Save as PDF" *is* a print of that HTML - **verified end to end**, not assumed: a real Chromium PDF (`page.pdf()`) generated from the actual popup window, before and after inserting a page break, shows 1 page vs. 2 pages, counted from the PDF's own internal `/Type /Page` objects (e2e test, see below). The separate `atomToPdf(node)` per-node function is **not** the real mechanism - it only backs this fidelity table's own test suite (see its own doc comment) - stated explicitly so this doesn't become a "written but never actually reached by the real feature" gap. |
| DOCX | **lossy** | A real native Word page break (`<w:br w:type="page"/>`) is emitted - Word itself paginates correctly when opened. Confirmed **empirically** (not assumed) that mammoth's HTML conversion (this package's own DOCX import path) drops it entirely on re-import, with zero trace - export fidelity is real, import fidelity is not. |
| Markdown | **unsupported** | Markdown has no pagination concept at all. Exports as an inert `<!-- page break -->` HTML comment (matching this project's own established "don't silently delete an atom with no trace" discipline - see the images/formulas markdown-export history in `formats/fidelity.ts`) - but nothing parses that comment back into a node on import, so this is genuinely `unsupported`, not merely undeclared. |

### Implementation

- **Schema**: `atom/schema.ts` - new `page_break` node spec, distinct from `divider`.
- **Declaration**: `atom/declarations.ts` - `{ type: "page_break", kind: "pageBreak", group: "block", validate: () => true }`.
- **Command**: reuses `insertBlockAtom`/`insertAtom` (same pattern as item 1 and every other atom).
- **Renderer**: no special case needed - the generic atomic-node dispatch (`surface/renderer.ts`'s `atomTypes` set, now including `"page_break"`) handles it; its default tag (`div`) plus `theme.ts`'s new CSS gives it the dashed/labeled appearance. `mediaAtomSelected`/context-menu gating (`CanonicalAuthorityEditor.tsx`) extended to exclude `page_break` the same way `divider` was already excluded (no media-editing UI for either).
- **HTML/Markdown/DOCX/PDF**: `atom/formats.ts`'s `atomToHtml`/`atomFromHtmlElement`/`atomToMarkdown`/`atomToDocx`/`atomToPdf`, `list/formats.ts`'s `parseBlock` (`declaredAtom === "page_break"`) and its two whole-document dispatch arrays, `formats/docx/export.ts`'s `blockXml`.
- **Toolbar**: "Page break" placed immediately next to "Horizontal line" in the "More to insert" group (both dropdown item and wide-viewport-promoted standalone copy) - the two tools are conceptually paired (both are line-insertion tools), so keeping them adjacent matches how every other related pair in this toolbar (Insert formula/Special characters, Save-as-* variants) is grouped.
- **`tools` prop**: new `horizontalLine`/`pageBreak` keys in `toolbarTools.ts`, both defaulting to visible - automatically covered by the existing exhaustive `DEFAULT_TOOLBAR_TOOLS` completeness test (`CanonicalAuthorityEditor.toolbarTools.test.tsx`), which would have failed had either key not been wired to a real toolbar effect.

## Verification

- **Core**: 743/743 (was 739 before this session's work; net +4 from the div-transparent-container fix's own test plus this feature's HTML/Markdown/DOCX round-trip tests and the two fidelity-table completeness tests).
- **React unit**: 151/151 (unchanged count - no new unit tests needed beyond the exhaustive toolbar-tools completeness test, which already covers the two new keys automatically).
- **React e2e**: full suite run; new tests added to `canonical-authority.spec.ts`:
  - "inserts a horizontal line via the toolbar, using the same atom-insertion pattern as image/video/audio"
  - "inserts a page break via the toolbar, rendered distinctly from a horizontal line and never surfacing media UI" (asserts real computed CSS - dashed border, "Page break" label content - not just node presence)
  - "deletes a horizontal line and a page break via the toolbar's delete-selected-atom action"
  - **"a page break produces a real second page in the actual 'Save as PDF' output, not just a visual marker"** (Chromium-only, `page.pdf()`) - generates a real PDF from the actual popup window before and after inserting a page break, counts real `/Type /Page` objects in the PDF bytes, asserts page count increases by exactly one. This is the test that actually closes out the fidelity table's PDF "full" claim above with evidence, not assumption.
  - `formats/docx/format.test.ts` (core): new test exporting both a divider and a page break, asserting the real DOCX XML constructs exist, then re-importing via mammoth and confirming neither survives - matching the declared DOCX fidelity honestly in both directions.

## Related/similar issues

[html-import-div-atom-markers-treated-as-transparent-wrapper](html-import-div-atom-markers-treated-as-transparent-wrapper.md) (found and fixed while verifying this feature's own claimed HTML fidelity - without it, `page_break` would have silently failed its own round-trip test the same way `block_formula` already silently did, undetected, before this session).
