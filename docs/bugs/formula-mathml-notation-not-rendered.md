# Formula `attrs.notation: "mathml"` is validated and round-tripped, but the renderer always renders as LaTeX

**Status:** Open
**Area:** atom / surface renderer / formula
**First reported:** 2026-08-25, found during pre-Phase-12b punch-list item 3's proactive "check for other atom attrs with the same gap" pass (following the `atom.attrs.error` fix), not by direct user report.
**Related files:** `packages/core/src/foundation/atom/schema.ts:13-17` (`formulaAttrs.notation`, required, `"latex" | "mathml"`), `packages/core/src/foundation/atom/declarations.ts:11` (`formulaValid` accepts both), `packages/core/src/foundation/atom/formats.ts:16,36` (HTML codec round-trips `data-smart-notation` faithfully both directions), `packages/core/src/foundation/surface/renderer.ts:28-33` (`renderFormulaInto`, ignores `notation` entirely), `packages/react/src/components/CanonicalAuthorityEditor.tsx:792` (toolbar's only formula-insert path hardcodes `notation: "latex"`)

## Symptom

A formula atom's `notation` attribute is real, required, schema-validated (`"latex"` or `"mathml"`), and faithfully round-tripped through the HTML import/export codec (`data-smart-notation="mathml"`) - but the canonical renderer's `renderFormulaInto` (`surface/renderer.ts:28-33`) unconditionally calls `katex.render(source, element, KATEX_OPTIONS)`, which only understands LaTeX input. A formula with `notation: "mathml"` has its MathML markup fed to KaTeX's LaTeX parser, which will either throw (caught by the existing try/catch, falling back to `element.textContent = source` - raw MathML tags shown as visible plain text) or, in some cases, parse nonsensically as pseudo-LaTeX. Either way, a MathML-notation formula never renders as actual math.

Same class of gap as `docs/bugs/atom-upload-error-reason-not-rendered.md` (a schema attribute with a real writer/round-trip path and no renderer consumer) - found by extending that fix's "check for other instances" recommendation to the sibling `notation` field rather than incidentally.

## Reproduction

Not reachable via the current product UI: the toolbar's only formula-insert path (`CanonicalAuthorityEditor.tsx:792`, `insertInlineFormula`) hardcodes `notation: "latex"` unconditionally - there's no UI control to choose MathML. Reachable via: (1) a host calling `insertAtom("formula", { source, notation: "mathml" }, ...)` directly through the programmatic command API, or (2) importing HTML authored elsewhere that already contains `<... data-smart-notation="mathml" data-smart-formula="<mathml markup>">` (the import codec, `atom/formats.ts:36`, accepts and preserves it without validating that the renderer can actually display it).

Not manually reproduced end-to-end in a browser in this pass (found via source inspection, matching the "static gap, no live repro needed" methodology already established for the `columnWidths`/`textColor`/`attrs.error` instances of this pattern) - direct source citations above are sufficient to establish it, per those prior entries' own precedent.

## Root cause

The formula schema was built anticipating two notations (the schema, validation, and HTML codec all treat `"latex"`/`"mathml"` symmetrically), but only a LaTeX rendering path was ever implemented (KaTeX has no MathML-input mode) - the same "two ends of a pipe built in different work items, nothing connecting them" shape as the other instances of this pattern, compounded here by the fact that no UI path currently exercises the unimplemented side, so nothing has ever surfaced it as a visible failure.

## Fix

Not attempted in this pass - found via a proactive check, out of scope for the punch-list item that prompted the search. A correct fix has two reasonable shapes: (a) implement real MathML rendering when `notation === "mathml"` (e.g. injecting the MathML markup directly as `innerHTML` via a sanitized/allowlisted path, since MathML is renderable natively by browsers without KaTeX), or (b) if MathML support isn't actually intended yet, tighten `declarations.ts`'s `formulaValid` to reject `notation: "mathml"` at the command layer (and decide whether the HTML import codec should also reject/convert it) so the schema stops promising a capability nothing implements - either resolves the "written but never correctly consumed" gap, just in different directions (build the missing half vs. stop offering it).

## Regression coverage

None yet - not fixed. A future fix should add a renderer test for a `notation: "mathml"` formula node asserting it does not fall through to plain-text/garbled output (if (a) is chosen), or a `declarations.test.ts` test asserting `formulaValid` now rejects `mathml` (if (b) is chosen).

## Related/similar issues

- [atom-upload-error-reason-not-rendered](atom-upload-error-reason-not-rendered.md) - the fix that prompted this search; same "written, never rendered" shape, different attribute.
- [table-column-width-not-rendered](table-column-width-not-rendered.md), [table-cell-text-color-not-rendered](table-cell-text-color-not-rendered.md) - the first two confirmed instances of this recurring pattern.
- Narrower real-world reach than the other three instances (no current UI path reaches it, only API/import), which is why this is filed as a new, separate entry rather than folded into the `attrs.error` one - the severity and fix shape are both genuinely different.
