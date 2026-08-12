# Phase 8b final closeout (2026-08-12)

**Purpose:** the complete record of Phase 8b's final closeout — promoting `canonicalAuthorityFlag` to on-by-default, retiring `LegacyClassicEditor` and the four rollback bridges, and everything that surfaced along the way. Written incrementally as the work happened, not reconstructed afterward.

## 1. The "full e2e suite" was never actually the full e2e suite

**This is a finding about the promotion decision itself, not just a bridge-deletion side effect.**

`docs/PHASE_8B_PROMOTION_READINESS.md` (2026-08-12, the report that recommended promotion) reported: *"Full e2e suite (`canonical-authority.spec.ts` + `canonical-toolbar-routing.spec.ts`, Chromium) | 55/55 passed, 0 failures."* That framing — "full e2e suite" meaning those two files — was carried forward from earlier session reports and used, unchallenged, as the basis for every verification step in this closeout up through retiring `LegacyClassicEditor`.

It was wrong. `packages/react/e2e/` contains 12 spec files. The actual, tooling-level definition of "the e2e suite" is `pnpm e2e` (both root and `packages/react` READMEs point at it correctly) — `playwright test --pass-with-no-tests` with **no file filter**, i.e. all 12 files. The narrower two-file definition was never a real project convention; it was informal shorthand from prior report-writing that got treated as authoritative without anyone checking it against `package.json`.

**How this was discovered:** after retiring `LegacyClassicEditor` and deleting the Phase 8a (clipboard) and Phase 5 (block) rollback bridges — all verified clean against the two-file "full suite" — a routine broader check (`playwright test e2e/ --project=chromium`, run because the block-bridge deletion touched a second playground surface, `CanonicalSurface.tsx`, that the two-file suite doesn't exercise) turned up mass failures in 5 files nobody had run this session: `list-workflows.spec.ts`, `table-workflows.spec.ts`, `formatting-workflows.spec.ts`, `format-runtime-workflows.spec.ts`, `remaining-workflows.spec.ts` (30 tests total).

**Why they broke:** all 30 tests navigate to `/` (the pre-promotion default route) and share two legacy-specific patterns:
1. Content seeding via `element.innerHTML = html; element.dispatchEvent(new InputEvent(...))` — canonical's model doesn't observe raw DOM mutation as a source of truth (same root cause as the retired "reports the first divergence..." test in §2 below), so this silently desyncs canonical's internal state from what's visibly on screen.
2. Toolbar selectors using `getByTitle(...)` / CSS `[title="..."]`, matching an HTML `title` attribute legacy's toolbar set. Canonical's toolbar uses `aria-label` on plain `<button>` elements instead — `title`-based selectors never find anything and every affected test times out (30.1s Playwright default) rather than failing fast.

**Coverage impact — verified exactly, not estimated.** A dedicated research pass read all 81 relevant tests in full (the 30 broken ones plus all 41 tests in `canonical-authority.spec.ts` and all 10 in `canonical-toolbar-routing.spec.ts`) and classified each of the 30 against genuine scenario-level overlap, not just topical similarity:

| Verdict | Count | Meaning |
|---|---|---|
| DUPLICATE | 1 | Genuinely covered elsewhere already; safe to lose. |
| PARTIAL | 8 | Existing test covers part of the scenario; a real, specific piece is untested. |
| GAP | 21 | No existing test covers this scenario at all. |

Full test-by-test table:

| # | File | Test | Verdict | Note |
|---|---|---|---|---|
| 1 | list-workflows | changes a selected bullet list to an alphabetic ordered list | GAP | no test converts a populated bullet list via range selection w/ literal CSS check |
| 2 | list-workflows | overrides imported per-item marker styles when changing list type | GAP | no equivalent |
| 3 | list-workflows | changes a mouse-selected bullet list to an alphabetic ordered list | GAP | no real mouse-drag text selection + list-type change test |
| 4 | list-workflows | changes hierarchy when selection crosses nested/outer items | GAP | no equivalent trigger shape |
| 5 | list-workflows | applies a depth-aware preset to a selected list hierarchy | PARTIAL | covered via API-set caret, not real range selection; marker string not checked |
| 6 | list-workflows | removes an existing ordered list without losing its items | GAP | existing test shows the opposite behavior (single-item-only unwrap) |
| 7 | list-workflows | converts a partially selected nested list as a complete subtree | GAP | no equivalent |
| 8 | list-workflows | undoes and redoes a nested list conversion as one history step | GAP | **Undo/Redo buttons are never clicked anywhere in canonical-authority.spec.ts or canonical-toolbar-routing.spec.ts** |
| 9 | list-workflows | moves a list item up and down (nested case) | PARTIAL | flat-list move covered; nested-child-travels-with-parent is not |
| 10 | list-workflows | converts heading + partial nested selection | GAP | no equivalent |
| 11 | list-workflows | numbered-list button preserves heading + descendants | GAP | no equivalent |
| 12 | table-workflows | inserts a table through the real toolbar | GAP | different insert mechanism (dialog+3×3 vs. direct button+2-row) |
| 13 | table-workflows | merges/splits a cell range without losing content | PARTIAL | structure covered; actual cell **text** preservation through merge+split is not |
| 14 | table-workflows | undoes and redoes a cell merge as one history step | GAP | Undo/Redo never clicked |
| 15 | table-workflows | routes row/column changes | PARTIAL | "add row" covered w/ counts; column/delete only in generic replay w/o concrete counts |
| 16 | table-workflows | snaps cell selection to spans, overlay stays out of content | GAP | overlay concept doesn't exist in canonical tests |
| 17 | table-workflows | expands rectangular cell selection with Shift+Arrow | GAP | no equivalent |
| 18 | table-workflows | Tab precedence appends row at final cell | GAP | no equivalent |
| 19 | table-workflows | leading headers with scope/headers associations | GAP | accessibility markup untested |
| 20 | formatting-workflows | bold on mixed selection updates toolbar state | GAP | `aria-pressed="mixed"` never asserted for any mark button |
| 21 | formatting-workflows | changes heading + alignment for selected block | GAP | only in generic replay w/o concrete assertions |
| 22 | formatting-workflows | native link preserving selected label | PARTIAL | link creation covered via `window.prompt`, not the rich popover; label preservation not asserted |
| 23 | formatting-workflows | undoes and redoes inline formatting as one history step | GAP | Undo/Redo never clicked |
| 24 | format-runtime-workflows | exports content through HTML format runtime | GAP | only Native/JSON/DOCX/PDF export tested |
| 25 | format-runtime-workflows | imports HTML through format runtime | PARTIAL | import covered via raw file input, not menu+filechooser; list canonicalization unchecked |
| 26 | format-runtime-workflows | imports Markdown through format runtime | GAP | no Markdown import tested at all |
| 27 | remaining-workflows | creates/removes checklist preserving checked state | PARTIAL | creation/checking covered; **removal** untested |
| 28 | remaining-workflows | blockquote + code block commands | **DUPLICATE** | both halves genuinely covered elsewhere |
| 29 | remaining-workflows | inserts formula through real dialog | PARTIAL | insertion covered via `window.prompt`, not the richer LaTeX-input dialog |
| 30 | remaining-workflows | coalesces image resize drag into one undo step | GAP | canonical only has discrete grow/shrink buttons; no drag, no Undo |

**Systemic gap, not just a list of individual misses:** Undo/Redo buttons are never clicked in either canonical spec file, at all — that alone accounts for 4 of the 30 GAPs and means multi-operation-undo-as-one-step (a real, subtle correctness property) has zero coverage anywhere in the canonical suite today.

**Disposition (owner decision, 2026-08-12):** the 5 files were retired (deleted) rather than rewritten in this closeout pass, given the scale (21 new tests + 8 extensions). This is tracked as explicit follow-up work, not silently dropped:

- **Priority, per owner instruction:** table Tab/Shift+Arrow navigation precision (#17, #18) and undo-coalescing (the systemic gap: #8, #14, #23, #30, plus general Undo/Redo coverage) should be addressed first when this work resumes — these are exactly the class of interaction-level, real-keyboard-driven bugs that have caused the worst regressions in this migration (block-move selection corruption, indent/outdent mixed-scope gaps), and losing dedicated coverage for them at the same moment the legacy safety net disappears is the highest-risk part of this gap.
- Remaining 25 items follow in whatever order Phase 9 planning assigns them.
- Rewritten tests must drive canonical the way `canonical-authority.spec.ts` already does: real toolbar clicks (`aria-label`-based selectors, not `title`), real keyboard/mouse interaction, and content seeding via a canonical-compatible mechanism (the real "Import document" button + file chooser, or `window.__smartProductCanonical.replaceValue(...)`) — never raw `innerHTML` + synthetic events.

**Process fix, so this can't recur silently:** going forward in this project, "run the full e2e suite" means `pnpm e2e` (or `playwright test e2e/` with no path filter) across all files present in `packages/react/e2e/` at the time, not a remembered subset from a prior report. No doc or script needed correcting — the tooling was already right; the gap was entirely in how prior verification passes described their own scope without checking it against `package.json`.

## 2. Also retired in the same investigation: one dual-implementation e2e test

`canonical-authority.spec.ts`'s "reports the first divergence across the retained-vs-canonical lifecycle trajectory" test opened two pages — one navigating to `/?sessionReplay=1` (pre-promotion: legacy), one to `/?canonicalAuthority=1&sessionReplay=1` (canonical) — and asserted their behavior stayed equivalent across a sequence of intents. Once `LegacyClassicEditor` was retired, both pages render canonical, and one intent (`external-replacement`'s legacy branch: raw `innerHTML` mutation + synthetic `input` event) desynced canonical's model from its own DOM — the same root-cause pattern as §1. The test's entire premise (two different real implementations) no longer held, so it was removed rather than fixed. See the retirement commit for full detail.

## 3. Flag promotion

`canonicalAuthorityFlag`'s default (`packages/react/src/canonicalAuthorityFlag.ts`) was flipped from `false` to `true` (`a0506af`). Before flipping it, confirmed no existing test's behavior depended on the previous default: the playground and every e2e test always passed an explicit `canonicalAuthority` prop (never relying on fallthrough), and the four `ClassicEditor.*.test.tsx` unit suites imported the legacy module directly, bypassing the flag-aware wrapper entirely. Full 3-browser e2e (the two-file subset, at that point in the work — see §1 for why that subset was itself an incomplete definition) was identical before and after: 163 passed, 2 pre-existing skips, 0 failures.

## 4. LegacyClassicEditor retirement

Deleting the four rollback bridges required retiring `LegacyClassicEditor` first (`60adfb7`) — all four were its command engine with no other implementation underneath, so deleting them first would not have compiled. This was flagged and explicitly re-confirmed with the owner before proceeding, given it meant:

- A breaking change to the published package's public API: `LegacyClassicEditor` (previously a separate, directly-importable export, usable independent of the flag) no longer exists.
- `ClassicEditorAuthority` (exported as `ClassicEditor`) now unconditionally renders `CanonicalAuthorityEditor`. Legacy-only configuration props (`table`, `media`, `formula`, `features`, `plugins`, `formats`, `mediaManager`, `fonts`, `theme`, `preserveFontFamily`, etc.) remain accepted on `ClassicEditorProps` as inert/ignored fields, for source compatibility, rather than being removed outright.
- Deleted: `ClassicEditor.tsx` (6,069 lines), `editorController.ts`, and their five dedicated test files.
- Six lint-gate scripts (`check-phase2-5-contract.mjs` through `check-phase8b-contract.mjs`) hardcoded reads of `ClassicEditor.tsx` to assert it hadn't regressed to legacy DOM primitives (raw `execCommand`, direct table DOM mutation, KaTeX trust config, etc.). Those assertions became vacuous by the file's absence and were removed. One real, carried-forward gap surfaced in the process: `check-phase7-contract.mjs`'s KaTeX `trust: false`/`strict: "error"` assertion had nothing to repoint at — that config lived only in the deleted file, and canonical's formula insertion has no live KaTeX rendering at all (it stores LaTeX source as data via a `window.prompt`, unlike legacy's rendered math). This is a real, pre-existing functional gap in canonical (no live math typesetting), not something this closeout introduced — flagged here since nothing else in this codebase surfaces it.
- `check-phase8b-contract.mjs`'s "product export routes through the runtime rollback flag" check was inverted to "unconditionally renders canonical, no legacy reference remains" — there is nothing left to roll back to.
- One e2e test retired as a direct consequence: see §2 above.
- 30 more e2e tests broken as an indirect consequence, discovered later: see §1 above.

## 5. The four rollback bridges

Deleted in `3 → 2 → 1 → 0` order (most-recently-added first), each gated by the DOCX/PDF export guard and the full e2e suite before and after, one commit per bridge:

| Order | Bridge | Phase | Commit | Notable complication |
|---|---|---|---|---|
| 1 | `canonicalClipboardRuntime.ts` | 8a | `7915bc9` | None — LegacyClassicEditor-only. Canonical's own paste handling was always a separate, independent implementation (`packages/core/src/foundation/surface/input.ts`); `check-phase8a-contract.mjs`'s product-boundary assertion was repointed there. |
| 2 | `domBlockCommandBridge.ts` | 5 | `45c6832` | Also load-bearing for Gate 13/14 test evidence: `blockShadowComparator.ts` (+3,000-case unit test), `legacyBlockEngine.ts` (frozen legacy snapshot), 7 of 42 browser-replay comparable intents, and a second playground surface (`CanonicalSurface.tsx`, not covered by `tsc` lint — only caught by actually running the dev server) with its own dedicated diagnostic hook and e2e test. All retired together. |
| 3 | `canonicalInlineCommandBridge.ts` | 4 | `c034ef8` | Same dual-purpose pattern as the block bridge: `inlineShadowComparator.ts` (+3,000-case unit test), `legacyInlineEngine.ts`, 12 of the remaining 35 comparable intents, and the same second `CanonicalSurface.tsx` surface. |
| 4 | `canonicalListCommandBridge.ts` | 3 | `e15a326` | None — already fully orphaned by LegacyClassicEditor's retirement; `legacyListShadowComparator.ts` had always used pure canonical commands directly, never this DOM bridge. No dedicated test file existed for it. Trivial, zero-fallout deletion. |

`Gate13ReplaySurface.tsx`'s `comparableIntents` count: **42 → 35** (bridge 2) **→ 23** (bridge 3). This number can no longer increase back toward 42 — the parity evidence for the retired 19 intents (7 block + 12 mark) cannot be regenerated; that is the intended, accepted consequence of closing Gate 14, per owner decision, not an oversight.

## 6. Cleanup pass

- Confirmed repo-wide: zero `execCommand` references outside `docs/` and the lint script's own self-excluded detection regex.
- Confirmed zero remaining `ROLLBACK_ADAPTER`/`MIGRATION_ADAPTER` marker strings, and zero stale `LegacyClassicEditor` references outside intentional historical comments and the phase8b contract's own forbidden-reference check.
- `docs/MIGRATION_ADAPTER_INVENTORY.md` rewritten from a live inventory to a closed historical record (all four bridges marked deleted, with commit hashes).
- `packages/react/playground/src/App.tsx`'s `preserveFontFamily` prop wiring removed — fully inert since `ClassicEditor` no longer reads it, and its comment ("compared against a real legacy capability") was actively wrong post-retirement. The `canonicalAuthority`/`value`/`defaultValue` seeding split was deliberately left alone: it still does real seeding work for existing e2e tests regardless of the URL param's presence, even though it no longer selects between two different editor implementations.

## 7. Final verification state

As of `1d7b74f` (this closeout's last commit):

| Check | Result |
|---|---|
| `pnpm run lint` (all gate scripts + both packages' `tsc --noEmit`) | Clean |
| Core unit tests | 461/461 |
| React unit tests | 122/122 (down from 240/240 at closeout start — accounted for entirely by deleted legacy-only/retired-bridge test files, not by any test going from passing to failing) |
| DOCX/PDF export guard | Passed at every one of the four bridge-deletion steps, before and after |
| Full e2e suite — **all 7 remaining spec files**, all 3 browsers (the corrected definition; see §1) | 250 passed, 5 pre-existing/expected skips (one chromium-only headed-mode test, one opt-in-only `SRTE_PROFILE=1` profiling test, both browser/env-restricted by design), 0 failures |

One transient webkit failure was observed mid-sequence (`tracks the Block type dropdown with the current caret owner`, `runtime.replaceValue` undefined) — reproduced as a pre-existing parallel-run timing flake, not a regression: passed 3/3 in isolated re-runs and passed cleanly on chromium/firefox in the same full run. Not present in the final verification pass above.

## 8. Outstanding follow-up (not closed by this pass)

1. **29 e2e tests need rewriting or extending** against canonical (21 new, 8 extending existing partial coverage) — see §1's full table. Owner-prioritized order: table Tab/Shift+Arrow navigation precision and undo-coalescing first (these are exactly the class of interaction-level, real-keyboard-driven bugs responsible for the worst regressions in this migration — block-move selection corruption, indent/outdent mixed-scope gaps — and the systemic Undo/Redo gap in particular has zero coverage anywhere in the canonical suite today), then the remaining 25 in whatever order Phase 9 planning assigns them. Rewritten tests must drive canonical the way `canonical-authority.spec.ts` already does: real `aria-label`-based toolbar interactions, real keyboard/mouse, content seeded via the real "Import document" flow or `window.__smartProductCanonical.replaceValue(...)` — never raw `innerHTML` + synthetic events.
2. **Canonical has no live KaTeX (or equivalent) formula rendering** — it stores LaTeX source as data via a `window.prompt`, with no rendered math typesetting. Legacy had this via a security-hardened (`trust: false`, `strict: "error"`) KaTeX integration that's now gone along with it. Not caused by this closeout; surfaced by it, via the lint-gate check that used to guard it.
3. **`canonicalAuthorityFlag` is now fully vestigial** — nothing reads its resolved value anymore (`ClassicEditorAuthority` no longer branches on it), but the class, its full `setGlobal`/`setTenant`/`setDocument`/`enabled()` API, and its public export from `index.ts` were all deliberately left in place rather than also removed, since that would be an additional breaking-API-surface decision beyond what was explicitly authorized in this closeout. Whether to deprecate/remove it is a separate decision for whoever owns the public API surface next.

## 9. Completion statement

Phase 8b is closed: `canonicalAuthorityFlag` is on by default, `LegacyClassicEditor` and all four rollback bridges are deleted, canonical authority is the repository's only editor implementation, and the repository-wide single-authority exception this phase existed to close is closed. What remains open is explicitly tracked, not silently dropped: the 29-test e2e follow-up (§8.1), the KaTeX rendering gap (§8.2), and the `canonicalAuthorityFlag` deprecation question (§8.3).
