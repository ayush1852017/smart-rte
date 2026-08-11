# Phase 8b delta report 4 — Gate 13 replay closure

## A. Scope and implementation

This delta adds the ten named list intents and `table.insert` to the browser
retained-vs-canonical replay. The route is
`packages/react/playground/src/Gate13ReplaySurface.tsx:49-78`, and the list
retained/canonical scenarios are implemented in
`packages/react/src/adapters/legacyListShadowComparator.ts:157-291`.

The list comparator applies the retained transaction and the canonical pure
operations from the same initial document, maps the canonical selection through
the operations, converts legacy node selections to a documented text-owner
semantic point, and compares normalized structure plus selection. The table
insertion comparator and its stable first-cell selection point are in
`packages/react/src/test-harness/tableShadowComparator.ts:63-115`.

## B. Complete intent classification

The classification inventory remains 49 generated intents: 42 comparable and
seven valid owner-approved exclusions. The full source table is
[`PHASE_8B_GATE13_INTENT_CLASSIFICATION.md`](./PHASE_8B_GATE13_INTENT_CLASSIFICATION.md).

| Intent | Retained counterpart | Replay status / exclusion reason |
|---|---:|---|
| `mark.bold` | yes | replayed |
| `mark.italic` | yes | replayed |
| `mark.underline` | yes | replayed |
| `mark.strike` | yes | replayed |
| `mark.code` | yes | replayed |
| `mark.superscript` | yes | replayed |
| `mark.subscript` | yes | replayed |
| `mark.textColor` | yes | replayed |
| `mark.backgroundColor` | yes | replayed |
| `mark.fontSize` | yes | replayed |
| `mark.fontFamily` | yes | replayed |
| `mark.link` | yes | replayed |
| `block.setType` | yes | replayed |
| `block.setAttributes` | yes | replayed |
| `block.wrap` | yes | replayed |
| `block.unwrap` | yes | replayed |
| `block.move` | yes | replayed |
| `block.indent` | yes | replayed |
| `block.outdent` | yes | replayed |
| `list.create` | yes | replayed in this delta |
| `list.setPreset` | yes | replayed in this delta |
| `list.setStyle` | yes | replayed in this delta |
| `list.indent` | yes | replayed in this delta |
| `list.outdent` | yes | replayed in this delta |
| `list.move` | yes | replayed in this delta |
| `list.move.reverse` | yes | replayed in this delta |
| `list.create.numbered` | yes | replayed in this delta |
| `list.setChecked` | yes | replayed in this delta |
| `list.restartNumbering` | **no** | retained engine had no capability; owner-approved exclusion |
| `list.continueNumbering` | **no** | retained engine had no capability; owner-approved exclusion |
| `list.unwrap` | yes | replayed in this delta |
| `table.insert` | yes | replayed in this delta; selection compared |
| `table.mergeCells` | yes | replayed |
| `table.splitCell` | yes | replayed |
| `table.insertRow` | yes | replayed |
| `table.removeRow` | yes | replayed |
| `table.insertColumn` | yes | replayed |
| `table.removeColumn` | yes | replayed |
| `table.setHeader` | yes | replayed |
| `table.moveRow` | **no** | retained engine had no row-reordering capability; owner-approved exclusion |
| `table.moveColumn` | **no** | retained engine had no column-reordering capability; owner-approved exclusion |
| `table.remove` | yes | replayed |
| `atom.insert.image` | **no** | retained engine had no provider-backed insertion contract; owner-approved exclusion |
| `atom.resize` | yes | replayed |
| `atom.update` | yes | replayed |
| `atom.delete` | yes | replayed |
| `atom.insert.video` | **no** | retained engine had no video insertion; owner-approved exclusion |
| `atom.insert.audio` | **no** | retained engine had no audio insertion; owner-approved exclusion |
| `atom.insert.formula` | yes | replayed |

The seven exclusions are unchanged from Delta 3. No intent was excluded because
the harness lacked a route.

## C. Equivalence policy

The replay compares normalized document structure with IDs stripped and semantic
selection positions. Operation streams and node IDs are not compared. Each
new named intent is a one-intent replay, so its reported intent is necessarily
the first divergent intent when it differs. Logs contain only hashes and
classification codes; no document text is emitted.

The ten list scenarios compare semantic selection after the command. The new
`table.insert` scenario compares the first inserted-cell paragraph selection.
The twelve pre-existing table/atom rows still expose the inherited comparator
limitation from Delta 3 (`selectionCompared: false` for eight table commands and
four atom smoke rows); this delta does not silently call those structural-only
checks selection evidence.

## D. Gate 13 results

The browser route now reports **42 comparable intents** and the Playwright test
asserts 42 results (`packages/react/e2e/canonical-authority.spec.ts:717-739`).
The route passed in all three browsers:

| Browser | Comparable intents | Selection compared | Divergences | Result |
|---|---:|---:|---:|---|
| Chromium | 42 | 30/42 (12 inherited table/atom rows remain structure-only) | 10 | pass; no semantic/data-loss |
| Firefox | 42 | 30/42 | 10 | pass; no semantic/data-loss |
| WebKit | 42 | 30/42 | 10 | pass; no semantic/data-loss |

The new ten list intents plus `table.insert` all have selection checkpoints.
The remaining 12 selection gaps are inherited from the eight pre-existing table
rows and four atom smoke rows; none is one of the eleven additions.

Every browser produced the same ten differences:

| Intent | Classification | Hash | Interpretation |
|---|---|---|---|
| `block.quote` | `selection-only` | `c80caa69` | Existing Phase 5 selection family |
| `block.code` | `selection-only` | `42993efd` | Existing Phase 5 selection family |
| `table.insertColumn` | `expected-normalization` | `1d9005a0` | Same Phase 6 approved correction class |
| `table.setHeader` | `visual-only` | `122df650` | Same Phase 6 approved correction class |
| `table.insert` | `expected-normalization` | `55381491` | Legacy omits canonical table layout/width defaults; text is conserved |
| `list.create` | `selection-only` | `ac36cbab` | Retained toggle returns a node selection; canonical mapping retains the text-owner point |
| `list.setPreset` | `expected-normalization` | `9f4b08ab` | Retained stores a portable fallback style alongside preset; canonical stores preset as source of truth |
| `list.setStyle` | `selection-only` | `41d81290` | Selection mapping only |
| `list.create.numbered` | `selection-only` | `141cd3eb` | Selection mapping only |
| `list.unwrap` | `selection-only` | `daccee1d` | Selection mapping only |

No new `semantic`, `data-loss`, or `unknown` difference appeared in the eleven
added intents. Gate 13's missing-intent coverage gap is closed; the inherited
selection-only table/atom limitation and Gate 14 dispositions remain explicit
rather than being folded into the pass count.

## E. Tests and suite accounting

Focused evidence:

- `packages/react/src/adapters/legacyListShadowComparator.test.ts:11-22` —
  10 named list intents, all with selection comparison; pass.
- `packages/react/src/test-harness/tableShadowComparator.test.ts:9-16` —
  `table.insert` selection checkpoint; pass (expected-normalization).
- `packages/core/src/foundation/block/commands.test.ts` — 8/8 pass after the
  blockquote fix.

Prior-suite accounting (no tests removed):

| Suite | Before this delta | After this delta | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 423 passed | 51 files / 424 passed | none |
| React Vitest | 43 files / 237 passed | 43 files / 240 passed | none; three focused regressions/replay tests added |
| Playwright, all browsers | 243 total: 236 passed, 2 WebKit failures, 5 skipped | 243 total: 238 passed, 0 failures, 5 skipped | none |

The prior WebKit failures were the two recurring Phase 3 tests named in the
separate flake report; the current full three-browser run passed them.

## F. Web/browser evidence commands

```text
pnpm --filter smartrte-react exec vitest run src/adapters/legacyListShadowComparator.test.ts
pnpm --filter smartrte-react exec vitest run src/test-harness/tableShadowComparator.test.ts
pnpm --filter smartrte-react exec playwright test \
  e2e/canonical-authority.spec.ts -g "retained/canonical command replay"
```

The last command ran Chromium, Firefox, and WebKit: **3 passed**. The full
three-browser suite then ran **243 tests: 238 passed, 5 intentional skips**.

## G. Gate 14 impact

This report does not close Gate 14. The replay surfaced no new semantic/data-loss
behaviour, but Gate 14's stricter rule still requires owner disposition for any
difference. The two table differences match the Phase 6 correction classes; the
two block differences remain the known Phase 5 selection family. The five new
list/table differences above are now documented, with no content loss. They must
not be silently waived by this Gate 13 coverage report.

## H. Remaining scope and readiness

No flag promotion, rollback-bridge deletion, or new editing feature was done.
The seven exclusions remain exactly the owner-approved waiver. Before claiming
full Gate 13 evidence rather than “42 intents replayed,” the inherited
selection-only table/atom comparators should either gain real retained/canonical
selection outputs or be explicitly accepted as a separate waiver. Gate 14 still
needs its owner decision on the known selection differences and documented Phase
6 corrections.
