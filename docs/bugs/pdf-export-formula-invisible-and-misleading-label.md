# PDF export: formulas render invisible, and "Save as PDF" misleadingly implies a direct download

**Status:** Fixed (formula rendering) / Addressed via relabeling, not mechanism change (download expectation - explicit user decision)
**Area:** core (`formats/pdf/format.ts`), react (`components/CanonicalAuthorityEditor.tsx`)
**First reported:** 2026-09-07, "In PDF formula not rendering." and "Save as PDF should download as PDF but it opens in new page."

## Issue 1: formulas invisible in PDF export

### Root cause

`buildPdfPrintDocument` (`formats/pdf/format.ts:189`, the function behind this package's real "Save as PDF" - see its own doc comment: it's a genuine browser print of an HTML document, not a separate PDF-generation library) called `serializeCanonicalListHtml(document, { clean: true })` **without** `renderFormulaHtml: true`. This is the exact same gap already found and fixed once for Sootr's Web Preview ([formula-not-rendered-in-static-html-consumers](formula-not-rendered-in-static-html-consumers.md)) - `atomToHtml`'s formula branch only bakes real KaTeX HTML when explicitly asked to; without it, a formula serializes as an empty, invisible `<span data-smart-formula="...">`. That earlier fix was applied to Sootr's own preview code and to the option's default-off plumbing, but never propagated to this **second** static-HTML consumer inside the package itself.

A second, deeper gap surfaced once the first was fixed: this print window is a brand-new, isolated document (`window.open` + `document.write`, `react/src/adapters/pdfPrint.ts`) that shares **none** of the host page's stylesheets - even with real KaTeX HTML baked in, it rendered as unstyled character soup, because nothing had ever loaded KaTeX's own CSS into this document. Confirmed directly with a live font-family check (`getComputedStyle(...).fontFamily` resolved to the page's plain body font, not `KaTeX_Main`).

### Fix

- `serializeCanonicalListHtml(document, { clean: true, renderFormulaHtml: true })`.
- Added a `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.18.4/dist/katex.min.css">` to the print document's `<head>`, pinned to the exact version this package bundles (`package.json`'s `katex` dependency) so the JS that generates the markup and the CSS that styles it never drift apart. Matches this package's own documented KaTeX setup convention (README's CDN `<link>` example) rather than inventing a second one. Requires network access at export time - the same requirement the live editor already has for its own KaTeX CSS.

### Regression coverage

New e2e test in `canonical-authority.spec.ts`, "a formula renders as real, visually laid-out math in the actual 'Save as PDF' output, not an empty or unstyled placeholder": inserts a real formula, triggers the actual "Save as PDF" flow, and asserts on the **real popup window's computed styles** - `getComputedStyle(.katex).fontFamily` contains `KaTeX_Main` (the one property in KaTeX's CSS most directly diagnostic of "did the stylesheet actually load and apply" - an unstyled span would resolve to the page's plain font instead), and `.katex-mathml`'s `clip-path` is applied (KaTeX's CSS-only accessibility-hiding rule for its MathML twin - without the CSS it would render fully visible, duplicating the equation). Required a `toPass()` retry wrapper: the popup's own `load` event does not reliably block on the external CDN stylesheet finishing and applying before resolving, confirmed directly (the same assertion immediately after `waitForLoadState()` alone was flaky).

## Issue 2: "Save as PDF" implies a direct download, but opens a print window

### Investigation

Every other "Save a copy" entry (HTML, Markdown, Word, Smart RTE file) triggers a real, direct file download. "Save as PDF" (`react/src/adapters/pdfPrint.ts`'s `printSmartDocumentAsPdf`) opens a new window and calls the browser's own `window.print()`, where the user must choose "Save as PDF" as the print destination themselves - a fundamentally different mechanism from its sibling menu items, with no signal in the UI that it works differently.

**This is not a code defect - it's the only mechanism available.** Browsers have no built-in API for a web page to generate a real PDF file and trigger a direct download of it; doing so would require bundling a full client-side PDF-generation/layout library (real, sizeable new work: laying out tables, images, formulas, and pagination into an actual PDF byte stream is a different problem than printing HTML). Presented this tradeoff to the user directly; **explicit decision: keep the print-dialog mechanism, fix the misleading label instead.**

### Fix

Renamed the toolbar entry from "Save as PDF" to **"Print / Save as PDF"** (`CanonicalAuthorityEditor.tsx`'s `saveCopyMenuItems`) - sets the correct expectation for the mechanism that actually exists, rather than implying a one-click download it doesn't do. The `tools.saveAsPdf` prop key and `runPdfExport` function are unchanged - this is a label-only change.

### Regression coverage

Updated every existing e2e test that clicks this menu item by its accessible name (`canonical-authority.spec.ts` x2, `canonical-toolbar-routing.spec.ts` x1) to the new label - all still pass.

## Verification

Core 743/743 (unchanged - `buildPdfPrintDocument`'s own behavior isn't covered by a core-level formula-rendering assertion, since KaTeX CSS loading is a real-browser concern; covered instead at the e2e level). React unit 151/151 (unchanged). Full e2e suite unaffected beyond the label-rename updates and the two new/adjusted PDF tests, both passing reliably across repeated runs.

## Related/similar issues

[formula-not-rendered-in-static-html-consumers](formula-not-rendered-in-static-html-consumers.md) (the first instance of this exact "static HTML consumer needs `renderFormulaHtml`" gap - this is the second, previously-missed consumer of the same gap class). [horizontal-line-and-page-break-tools](horizontal-line-and-page-break-tools.md) (added the real, page.pdf()-based PDF verification pattern this fix's own test reuses).
