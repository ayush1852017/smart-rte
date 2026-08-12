# Gate 13: four table commands show retained-vs-canonical normalization differences

**Status:** Not a bug for 3 of 4 (documented Phase 6 correction class) — but **one of the four (`table.mergeCells`) is new since the last written report and needs explicit disposition**, not just inherited sign-off. Gate 14 owner disposition outstanding for all four.
**Area:** table / test infra (retained-vs-canonical replay)
**First reported:** `table.insertColumn` and `table.setHeader` — unknown, present at least as far back as `docs/PHASE_8B_DELTA_REPORT_3.md`. `table.insert` — first appears in `docs/PHASE_8B_DELTA_REPORT_4.md` (2026-08-07). `table.mergeCells` — **not present in any written report; first observed in the 2026-08-12 re-audit for this file.**
**Related files:** `docs/PHASE_8B_DELTA_REPORT_3.md`, `docs/PHASE_8B_DELTA_REPORT_4.md`, `docs/bugs/table-merge-multiplies-row-height.md`, `docs/PHASE_8B_PROMOTION_READINESS.md`

## Symptom

The Gate 13 retained-vs-canonical replay reports four table commands producing a structurally-different (but non-semantic, non-data-loss) result between the retained and canonical editors:

| Intent | Classification | Hash |
|---|---|---|
| `table.insertColumn` | `expected-normalization` | `1d9005a0` |
| `table.setHeader` | `visual-only` | `122df650` |
| `table.insert` | `expected-normalization` | `55381491` |
| `table.mergeCells` | `expected-normalization` | `a37b125d` |

## Reproduction

Automated, via the replay harness: `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`. All four confirmed present and identical across Chromium/Firefox/WebKit in the 2026-08-12 re-audit.

## Root cause

- `table.insertColumn` / `table.setHeader`: documented as "the same Phase 6 approved correction class" — the canonical engine's table geometry/header handling was deliberately corrected relative to the legacy behavior; the difference is expected and was previously reviewed.
- `table.insert`: "legacy omits canonical table layout/width defaults; text is conserved" — the canonical engine sets layout defaults the legacy one doesn't.
- `table.mergeCells` (**the new one**): not classified in writing anywhere prior to this file. Strong circumstantial explanation, not yet confirmed by re-reading the actual diff: [table-merge-multiplies-row-height.md](table-merge-multiplies-row-height.md) documents that the canonical merge content-assembly was fixed (concatenates simple one-paragraph content instead of stacking it), while that same bug file explicitly states the retained/legacy DOM table bridge was deliberately **not** fixed. If canonical merge output changed and retained didn't, a new `table.mergeCells` divergence between the two is exactly what that asymmetric fix would produce. **This should be confirmed by inspecting the actual hash `a37b125d` diff before treating this explanation as settled** — it is the most likely explanation given the timeline, not a verified one.

## Fix

None — not attempted in this pass per the audit's own scope (classification and reporting only, no fixes).

## Regression coverage

The replay harness itself; see [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md) for the general mechanism.

## Related/similar issues

- [table-merge-multiplies-row-height](table-merge-multiplies-row-height.md) — the likely (unconfirmed) cause of the new `table.mergeCells` divergence.
- [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md), [gate13-list-command-selection-and-style-differences](gate13-list-command-selection-and-style-differences.md) — the other two clusters of accepted-but-undispositioned Gate 13 differences.
- **Gate 14 status**: outstanding for all four. `table.mergeCells` specifically needs *new* owner attention, not just inherited sign-off, since it wasn't part of any previously-reviewed report.
