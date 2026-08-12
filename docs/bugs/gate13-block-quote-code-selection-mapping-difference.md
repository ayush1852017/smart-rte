# Gate 13: `block.quote` and `block.code` retained-vs-canonical selection differs (not content)

**Status:** Not a bug — classified and documented, but **Gate 14 owner disposition is still outstanding** (see below; this is a decision-pending item, not a closed one)
**Area:** block / selection / test infra (retained-vs-canonical replay)
**First reported:** unknown — present in the replay evidence at least as far back as `docs/PHASE_8B_DELTA_REPORT_3.md`; unchanged through `docs/PHASE_8B_DELTA_REPORT_4.md` and the fresh 2026-08-12 re-audit
**Related files:** `docs/PHASE_8B_DELTA_REPORT_3.md`, `docs/PHASE_8B_DELTA_REPORT_4.md`, `docs/PHASE_8B_PROMOTION_READINESS.md`

## Symptom

The Gate 13 retained-vs-canonical replay harness (`packages/react/e2e/canonical-authority.spec.ts`, `"runs the retained/canonical command replay in the selected browser"`) reports the resulting *selection* after applying `block.quote` or `block.code` differs between the retained (legacy) and canonical editors, even though the resulting document structure is identical (ID-stripped structure comparison passes; only selection mapping differs).

## Reproduction

Confirmed via the automated replay harness, not a manual repro — this is a structural comparator finding, reproducible on every run: `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`. Stable across all three browsers and across every re-run to date (hashes `c80caa69` for `block.quote`, `42993efd` for `block.code` unchanged since at least Delta Report 3).

## Root cause

Not investigated further than classification — the replay harness identifies this as belonging to "the existing Phase 5 selection family," i.e. a known category of selection-mapping difference between the two editors' block-transform commands, not a new or unexplained defect. No deeper root-cause trace exists in the written record.

## Fix

None — this is a documented, stable, non-semantic difference, not something scheduled for a code fix. It would need to be either (a) actually matched between the two engines, or (b) formally accepted as a permanent difference, before Gate 14 can close.

## Regression coverage

The replay harness itself is the regression coverage — `packages/react/e2e/canonical-authority.spec.ts`. It intentionally does *not* fail the build on this classification (`expected-normalization`/`selection-only`/`visual-only` are treated as known-acceptable, only `semantic`/`data-loss`/`unknown` fail the assertion).

## Related/similar issues

- [gate13-table-normalization-differences](gate13-table-normalization-differences.md) — the other cluster of accepted-but-undispositioned Gate 13 differences, unrelated cause.
- [gate13-list-command-selection-and-style-differences](gate13-list-command-selection-and-style-differences.md) — same.
- **Gate 14 status**: per `docs/PHASE_8B_DELTA_REPORT_4.md` §G, this specific difference "must not be silently waived by [the] Gate 13 coverage report" — it requires explicit owner disposition before Phase 8b promotion. Still outstanding as of the 2026-08-12 re-audit.
