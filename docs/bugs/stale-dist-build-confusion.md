# Stale `dist` builds caused repeated "still broken" reports for already-fixed bugs

**Status:** Fixed (for the playground environment; published-package consumers remain outside this fix's scope)
**Area:** environment / process / build tooling — **not a code defect.** Check this file first when a report says something "still isn't working" after a fix was already verified.
**First reported:** unknown — pattern recurred across multiple points in this project's history; most explicitly named in `docs/PHASE_8B_MIXED_CHECKBOX_PRESET_REOPEN.md`

## Symptom

A bug gets fixed, verified with passing tests, and reported as resolved — then a subsequent manual test session reports the exact same symptom as "still broken," sometimes multiple rounds in a row. The fix, on inspection, is genuinely present and correct in source.

## Reproduction

Confirmed root cause in at least one case: the React playground (`packages/react/playground`) imported the `smartrte-core`/`smartrte-react` packages' **built `dist` entry points** rather than live workspace source. Source code changes — even fully committed, tested ones — never reached the running playground page until the packages were explicitly rebuilt. A developer editing source, testing in an already-open playground tab, and not rebuilding/restarting would reliably see old behavior and reasonably (but incorrectly) conclude the fix hadn't worked or had regressed.

This exact pattern is the leading suspected explanation (not confirmed, since it could not be independently reproduced) for at least two later reports in this project: see [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md) and [mixed-depth-select-retype-stray-numbering-not-reproducible](mixed-depth-select-retype-stray-numbering-not-reproducible.md) — both investigated thoroughly with multiple faithful reproduction attempts against current source, both came back completely clean, both remain unexplained if not attributable to this pattern.

## Root cause

`packages/react/playground/vite.config.ts` did not alias `smartrte-core`/`smartrte-react` imports to workspace source — it resolved them the normal way, through each package's built `dist` output, same as any external consumer would.

## Fix

`packages/react/playground/vite.config.ts` now aliases all relevant import paths — `smartrte-react`, `smartrte-core`, `smartrte-core/foundation`, `smartrte-core/legacy` — directly to live workspace `src`, confirmed exhaustively (all four subpaths checked, not just spot-checked). Playwright's own `webServer` config runs the exact same dev server (`pnpm --dir playground dev`) with `reuseExistingServer: true`, so e2e tests and manual playground testing are now structurally guaranteed to run identical code — there is no remaining path by which the playground specifically can serve stale code.

**What this fix does NOT cover:** if a report is tested against Sootr (or any other real consumer of the published `smartrte-core`/`smartrte-react` npm packages) rather than this dev server, that consumer is still pulling from the published package registry, which is a separate, unaddressed staleness vector — these packages are confirmed already published and live on the public npm registry (see `docs/PHASE_ROADMAP_8B_12B.md`).

## Regression coverage

No automated test can catch "a human is looking at a stale browser tab" — this is a config/process fix, not a logic fix. The closest thing to regression coverage is the alias configuration itself, which should be spot-checked (`cat packages/react/playground/vite.config.ts`) if this pattern is ever suspected again.

## Related/similar issues

- [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md)
- [mixed-depth-select-retype-stray-numbering-not-reproducible](mixed-depth-select-retype-stray-numbering-not-reproducible.md)
- [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) — a different root cause (resource contention, not stale build) but the same general shape of "looks broken under one condition, clean under another" — worth ruling this file out first before assuming that one's explanation, and vice versa.

**Standing instruction for future reports:** before investigating a "this was already fixed but is still broken" report, confirm (1) the reporter is testing against `localhost:5173` (the live-source dev server), not a published package or a stale open tab, and (2) they've hard-refreshed / restarted Vite since the fix landed. Ask this before re-opening investigation from scratch.
