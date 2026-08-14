# Phase 9 §2.6 — Semver, changelog, and publish policy

## Version

Both packages move from independent 0.x counters to a coordinated `1.0.0-beta.1`:

- `smartrte-core`: `0.2.1` → `1.0.0-beta.1`
- `smartrte-react`: `0.3.4` → `1.0.0-beta.1`

A major bump (not a minor/patch continuation of the 0.x line) is the correct call, not a stylistic one. Per Phase 9 §1.1's finding, **every version ever published to npm for either package (through 0.2.1 / 0.3.4) predates the canonical document model entirely** — those releases shipped the old DOM-authoritative editor. This release is the first to ship the canonical engine, `CanonicalAuthorityEditor` as the sole production editor, the framework-agnostic `packages/core`, the format-codec rewrite, and live KaTeX. Continuing the old 0.x counter would understate the change; every consumer's runtime behavior changes, not just internals. `-beta.1` reflects that this is genuinely new to real usage, not a repeat of a code path already exercised in production. `smartrte-react`'s `smartrte-core` dependency is declared as `workspace:^`, which pnpm resolves to the real published range at publish time — no manual pin needed.

## Changelog

Consolidated `1.0.0-beta.1` entries were added to both `packages/core/CHANGELOG.md` and `packages/react/CHANGELOG.md`, each with an explicit **BREAKING CHANGE** lead line. These summarize the cumulative, never-before-released state (the canonical model, format codecs, KaTeX, the public API surface cleanup from §2.5) rather than every internal phase gate — the many `docs/PHASE_*_COMPLETION_REPORT.md` files remain the detailed record of how each piece was built and verified; the changelog is the user-facing "what's different from what you have now" summary.

## Do not publish to `latest` until

This list is what stands between `1.0.0-beta.1` and a real `npm publish --tag latest`. It reflects genuine, previously-documented gaps carried forward from this session and earlier phases, not new criteria invented for this document.

1. ~~**Phase 9 §3 (13 exit gates) verified and §4 (completion report) written.**~~ **CLOSED 2026-08-13.** All 13 gates pass (`docs/PHASE_9_EXIT_GATES.md`); completion report written (`docs/PHASE_9_COMPLETION_REPORT.md`).
2. **The 29 e2e tests deferred at Phase 8b closeout are resolved or explicitly re-accepted.** `docs/PHASE_8B_FINAL_CLOSEOUT.md` retired 5 test files (30 tests) covering list/table/formatting/format-runtime/remaining workflows with only 1 confirmed duplicate; owner instruction was to track the other 29 as follow-up, prioritizing table Tab/Shift+Arrow navigation and undo-coalescing. That follow-up has not happened. Publishing to `latest` without it means shipping to real consumers with less verified e2e coverage than the pre-canonical editor had. **Still open.**
3. ~~**Live KaTeX rendering gets a real browser visual check.**~~ **CLOSED 2026-08-13, via an alternative method — see "KaTeX visual verification" below.** The Chrome extension needed for direct live-browser inspection remained unavailable; closed instead via Playwright-captured screenshots inspected directly, not left open on the basis of unavailable tooling.
4. **NVDA + Chrome manual accessibility validation**, flagged as outstanding across Phase 4 (mixed `aria-pressed`/toolbar), Phase 5 (block transforms), Phase 6 (table mode), and Phase 7 (atom announcements), and never closed. All four phases passed on axe + Safari/VoiceOver only. This is a repeated, explicitly-acknowledged gap, not an oversight being raised for the first time here. **Still open.**
5. **A native Windows Word clipboard capture**, flagged in Phase 8a as an owner-waived residual risk and explicitly named there as "a Phase 11/pre-production hardening item." The current paste-normalization fidelity for Word content is verified against macOS Word and a Mammoth-derived synthetic fixture, not a real Windows clipboard payload. **Still open.**
6. **`mammoth`'s bundled transitive `@xmldom/xmldom@0.8.11` is a reachable DoS in the DOCX import path** — see `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md` and "Dependency vulnerability scan" below. Two fix attempts tried and reverted: the bare override broke DOCX import outright; a scoped patch fixing that break surfaced a second, independent incompatibility beyond the authorized patch scope. **Blocking, still open.**

None of the still-open items block `-beta.1` itself — a pre-release channel exists precisely so real integration testing can happen against something installable before the above is fully closed. They block calling this **stable** and moving the npm `latest` tag to it. Item 6 in particular should be resolved before *any* publish, including `beta`, given it's a DoS in a routine, expected-use feature (importing a DOCX file) rather than an edge case.

## KaTeX visual verification (closed 2026-08-13)

The Chrome extension needed for direct live-browser visual inspection was checked again and remained unavailable (`Browser extension is not connected`). Rather than leave this open indefinitely on that basis, verification was closed via an alternative method: a Playwright script drove the real canonical renderer in an actual chromium browser through `editor.replaceState` + `renderer.render` (the same code path production `CanonicalEditorRuntime.replaceValue` uses), captured `.png` screenshots of four representative cases, and each was inspected directly (not just asserted on programmatically):

1. **Simple inline formula** (`E=mc^2`) — rendered correctly: italic serif math variables, properly positioned superscript, correct `=` spacing.
2. **Complex formula** (`\sum_{i=1}^{n} \frac{x_i^2}{\sqrt{\alpha+\beta}}`) — rendered correctly: summation with limits, a proper fraction bar, a square root radical, Greek letters, nested sub/superscripts all correctly laid out. This is unambiguously genuine KaTeX typesetting, not a degraded or partial render.
3. **`trust:false`-blocked construct** (`\includegraphics{https://evil.test/x.png}`) — rendered as red inert error text showing the literal command name; **no `<img>` element or any other executable/unsafe markup was produced.** Confirms `trust:false` degrades safely under actual visual inspection, not just DOM-structure assertion.
4. **Invalid LaTeX** (`\frac{1`, unbalanced brace) — rendered as plain black text showing the raw source; no crash, no visual corruption, no red error styling bleeding into surrounding content.

**Confidence level:** high, comparable to direct browser-extension inspection. The capture mechanism differs (Playwright's screenshot API rather than the browser extension's), but the artifact inspected is identical in kind — real pixels rendered by a real Chromium instance running the actual production code path, viewed directly rather than inferred from DOM structure or unit assertions. The one gap relative to true interactive inspection: no manual interaction (clicking, resizing, hovering) was exercised, only static rendered states.

## Dependency vulnerability scan (2026-08-13)

`pnpm audit` run against the full workspace, then triaged (not just reported raw) for the 5 runtime dependencies added in Phase 9 (`katex`, `jszip`, `mammoth`, `pdfjs-dist`, `@xmldom/xmldom`):

- **`katex`, `jszip`, `pdfjs-dist`:** zero advisories at any resolved version in the tree.
- **`@xmldom/xmldom` (our own direct pin, `^0.9.11`):** zero advisories — confirmed still npm's current `latest` dist-tag, not deprecated, not superseded by anything newer since Phase 9 pinned it.
- **`mammoth@1.11.0`:** clean itself, but bundles its **own** transitive `@xmldom/xmldom@0.8.11` — a version our top-level pin does not affect, and which is vulnerable to 5 disclosed advisories. Reachability triaged directly against mammoth's source, not assumed from the advisory alone: 4 of the 5 (all XML-*serialization*-injection issues) are not reachable, since mammoth never calls `XMLSerializer`; the 5th (uncontrolled recursion, reachable via `DOMParser.parseFromString` + `getElementsByTagName`, both of which mammoth calls on every DOCX import) **is** reachable — a crafted, deeply-nested `.docx` file can crash `importDocxDocumentWithMammoth` with a stack-exhaustion `RangeError`. Full detail: `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

**Attempt 1 — bare pnpm override:** worked correctly at the dependency-resolution level (`pnpm -r why @xmldom/xmldom` confirmed a single `0.9.11` everywhere; `pnpm audit` confirmed all 5 advisories gone) but broke DOCX import completely — every test hit `TypeError: DOMParser.parseFromString: the provided mimeType "undefined" is not valid.`, because mammoth's own internal call site calls `parseFromString(string)` with no `mimeType` argument and `@xmldom/xmldom`'s entire `0.9.x` line (confirmed `0.9.0` onward) validates `mimeType` before applying its own documented default. Reverted.

**Attempt 2 — override + a scoped `pnpm patch` for mammoth (the decided-on option 2):** the patch itself was correct and minimal — mammoth's own caller (`lib/xml/reader.js:16`) already intended to pass `"text/xml"`, but its wrapper (`lib/xml/xmldom.js:4`) silently dropped the argument; the patch just declares and forwards it. This genuinely fixed the mimeType crash. But it surfaced a **second, independent incompatibility**: `@xmldom/xmldom` 0.9.x's `DOMParser` constructor immediately fires a synthetic deprecation warning through the old `errorHandler` callback (which mammoth still uses instead of the newer `onError`) before any parsing happens, and mammoth's own error-collection logic can't distinguish that warning from a real fatal parse error — so it now throws on *every* document, valid or not, for an unrelated reason. Fixing this needs a second patch, outside the single-function, one-line scope explicitly authorized for this pass. Stopped there per the standing rule against expanding a patch unilaterally; both the override and the mammoth patch were fully reverted.

**Still not fixed.** Full detail (both attempts, the exact patch diff, verification at each step, and the drafted-but-unfiled upstream issue — no `gh` CLI available in this environment) in `docs/bugs/mammoth-bundles-vulnerable-transitive-xmldom.md`.

## Publish mechanics (for whoever runs this for real)

- Publish both packages with `npm publish --tag beta` (or pnpm's equivalent), never `--tag latest`, until the criteria above are closed.
- This document does not publish anything — no `npm publish` was run as part of Phase 9 §2.6. Publishing is a real, external, hard-to-reverse action outside what an in-repo phase task should do unilaterally.
