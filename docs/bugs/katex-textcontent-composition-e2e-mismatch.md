# Composition e2e test asserted formula-atom textContent equal to raw LaTeX source

**Status:** Fixed
**Area:** atom / renderer / e2e test
**First reported:** 2026-08-13 — self-discovered during Phase 9 §2.4 (live KaTeX rendering) verification, never reached `master`
**Related files:** none prior

## Symptom

After wiring real KaTeX rendering into `foundationSubtreeRenderer.syncNodeAttributes` (Phase 9 §2.4), the full 3-browser Playwright e2e suite showed `e2e/canonical-surface.spec.ts:180` ("reconciles composition before, after, and between atoms with zero composing writes") failing consistently in all three browsers (chromium, firefox, webkit) — a stronger signal than the single-browser timing flakes seen elsewhere in this project, and thus treated as a likely genuine regression rather than dismissed.

## Reproduction

`pnpm exec playwright test e2e/canonical-surface.spec.ts -g "reconciles composition before, after, and between atoms" --project=chromium --project=firefox --project=webkit --reporter=list` from `packages/react/`, after the KaTeX renderer change and before the test fix below.

## Root cause

Not a renderer regression. The test's final assertion compared `harness.renderer.mapping.nodeToDom("atom-owner")?.textContent` against a literal string built from each formula atom's raw `source` (e.g. `"x"`, `"y"`) — an assumption that was only ever true because the old formula renderer did `element.textContent = source` directly.

KaTeX's default `output: "htmlAndMathml"` renders each formula as HTML (visual glyphs) **and** MathML (`<math><mi>x</mi>...<annotation encoding="application/x-tex">x</annotation></math>` for accessibility/copy-paste), so a single-character source like `"x"` now appears three times in `element.textContent` (once from the HTML span, once from the MathML `<mi>`, once from the MathML `<annotation>`). The seeded test paragraph (`playground/src/CanonicalSurface.tsx`, `atomDocument()`) confirmed `inline-atom`'s source is exactly `"x"`, matching this exactly (`"aनx界yमb"` expected vs. real KaTeX output producing `"xxx"`/`"yyy"` in place of each single char).

This is intentional, correct behavior from Phase 9 §2.4 (real math rendering, MathML included for accessibility) — not a defect to fix in the renderer.

## Fix

`packages/react/e2e/canonical-surface.spec.ts` — the test's final text check no longer reads `owner.textContent` directly. It now walks `owner.childNodes`, concatenating `Text` node data and substituting `[<data-smart-id>]` placeholders for element children (atoms), so the assertion verifies text reconciled correctly *around* the atoms without depending on what an atom renders internally. Expected value updated from `"aनx界yमb"` to `"aन[inline-atom]界[inline-atom-2]मb"`. The `beforeWrites`/`afterWrites`/`betweenWrites`/`atoms` assertions (composition write-count and atom-identity checks) — the actual point of the test — were untouched and remained correct throughout.

## Regression coverage

`e2e/canonical-surface.spec.ts:180` itself, re-verified passing on all 3 browsers after the fix. `packages/core/src/foundation/surface/formulaRendering.test.ts` (5 unit tests) separately covers the KaTeX rendering contract (real HTML+MathML output, accessible-name attributes, stable re-render identity, invalid-LaTeX fallback, `trust:false` enforcement) at the unit level.

## Related/similar issues

None — first bug specific to the KaTeX integration.
