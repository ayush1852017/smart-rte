# WebKit-only Playwright tests time out under full-suite load, pass in isolation

**Status:** Fixed (the recurring list-Enter timeout was traced to a harness readiness/focus race; continue monitoring full-suite contention)
**Area:** test infra / browser (WebKit) / selection & history regression tests
**First reported:** 2026-08-05 (the dated `docs/PHASE_8B_DELTA_REPORT.md` first records the full-suite timeout)
**Related files:** `docs/PHASE_8B_DELTA_REPORT.md`, `docs/PHASE_8B_DELTA_REPORT_2.md`, `docs/PHASE_8B_DELTA_REPORT_3.md`, `docs/PHASE_8B_DELTA_REPORT_4.md`, `docs/PHASE_8B_WEBKIT_FLAKE_INVESTIGATION.md`

## Symptom

Specific Playwright tests fail (timeout) only when run as part of the full three-browser suite, and pass immediately when re-run alone in WebKit. Not a single fixed test — different specific tests have shown this pattern across different rounds.

## Reproduction

Traced across four sequential delta reports:
- **Round 1**: `canonical-surface.spec.ts` — `"handles Enter start/mid/end and restores structural history"` timed out in a full run; passed immediately when isolated with no product change.
- **Round 2**: the same flake did **not** reappear in that round's full run — looked "fixed" by simple absence, not by any applied fix.
- **Round 3**: two **different** tests failed in a 243-test full run — `canonical-surface.spec.ts:421` ("replays 1,000 privacy-safe comparator scenarios in this browser") and `:465` ("Backspace merges into the deepest preceding descendant and Delete mirrors forward"). Both passed cleanly when rerun alone in WebKit. Explicitly logged as "a recurring/full-suite resource flake, not hidden as a pass"; the corresponding readiness gate was marked qualified, not clean, because of it.
- **Round 4**: full three-browser run passed clean (238/238, 0 failures) — but no code fix, root cause, or commit is described as having caused this; it reads as the flake simply not reproducing that time.

## Root cause

The recurring Phase 3 list-Enter timeout was not a list-command or shared-state defect. The test pressed Enter immediately after `page.goto`; under full WebKit load, the React harness effect had not yet mounted/focused the canonical surface, so Enter went to the page instead of the seeded list. The same test passed in isolation because the mount/focus race was narrower there. The later generated-replay failures were a separate snapshot-synchronization issue, recorded in [session-replay-transient-native-selection-flake](session-replay-transient-native-selection-flake.md).

## Fix

`packages/react/e2e/canonical-surface.spec.ts` now waits for `window.__smartCanonical`, waits for the surface to be visible, and explicitly focuses it before the first Enter. This makes the test exercise list Enter rather than React mount timing. A focused WebKit repetition passed 10/10, and the subsequent full three-browser run passed 343/343 non-skipped tests. No retry was added.

## Regression coverage

`packages/react/e2e/canonical-surface.spec.ts`: `handles Enter start/mid/end and restores structural history`, with explicit harness readiness/focus; focused WebKit 10/10 and full three-browser run 343 passed / 5 skipped. The generated replay has separate synchronization coverage in [session-replay-transient-native-selection-flake](session-replay-transient-native-selection-flake.md).

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — a different root cause but the same shape of failure; verify the live-source server before reopening either issue.
- A later, independent investigation (this project's ongoing session-based work) reproduced a *different* list-Enter scenario in isolation across all three browsers with no failures at all — see [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md). That investigation is not the same test as this file's, but establishes that this general test family (list Enter/history behavior in WebKit) has a documented history of looking broken under one testing condition and clean under another.
