# Phase 6 table behavior-change catalogue

Comparator equivalence is normalized canonical structure with IDs stripped, plus semantic selection where an input path exposes it. Operations and IDs are not compared. Logs contain scenario IDs, hashes, and classifications only.

The retained-engine corpus contains 2,100 scenarios (seed `0x7AB1E006`): 300 each for row insertion/removal, column insertion/removal, merge, header-row toggle, and split. The corpus recorded 1,500 equivalent results, 300 expected-normalization results, and 300 visual-only results; it recorded no semantic, data-loss, or unknown result.

Intentional differences:

1. **Column insertion — expected normalization (300).** Canonical tables materialize one table-owned `columnWidths` entry for the inserted logical column. Legacy left width ownership implicit or duplicated it on cells. Content, cell order, and spans are equivalent. This is a correction to the single-source-of-truth rule, not a content change.
2. **Header toggle — visual-only (300).** The product projection gives newly created header cells the established bold/subtle-background defaults. The retained model engine changed only `th`/`td`. Header semantics and content are equivalent; the difference is presentation.
3. **Malformed imported grids — correction of legacy behavior.** Canonical repair clamps overhanging spans, moves overlapping anchors to the next free position, pads holes, and closes the leading header region without deleting cell content. Legacy behavior varied by browser DOM repair. These fixtures are validated as deterministic non-destructive corrections rather than exact legacy equivalence.
4. **Header/body merge — correction of legacy behavior.** Canonical merge refuses a selection spanning header and body cells. Legacy could produce a merged cell whose header semantics depended on the anchor. Refusal avoids an ambiguous accessibility result.
5. **Single body-cell header toggle — correction of legacy behavior.** A body cell that is in neither a leading row nor leading column is refused because it would violate the table header geometry invariant. Leading row/column toggles remain supported.

The manual Phase 5 selection-only spot-check and NVDA table-mode validation are tracked separately because neither can be honestly inferred from the synthetic comparator.
