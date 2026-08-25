# Phase 8c Collaboration Readiness completion report

**Verdict: Complete.** All five items and all six collab-readiness gate assertions defined in `docs/PHASE_ROADMAP_8B_12B.md` are implemented and verified. `pnpm run lint` (including the new `lint:phase8c-contract`) is green; the full core (540 tests), react (97 tests), and 3-browser e2e (253 passed / 5 skipped / 0 failed, matching the project's known baseline) suites all pass.

This phase was entered mid-session after a Phase 10 (Plugin Ownership) kickoff was interrupted: the roadmap's own "non-negotiable ordering" (8c precedes 10) was checked and found not actually satisfied, despite prior handoff docs implying otherwise. This report exists so that check does not have to be redone from scratch again.

## Item 1 — Per-transaction validity model

No production code change was needed: `applyTransactionAtomic` (`packages/core/src/foundation/transactions.ts`) already applies a transaction's full operation list via `applyOperations` (which has no per-operation validation) and validates once at commit. Closed with a regression test proving the property against a real multi-op command: `table/table.test.ts`, describe block "per-transaction validity (Phase 8c item 1)" — asserts a fine-grained row-insert's first operation alone produces an invalid intermediate document, while the full transaction commits to a valid one.

## Item 2 — Fine-grained table operations

All 11 table commands that previously replaced the whole table via a single `replaceNode` (`insertTableRowCommand`, `removeTableRowCommand`, `insertTableColumnCommand`, `removeTableColumnCommand`, `mergeTableCellsCommand`, `splitTableCellCommand`, `setTableHeaderCommand`, `setTableCellAttributesCommand`, `setTableColumnWidthCommand`, `setTableRowHeightCommand`, `moveTableColumnCommand`) now emit only the operations the edit actually requires — `insertNode`/`removeNode`/`moveNode`/`setNodeAttributes` scoped to the affected row(s)/cell(s), plus (for merge) one cell-scoped `replaceNode`. The `replaceTable` helper and its supporting `Placement`/`placementsOf`/`tableFromPlacements`/`spanAttrs` machinery were deleted entirely once unused — no `SmartOperation` type changes were needed; the existing vocabulary was already sufficient.

Measured effect: a single-row insert into a 50×50 table now produces a ~16.8 KB history entry, down from ~1.6 MB (`table/table.test.ts`, "measures a 50x50 single-row-insert payload").

The 1,000-seed fuzz test (`table/table.test.ts`, seed `0x6A1D2026`) was widened from 4 to 7 operation choices (adding merge/split/move-column) and asserts geometry validity, schema validity, and exact undo-round-trip identity after every step, plus that no operation ever replaces the whole table.

**Two pre-existing bugs were found and fixed while widening that fuzz test** (both predate Phase 8c; neither was introduced by this work — see `docs/bugs/` for full detail):
- [table-row-empty-rowspan-coverage-rejected](bugs/table-row-empty-rowspan-coverage-rejected.md) — `table_row`'s schema content spec was `table_cell+`, which rejected a row left with zero cells after a full-width multi-row merge, even though that structure is geometrically correct and necessary. Relaxed to `table_cell*`.
- [setnodeattributes-reorders-keys-breaking-exact-match](bugs/setnodeattributes-reorders-keys-breaking-exact-match.md) — `setNodeAttributes`'s apply logic silently moved a node's `attrs` key to the end of the object, breaking a later exact-match (`JSON.stringify`-based) check in a one-operation-at-a-time undo replay. Fixed in `packages/core/src/foundation/operations.ts` to preserve key order.

## Item 3 — Annotation range primitive

New module `packages/core/src/foundation/annotations/` (`types.ts`, `range.ts`, `range.test.ts`, wired into `foundation/index.ts`). `AnnotationRange` anchors to node ids (`startId`/`endId`) with optional offsets. `resolveAnnotationRange` resolves against the live document via `PositionLookup` — free for 10 of 12 operation types, since node identity survives them unchanged. `rebaseAnnotationRange`/`rebaseAnnotationRangeThroughOperations` add bespoke handling only for `splitNode` (an endpoint whose offset moved into the new right-hand node gets its id rewritten) and `mergeNode` (a caller-supplied `MergeOrphanPolicy` decides what happens to an endpoint anchored to the retired id — `foundation/` takes no position on drop-vs-snap, per explicit user decision). Integration into a real transaction pipeline and any comment/suggestion semantics are explicitly out of scope — Phase 12a's concern.

Verified by 12 tests including a 500-case seeded property test (seed `0xA27A0`) round-tripping split → rebase → undo(merge) → rebase back to the exact original range.

## Item 4 — Rollback preserves node identity

Verified moot rather than fixed: the mechanism the roadmap names (`legacyDocument()` / the `LegacyClassicEditor` HTML-rollback boundary) was already deleted from product code in commits `60adfb7` and `cb05f88`, independently reconfirmed via `git grep`. Checkpoint/restore (`canonicalEditorRuntime.ts`'s `restoreCheckpoint`) uses the structured JSON envelope (`serializePersistedDocument`/`parsePersistedDocument`) and preserves ids by construction. `docs/bugs/rollback-edit-remints-node-ids.md` updated from `Open` to `Fixed by deletion`, with a forward-looking flag (not a fix) for any future HTML-based restore surface.

## Item 5 — Collab-readiness gate

New `scripts/check-phase8c-contract.mjs`, following the `sourceHas`/`assertContract` template (`scripts/contract-utils.mjs`), wired into `package.json` as `lint:phase8c-contract` in the top-level `lint` chain. All six assertions:

1. **Node identity survives split, merge, move, type change, undo.** Covered by `foundation.test.ts` (apply/invert identity + 500-case structural property), `block/commands.test.ts` (500-case editor-level type-change undo/redo, plus a new 500-case move-then-undo-then-redo test closing the one gap found — move was previously only covered at the pure-operation-algebra level), `table/table.test.ts` (1,000-case fuzz), `list/history.property.test.ts` (1,000-case).
2. **Every operation is granular.** The `replaceTable` identifier no longer exists in `table/commands.ts` at all (gate checks for its absence); `table/table.test.ts` runtime-asserts no operation ever replaces the whole table.
3. **Selection maps through every operation type, associatively.** `foundation.test.ts` already checked resolvability for all 12 types; associativity was previously checked only for `insertText`/`deleteText` — extended (`it.each` over the (now module-scoped) `operationCases()` fixture) to all 12.
4. **Transactions are JSON-serializable, carry `baseRevision` and `authorId`.** `baseRevision` is required and tested; `authorId` stays optional at the type level (explicit decision — no ripple through every `SmartTransaction` construction call site this phase), with a new test verifying it plumbs end-to-end from `transact()` options into the emitted transaction and its history entry when supplied.
5. **Every operation implements `map(op, otherOp)`.** `mapOperation`'s implementation was already complete for all 12 types; test coverage was one smoke case — extended to `it.each` over all 12.
6. **Annotation ranges survive arbitrary transaction sequences.** Item 3's 500-case property test.

## Verification

- `pnpm run lint` — green, including `lint:phase8c-contract` (sanity-checked to actually fail: reintroducing a `replaceTable(` call site trips it).
- `pnpm --filter smartrte-core test` — 540/540.
- `pnpm --filter smartrte-react test` — 97/97, run against a freshly rebuilt `packages/core/dist` (the stale pre-existing dist would have silently skipped exercising any of this phase's changes — rebuilt before this run).
- Full 3-browser e2e (`chromium`/`firefox`/`webkit`, all 7 spec files) — 253 passed / 5 skipped / 0 failed, matching the project's previously-recorded baseline exactly.
- `tsc --noEmit` clean in both `packages/core` and `packages/react`.

Phase 10 (Plugin Ownership) may now proceed per the roadmap's ordering.
