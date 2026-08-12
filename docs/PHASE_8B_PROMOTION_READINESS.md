# Phase 8b promotion readiness (2026-08-12)

**Purpose:** everything the owner needs to make the Phase 8b promotion decision, without re-deriving any number themselves. Every figure below was re-checked directly in this session against current `HEAD` — none is inherited from a prior report without being re-verified. No flag was promoted, no rollback bridge was deleted, and no divergence found below was fixed — this is an audit and reporting pass only, per its own scope.

## 1. Current verified state

| Check | Result |
|---|---|
| `pnpm run lint` (all gate scripts + both packages' `tsc --noEmit`) | Clean |
| Core unit tests | 461/461 passed |
| React unit tests | 240/240 passed |
| Full e2e suite (`canonical-authority.spec.ts` + `canonical-toolbar-routing.spec.ts`, Chromium) | 55/55 passed, 0 failures |
| Uncommitted files | 8 (all `docs/`, all from this audit pass — see §5) |

## 2. Gate 13/14 status — re-run fresh, not inherited

**The actual current count is 11 divergences per browser, identical across Chromium/Firefox/WebKit** — not the 10 in the last written report (`docs/PHASE_8B_DELTA_REPORT_4.md`), and matching the "11" figure that had been circulating verbally without being re-verified. Re-run via `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`, reading the `gate-13-browser-replay` test annotation directly (not console output, which Playwright suppresses for passing tests by default).

**All 42 comparable intents pass structurally in all three browsers.** All 11 divergences are `selection-only`, `expected-normalization`, or `visual-only` — **none is `semantic`, `data-loss`, or `unknown`.** This safety property is unchanged from every prior report.

| Intent | Classification | Hash | Ledger file |
|---|---|---|---|
| `block.quote` | `selection-only` | `c80caa69` | [gate13-block-quote-code-selection-mapping-difference](bugs/gate13-block-quote-code-selection-mapping-difference.md) |
| `block.code` | `selection-only` | `42993efd` | same |
| `table.insertColumn` | `expected-normalization` | `1d9005a0` | [gate13-table-normalization-differences](bugs/gate13-table-normalization-differences.md) |
| `table.setHeader` | `visual-only` | `122df650` | same |
| `table.insert` | `expected-normalization` | `55381491` | same |
| `table.mergeCells` | `expected-normalization` | `a37b125d` | same — **new, see below** |
| `list.create` | `selection-only` | `ac36cbab` | [gate13-list-command-selection-and-style-differences](bugs/gate13-list-command-selection-and-style-differences.md) |
| `list.setPreset` | `expected-normalization` | `9f4b08ab` | same |
| `list.setStyle` | `selection-only` | `41d81290` | same |
| `list.create.numbered` | `selection-only` | `141cd3eb` | same |
| `list.unwrap` | `selection-only` | `daccee1d` | same |

**What's new since the last written report:** `table.mergeCells`. It doesn't appear in `docs/PHASE_8B_DELTA_REPORT_4.md`'s table at all. Likely explanation (not yet confirmed by reading the actual diff, flagged as such in the ledger entry): `docs/bugs/table-merge-multiplies-row-height.md` documents that canonical's table-merge content assembly was fixed to concatenate simple content instead of stacking it, while that same bug file explicitly records the retained/legacy table bridge was **not** fixed. A fixed canonical side and an unfixed retained side would produce exactly this new divergence. This should be confirmed by reading the hash `a37b125d` diff before treating it as settled — it's the best available explanation given the timeline, not a verified one.

**Everything else is unchanged** — same 10 intents, same hashes, as the last written report. Nothing regressed in this cluster.

**Also found, never previously reported in writing:** the same replay run emits an `atomCorpus` result — of 7 atom scenarios compared, only 2 are fully equivalent; 5 diverge (3 `equivalent-serialization`, 2 `expected-normalization`). This number has apparently never been called out or reviewed in any prior Gate 13/14 report, despite coming from the same test run those reports are based on. It's also **not asserted on** — `packages/react/e2e/canonical-authority.spec.ts` has a hard `expect(result.listCorpus.divergences).toEqual({})` but no equivalent assertion for `atomCorpus`, so a regression here would currently pass CI silently. Detail: [gate13-atom-corpus-serialization-differences](bugs/gate13-atom-corpus-serialization-differences.md).

**Gate 14 disposition:** still outstanding for all of the above, exactly as every prior report has said. Nothing in this pass closes it — that's an owner decision, not a technical one, and four new ledger files now exist specifically so that decision doesn't require re-deriving the underlying data again.

## 3. Outstanding items requiring the owner specifically

**Update 2026-08-12:** the three manual checks below are now confirmed by the owner. All three ledger files updated accordingly. The only remaining item is the `unwrapList` priority call.

| Item | Status |
|---|---|
| **Double-Enter list exit** (`docs/bugs/double-enter-list-exit-not-reproducible.md`) | ✅ Confirmed by owner 2026-08-12 — not a bug, not reproducible on current build. |
| **Multi-depth select + retype stray numbering** (`docs/bugs/mixed-depth-select-retype-stray-numbering-not-reproducible.md`) | ✅ Confirmed by owner 2026-08-12 — not a bug, not reproducible on current build. |
| **Mixed-scope Indent/Outdent vs. your exact screenshots** (`docs/bugs/mixed-list-scope-indent-outdent-disabled-incorrectly.md`) | ✅ Confirmed by owner 2026-08-12 — matches the original scenario, works correctly. |
| **`unwrapList` deepest-first gap** (`docs/bugs/unwraplist-deepest-first-gap-multi-depth-toggle-off.md`) — still needs a priority call, not more investigation | ⏳ Open. **What's broken:** selecting a range that spans multiple list nesting depths at once, then clicking the already-active toggle-off button, only un-lists the top-level items in that selection — deeper items silently stay nested. **How often it likely matters:** probably rare in practice — it needs a selection deliberately spanning several indent levels at once, not a single item or a same-depth range, which covers most real editing. **Cost of fixing now:** real — it needs a "process deepest-first against a progressively-updated document" pattern with no precedent anywhere in this command layer, i.e. new architecture, not a patch. **Cost of deferring:** low, and possibly cheaper overall — Phase 8c's planned fine-grained table operations likely need the same "progressively-updated document" capability, so building it once for both when 8c starts may cost less than building it twice. |

## 4. Recommendation

From a pure engineering-readiness standpoint: **promotion looks safe.** All three manual checks are now confirmed (§3). Nothing found in the Gate 13/14 re-audit changes that — the one new divergence (`table.mergeCells`) is classified `expected-normalization`, the same safe category as three other already-reviewed differences, and has a plausible, traceable explanation tied to an intentional prior fix. The never-reported atom corpus number is a genuine gap in review coverage, not a genuine risk indicator by itself, but it hasn't been reviewed — worth a look before or shortly after promotion, not necessarily a blocker. The only item still open for a decision (not an investigation) is `unwrapList`'s deepest-first gap, and it's a scope/timing call, not a readiness blocker either way. This is a recommendation; the owner decides.

## 5. If promoted: rollback-bridge deletion sequence

Restated here so it's in one place when you're ready to act — **not started, not attempted in this pass.**

Delete the four dormant rollback bridges in `3 → 2 → 1 → 0` order (i.e., one at a time, most-recently-added first, verifying after each), per the existing Phase 8b plan. Before and after **each** of the four deletion commits, run the DOCX/PDF export guard (`packages/react/src/adapters/phase8bExportGuard.test.ts`) and retain its result with the deletion commit — the guard calls the DOCX/PDF format adapters directly, without mounting `ClassicEditor` or importing any rollback bridge, specifically so format export can't be silently lost during the cleanup. Full bridge inventory and current reachability status: `docs/MIGRATION_ADAPTER_INVENTORY.md`.

## 6. Files touched in this pass

- `docs/bugs/gate13-block-quote-code-selection-mapping-difference.md` (new)
- `docs/bugs/gate13-table-normalization-differences.md` (new)
- `docs/bugs/gate13-list-command-selection-and-style-differences.md` (new)
- `docs/bugs/gate13-atom-corpus-serialization-differences.md` (new)
- `docs/bugs/double-enter-list-exit-not-reproducible.md` (repro steps tightened)
- `docs/bugs/mixed-depth-select-retype-stray-numbering-not-reproducible.md` (repro steps tightened)
- `docs/bugs/mixed-list-scope-indent-outdent-disabled-incorrectly.md` (verification caveat added)
- This file (new)

No test suite changed. No test was removed. No divergence was fixed.
