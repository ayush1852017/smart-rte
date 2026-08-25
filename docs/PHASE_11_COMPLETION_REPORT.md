# Phase 11 completion report — Tiers 1–3 (Production Hardening)

**Verdict: Complete, with an explicit, bounded set of items deferred to human/hardware action, not silently skipped.** Tier 0 (the two stop-condition items) was closed and reported separately (`docs/PHASE_11_TIER0_COMPLETION_REPORT.md`). This report covers Tiers 1–3, undertaken because Phase 11.5's own gate 1 blocked it from starting until Phase 11 actually shipped — only Tier 0 had been done when that gap was found.

Per `CLAUDE.md`'s standing rule, `docs/bugs/` was checked before starting each item; three real, previously-undiscovered bugs were found and fixed along the way (not just tests written), and one real feature gap was found and correctly deferred rather than rushed.

## A. Implemented interfaces (verbatim)

`packages/core/src/foundation/surface/input.ts` — new private methods: `handleTableTab(tableId, currentCellId, backward)`, `tableAncestorsAt(pos)`, `handleTableShiftArrow(rowDelta, colDelta)`, `firstOwnerOf(cell)` — table Tab/Shift+Tab and Shift+Arrow cell navigation, previously nonexistent.

`packages/core/src/foundation/schema.ts` — `restoreUnknownMarks`, `baseSchema` (now exported), carried over from Tier 0; unchanged this pass except where noted.

`packages/core/src/foundation/marks/formats.ts` — `docxProperties` (now exported), new `markRunDocxProperties(node)`.
`packages/core/src/foundation/block/formats.ts` — new `blockToDocxEntry(node, quoteDepth?)`, extracted from `canonicalBlocksToDocx`'s per-node visit body (which now calls it internally, not duplicates it).
`packages/core/src/foundation/formats/featureCodecs.ts` — `inline-marks`/`colors-fonts-sizes`/`headings-alignment`/`blockquote-code` now have real `serialize` for DOCX.

`packages/core/src/foundation/surface/renderer.ts` — `FoundationSubtreeRenderer` constructor gains an `options: { contentVisibility?: boolean }` param (default `{}`, no behavior change); new private `syncContentVisibility`. `createSubtreeRenderer(root, options?)`.
`packages/react/src/canonicalEditorRuntime.ts` — `CanonicalEditorRuntimeOptions.contentVisibility?: boolean`; `firstTextSelection` fixed to exclude atomic nodes (real bug, see §E).

`packages/react/src/mediaProvider.ts` — doc comment on `MediaProvider.upload` stating the server-side-validation host responsibility explicitly.
`packages/react/src/components/CanonicalAuthorityEditor.tsx` — `insertMediaFile` gains a best-effort client-side MIME check.
`packages/react/src/theme.ts` — new `--srte-primary-pressed` custom property (real bug fix, see §E).

## B. Deviations from spec

None at the "spec vs. reality" level this pass — unlike Tier 0, the Tier 1–3 spec's own content items were investigated first (three parallel Explore passes) precisely to catch this class of surprise before planning, and it worked as intended:

- Two items the Tier 0 report listed as open (atom-corpus CI gap, "Grow selected atom" button) were found to already be fixed a week earlier, in Phase 8b — my own prior report had carried stale claims forward without re-verifying. Corrected in `docs/PHASE_11_TIER0_COMPLETION_REPORT.md` §E rather than silently re-closing them here.
- Table Tab/Shift+Arrow navigation, filed as a missing *test*, was found to be a missing *feature* — confirmed by direct code inspection before estimating scope, not assumed. Per the user's explicit decision, built rather than deferred.
- The paste-failure diagnostic, believed unwired based on a `packages/react/src`-scoped grep, was found already fully wired end-to-end once the search was widened to `packages/core` — the earlier investigation's own search radius was too narrow. Only the missing regression test was added.

## C. Locked decisions

- Table Tab/Shift+Arrow: build now, not defer (user decision, explicit).
- Real-document performance validation: paused, pending the user supplying an actual document (user decision, explicit) — not attempted with a fabricated substitute.
- content-visibility: implemented for real (not just designed) and benchmarked before deciding adoption, per the roadmap's own instruction — see §F/§H for the negative result and disposition.

## D. Exit gate results (against the original Tier 1–3 item list)

| # | Item | Result |
|---|---|---|
| 1.3 | NVDA + Chrome accessibility validation | **Not attempted** — needs a human with a real screen reader; axe-core (below) cannot substitute. `docs/MANUAL_VALIDATION_SESSION.md` still has the open row. |
| 1.4 | Physical-device IME validation | **Not attempted** — needs physical hardware; synthetic composition-event coverage already exists and is unchanged. |
| 1.5 | Native Windows Word clipboard capture | **Not attempted** — `docs/bugs/native-windows-word-clipboard-capture-gap.md` is explicit that only a real captured payload closes this. |
| 1.6 | Server-side upload MIME validation | **Done** — doc comment + client-side defense-in-depth check. |
| 1.7 | 29 deferred e2e tests | **Partial** — the two named priority groups closed in full (undo-coalescing systemic gap; table Tab/Shift-Arrow, which turned out to require building the underlying feature); 1 more (#6, multi-item list unwrap) closed from the remaining 25 plus one (#20) investigated and correctly re-scoped to a tracked feature gap rather than rushed. 23 of the original 29 remain open — see §E. |
| 1.8 | Atom-corpus CI assertion gap | **Already fixed** (Phase 8b) — corrected the stale claim, no new work needed. |
| 1.9 | "Grow selected atom" button | **Already fixed** (Phase 8b) — corrected the stale claim, no new work needed. |
| 1.10 | Marks/blocks codec slice | **Done** — DOCX serialize wired for both, per the scope doc's recommended order; HTML/Markdown/PDF deliberately deferred per the same doc. |
| 1.11 | Real-document performance validation | **Paused** — awaiting the user's document. |
| 1.12 | `content-visibility`, renderer-integrated | **Done, benchmarked, rejected** — real implementation, does not beat baseline; kept as opt-in/default-off, documented in `docs/PERFORMANCE_TRENDS.md`. |
| 1.13 | Clipboard corpus + paste-failure diagnostic | **Diagnostic already fully wired** (correcting an earlier investigation's narrower search); regression test added. Corpus expansion beyond 8 not attempted — needs real app captures. |
| 1.14 | Security review + live CVE check | **Done** — `pnpm audit` run for the first time in this repo's history; one real, shipped-dependency vulnerability found and fixed (`underscore` via mammoth); mammoth's Phase 9 revisit trigger explicitly re-checked and confirmed still valid. |
| 1.15 | Twelve scenario layers / a11y / i18n | **a11y done** (3 new axe-scanned surfaces, 2 real bugs found and fixed); **i18n explicitly not attempted** — no localization infrastructure exists in the product yet, so building a testing layer for it would test nothing real. |

## E. Known gaps and TODOs

- **23 of the original 29 deferred e2e tests remain unwritten.** Full list in `docs/PHASE_8B_FINAL_CLOSEOUT.md:29-60`. This was scoped as best-effort per the approved plan; the highest-value/highest-risk ones (systemic undo gap, table navigation, one data-loss-shaped concern) are closed.
- **`docs/bugs/mark-toolbar-buttons-no-pressed-state.md` (new, Open):** found while attempting to close GAP #20. Mark toolbar buttons (Bold/Italic/etc.) have no `aria-pressed` at all, not just a missing "mixed" case — a real accessibility gap, structurally identical to the already-fixed list-button version, but never built for marks. Documented with a concrete fix shape; not built this pass (real feature work, not a test-writing task).
- **Real-document performance validation** remains open, paused on the user providing a document.
- **NVDA+Chrome, physical-device IME, native Windows Word clipboard capture** remain open, needing resources this agent doesn't have.
- **Clipboard corpus** remains at 8 real captures; expansion needs new real-app captures, not synthetic ones.
- **i18n/RTL testing infrastructure**: recommend not building this until the product has actual localization support — building a test layer for a capability that doesn't exist would be testing nothing.
- **HTML/Markdown/PDF codec cells for marks and blocks** remain whole-document-walker-only, per the scope doc's own explicit deprioritization ("last, if at all").

## F. Verification results

- Core: 595 (Tier 0 close) → **599/599** (+4: two clipboard-diagnostic tests, two featureCodecs tests net of one removed/split).
- React: **92/92**, unchanged throughout.
- Full 3-browser e2e: **278 passed / 7 skipped / 0 failed** (up from Tier 0's 253/5/0 — 25 new passing tests: table Tab/Shift-Tab, table Shift-Arrow, 2 undo-coalescing, 1 content-visibility benchmark [chromium-only, hence 2 more skips], 3 new axe-scan surfaces ×3 browsers, 1 multi-item-unwrap ×3 browsers). Two consecutive clean full runs at the end. One transient WebKit failure mid-session (`canonical-toolbar-routing.spec.ts`'s "moves the caret to an editable line after a block atom") matched the previously-documented full-suite-load flake pattern (`docs/bugs/webkit-full-suite-timeout-flake.md`) — confirmed via isolated re-run (passed) and a second full-suite run (0 failures) before being disclosed here as a non-issue rather than hidden.
- `pnpm run lint`: green throughout, including the Phase 10 gate re-verified after every `input.ts`/`dispatch.ts`-adjacent change.
- `pnpm audit`: run for the first time this repo's history; 1 real (shipped-dependency) finding fixed, 42 dev-tooling-only findings triaged and left (see `docs/PHASE_11_SECURITY_REVIEW.md`).
- Rebuilt `packages/core` before every `packages/react`/e2e verification pass throughout, per the established stale-dist lesson.

## G. Real bugs found and fixed (not just tests written)

1. **`docs/bugs/replacevalue-crashes-when-document-starts-with-an-atom.md`** — `firstTextSelection` treated an atomic node with empty `children` as a valid text-caret target, crashing when an atom was the first block. Found while seeding a test document; fixed.
2. **`docs/bugs/toolbar-pressed-state-insufficient-color-contrast.md`** — pressed toolbar buttons measured 4.43:1 contrast against WCAG AA's 4.5:1 minimum. Found by the new axe-core coverage; fixed with a dedicated `--srte-primary-pressed` color.
3. **`docs/bugs/mark-toolbar-buttons-no-pressed-state.md`** — found, correctly scoped as real feature work, and deferred rather than rushed (see §E).

## H. Scope leakage

- `docs/PHASE_9_EXIT_GATES.md` and `docs/PHASE_9_CODEC_REFACTOR_SCOPE.md`-referencing text were updated to reflect the marks/blocks codec slice landing — a necessary correction to a standing exit-gate record, not new scope.
- `docs/PERFORMANCE_TRENDS.md` gained a new dated section recording the content-visibility benchmark result — the negative-result-recording precedent this project already follows (the original naive experiment is recorded the same way).
- No other out-of-scope changes.

## Summary

Every automatable Tier 1–3 item is either done, correctly paused pending external input (real document), or explicitly flagged as needing human/hardware resources this agent doesn't have. Nothing was faked, silently skipped, or claimed done without verification.

**Update 2026-08-19 (same day): the product owner explicitly waived all four remaining items** (NVDA+Chrome, physical-device IME, native Windows Word clipboard capture, real-document performance validation) rather than resolving them. This is a deliberate decision to ship v1.0 without that validation, not evidence the underlying behavior is fine — recorded here and in `docs/PHASE_ROADMAP_8B_12B.md` as the explicit decision point, so it isn't later mistaken for "these were checked and passed." **Phase 11 is now fully closed. v1.0 may ship. Phase 11.5's gate 1 is satisfied.**
