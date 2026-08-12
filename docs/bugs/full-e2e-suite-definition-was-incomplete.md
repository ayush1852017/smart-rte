# "Full e2e suite" in prior session reports meant 2 of 12 spec files, not the actual suite

**Status:** Fixed (process gap corrected; underlying test-coverage gap tracked as follow-up, not yet closed)
**Area:** test infra / process
**First reported:** 2026-08-12, discovered during Phase 8b final closeout while verifying the block rollback bridge deletion

## Symptom

`docs/PHASE_8B_PROMOTION_READINESS.md` and other prior session reports described "the full e2e suite" as `canonical-authority.spec.ts` + `canonical-toolbar-routing.spec.ts` (Chromium), and every verification step in this project used that definition. `packages/react/e2e/` actually contains 12 spec files; the other 10 were never run during that verification.

## Reproduction

Run `pnpm --filter smartrte-react run e2e` (no file filter) versus the narrower two-file invocation used in prior reports — the former runs 12 files, the latter 2.

## Root cause

Informal shorthand from an earlier session's report-writing got copied forward into later reports and treated as the project's actual convention, without ever being checked against `package.json`'s `e2e` script (which has always run the whole directory, unfiltered) or the READMEs (which correctly document `pnpm e2e`).

## Fix

No code or doc changed — the tooling was already correct. The fix is behavioral: "run the full e2e suite" now explicitly means all files present in `packages/react/e2e/`, not a remembered subset. See `docs/PHASE_8B_FINAL_CLOSEOUT.md` §1 for the full incident writeup, including the 30 tests this gap let go unverified and the exact scenario-by-scenario coverage table produced once they were found.

## Regression coverage

None applicable — this is a process/verification-scope finding, not a code defect with a test to write. The underlying discovery (30 tests in 5 files depended on the retired legacy DOM-mutation editing pattern) is tracked as its own follow-up in `docs/PHASE_8B_FINAL_CLOSEOUT.md` §1, not closed by this entry.

## Related/similar issues

- [stale-dist-build-confusion](stale-dist-build-confusion.md) — a different "verification gave a false-confident signal" pattern in this same project, worth checking together if a future "looked fine but wasn't" report comes in.
- `docs/PHASE_8B_FINAL_CLOSEOUT.md` §1 — full detail, coverage table, and prioritized follow-up plan for the 30 tests this gap hid.
