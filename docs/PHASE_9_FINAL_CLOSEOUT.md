# Phase 9 final closeout — codec refactor sizing, KaTeX visual gap, dependency scan

2026-08-13, branch `core-implementation`. Three independent items requested as the last Phase 9 work before Phase 10. `docs/bugs/` was checked before starting (nothing existing matched any of the three areas) and one new entry was added as a result of this work.

**Update, same day:** the item 3 fix (pnpm override) was subsequently attempted, confirmed effective at the dependency-resolution level, then found to break DOCX import entirely, and reverted. See the updated §3 and "What remains" below — **Phase 9 is still not closed**; this update makes the blocker more precisely characterized, not resolved.

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

**Update:** the recommended fix — a pnpm override (`"pnpm": {"overrides": {"@xmldom/xmldom": "^0.9.11"}}`) — was subsequently tried. It worked exactly as intended at the dependency-resolution level (`pnpm -r why @xmldom/xmldom` showed a single `0.9.11` everywhere including inside mammoth; `pnpm audit` showed all 5 advisories gone, high-severity count 33→28) but broke DOCX import completely: every test in `docx/format.test.ts` failed with `TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.` Mammoth's own internal call (`node_modules/mammoth/lib/xml/xmldom.js:13`) calls `parseFromString(string)` with no `mimeType` argument; `@xmldom/xmldom`'s entire `0.9.x` line (confirmed from `0.9.0` onward via `npm pack`, not just `0.9.11`) validates `mimeType` before applying its own documented default, throwing instead of defaulting — a genuine inconsistency between `@xmldom/xmldom`'s own JSDoc and implementation, unrelated to this repo. No `0.9.x` version avoids this. The override was reverted; `pnpm -r why @xmldom/xmldom` confirmed mammoth back on `0.8.11`, and the full suite (core, react, DOCX-specific) confirmed passing again at prior counts. **The DoS finding remains open and unfixed** — full detail and real remaining options (patch mammoth's call site, replace the library, accept as documented risk, report upstream) in `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

## Test counts — unchanged, as expected

No source code was modified, net, by any of the three items or the subsequent override attempt (only documentation; a temporary, fully-removed verification script; and a `package.json`/lockfile change that was itself fully reverted). Confirmed rather than assumed, after the revert:

- **Core:** 495/495 (unchanged from the Phase 9 completion report's figure).
- **React:** 97/97 (unchanged).
- **DOCX-specific (`docx/format.test.ts`):** 12/12 (failed 9/12 mid-attempt with the override in place; back to 12/12 after revert).
- **Lint** (`pnpm run lint` — all contract-check scripts plus both packages' `tsc --noEmit`): clean, re-run after the revert.
- **E2e**, all 7 files, no filter, 3 browsers: **250 passed, 5 expected skips, 0 failures**, re-run in full after the revert (not just inferred from a clean `git status`).

## What remains

Phase 9 is **still not fully closed.** The mammoth/xmldom finding is open, more precisely characterized than before, and does not have an easy fix:

- **The mammoth/xmldom DoS finding is unresolved.** The obvious fix (pnpm override) does not work — it trades a narrow, attacker-must-craft-a-file DoS for an unconditional break of every DOCX import, which is strictly worse. A real fix needs one of: patching/vendoring mammoth's own xmldom call site, replacing the DOCX-parsing library, or explicitly accepting the DoS as a documented residual risk. None of these is a small, obvious choice, and none has been applied. This should still be treated as blocking any publish, including `beta`, until a decision is made — not because a fix wasn't attempted, but because the attempted fix made things worse and was correctly reverted rather than shipped or forced.

Everything else genuinely closed stays closed. Still-open items unrelated to this closeout's scope — the 29 deferred e2e tests, NVDA+Chrome validation, the native Windows Word capture — are unchanged; see `docs/PHASE_9_RELEASE_POLICY.md`'s full "do not publish to latest until" list for their status.

The codec refactor itself (item 1) remains entirely unimplemented, as explicitly requested — it is now sized and schedulable, not done.
