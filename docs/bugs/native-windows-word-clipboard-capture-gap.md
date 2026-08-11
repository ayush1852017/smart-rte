# Native Windows Word clipboard HTML was never captured

**Status:** Open — owner-waived residual risk for Phase 8a; Phase 11/pre-production hardening
**Area:** clipboard / Word normalization / fixture corpus
**First reported:** 2026-08-05 (the Phase 8a report records the explicit owner waiver)
**Related files:** `docs/PHASE_8A_COMPLETION_REPORT.md`, `docs/PHASE8A_FIXTURE_CAPTURE.md`, `docs/PHASE8A_BEHAVIOR_CHANGE_CATALOGUE.md`

## Symptom

The Phase 8a P0 corpus requires the raw `text/html` and `text/plain` payloads copied from native Word on Windows. No Windows device was available, so the required source-specific evidence was never collected. A supplied Windows `.docx` file was converted with Mammoth, but that is document conversion output, not Word's clipboard HTML.

## Reproduction

Open `http://localhost:5173/?clipboardCapture=1` on Windows, copy a document from desktop Word, and import the resulting `.clipboard.json` into `packages/core/src/foundation/clipboard/fixtures/captured/p0/`. That capture has not been performed. The real macOS Word fixture passes the corpus and generic-path tests, but it cannot prove Windows Office-version behavior or nested ordered/unordered marker variants.

## Root cause

This is an evidence/environment gap, not a demonstrated normalizer failure. Windows Word emits clipboard-specific Office HTML whose markers, namespaces, conditional comments, VML fallbacks, and list overrides can differ from both macOS Word and a DOCX-to-HTML converter.

## Fix

No code fix was claimed. The capture page deliberately stamps the Mammoth output as `docx-reference` and keeps it outside the captured P0 corpus, so it cannot silently satisfy the Windows gate. The owner accepted this exact residual risk on 2026-08-05; obtain a native capture before production hardening/Phase 11 and rerun the Windows-specific corpus cases.

## Regression coverage

`packages/core/src/foundation/clipboard/corpus.test.ts` covers the eight captured non-Windows fixtures and runs each through the detected and generic paths. There is no Windows native fixture, so Gates 3, 5, and the Windows portion of Gate 17 remain unevidenced rather than marked passed.

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — verify the live-source capture page and restart it before attributing a missing fixture to a code defect.
- [nested-list-in-table-cell-not-reproducible](nested-list-in-table-cell-not-reproducible.md) — another manual report whose interpretation depends on a confirmed-fresh playground, but not the same clipboard source gap.
