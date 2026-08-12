# "Double-Enter doesn't exit a list at the end of the editor" — not reproducible against current source

**Status:** Not a bug / not reproducible — confirmed by owner manual check on 2026-08-12, following the exact steps below
**Area:** list / input
**First reported:** 2026-08-10/11 (this project's ongoing list-toolbar bug hunt)

## Symptom

Reported: when a list is the last element in the editor, pressing Enter twice on a trailing empty item doesn't exit the list — it just keeps adding new numbered/bulleted items indefinitely.

## Reproduction

Three separate, faithful reproduction attempts, all against the live-source dev server, all in real Chromium/Firefox/WebKit via Playwright — **none reproduced the reported symptom**. All three exit correctly on the second Enter.

**Exact steps for a manual re-check on the current build** (open `http://localhost:5173/?canonicalAuthority=1`, hard-refresh first per [stale-dist-build-confusion](stale-dist-build-confusion.md)):

1. Click into the editor. Select all existing content and delete it, or start from an empty document.
2. Type a line of text, then click the "Numbered list" (or "Bulleted list") toolbar button to turn it into a list.
3. Press Enter at the end of that line. This creates a second, empty list item — expected, this is normal "new item" behavior, not the exit.
4. With the cursor still on that new empty item, press Enter **again**.
5. **Expected**: the empty item disappears from the list, and a new plain paragraph (not a list item) appears immediately after the list, with the cursor in it.
6. **If instead** a third numbered/bulleted item appears (the list keeps growing instead of exiting) — that is the actual bug. Note whether this is the very first list in the document or a list with other content after it, and whether it's a numbered or bulleted list.

(The three original investigation attempts additionally covered: a single-item list as the only document content; a pre-seeded 3-item list with a third Enter afterward to confirm normal typing resumes; and a list built via real toolbar clicks and typed keystrokes rather than test-seeded content — all matching or exceeding the steps above.)

Existing jsdom unit tests (`"exits a depth-zero list from the newly-created empty trailing item"`, `"exits after a trailing list item instead of creating empty items forever"`) and an existing e2e test (`"deletes the empty paragraph after Enter exits a list"`) all pass on current source.

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
