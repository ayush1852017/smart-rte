# Full 3-browser e2e run intermittently reports "Test not found in the worker process" for one suggestions.spec.ts test, not reproducible in isolation

**Status:** Not reproducible after 3 full-suite runs (2026-08-25 pre-12b punch list). Observed once during the audit that first filed this entry; three subsequent full, unfiltered `pnpm --filter smartrte-react run e2e` runs (443 passed / 7 skipped / 0 failed, each time, 450 tests total) produced zero failures anywhere in the suite. Downgraded from "Needs re-verification" — treat as infra noise, not a live product or harness defect, unless it recurs.
**Area:** test infra / e2e (Playwright)
**First reported:** 2026-08-25, during the Phase 9–12a independent audit's full e2e suite run (`pnpm --filter smartrte-react run e2e`, the actual `e2e` script from `packages/react/package.json`, all 10 spec files × 3 browser projects, run exactly as CI/the project defines "full suite" per `docs/bugs/full-e2e-suite-definition-was-incomplete.md`).
**Related files:** `packages/react/e2e/suggestions.spec.ts` (the affected test, "ambient track-changes mode: the Track changes toggle documents its two excluded cases", declared at line 160), `docs/PHASE_ROADMAP_8B_12B.md` (Phase 12a closeout claims "comments and suggestions e2e specs (including the ambient-mode test) each stable across 3 runs × 3 browsers")

## Symptom

A full, unfiltered run of the e2e suite (`pnpm --filter smartrte-react run e2e`) produced **2 failures out of 444 tests**: `[firefox]` and `[webkit]` both failed the same test, reported by Playwright as:

```
[firefox] › e2e/suggestions.spec.ts:203:3 › Phase 12a - suggestions (track changes) › ambient track-changes mode: the two excluded cases (cross-paragraph replace, cross-block merge) still apply directly, and the toggle documents this

Test not found in the worker process. Make sure test title does not change.
```

Two things are odd about this failure, both pointing away from a real product/test-logic bug:
1. The reported line number (203) and title ("the two excluded cases (cross-paragraph replace, cross-block merge) still apply directly, and the toggle documents this") **do not match any test currently in `suggestions.spec.ts`** — the actual test at that area of the file (declared at line 160) is titled "the Track changes toggle documents its two excluded cases." No test with the reported title exists in the file at all.
2. Playwright's own failure message — "Test not found in the worker process" — is a known class of Playwright worker/reporter desync, not an assertion failure from the test body itself (there is no stack trace, no assertion diff, nothing pointing at editor/suggestion behavior).

## Reproduction

Full suite: `pnpm --filter smartrte-react run e2e` (no filter) — reproduced once, 2/444 failed as above, both on the same test, both on non-Chromium projects (firefox, webkit), both with the "not found in worker" message rather than a real assertion failure. Chromium's run of the same test passed.

**Does not reproduce in isolation**: `npx playwright test e2e/suggestions.spec.ts -g "excluded cases" --project=firefox --project=webkit --project=chromium` → all 3 passed cleanly (13.5s), with the test's real title ("the Track changes toggle documents its two excluded cases") correctly reported at its real location.

Not re-run a second time at full-suite scope in this pass (time-boxed audit); flagged as "needs re-verification" rather than "confirmed flake," per this project's own status taxonomy, since a single occurrence isn't yet a demonstrated pattern.

**Re-verification (2026-08-25, pre-12b punch list item 2)**: ran the full, unfiltered `pnpm --filter smartrte-react run e2e` three more times in direct succession (post the working-tree commit in the same session). Every run: 443 passed, 7 skipped (the same pre-existing, explained skips), **0 failed**, 450 tests total each time. `suggestions.spec.ts`'s "the Track changes toggle documents its two excluded cases" (and every other test in the file) passed cleanly on firefox and webkit all three times. No occurrence of the "Test not found in the worker process" message in any of the three runs.

## Root cause

Not conclusively determined. The evidence (isolated re-run passes cleanly; the reported title doesn't match anything in the actual file; the error is Playwright's own worker-process bookkeeping message rather than a test assertion) is consistent with a Playwright test-list/worker desync under full-suite concurrency (10 spec files × 3 browser projects running with shared workers, `fullyParallel: false`), similar in spirit to `docs/bugs/webkit-full-suite-timeout-flake.md` and `docs/bugs/session-replay-transient-native-selection-flake.md` — both prior instances of "looks like a real failure under full-suite load, doesn't reproduce isolated or on retry" in this same project. Not confirmed to be the identical mechanism as either of those, though.

This directly contradicts `docs/PHASE_ROADMAP_8B_12B.md`'s Phase 12a closeout claim that "comments and suggestions e2e specs (including the ambient-mode test) each [were] stable across 3 runs × 3 browsers" and "full e2e suite 145/146 passed with zero regressions" — that claim was accurate for the runs it was based on, but a fresh, independent full-suite run today did not reproduce a clean run for this specific test. Given the isolated re-run's clean pass, this reads as infra flake rather than a regression in the suggestions feature itself, but it is a real discrepancy between a phase-closeout claim and what a fresh audit run actually observed, worth recording rather than silently reconciling.

## Fix

Not attempted — this is a test-infra observation, not a diagnosed defect with a known code-level cause. Unlike `webkit-full-suite-timeout-flake.md` (which turned out to have a real, fixable root cause - a harness readiness/focus race), this one was actively checked for a similar concrete cause and none was found: three full-suite re-runs produced zero failures, giving no reproducing instance to root-cause against. If this reproduces again on a future full-suite run, it would be worth: (a) checking whether it's always the same test/file, (b) checking whether it correlates with worker count or specific adjacent tests in `suggestions.spec.ts`, and (c) considering whether `fullyParallel: false` combined with 10 spec files sharing workers across 3 projects is contributing, the way it was for the WebKit timeout flake.

## Regression coverage

Not applicable — this is a flake report, not a code defect with a test to add. The underlying suggestions feature itself has full, passing coverage (`packages/react/e2e/suggestions.spec.ts`'s tests all pass individually, including this one; `packages/core/src/foundation/suggestions/*.test.ts` all pass in the vitest run).

## Related/similar issues

- [webkit-full-suite-timeout-flake](webkit-full-suite-timeout-flake.md) — same shape (full-suite-only, non-reproducing-in-isolation timing/infra issue), different symptom (timeout vs. worker-not-found), same project.
- [session-replay-transient-native-selection-flake](session-replay-transient-native-selection-flake.md) — another "flaky only under full-suite contention" precedent in this project.
- [full-e2e-suite-definition-was-incomplete](full-e2e-suite-definition-was-incomplete.md) — establishes that "full e2e suite" means all 10 spec files × 3 browsers unfiltered, which is the exact invocation that surfaced this.
