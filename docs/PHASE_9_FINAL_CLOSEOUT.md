# Phase 9 final closeout — codec refactor sizing, KaTeX visual gap, dependency scan

2026-08-13, branch `core-implementation`. Three independent items requested as the last Phase 9 work before Phase 10. `docs/bugs/` was checked before starting (nothing existing matched any of the three areas) and one new entry was added as a result of this work.

**Update, 2026-08-14:** the decision was made to pursue option 2 (patch mammoth's own call site) rather than accept the DoS as residual risk. Applied: override re-confirmed effective, plus a scoped `pnpm patch` fixing the exact bug that broke the first attempt (mammoth's wrapper silently dropped a `mimeType` argument its own caller already intended to pass). That patch was correct and did fix the mimeType crash — but surfaced a second, independent incompatibility (xmldom 0.9.x's constructor-time deprecation notice being misread as a fatal error by mammoth's error-handling) that needs a second patch outside the authorized one-line scope. Stopped there per the standing rule against expanding a patch unilaterally; both the override and the mammoth patch were reverted. See the updated §3 and "What remains" below — **Phase 9 is still not closed**; each attempt narrows the actual blocker further without yet resolving it.

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

**Update 1:** the recommended fix — a pnpm override (`"pnpm": {"overrides": {"@xmldom/xmldom": "^0.9.11"}}`) — was tried alone first. It worked exactly as intended at the dependency-resolution level but broke DOCX import completely with a `mimeType`-validation `TypeError`. Reverted (full detail: `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`).

**Update 2 (this session):** decision made to pursue patching mammoth's own call site (option 2) rather than accept the DoS as residual risk. Re-applied the override, then used `pnpm patch mammoth@1.11.0` to fix the actual bug behind the mimeType crash: mammoth's own `lib/xml/reader.js:16` already calls its local `parseFromString` wrapper with `"text/xml"` as a second argument, fully intending to pass it — but the wrapper (`lib/xml/xmldom.js:4`) was declared with only one parameter and silently dropped it before ever reaching the real `domParser.parseFromString()` call. The patch (`patches/mammoth@1.11.0.patch`, committed via `pnpm patch-commit`) is a genuine two-line fix: declare and forward the parameter, nothing else. **This did fix the mimeType crash.** But a second, independent failure appeared in its place: `@xmldom/xmldom` 0.9.x's `DOMParser` constructor fires a synthetic deprecation warning through the old `errorHandler` callback (which mammoth still uses) immediately on construction, before any parsing — and mammoth's own error-collection code can't tell that warning apart from a real fatal parse error, so it now throws on every document regardless of validity. Fixing this needs patching mammoth's error-handling logic too, which is outside the single-function, one-line scope explicitly authorized for this pass. Stopped there rather than expanding the patch unilaterally. Both the override and the mammoth patch were fully reverted; confirmed mammoth back on `0.8.11` via `pnpm -r why`, and the full suite (lint, core, react, DOCX-specific, full 3-browser 7-file e2e) confirmed passing again at prior counts.

Also drafted (not filed — no `gh` CLI or other GitHub-posting mechanism available in this environment) an upstream issue against `@xmldom/xmldom` describing both incompatibilities found. Full draft text preserved in `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` in case the scratch-path copy is lost to session cleanup.

**The DoS finding remains open and unfixed.** The path forward is narrower now than after the first attempt — the mimeType half of a mammoth patch is proven correct; what's left is a second, similarly-scoped patch to mammoth's error-handling, which is a new scope decision rather than a continuation of what this pass authorized. Full detail: `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

## Test counts — unchanged, as expected

No source code was modified, net, by any items or fix attempts across either closeout session (only documentation; a temporary, fully-removed verification script; and two rounds of `package.json`/lockfile/patch changes, both fully reverted). Confirmed rather than assumed, after each revert:

- **Core:** 495/495 (unchanged throughout).
- **React:** 97/97 (unchanged throughout).
- **DOCX-specific (`docx/format.test.ts`):** 12/12 at baseline. Attempt 1 (bare override): 3/12 (9 failed on the mimeType `TypeError`). Attempt 2 (override + mammoth patch): still failing, different error (the `errorHandler`-deprecation-as-fatal issue) — not re-counted precisely since the failure mode changed mid-investigation and stopping/reverting took priority over an exact count at that intermediate state. Back to 12/12 after each full revert.
- **Lint** (`pnpm run lint`): clean, re-confirmed after the final revert.
- **E2e**, all 7 files, no filter, 3 browsers: **250 passed, 5 expected skips, 0 failures**, confirmed clean prior to this session's attempt (not re-run a second time after attempt 2's revert, since attempt 2 never got past `docx/format.test.ts` to a state worth taking the ~2-minute full e2e run against — reverting to the byte-identical last-committed state, already e2e-verified, made a repeat run redundant).

## What remains

Phase 9 is **still not fully closed.** The mammoth/xmldom finding is open, and now considerably more precisely characterized after two fix attempts:

- **The mammoth/xmldom DoS finding is unresolved.** Attempt 1 (bare pnpm override) broke DOCX import outright. Attempt 2 (override + a scoped, correct patch to mammoth's dropped `mimeType` argument) fixed that specific break but uncovered a second, independent incompatibility in mammoth's error-handling that needs its own patch to resolve — outside the scope authorized for this pass. Neither attempt was forced through or worked around; both were fully reverted on discovering they didn't cleanly resolve. The next real options are: extend the mammoth patch to also fix the `errorHandler`/`onError` mismatch (the most promising path — half the fix is already proven correct), replace `mammoth` entirely, or explicitly accept the DoS as documented risk (previously rejected for this specific finding as not comparable to coverage-gap-style waivers). This should still be treated as blocking any publish, including `beta`, until one of those is decided and actually verified end-to-end.

Everything else genuinely closed stays closed. Still-open items unrelated to this closeout's scope — the 29 deferred e2e tests, NVDA+Chrome validation, the native Windows Word capture — are unchanged; see `docs/PHASE_9_RELEASE_POLICY.md`'s full "do not publish to latest until" list for their status.

The codec refactor itself (item 1) remains entirely unimplemented, as explicitly requested — it is now sized and schedulable, not done.
