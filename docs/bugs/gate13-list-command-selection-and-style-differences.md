# Gate 13: five list commands show retained-vs-canonical selection or style-storage differences

**Status:** Not a bug — documented, stable since `docs/PHASE_8B_DELTA_REPORT_4.md`. Gate 14 owner disposition still outstanding.
**Area:** list / test infra (retained-vs-canonical replay)
**First reported:** `docs/PHASE_8B_DELTA_REPORT_4.md` (2026-08-07) — these five were added to the replay's comparable-intent set in that report (previously excluded/uncovered)
**Related files:** `docs/PHASE_8B_DELTA_REPORT_4.md`, `docs/PHASE_8B_PROMOTION_READINESS.md`

## Symptom

Five list commands show a retained-vs-canonical difference in the Gate 13 replay:

| Intent | Classification | Hash |
|---|---|---|
| `list.create` | `selection-only` | `ac36cbab` |
| `list.setPreset` | `expected-normalization` | `9f4b08ab` |
| `list.setStyle` | `selection-only` | `41d81290` |
| `list.create.numbered` | `selection-only` | `141cd3eb` |
| `list.unwrap` | `selection-only` | `daccee1d` |

## Reproduction

Automated, via `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`. Confirmed present and unchanged (same hashes) across all three browsers in the 2026-08-12 re-audit — identical to the values in `docs/PHASE_8B_DELTA_REPORT_4.md`, so nothing about this cluster has changed since that report, unlike [gate13-table-normalization-differences](gate13-table-normalization-differences.md)'s new addition.

## Root cause

- `list.create`: "retained toggle returns a node selection; canonical mapping retains the text-owner point" — a selection-representation difference, not a content difference.
- `list.setStyle`, `list.create.numbered`, `list.unwrap`: documented only as "selection mapping only" — no deeper cause given in the written record.
- `list.setPreset`: "retained stores a portable fallback style alongside preset; canonical stores preset as source of truth" — a deliberate representation difference (canonical treats preset as authoritative; retained keeps a redundant style fallback for its own rendering needs).

## Fix

None — not attempted in this pass.

## Regression coverage

The replay harness itself; see [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md) for the general mechanism.

## Related/similar issues

- [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md), [gate13-table-normalization-differences](gate13-table-normalization-differences.md) — the other two clusters.
- [list-marker-competing-style-and-preset-signals](list-marker-competing-style-and-preset-signals.md) — an actual bug (not this file's accepted difference) about the canonical side's own preset/style attrs conflicting with each other, unrelated to this file's retained-vs-canonical comparison.
- **Gate 14 status**: outstanding for all five, unchanged since the last written report.
