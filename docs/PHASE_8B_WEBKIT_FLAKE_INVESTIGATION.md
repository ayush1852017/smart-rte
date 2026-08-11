# Phase 8b WebKit flake investigation

## Scope

This note covers the two recurring WebKit failures from the Phase 8b work
order:

- The work order identified `canonical-surface.spec.ts:421` and `:465`; after
  subsequent tests were added, the same test titles are currently at
  `packages/react/e2e/canonical-surface.spec.ts:700` (replay) and `:767`
  (deepest-descendant Backspace/Delete merging).

No retry was added and neither test was removed.

## Reproduction evidence

The previous full-suite evidence was 236 passed, two WebKit failures, and five
intentional skips. Both tests passed when run in isolation. I reran the tests
with retries disabled (`packages/react/playwright.config.ts:4-10`) and with
tracing retained on failure:

| Run | Result | Observation |
|---|---:|---|
| Canonical-surface WebKit project | 28 passed | Both target tests passed; no failure trace was produced |
| Full WebKit project, `--trace=on` | 79 passed, 2 skipped | Both target tests passed under project load; the instrumented run completed in 39.5 s |
| Full Chromium/Firefox/WebKit suite | 238 passed, 5 skipped | Both target tests passed under all-browser load |
| Two target tests, WebKit only, JSON timing | 2 passed | Comparator replay: 716 ms; merge test: 533 ms |

The default Playwright test timeout is 30 seconds (the project config's
120-second value at `packages/react/playwright.config.ts:12-16` is the web
server timeout, not the test timeout). The observed target durations are well
inside that budget, so simply widening a timeout is not supported by the
evidence. Because the failures did not reproduce in the investigation, no
failure trace exists to identify a failing phase.

The instrumented project run was:

```text
pnpm --filter smartrte-react exec playwright test \
  --project=webkit --trace=on --reporter=line
```

It completed all 81 tests (79 passed, two intentional skips) without exposing a
target failure or an environment transition to compare against a failing run.

## State-leak audit

The relevant paths were reviewed:

- The comparator creates two temporary roots and removes both on completion in
  `packages/react/src/test-harness/blockShadowComparator.ts:87-127`.
- Runtime teardown unsubscribes the editor, destroys the input pipeline and
  renderer, clears the deferred HTML timer, clears pending state, and removes
  the root children in `packages/react/src/canonicalEditorRuntime.ts:202-218`.
- The product component aborts pending media uploads and unmounts the runtime
  in `packages/react/src/components/CanonicalAuthorityEditor.tsx:148-157`.
- The inline bridge removes both DOM listeners and clears stored marks in
  `packages/react/src/adapters/canonicalInlineCommandBridge.ts:267-273`.

No unclosed context, listener, timer, or editor instance was identified in the
two target tests or their immediately shared teardown paths. This review does
not prove that unrelated tests cannot retain state; it only means the suspected
paths did not expose an obvious leak.

## Determination

The flake was **not resolved**. It was not reproduced in three progressively
heavier WebKit runs, and the isolated timings do not indicate timeout pressure.
The most accurate current classification is an intermittent contention or
environment-sensitive failure with no confirmed root cause—not a harmless flaky
test and not a proven code fix.

Before treating this as closed, run a repeated full-suite matrix with per-test
worker/resource instrumentation: worker count 1 versus the configured full
load, page/context creation and disposal counts, active timers/listeners at
test boundaries, heap measurements around the two tests, and a retained trace
for the first failure. The instrumentation should be added without changing
the assertions or adding retries; a retry would hide the condition.

## Regression accounting

No tests were removed. The current all-browser run is 243 total: 238 passed,
five intentional skips, zero failures. The prior comparison point was 243
total: 236 passed, two WebKit failures, five intentional skips. The passing
rerun is evidence that the failure is intermittent, not evidence that its root
cause has been fixed.

Promotion of the canonical-authority flag and deletion of rollback bridges
remain owner decisions and were not performed.
