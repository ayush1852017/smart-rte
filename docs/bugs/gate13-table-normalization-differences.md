# Gate 13: four table commands show retained-vs-canonical normalization differences

**Status:** 3 of 4 not a bug (documented Phase 6 correction class); **`table.mergeCells` — confirmed FIXED, 2026-08-25** (see disposition below). Gate 14 owner disposition still outstanding for the remaining 3 (`table.insertColumn`, `table.setHeader`, `table.insert`) — those are documented/expected, not re-litigated in this pass, but nobody has formally signed off Gate 14 for them either.
**Area:** table / test infra (retained-vs-canonical replay)
**First reported:** `table.insertColumn` and `table.setHeader` — unknown, present at least as far back as `docs/PHASE_8B_DELTA_REPORT_3.md`. `table.insert` — first appears in `docs/PHASE_8B_DELTA_REPORT_4.md` (2026-08-07). `table.mergeCells` — **not present in any written report; first observed in the 2026-08-12 re-audit for this file.**
**Related files:** `docs/PHASE_8B_DELTA_REPORT_3.md`, `docs/PHASE_8B_DELTA_REPORT_4.md`, `docs/bugs/table-merge-multiplies-row-height.md`, `docs/PHASE_8B_PROMOTION_READINESS.md`

## Symptom

The Gate 13 retained-vs-canonical replay originally reported four table commands producing a structurally-different (but non-semantic, non-data-loss) result between the retained and canonical editors. As of 2026-08-25, only three still do:

| Intent | Classification | Hash |
|---|---|---|
| `table.insertColumn` | `expected-normalization` | `1d9005a0` |
| `table.setHeader` | `visual-only` | `122df650` |
| `table.insert` | `expected-normalization` | `55381491` |
| ~~`table.mergeCells`~~ | ~~`expected-normalization`~~ | ~~`a37b125d`~~ — **now `equivalent`, no divergence (confirmed 2026-08-25, see Fix)** |

## Reproduction

Automated, via the replay harness: `pnpm --filter smartrte-react exec playwright test e2e/canonical-authority.spec.ts -g "retained/canonical command replay"`. All four confirmed present and identical across Chromium/Firefox/WebKit in the 2026-08-12 re-audit.

## Root cause

- `table.insertColumn` / `table.setHeader`: documented as "the same Phase 6 approved correction class" — the canonical engine's table geometry/header handling was deliberately corrected relative to the legacy behavior; the difference is expected and was previously reviewed.
- `table.insert`: "legacy omits canonical table layout/width defaults; text is conserved" — the canonical engine sets layout defaults the legacy one doesn't.
- `table.mergeCells` (**the new one, now resolved — see Fix below**): at the time this file was first written, not classified anywhere in prior reports. The circumstantial explanation on file was that [table-merge-multiplies-row-height.md](table-merge-multiplies-row-height.md)'s asymmetric fix (canonical merge content-assembly corrected; retained/legacy DOM table bridge deliberately left as-is) would produce exactly this kind of new divergence between the two engines.

## Fix

**2026-08-25 (pre-12b punch-list item 4): re-read the actual comparator output directly, per this file's own outstanding instruction, rather than re-asserting the circumstantial hypothesis.** Reproduced the exact scenario `Gate13ReplaySurface.tsx` uses (`table.cell.merge` on the fixed 2×2 `A/B/C/D` table, `{start:{row:0,column:0},end:{row:1,column:1}}`) directly against `compareRetainedAndCanonicalTable` (`packages/react/src/test-harness/tableShadowComparator.ts`): **`{ equivalent: true, legacyStructureHash: "3d512b9b", canonicalStructureHash: "3d512b9b" }`** — the two engines now produce byte-identical normalized structure for this exact scenario. No divergence, no hash `a37b125d` (the value recorded when this file was originally written). Cross-checked against the real 2,100-scenario property test (`tableShadowComparator.test.ts`, seed `0x7AB1E006`, 300 `table.cell.merge` iterations across randomly-sized tables): **`'table.cell.merge': { equivalent: 300 }`** — zero divergences of any classification, reproduced on a fresh run.

**Disposition: the `table.mergeCells` divergence no longer exists — fixed, not merely re-explained.** The circumstantial hypothesis on file (an asymmetric fix between canonical and retained merge content-assembly) is plausible as the historical cause but is now moot either way, since both engines agree today. Whatever exact change closed the gap between 2026-08-12 (when hash `a37b125d` was recorded) and now happened as a side effect of other work, not a change made in this pass — consistent with this project's recurring "silently fixed and never noticed" pattern (the same shape the independent audit's §2/`docs/bugs/` staleness check was built to catch, though it didn't happen to catch this specific one in its own sample).

## Regression coverage

The replay harness itself (`packages/react/playground/src/Gate13ReplaySurface.tsx`, exercised via `canonical-authority.spec.ts`'s "retained/canonical command replay") and `packages/react/src/test-harness/tableShadowComparator.test.ts`'s 2,100-scenario property test (`'table.cell.merge': { equivalent: 300 }`, re-run fresh 2026-08-25) both now assert `table.mergeCells` is equivalent — if either engine's merge output regresses relative to the other in the future, both would catch it. See [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md) for the general replay mechanism.

## Related/similar issues

- [table-merge-multiplies-row-height](table-merge-multiplies-row-height.md) — the plausible historical cause of the (now-resolved) `table.mergeCells` divergence; left as a related pointer even though the divergence it may have caused no longer reproduces.
- [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md), [gate13-list-command-selection-and-style-differences](gate13-list-command-selection-and-style-differences.md) — the other two clusters of accepted-but-undispositioned Gate 13 differences, unaffected by this update.
- **Gate 14 status**: `table.mergeCells` is resolved and needs no further owner action. The remaining 3 (`table.insertColumn`, `table.setHeader`, `table.insert`) are still outstanding for formal Gate 14 sign-off — documented and understood, but nobody has explicitly signed off on them as acceptable-as-is.
