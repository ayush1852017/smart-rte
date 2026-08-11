# "Double-Enter doesn't exit a list at the end of the editor" — not reproducible against current source

**Status:** Needs re-verification
**Area:** list / input
**First reported:** 2026-08-10/11 (this project's ongoing list-toolbar bug hunt)

## Symptom

Reported: when a list is the last element in the editor, pressing Enter twice on a trailing empty item doesn't exit the list — it just keeps adding new numbered/bulleted items indefinitely.

## Reproduction

Three separate, faithful reproduction attempts, all against the live-source dev server, all in real Chromium/Firefox/WebKit via Playwright — **none reproduced the reported symptom**:
1. A single-item list becoming the sole document content, converted via toolbar, Enter × 2.
2. A pre-seeded 3-item numbered list, caret at the end of the last item, Enter × 3 (to also confirm it doesn't loop back into list mode afterward).
3. A list built via actual toolbar clicks and typed keystrokes (not API-seeded), Enter × 2 then a 3rd Enter to confirm normal post-exit paragraph behavior.

All three exit correctly on the second Enter. Existing jsdom unit tests (`"exits a depth-zero list from the newly-created empty trailing item"`, `"exits after a trailing list item instead of creating empty items forever"`) and an existing e2e test (`"deletes the empty paragraph after Enter exits a list"`) all pass on current source.

## Root cause

Not established — no defect found to explain the reported symptom.

## Fix

None applied — there is nothing in current source to fix. See [stale-dist-build-confusion](stale-dist-build-confusion.md) for the leading suspected (not confirmed) explanation: this project has a documented history of "still broken" reports that were actually stale-build artifacts.

## Regression coverage

Existing coverage (unchanged, already passing): `packages/core/src/foundation/phase2_5.test.ts` ("exits a depth-zero list from the newly-created empty trailing item", "exits after a trailing list item instead of creating empty items forever"); `packages/react/e2e/canonical-authority.spec.ts` ("deletes the empty paragraph after Enter exits a list").

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — leading suspected explanation, unconfirmed.
- [list-enter-exit-silent-throw-missing-split-id](list-enter-exit-silent-throw-missing-split-id.md) — a genuinely real, different "Enter doesn't exit the list" bug from an earlier round, already fixed. If this report recurs with a *specific, reproducible* sequence, check that fix is still present in source before assuming it's the same stale-build pattern as this file.
- **If this resurfaces**: get either (a) confirmation the reporter is on the live dev server per the stale-build file's standing instruction, or (b) an exported document JSON / exact click sequence. Guessing at the repro has not worked across two separate investigation attempts.
