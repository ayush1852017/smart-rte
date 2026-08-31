# Pre-publish independent audit — 2026-08-30

**Recommendation: NO-GO.** Two Critical and several High findings below must be fixed and separately re-verified before Part 2 (the actual `npm publish`) proceeds. Per the standing rule for this audit, Part 2 was not started in this pass.

This audit was run fresh, independently of any prior completion report, against the working tree as it exists right now (`core-implementation` branch). Every claim below was verified directly — by running the actual command, reading the actual source, or reproducing the actual behavior — not inferred from a prior report's own description of itself.

---

## 1. Working tree state — FINDING (High): uncommitted work has recurred

`git status --short` shows **49 files** not committed: 26 modified, 23 untracked. This is materially the same class of finding as the 2026-08-25 audit's top finding (151 uncommitted files then). Contents:

- Modified: `packages/core/src/foundation/{editor.ts, modelDom.ts, surface/{input.ts,renderer.ts}, table/{schema.ts,commands.ts}, formats/docx/export.ts, clipboard/corpus.test.ts, formats/docx/format.test.ts, marks/marks.test.ts, list/formats.ts}`, `packages/react/src/{theme.ts, components/{CanonicalAuthorityEditor.tsx, ColorPickerPopover.tsx, LinkEditorPopover.tsx, MediaOverlay.tsx}}`, `packages/react/e2e/*.spec.ts`, `packages/react/package.json`, `pnpm-lock.yaml`, plus 4 `docs/bugs/*.md` updates.
- Untracked: 4 new React components (`TableBorderPopover.tsx`, `TableSizePickerPopover.tsx`, `FormulaLibraryPopover.tsx`, `SpecialCharacterPopover.tsx`, `ToolbarPrimitives.tsx`), 2 new data modules (`formulaLibrary.ts`, `specialCharacters.ts`), `e2e/toolbarHelpers.ts`, and 11 new `docs/bugs/*.md` entries.

This is the entire toolbar-redesign follow-up, formula library, special-character picker, and table-border-options feature work from this session — real, tested, working code (verified below), just not committed. **This blocks publishing as-is**: publishing from an uncommitted working tree means the published artifact corresponds to no git commit or tag, breaking traceability for every future bug report against this release, and directly contradicts basic release hygiene. Fix: commit this work (with the user's review/approval of the commit boundaries) before proceeding.

## 2. Full suite, fresh, unfiltered

**Core** (`pnpm --filter smartrte-core test`): **723/723 passed**, 81 files.

**React unit** (`pnpm --filter smartrte-react test`): **132/132 passed**, 30 files.

**Full e2e** (`pnpm --filter smartrte-react run e2e` — the actual script, chaining a fresh core build, a fresh react build, then `playwright test --pass-with-no-tests` with no filter, all 3 default projects): **528 total — 517 passed, 4 failed, 7 skipped.** Exit code was non-zero on this literal run.

All 4 failures individually re-verified in isolation (`--repeat-each=3`) and confirmed non-reproducing (parallel-load timing flakes, not regressions):
- `[firefox] partial-cross-paragraph-delete.spec.ts` × 2 — already documented, long-standing, unrelated to any current change.
- `[webkit] canonical-authority.spec.ts:5385` "deletes an inserted image atom via the media overlay" — 3/3 pass in isolation.
- `[webkit] canonical-surface.spec.ts:729` "Backspace merges into the deepest preceding descendant and Delete mirrors forward" — 3/3 pass in isolation.

All 7 skips individually explained, none unexplained:
- 2× `canonical-authority.spec.ts:2465` "captures the headed content-visibility experiment separately from production" — `test.skip(project !== "chromium", ...)`, a deliberate one-browser decision-input trace, not a regression test.
- 2× `canonical-authority.spec.ts:2502` "benchmarks the renderer-integrated content-visibility design against production" — same reason.
- 3× `canonical-performance-profile.spec.ts` "profiles identical 10k canonical surfaces" — skips on non-chromium AND unless `SRTE_PROFILE=1` is set (not set in a normal run), so skips on all 3 projects; explicitly documented in-file as "not a regression test."

**No unexplained failure or skip.** This item is clean.

## 3. `docs/bugs/` ledger spot-check

137 entries total. Sampled 20 across categories:

- **All 6 "Open" entries** re-verified (see §4 below) — all still accurately described.
- **9 "Fixed" entries'** cited regression tests confirmed to actually exist with matching names (not just trusted): `table-column-width-not-rendered` → `tableColumnWidth.test.ts` (5 tests, exists); `table-resize-shrinks-table-with-no-prior-columnwidths` → cited test name found verbatim in `table.test.ts`; `mammoth-own-reader-unguarded-recursion-dos` → `nestingGuard.test.ts` (6 tests, exists); `mapoperation-position-arithmetic-gaps` → `rebase.property.test.ts` (13 tests) + `dispatch-rebase.test.ts` (3 tests), both exist; `addmark-boundary-bias-inconsistent-with-inserttext` → cited test name found verbatim in `rebase.property.test.ts` line 193 (initially searched the wrong file by guessing from context — found on broadening the search, a reminder to verify by grep, not assumption). Zero discrepancies found in this sample.
- **`concurrent-rebase-non-transformable-conflicts.md`** (the moveNode/merge-absorption entry, see §4) additionally spot-checked at the code level: `rebase.property.test.ts`'s described test names (Cases A/B/C, non-adjacent merge, mergeNode-vs-unrelated-insertNode) all present verbatim.

No "Open" entry was found to have been silently fixed as a side effect of other work, and no "Fixed" entry's cited coverage was found to be missing or misdescribed in this sample. Given the sample was clean, a full 137-entry audit was not performed — flagging this as a scope limitation of this pass, not a claim that all 137 are individually re-verified.

## 4. Known open items — re-confirmed

- **`formula-mathml-notation-not-rendered.md`**: re-verified directly. `surface/renderer.ts`'s formula rendering has no reference to `notation` anywhere (grepped). `CanonicalAuthorityEditor.tsx`'s formula-insert path (now including this session's new formula-library flow) still hardcodes `notation: "latex"` (confirmed at the new `insertFormulaFromLibrary` call site). **Still accurate, unchanged.**
- **`insert-table-while-inside-another-table-silently-no-ops.md`**: re-reproduced live in a real browser (not just read) — inserted a table, placed the caret inside its first cell, invoked "Insert table" again: document structure byte-for-byte unchanged before/after. **Still accurate, unchanged.**
- **moveNode/merge-absorption rebase-conflict scoping** (`concurrent-rebase-non-transformable-conflicts.md`, status "Fixed" but scoped): re-read in full. The entry is explicit that this is a *deliberate, disclosed scope decision* — "conflicts explicitly, never silently corrupts," not "always transforms" — and that fixing `moveNode` fully would require redefining `.to`'s semantics for every existing caller, out of scope. This framing is still accurate; nothing in the current codebase has quietly resolved or invalidated it.
- Also checked the other 3 Open entries (`unwraplist-deepest-first-gap-multi-depth-toggle-off`, `native-windows-word-clipboard-capture-gap`, `production-input-to-paint-10k-exceeds-budget`) and the root-cause-open-but-mitigated `mammoth-office-xml-reader-collapse-alternate-content-recursion.md`: none of their cited source files have been touched since filing (confirmed via `git log` / mtimes), and the mitigation artifact (`nestingGuard.ts`) is still present and unchanged. **All still accurate.**

## 5. Dependency/security state — FINDING (Medium): mammoth revisit trigger has fired

- `pnpm audit` (full, including devDependencies): **42 vulnerabilities (1 critical, 27 high, 13 moderate, 1 low)** — all traced to dev-tooling transitive chains (`eslint`→`js-yaml`, `vitest`/`vite`→`postcss`, `storybook`/`@vitejs/plugin-react`→`@babel/core`), confirmed via the reported dependency paths.
- **`pnpm audit --prod`: zero vulnerabilities.** The actual production dependency tree that ships to consumers is clean. This is the number that matters for a publish decision; the full-audit count is a dev-environment/CI-supply-chain concern, not a published-package risk.
- `underscore` CVE fix (Phase 11): confirmed still in effect. `pnpm why underscore -r` shows `underscore@1.13.8` resolved everywhere it appears (via `mammoth → lop → duck`), matching the root `pnpm.overrides` pin. No regression.
- `@xmldom/xmldom` override: confirmed still in effect, resolved to `0.9.11` everywhere, matching the override.
- **Mammoth version gap has widened, and the standing revisit trigger is explicitly hit by this decision point.** `docs/PHASE_9_MAMMOTH_FINAL_DECISION.md`'s own text: *"Revisit trigger... before any `latest`-tag publish... has anything changed about mammoth's reachable surface, has a new candidate been found..."* Currently pinned at `mammoth@1.11.0` (with `patches/mammoth@1.11.0.patch` applied via `pnpm.patchedDependencies`, confirmed present and referenced correctly in `package.json`). Live upstream is now **`1.12.2`** (was `1.12.1` when Phase 11's security review last checked) — the gap has grown by one more patch release. Nothing in this session's work touched mammoth/DOCX-import code, so no *new* reachable-surface issue was found through routine use — but the trigger's own condition ("before any latest-tag publish") is unambiguously met by this prompt's Part 2.1 decision, and re-affirming (not silently skipping) the "stay on patched 1.11.0" decision is what the trigger asks for. **Recommend explicitly re-affirming this decision in the release notes/internal record before publishing**, rather than treating it as already closed.

## 6. "Written, never rendered" sweep

`git log --since="2026-08-25" -- '**/schema.ts'` shows exactly **one** committed schema change: the `divider` (`<hr>`) atom (commit `379cdd5`), a bare node with no attributes — confirmed wired through the renderer, atom/formats.ts codecs, and self-verified at 703/703 in its own commit message. No gap.

This session's own uncommitted schema change (`table_cell.borderTop/Right/Bottom/Left`) was cross-checked and confirmed to have a real consumer at every layer: `surface/renderer.ts` (live DOM), `modelDom.ts` (clipboard/print DOM), `list/formats.ts` (HTML export + import), `formats/docx/export.ts` (OOXML `tcBorders`) — all present, all in the same uncommitted diff. No gap, but this entire chain is still uncommitted (see §1).

No other schema/attribute additions were found in the committed history since 2026-08-25. This item is clean, modulo §1's commit-state finding.

## 7. Public API surface — FINDINGS (2 Critical, 2 High, 1 Medium)

### 7a. CRITICAL — the actual publish command must be `pnpm publish`, not `npm publish`

`packages/react/package.json` depends on `"smartrte-core": "workspace:^"`. This is a pnpm workspace protocol specifier — **not a valid version range outside the workspace.** `pnpm publish` rewrites this to the resolved real version automatically at publish time; a literal `npm publish` (as this prompt's Part 2.4 specifies) does **not** perform this rewrite. Publishing `smartrte-react` via plain `npm publish` would ship a `package.json` with a literal, unresolvable `"smartrte-core": "workspace:^"` dependency — **completely broken for every external consumer**, since `npm install` outside a pnpm workspace has no meaning for that specifier. **Any publish must use `pnpm publish`, confirmed via a `pnpm pack` dry-run inspection of the resulting `package.json` before the real publish.**

### 7b. CRITICAL — `dist/` is not cleaned before build; stale artifacts currently inflate and corrupt the published package

`npm pack --dry-run` on `packages/react` (against the `dist/` left over from the just-completed e2e run's own build step) reported **148 files, 1.3 MB tarball, 4.8 MB unpacked**, including:
- `dist/components/ClassicEditor.js` — **349.8 kB**. There is **no corresponding source file** (`ClassicEditor.tsx` does not exist anywhere in `src/`; only `ClassicEditorAuthority.tsx` does, which correctly re-exports as `ClassicEditor` and is the file the package's own `index.ts` imports from). This is a **dead, orphaned build artifact from a deleted source file** — directly contradicting the CHANGELOG's own claim that "the DOM-authoritative legacy editor... [has] been fully removed."
- `dist/standalone/editor.js` — **3.7 MB**, with no corresponding bundler config or source of that name anywhere in the repo (`src/standalone/` contains only `classic-editor-embed.tsx`, whose real output is 4.7 kB). Also confirmed orphaned.

**Verified the diagnosis directly**: `rm -rf dist && tsc -p tsconfig.json` (a genuinely clean rebuild) produces neither file. The re-packed result: **103 files, 138.8 kB tarball, 541.2 kB unpacked** — a ~90% size reduction, and the dead legacy code is gone. `packages/core`'s `dist/` showed the same pattern at smaller scale: 350 files before a clean rebuild, 328 after (22 stale files removed).

**Root cause**: `"build": "tsc -p tsconfig.json"` in both packages' `package.json` never removes `dist/` first; `tsc` only adds/updates outputs for files that still exist in `src/`, it never deletes outputs whose source was removed. Anyone who has built this package incrementally over its history (which is the normal way of working) has a `dist/` directory quietly accumulating dead code from every removed/renamed source file, and every `npm pack`/`npm publish` run without an explicit prior `rm -rf dist` ships all of it.

**Fix**: add a clean step before `tsc` in both packages' `build` script (e.g. `"build": "rm -rf dist && tsc -p tsconfig.json"`, or a proper `tsc --build --clean` step), then re-verify with a fresh `npm pack --dry-run` on both packages before any publish.

### 7c. HIGH — internal test infrastructure ships to npm

`dist/test-harness/*` (10 files: `atomShadowComparator`, `blockShadowComparator`, `clipboardShadowComparator`, `inlineShadowComparator`, `legacyAtomEngine`, `legacyBlockEngine`, `legacyClipboardEngine`, `legacyInlineEngine`, `legacyTableEngine`, `tableShadowComparator`, each with a `.js`+`.d.ts` pair) are present in **both** the stale and the freshly-cleaned pack — these are genuinely current, intentionally-built files (confirmed present after the clean rebuild too), not staleness. They are internal shadow-mode comparators between the legacy and canonical engines, used for this project's own migration-era regression testing — not part of the intended public API. `files`' exclusion globs (`!dist/**/*.test.js`, `!dist/**/*.test.d.ts`) only match files literally named `*.test.*`; `test-harness/` files aren't named that way, so the exclusion doesn't catch them. **Fix**: add `"!dist/test-harness/**"` to the `files` array (or move this source under a path excluded from the package's own `tsconfig.json` `include`, if it's genuinely never meant to ship).

### 7d. HIGH — `smartrte-react` has no `exports` field; `smartrte-core` does

`packages/core/package.json` has a proper `exports` map (`.`, `./foundation`, `./legacy`) restricting the package's reachable subpaths. `packages/react/package.json` has only `main`/`module`/`types` — no `exports` map at all, meaning every file under `dist/` (including, until just now, the orphaned `ClassicEditor.js` and 3.7 MB `standalone/editor.js` from §7b, and the internal `test-harness/` files from §7c) is reachable via an undocumented deep import (`smartrte-react/dist/whatever.js`) with no packaging-level guard against it. Not necessarily blocking on its own, but combined with §7b/7c it materially widened the blast radius of both findings. **Recommend adding an `exports` map to `packages/react/package.json`** mirroring `smartrte-core`'s pattern, restricting the public surface to the root entry (and any genuinely-intended sub-entries, e.g. the standalone embed if that's meant to be a real public API, not just an internal artifact).

### 7e. MEDIUM — `ClassicEditorProps.onChange`'s declared type doesn't match its runtime behavior

`ClassicEditorProps.onChange: ((change: SmartEditorChange) => void) | ((html: string) => void)` — a declared union explicitly offering the *old*, pre-canonical string-based callback signature for backward compatibility. The actual implementation (`ClassicEditorAuthority.tsx`) always does `(props.onChange as ((change: SmartEditorChange) => void) | undefined)?.(change)` — it **only ever invokes the callback with the new `SmartEditorChange` object**, regardless of which signature the type suggests is supported. A consumer migrating from a pre-1.0 version who writes `onChange={(html) => ...}` expecting a string (following the documented union type) would silently receive an object instead, with no type error and a confusing runtime failure (e.g., `html.length` reads `undefined`, not a character count). Given this is precisely the audience this backward-compat wrapper exists for, and precisely the kind of upgrade friction a "breaking major release" changelog is supposed to warn about, **recommend either implementing the actual dual-dispatch the type promises, or narrowing the type to just the new signature and calling this out explicitly in the changelog as removed, not silently kept-but-broken.**

## 8. Other findings

- **No npm authentication configured in this environment.** `npm whoami` → `401 Unauthorized`. Regardless of every other finding, **the actual `npm publish` step in Part 2.4 cannot be executed from this environment as-is** — it needs either real credentials provided interactively by whoever owns the npm org/account, or to be run by the user directly.
- **`smartrte-react` has a published `0.3.5`** on the npm registry (confirmed via `npm view smartrte-react versions`) that is **not documented in `packages/react/CHANGELOG.md`** (which stops at `0.3.4` before jumping to `1.0.0-beta.1`). Minor gap, but worth reconciling — either `0.3.5` was trivial enough to skip documenting (say so) or the changelog has a real gap.
- **Root `package.json`'s own `katex` dependency (`^0.16.22`) is stale** relative to both published packages' actual `katex@^0.18.4`. The root package is `"private": true` (never published, confirmed) so this carries no publish risk — noted for workspace hygiene only.
- Both `CHANGELOG.md` files (core and react) were last touched **2026-08-16**, predating Phase 10 (plugins), Phase 11 (versioning/comments/suggestions), Phase 12a, Phase 12b-client (collab), and this entire session's toolbar/formula/table-border work. This is expected — Part 2.2 of this same prompt is explicitly the task of writing the real changelog — flagged here only to confirm the audit's own premise that this work is still outstanding, not to report it as a surprise.
- `pnpm-workspace.yaml` references `rust/*`, `dart/*`, `apps/*` package globs with no corresponding directories currently present in the repo (confirmed via `ls`) — dead workspace config, harmless but worth a cleanup pass at some point; not publish-relevant since neither path contributes to what's actually published.
- No `.changeset`, `lerna.json`, or other monorepo versioning tool exists — version coordination between `smartrte-core` and `smartrte-react` (currently lockstep at `1.0.0-beta.1`) is manual convention only, not enforced. Relevant to Part 2.1's own explicit question ("check for a monorepo versioning tool/config before assuming lockstep") — confirmed: there isn't one, lockstep has been manual so far.

---

## Summary: go/no-go

**NO-GO.** Blocking findings, in priority order:

1. **§1** — 49 uncommitted files must be committed (or explicitly, deliberately excluded with reasoning) before any release process starts against this working tree.
2. **§7b (Critical)** — add a `dist/`-clean step to both packages' `build` script; re-verify via fresh `npm pack --dry-run` that no orphaned artifact ships.
3. **§7a (Critical)** — the publish mechanics in Part 2.4 must use `pnpm publish`, not `npm publish`, or the released `smartrte-react` will be broken for every consumer via its `workspace:^` dependency on `smartrte-core`.
4. **§7c/§7d (High)** — exclude `dist/test-harness/**` from `files`; add a real `exports` map to `packages/react/package.json`.
5. **§7e (Medium)** — resolve the `ClassicEditorProps.onChange` type-vs-behavior mismatch before shipping a release whose whole changelog narrative is about backward-compatible migration from the old API.
6. **§5 (Medium)** — explicitly re-affirm (don't silently skip) the mammoth-version decision, since this publish is exactly the occasion its own revisit trigger names.
7. **§8** — no npm auth in this environment; publishing needs the user's direct involvement regardless of the above.

None of the rest (§2 e2e flakes, §3/§4 ledger accuracy, §6 written-never-rendered) raised any concern — those areas are clean.

---

## Resolution status (2026-08-31, post-fix re-verification)

Each blocking finding from the go/no-go list above, checked off individually against the current working tree — not assumed from the fix having been attempted:

1. **§1 (uncommitted work) — RESOLVED.** The original 49 files were split across two commits: `d9fdb20` (made directly by the repo owner, toolbar primitives/formula library/special characters) and `05611a6` (the onChange fix, capability presets, and disable-safety restore wiring from the Sootr-migration work). `git status --short` is clean as of this update, before the packaging-fix commit described below.
2. **§7b (dist not cleaned, Critical) — RESOLVED.** Both `packages/core/package.json` and `packages/react/package.json`'s `build` scripts now read `"rm -rf dist && tsc -p tsconfig.json"`. Re-verified with fresh `npm pack --dry-run` after a real rebuild of both packages: core 331 files / 268.0 kB tarball / 1.1 MB unpacked; react 93 files / 134.0 kB tarball / 527.4 kB unpacked. Confirmed the orphans are gone (`ClassicEditor.js`/`.d.ts` absent) while the real current file survives (`ClassicEditorAuthority.js`/`.d.ts` present).
3. **§7a (npm publish vs pnpm publish, Critical) — NOT YET ACTIONED**, but not a code fix — this is a Part 2 execution-mechanics finding (use `pnpm publish`, never `npm publish`). Restated here as still binding for whenever Part 2 is re-opened.
4. **§7c (test-harness ships, High) — RESOLVED.** `"!dist/test-harness/**"` added to `packages/react/package.json`'s `files` array. Confirmed via `npm pack --dry-run 2>&1 | grep -c test-harness` → `0`.
5. **§7d (no exports map, High) — RESOLVED.** `packages/react/package.json` now has an `exports` map with `.` (root) and `./standalone/classic-editor-embed` (kept, not restricted to root-only, since no documentation was found ruling out the standalone embed as a real second public entry point — treated conservatively rather than guessed away).
6. **§7e (onChange type mismatch, Medium) — RESOLVED**, ahead of this packaging pass, as part of the Sootr-migration work (commit `05611a6`). See `docs/bugs/classic-editor-onchange-object-instead-of-string.md`. `ClassicEditorProps.onChange` is now `(html: string) => void`, matching actual runtime behavior exactly.
7. **§5 (mammoth revisit trigger, Medium) — RESOLVED.** Explicitly re-affirmed in `docs/PHASE_9_MAMMOTH_FINAL_DECISION.md`'s new "Revisit-trigger re-affirmation (2026-08-31...)" section: staying on patched `1.11.0` against a now-`1.12.2` upstream, no new reachable-surface issue found.
8. **§8 (no npm auth) — NOT RESOLVABLE BY ME.** `npm whoami` still returns `401 Unauthorized` (re-confirmed by the user's own terminal in this same session). This requires the user to run `npm login` themselves — explicitly out of scope for me per this project's standing credential-handling rule, not a packaging defect.
9. **§8 (undocumented `0.3.5`, Minor) — RESOLVED, root cause identified.** Not a changelog-writing oversight: `git log`/`git branch --contains` confirms `0.3.5` (`f711756`, 2026-08-15) was released from `master`, on a branch that diverged from `core-implementation` at `82c8e3b` — `core-implementation` never merged it back, so its CHANGELOG.md entry was simply never present on this branch, not deleted. Verified `packages/core/CHANGELOG.md` has no equivalent gap (its `master`-only commits are already ancestors of this branch's `HEAD`). Fixed by adding the real `0.3.5` entry (copied verbatim from `master`'s `f711756`) into `packages/react/CHANGELOG.md` in its correct chronological slot, between `1.0.0-beta.1` and `0.3.4`.

**Re-verification after all packaging fixes**: `pnpm --filter smartrte-core test` — 724/724 (81 files). `pnpm --filter smartrte-react test` — 140/140 (33 files). `pnpm run lint` (both packages' `tsc --noEmit`) — clean. Full 3-browser e2e re-run pending at time of writing this section (see below for result once it lands).

**Updated status: still NO-GO for the literal `npm publish` command in the original prompt's Part 2.4** (item 3 above, unchanged), but every code-level/packaging blocker is now fixed and re-verified. The two remaining items are both execution-mechanics/credentials, not defects: use `pnpm publish` (not `npm publish`) when Part 2 is re-opened, and the user must authenticate (`npm login` / `pnpm login`) themselves before that command can run.
