# DOCX inline-marks fidelity note wrongly grouped superscript/subscript with the marks mammoth actually drops

**Status:** Fixed
**Area:** formats / fidelity table (documentation accuracy, not code behavior)
**First reported:** self-discovered during Phase 9 §2.3, while writing a per-mark DOCX round-trip fixture
**Related files:** [[atom-to-docx-described-formulas-as-rendered-images]] (found in the same audit pass)

## Symptom

Phase 9 §2.2's DOCX inline-marks fidelity note (`packages/core/src/foundation/formats/fidelity.ts`) stated that mammoth's default HTML conversion fails to round-trip superscript/subscript on DOCX import, grouping them together with textColor/backgroundColor/fontSize/fontFamily/underline as "not mapped back."

## Reproduction

Not reported by a user. Found while writing `packages/core/src/foundation/formats/docx/format.test.ts`'s "round-trips every inline mark through DOCX export and import" test: exporting each of the twelve marks individually, running the real `exportDocxDocument`/`importDocxDocumentWithMammoth` round-trip, and inspecting mammoth's actual raw HTML output per mark (not inferring from mammoth's documentation).

## Root cause

The original §2.2 note was written from a general understanding of mammoth's default style-map limitations, without testing each mark individually. Direct per-mark testing showed mammoth's default conversion recognizes `<sup>`/`<sub>` (superscript/subscript) the same way it recognizes `<strike>` — they round-trip correctly. Only underline, textColor, backgroundColor, fontSize, and fontFamily are genuinely lost without an explicit mammoth style map. The original note's grouping was an unverified inference, not a tested claim.

## Fix

Corrected the fidelity note in `packages/core/src/foundation/formats/fidelity.ts`'s `inline-marks`/`docx` cell to the exact, tested breakdown. The new per-mark round-trip test (`docx/format.test.ts`) asserts mark identity per mark, not just that text content survives, which is what caught the imprecision in the first place — a text-only assertion would have passed either way.

## Regression coverage

`packages/core/src/foundation/formats/docx/format.test.ts`: "round-trips every inline mark through DOCX export and import" (asserts per-mark, not just per-text). `packages/core/src/foundation/formats/fidelity.test.ts`'s regression-guard tests keep the note text and the tested behavior from drifting apart again silently.

## Related/similar issues

[[atom-to-docx-described-formulas-as-rendered-images]] — found in the same audit pass, same root pattern: a fidelity claim that was asserted from inference rather than direct per-cell testing. Both were caught by Phase 9 §2.3's explicit "audit every cell against real coverage" pass, and both are why Phase 9 §3 gate 4 later did a full 44-cell audit rather than trusting the table's own claims about its verification status.
