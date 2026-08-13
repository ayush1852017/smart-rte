# Phase 9 final closeout — codec refactor sizing, KaTeX visual gap, dependency scan

2026-08-13, branch `core-implementation`. Three independent items requested as the last Phase 9 work before Phase 10. `docs/bugs/` was checked before starting (nothing existing matched any of the three areas) and one new entry was added as a result of this work.

## 1. Codec refactor scoping — done, not implemented (as requested)

Full detail: `docs/PHASE_9_CODEC_REFACTOR_SCOPE.md`.

Sized the 5 whole-document walkers backing the 36 metadata-only `FeatureFormatCodec` cells: `docx/export.ts` (270 lines, 21 branches, one real threading problem — a mutable relationship-ID allocator that must stay globally sequential across the whole document), `pdf/format.ts` (216 lines, export side tractable, **import side is a standing architectural exception** — PDF import synthesizes structure from spatial text-layout data with no pre-existing node to parse into, and doesn't decompose into gate 3's per-node `parse` shape without changing what PDF import fundamentally is), `list/formats.ts` (580 lines, the largest and most cross-cutting — a single mutually-recursive HTML/Markdown codec that already owns every feature at once, not just lists despite its name), and the two smaller dormant-layer files `marks/formats.ts` and `block/formats.ts`/`table/formats.ts`.

Proposed a feature-by-feature split (marks and blocks smallest/safest to start, HTML/Markdown largest/highest-risk/lowest-payoff, PDF import excluded from the same estimate entirely) with explicit ordering constraints. This is a scheduling input for Phase 10 planning, not a commitment to do the work.

## 2. KaTeX visual-inspection gap — closed via an alternative method

Full detail: `docs/PHASE_9_RELEASE_POLICY.md`, "KaTeX visual verification" section.

The Chrome extension remained unavailable. Closed instead by driving the real production render path (`editor.replaceState` + `renderer.render`, the same calls `CanonicalEditorRuntime.replaceValue` makes) in an actual chromium browser via Playwright, capturing screenshots of 4 representative cases, and inspecting each directly: a simple formula, a complex one (sum, fraction, radical, Greek letters, sub/superscripts), a `trust:false`-blocked command (`\includegraphics`), and invalid LaTeX. All four rendered exactly as expected — correct math typesetting, no image injected from the blocked command (rendered as inert red error text instead), clean plain-text fallback for invalid input with no crash or corruption. Confidence level: high, comparable to direct extension-based inspection — same kind of artifact (real rendered pixels from a real browser), different capture mechanism. This residual item from the Phase 9 completion report is now closed, not left open on the basis of unavailable tooling.

The verification script was temporary (copied into `packages/react/e2e/`, run once, deleted immediately after) — it is not part of the committed test suite. No source code was changed by this item.

## 3. Dependency vulnerability scan — one real, unfixed finding

Full detail: `docs/PHASE_9_RELEASE_POLICY.md`, "Dependency vulnerability scan" section; `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

`katex`, `jszip`, and `pdfjs-dist` are clean. Our own direct `@xmldom/xmldom` pin (`^0.9.11`) is clean and confirmed still current (npm's `latest` dist-tag, not deprecated, not superseded since Phase 9 chose it). **`mammoth@1.11.0` bundles its own transitive `@xmldom/xmldom@0.8.11`**, unaffected by our top-level pin. Triaged against mammoth's actual source rather than trusting raw audit output: 4 of 5 disclosed advisories are unreachable (mammoth never serializes XML), but the 5th — uncontrolled recursion causing a stack-exhaustion crash — **is reachable**, since mammoth calls `DOMParser.parseFromString()` and `getElementsByTagName()` (both confirmed trigger vectors) on every single DOCX import, unconditionally. A crafted, deeply-nested `.docx` file — trivial to construct, no special access required — can crash `importDocxDocumentWithMammoth` through completely routine use of the import feature.

**Recommended fix, not applied:** a pnpm override (`"pnpm": {"overrides": {"@xmldom/xmldom": "^0.9.11"}}`) forcing the safe version everywhere in the tree, including inside mammoth's own resolution. Reported for confirmation per this project's standing rule on changes with real blast radius — not applied unilaterally.

## Test counts — unchanged, as expected

No source code was modified by any of the three items (only documentation and one temporary, fully-removed verification script). Confirmed rather than assumed:

- **Core:** 495/495 (unchanged from the Phase 9 completion report's figure).
- **React:** 97/97 (unchanged).
- **E2e**, all 7 files, no filter, 3 browsers: **250 passed, 5 expected skips, 0 failures** (unchanged from every prior check this phase). No test was added, removed, or renamed by this closeout.

## What remains

Phase 9 is **not** fully closed. One item from this closeout is a real, open, blocking finding:

- **The mammoth/xmldom DoS finding (item 3) is unresolved** and should be treated as blocking any publish — including `beta` — not just `latest`, since it's a crash-on-routine-use vulnerability in an expected-use feature (DOCX import), not an edge case. It needs an explicit decision on the recommended pnpm-override fix before it can close.

Everything else genuinely closed this session (§3/§4 gate verification and completion report from the prior closeout, the KaTeX visual gap from this one) stays closed. Still-open items unrelated to this closeout's scope — the 29 deferred e2e tests, NVDA+Chrome validation, the native Windows Word capture — are unchanged and were not expected to be touched by this pass; see `docs/PHASE_9_RELEASE_POLICY.md`'s full "do not publish to latest until" list for their status.

The codec refactor itself (item 1) remains entirely unimplemented, as explicitly requested — it is now sized and schedulable, not done.
