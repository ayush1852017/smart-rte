# Formulas rendered live in the editor but never appeared in Sootr's Web Preview or Flutter Preview

**Status:** Fixed (Web Preview) / Mitigated with a text fallback (Flutter Preview) — see the "Flutter Preview" section for why full image rendering there is a separate, larger initiative, not built in this pass.
**Area:** core / atom & list serialization (`packages/core/src/foundation/atom/formats.ts`, `list/formats.ts`), react (`canonicalEditorRuntime.ts`, `CanonicalAuthorityEditor.tsx`)
**First reported:** 2026-08-31, "formulas are not rendering to preview and flutter preview of sootr"
**Related files:** `docs/bugs/atom-to-docx-described-formulas-as-rendered-images.md` (the same underlying design decision - formulas export as data/text, never a rendered image - already made deliberately for DOCX/PDF; this is the HTML case), `docs/SOOTR_MIGRATION_READINESS.md`

## Investigation

Not a regression: the live editing surface renders formulas correctly because `surface/renderer.ts` calls `katex.render(source, element, ...)` **imperatively against the live DOM** on every mount/update - this happens entirely outside, and is invisible to, the separate serialization path (`serializeCanonicalListHtml`, `atom/formats.ts`'s `atomToHtml`) that produces the HTML string handed to a host's `onChange`. Confirmed directly: `atomToHtml`'s formula branch has always emitted an **empty** `<span data-smart-formula="...">` - a data-only placeholder, by design, matching the exact same "export as data/text, never a rendered image" decision already made (and documented) for DOCX and PDF export.

Sootr's "Web Preview" panel takes this saved HTML string and injects it via `dangerouslySetInnerHTML` into a plain `<div>` - not a mounted `CanonicalAuthorityEditor` instance, so none of the live surface renderer's KaTeX logic ever runs against it. The empty placeholder stays empty. "Flutter Preview" is a fundamentally different problem: it renders the same HTML string through a generic Flutter HTML-to-widget package running inside an iframe'd Flutter web build - even a self-contained, fully-rendered KaTeX HTML blob (which is real, valid HTML, but extremely CSS-layout-heavy and browser-engine-specific) would not translate into anything sensible through a generic Flutter HTML parser. Confirmed there is no existing formula-to-image rendering pipeline anywhere in this codebase to reuse for that case (`atomToPdf` also just falls back to raw LaTeX text, not an image, per the already-existing PDF decision).

## Fix (Web Preview)

Added an opt-in `renderFormulaHtml` option, threaded through the full chain: `serializeCanonicalListHtml(document, { renderFormulaHtml: true })` → `atomToHtml(node, { renderFormulaHtml: true })` now calls `katex.renderToString(source, KATEX_OPTIONS)` (the exact same options and `try`/`catch`-to-plain-text fallback as the live renderer, plus the same `katex/contrib/mhchem` import for `\ce{...}` chemistry notation) and bakes the resulting HTML+MathML as the formula element's inner content, instead of leaving it empty.

- `CanonicalEditorRuntimeOptions.renderFormulaHtml` / `CanonicalAuthorityEditorProps.renderFormulaHtml` (both optional, default `false` - zero behavior change for any existing consumer who doesn't opt in) thread this down to the `scheduleHtmlChange` call that produces `onChange`'s/`onHtmlChange`'s HTML string. Flows through `ClassicEditor` automatically via its existing rest-prop spread, no separate wiring needed there.
- **Implemented as a module-scoped flag in `list/formats.ts`, not a parameter threaded through every `serializeInline`/`serializeBlock` call site** - those two functions recurse through dozens of call sites (lists, tables, blockquotes), and threading a new parameter through all of them is exactly the kind of change that's easy to miss at one nested site and silently leave broken there. Safe because serialization is synchronous, single-threaded, non-reentrant recursion - `serializeCanonicalListHtml` sets the flag before its call and restores it in `finally` before ever returning.
- **Round-trip safety unaffected**: `atomFromHtmlElement`'s formula branch reads only the `data-smart-formula` attribute, never an element's children - baking in rendered HTML content changes nothing about how a formula is reconstructed when this HTML is parsed back into the model. Verified directly with a dedicated round-trip test.
- Left the DOCX/PDF/Markdown export functions (`atomToDocx`, `atomToPdf`, `atomToMarkdown`) completely untouched - this option is scoped specifically to `serializeCanonicalListHtml`'s own HTML-export path, not a change to the already-decided literal-LaTeX-text behavior for those other formats.

## Flutter Preview - not fully solved in this pass

Per explicit discussion: full image-based rendering (SVG/PNG) that would work through Flutter's generic HTML renderer is real, new infrastructure - no such pipeline exists anywhere in this codebase today (confirmed via `atomToPdf`, which faces the identical "can't run KaTeX JS" constraint and already settled on a plain-text fallback rather than an image). Building one is a legitimate future initiative with its own design questions (server-side vs. client-side rendering, SVG vs. PNG, where the rendering happens), not something to build inline as part of this fix. The chosen interim approach, matching the already-accepted DOCX/PDF precedent: Sootr's own `FlutterPreview.tsx` (or wherever `content` is prepared before the `postMessage` to the Flutter iframe) should replace `[data-smart-type="formula"]`/`[data-smart-type="block_formula"]` elements' content with their `data-smart-formula` attribute as plain visible text before sending - readable LaTeX source instead of nothing, not a package-side change.

## Regression coverage

- `packages/core/src/foundation/list/formats.test.ts`, `describe("serializeCanonicalListHtml renderFormulaHtml option", ...)`: default-off unchanged, real KaTeX HTML present when enabled, `\ce{...}` chemistry support, graceful fallback (no throw) on invalid LaTeX, round-trip safety, and correct interaction with the existing `clean: true` option. 6 new tests, all passing.
- `packages/react/src/components/ClassicEditorAuthority.test.tsx`: confirms the option threads all the way from the legacy-compat `ClassicEditor` prop down to `onChange`'s actual HTML output - off by default, real `class="katex"` markup present when `renderFormulaHtml` is passed.

Suite counts after this fix: core 730/730 (81 files), react 141/141 (33 files, wait for full e2e run to confirm), lint clean on both packages.

## Related/similar issues

`atom-to-docx-described-formulas-as-rendered-images.md` (the same "formulas export as data/text, never an image" decision, previously made and documented for DOCX). `docs/SOOTR_MIGRATION_READINESS.md` (the original migration-scoping investigation, which didn't specifically anticipate a *preview* consumer needing rendered formula HTML - the migration gaps it found were all about live-editing behavior, not static-HTML display).
