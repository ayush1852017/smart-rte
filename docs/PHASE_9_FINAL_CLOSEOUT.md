# Phase 9 final closeout — codec refactor sizing, KaTeX visual gap, dependency scan

2026-08-13, branch `core-implementation`. Three independent items requested as the last Phase 9 work before Phase 10. `docs/bugs/` was checked before starting (nothing existing matched any of the three areas) and one new entry was added as a result of this work.

**Update, 2026-08-14 (two rounds):** first, the decision was made to pursue option 2 (patch mammoth's own call site) rather than accept the DoS as residual risk. A first attempt at that patch (mimeType-only) fixed the original crash but surfaced a second, independent incompatibility, and was reverted rather than expanded beyond its authorized one-line scope. Then, explicitly re-authorized to extend the patch to cover both incompatibilities: applied, verified clean across the full suite, and **verified against the actual disclosed PoC through the real production entry point** — which is exactly what surfaced a *third*, previously-undisclosed, unrelated bug in mammoth's own code with the same crash symptom. **The originally-tracked finding is now fixed and closed.** A new, different finding takes its place as the open item. See the updated §3 and "What remains" below.

## 1. Codec refactor scoping — done, not implemented (as requested)

Full detail: `docs/PHASE_9_CODEC_REFACTOR_SCOPE.md`.

Sized the 5 whole-document walkers backing the 36 metadata-only `FeatureFormatCodec` cells: `docx/export.ts` (270 lines, 21 branches, one real threading problem — a mutable relationship-ID allocator that must stay globally sequential across the whole document), `pdf/format.ts` (216 lines, export side tractable, **import side is a standing architectural exception** — PDF import synthesizes structure from spatial text-layout data with no pre-existing node to parse into, and doesn't decompose into gate 3's per-node `parse` shape without changing what PDF import fundamentally is), `list/formats.ts` (580 lines, the largest and most cross-cutting — a single mutually-recursive HTML/Markdown codec that already owns every feature at once, not just lists despite its name), and the two smaller dormant-layer files `marks/formats.ts` and `block/formats.ts`/`table/formats.ts`.

Proposed a feature-by-feature split (marks and blocks smallest/safest to start, HTML/Markdown largest/highest-risk/lowest-payoff, PDF import excluded from the same estimate entirely) with explicit ordering constraints. This is a scheduling input for Phase 10 planning, not a commitment to do the work.

## 2. KaTeX visual-inspection gap — closed via an alternative method

Full detail: `docs/PHASE_9_RELEASE_POLICY.md`, "KaTeX visual verification" section.

The Chrome extension remained unavailable. Closed instead by driving the real production render path (`editor.replaceState` + `renderer.render`, the same calls `CanonicalEditorRuntime.replaceValue` makes) in an actual chromium browser via Playwright, capturing screenshots of 4 representative cases, and inspecting each directly: a simple formula, a complex one (sum, fraction, radical, Greek letters, sub/superscripts), a `trust:false`-blocked command (`\includegraphics`), and invalid LaTeX. All four rendered exactly as expected — correct math typesetting, no image injected from the blocked command (rendered as inert red error text instead), clean plain-text fallback for invalid input with no crash or corruption. Confidence level: high, comparable to direct extension-based inspection — same kind of artifact (real rendered pixels from a real browser), different capture mechanism. This residual item from the Phase 9 completion report is now closed, not left open on the basis of unavailable tooling.

The verification script was temporary (copied into `packages/react/e2e/`, run once, deleted immediately after) — it is not part of the committed test suite. No source code was changed by this item.

## 3. Dependency vulnerability scan — original finding fixed; verifying it surfaced a new, separate one

Full detail: `docs/PHASE_9_RELEASE_POLICY.md`, "Dependency vulnerability scan" section; `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` (fixed); `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md` (new, open).

`katex`, `jszip`, and `pdfjs-dist` are clean. Our own direct `@xmldom/xmldom` pin (`^0.9.11`) is clean and confirmed still current. **`mammoth@1.11.0` bundled its own transitive `@xmldom/xmldom@0.8.11`**, unaffected by our top-level pin, vulnerable to 5 disclosed advisories — reachability triaged directly against mammoth's source: 4 of 5 unreachable (mammoth never serializes XML), the 5th (uncontrolled recursion) reachable via `DOMParser.parseFromString()` + `getElementsByTagName()`, both called on every DOCX import.

**Attempt 1** (bare pnpm override): worked at the dependency-resolution level, broke DOCX import outright with a `mimeType`-validation `TypeError`. Reverted.

**Attempt 2** (override + a mimeType-only patch): fixed that crash, surfaced a second incompatibility (an `@xmldom/xmldom` 0.9.x constructor-time deprecation notice mammoth's error-handling misreads as fatal). Outside the scope authorized at the time. Reverted.

**Attempt 3, explicitly re-authorized** (override + a two-part patch — forward `mimeType`, rename mammoth's `errorHandler` option to `onError`): fixed both incompatibilities. `errorHandler`→`onError` works because `@xmldom/xmldom`'s constructor treats both option names as the same underlying real-error callback (`this.onError = options.onError || options.errorHandler`), but only fires its deprecation notice when `errorHandler` specifically is used — renaming avoids the notice by construction, with zero change to real-error detection.

**Full verification, in order:** `docx/format.test.ts` 12/12 (up from 3/12 after attempt 2's partial patch); lint clean; core 495/495; react 97/97; full 3-browser 7-file e2e 250/5/0 — all identical to baseline, zero regressions; `pnpm -r why`/`pnpm audit` reconfirmed the safe resolution and zero xmldom advisories; **the disclosed PoC re-attempted directly against the patched library code — parsing and traversing a 10,000-level-deep document — succeeded with no crash**, direct proof rather than an inference from green tests.

**This closes the originally-tracked finding.** The override and patch are kept in place as the permanent fix (not reverted) — `package.json`'s `pnpm.overrides`/`pnpm.patchedDependencies`, `patches/mammoth@1.11.0.patch`.

**But verifying against the real end-to-end path (a crafted `.docx`, not just the isolated library call) surfaced a genuinely separate, previously-undisclosed bug**: mammoth's own `lib/xml/reader.js` has its own unguarded recursive tree-walker (`convertNode`/`convertElement`), untouched by this patch, unrelated to `@xmldom/xmldom` in any way, and present regardless of which version is installed. A deeply-nested real `.docx` still crashes the import — through different code, for a different reason, and this bug pre-dates every change made in either closeout session. New entry: `docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md`.

Also drafted (not filed — no `gh` CLI or other GitHub-posting mechanism available in this environment) an upstream issue against `@xmldom/xmldom` describing both incompatibilities the patch worked around. Full draft text preserved in `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

## Test counts

Reverted attempts left no net source change (confirmed at each revert). The final, kept fix (override + `patches/mammoth@1.11.0.patch`) is a real, permanent change to `package.json`/`pnpm-lock.yaml`/`patches/`:

- **Core:** 495/495 (unchanged throughout, including with the final fix in place).
- **React:** 97/97 (unchanged throughout, including with the final fix in place).
- **DOCX-specific (`docx/format.test.ts`):** 12/12 at baseline. Attempt 1: 3/12. Attempt 2: still failing (different error, not re-counted precisely — reverted before a full count). Attempt 3 (final, kept): **12/12** — the fix itself introduces zero test regressions.
- **Lint** (`pnpm run lint`): clean, re-confirmed with the final fix in place.
- **E2e**, all 7 files, no filter, 3 browsers: **250 passed, 5 expected skips, 0 failures**, re-confirmed in full with the final fix in place — identical to every prior baseline this entire phase.

No test was added, removed, or renamed by any of this. The only durable, non-documentation changes are `package.json` (`pnpm.overrides`, `pnpm.patchedDependencies`), `pnpm-lock.yaml`, and `patches/mammoth@1.11.0.patch`.

## What remains

**The originally-tracked mammoth/xmldom finding is fixed, verified end-to-end against the actual disclosed PoC, and closed.** That is genuine, durable progress — not another narrowing-without-resolving step.

**Phase 9 is still not fully closed**, because verifying that fix properly (against the real PoC through the real entry point, not just green tests) surfaced a new, previously-undisclosed, unrelated bug:

- **`docs/bugs/mammoth-own-reader-unguarded-recursion-dos.md` (new, open).** Mammoth's own `lib/xml/reader.js` has an unguarded recursive tree-walker, completely independent of `@xmldom/xmldom`, that a deeply-nested `.docx` can still crash through. This bug pre-dates this session entirely — it was never part of the disclosed CVEs, was not introduced by any fix attempted here, and would have been equally present under the old, vulnerable xmldom too. It carries the same practical risk (DoS via routine DOCX import) as the finding that's now closed, and should be evaluated with the same rigor before any publish.

Everything else stays as previously stated: the 29 deferred e2e tests, NVDA+Chrome validation, and the native Windows Word capture are unchanged and outside this closeout's scope — see `docs/PHASE_9_RELEASE_POLICY.md`'s full "do not publish to latest until" list. The codec refactor (item 1) remains entirely unimplemented, as explicitly requested — sized and schedulable, not done.
