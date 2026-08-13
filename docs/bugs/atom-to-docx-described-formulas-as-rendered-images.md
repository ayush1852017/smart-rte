# atomToDocx described DOCX formula export as a rendered image, not literal text

**Status:** Fixed
**Area:** atom / formats (dormant per-feature semantic layer)
**First reported:** self-discovered during Phase 9 §2.3, while auditing every (feature, format) fidelity cell against real test coverage before building new fixtures
**Related files:** [[katex-textcontent-composition-e2e-mismatch]] (different bug, same `atom/formats.ts` area)

## Symptom

`atomToDocx` (`packages/core/src/foundation/atom/formats.ts`) modeled a formula atom's DOCX export as `{ kind: "image", alt: "Rendered formula" }` — implying formulas get rendered to an image and embedded that way.

## Reproduction

Not reported by a user; found by direct comparison while auditing Phase 9 §2.2's fidelity table against real behavior: `packages/core/src/foundation/formats/docx/export.ts` (the real, production DOCX exporter, built in §2.1) was read directly to see what it actually emits for a formula node.

## Root cause

`atomToDocx` is part of the "dormant per-feature semantic layer" — functions built for independent, per-feature fidelity verification (§2.2's finding), not wired into production document assembly. It predates the §2.1 DOCX exporter rewrite and was never updated to match the exporter's actual, final behavior: formulas are written as literal LaTeX text inside an `<m:oMath>` zone (`docx/export.ts`), not translated to real OMML and not rendered as an image. The `kind: "image"` / `"Rendered formula"` description was stale, describing a fallback approach that was never implemented.

## Fix

`atomToDocx` now returns `{ kind: "text", source }` for formula/block_formula nodes, matching `docx/export.ts`'s real behavior. `packages/core/src/foundation/atom/formats.test.ts`'s corresponding assertion was updated to match.

## Regression coverage

`packages/core/src/foundation/atom/formats.test.ts`: "describes DOCX formulas as literal LaTeX text, matching the actual exporter (not a rendered image)".

## Related/similar issues

None with the same root cause. Broader pattern: the dormant per-feature layer (`atom/formats.ts`, `marks/formats.ts`, `block/formats.ts`, `table/formats.ts`, `list/formats.ts`'s `canonical*To{Docx,Pdf}*` functions) is tested in isolation and can drift from the real, whole-document production codecs (`docx/export.ts`, `pdf/format.ts`) unless explicitly cross-checked, as this bug demonstrates. See `packages/core/src/foundation/formats/featureCodecs.ts`'s doc comment (Phase 9 §3 gate 3) for the same observation at the architecture level.
