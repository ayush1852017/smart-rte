# Phase 8b Canonical Authority Takeover — Delta Report 3

Date: 2026-08-07  
Scope: Phase 8b gates 13, 14, and 16; independent DOCX/PDF deletion guard

## Verdict

**HOLD.** The new retained-versus-canonical evidence is useful, but it does
not close gates 13 or 14.

- The 49 generated intents were classified. Forty-two have retained
  counterparts; seven are legitimate exclusions.
- A browser evidence route compares 31 of those 42 intents in Chromium,
  Firefox, and WebKit. It reports the same four divergences in every browser.
- The remaining 11 comparable intents are not silently counted as equal. They
  still need a retained replay path (or an owner-approved, documented waiver).
- The DOCX/PDF export guard is independent of the four rollback bridges and
  passes.
- No flag promotion occurred and no rollback bridge was deleted.

## A. Implemented replay and guard interfaces

The browser evidence route is `packages/react/playground/src/Gate13ReplaySurface.tsx`.
Its actual result contract is:

```ts
type Gate13Result = {
  browserReady: true;
  comparableIntents: number;
  intentResults: Array<{
    intent: string;
    equivalent: boolean;
    selectionCompared: boolean;
    classification?: string;
    hash: string;
  }>;
  listCorpus: {
    scenarios: number;
    equivalent: number;
    divergences: Record<string, number>;
  };
  atomCorpus: {
    scenarios: number;
    equivalent: number;
    divergences: Record<string, number>;
  };
};
```

`packages/react/e2e/canonical-authority.spec.ts` compares normalized structure
with IDs removed and, where the adapter exposes it, semantic selection. The
selection representation is the owner path plus kind and offset; it does not
compare freshly generated node IDs. Logs contain hashes and classifications,
not document text.

The independent format guard is
`packages/react/src/adapters/phase8bExportGuard.test.ts`. It calls the DOCX
export/import adapters and the PDF print adapter directly; it does not mount
`ClassicEditor` or import a rollback bridge.

## B. Deviations from the work order

| Requirement | Actual result | Consequence |
|---|---|---|
| Replay every comparable generated intent against retained and canonical surfaces | 31 named intents run in the three-browser evidence route. The ten named list intents and `table.insert` are not in that route. Existing retained shadow corpora cover subsets, but not this complete named matrix. | Gate 13 remains qualified. These are comparable capabilities, not exclusions. |
| Compare semantic selection after every intent | Mark and block adapters expose selection comparisons (19 of the 31 browser intents). Table and atom adapter comparators currently expose structure only (12 of 31). | Selection parity for table/atom operations is unproven. |
| Gate 14 has a zero-difference bar | The raw replay has four differences: two selection-only block differences, one table normalization difference, and one table header representation difference. The two table cases now cross-reference approved Phase 6 catalogue entries. | The table cases are documentation-closed as prior approved corrections; the two block selection differences still keep Gate 14 open. |
| Browser list replay corpus | The browser route runs a bounded five-case smoke corpus to keep the page responsive. The required 1,000-case retained list corpus remains a Node/Vitest test with seed `0xD0A10300`. | Browser evidence is not a substitute for the full named list replay. |
| Exploratory product-UI dual runner | Removed from test registration after it proved too slow and affordance-dependent. The bounded route is the reproducible evidence path; no product code depends on the exploratory runner. | No false green is attributed to that runner. |
| Full browser regression | The full run reached 243 tests but had two recurring WebKit Phase 3 failures. Running those two tests alone passed. | Gate 16 is qualified, not a clean full-suite pass. |

No editing-state contract, operation algebra, or host API was changed.

## C. Locked decisions for this delta

- Equivalence is normalized, ID-stripped document structure plus semantic
  selection where the retained adapter supplies a comparable selection.
- Operation streams and node IDs are never compared.
- A semantic point uses owner path, resolved kind, and offset. Owner paths are
  the correct cross-run identity; node IDs remain covered by the Phase 1
  identity tests.
- The seven generated exclusions are exactly:
  `list.restartNumbering`, `list.continueNumbering`, `table.moveRow`,
  `table.moveColumn`, `atom.insert.image`, `atom.insert.video`, and
  `atom.insert.audio`.
- `mark.code` is **comparable** despite lacking a legacy toolbar button: the
  retained inline command exists and is exercised by the retained inline
  harness.
- Provider-backed image insertion is excluded because the retained engine had
  a local image path, not the Phase 8b host `MediaProvider` contract. Video and
  audio insertion had no retained capability.
- DOCX/PDF browser workflows are not among the 49 generated editing intents;
  they are protected by the separate export guard.
- A retained/canonical difference is a defect for Gate 14. Earlier-phase
  “corrections of legacy behaviour” are not waivers in the authority takeover.

## Full 49-intent classification

The source table is also kept at
`docs/PHASE_8B_GATE13_INTENT_CLASSIFICATION.md`; the complete table is repeated
here so the report is self-contained.

| Intent | Retained counterpart? | Exclusion reason when not comparable |
|---|---:|---|
| `mark.bold` | yes | — |
| `mark.italic` | yes | — |
| `mark.underline` | yes | — |
| `mark.strike` | yes | — |
| `mark.code` | yes | Retained command exists; no toolbar-only exclusion. |
| `mark.superscript` | yes | — |
| `mark.subscript` | yes | — |
| `mark.textColor` | yes | — |
| `mark.backgroundColor` | yes | — |
| `mark.fontSize` | yes | — |
| `mark.fontFamily` | yes | Existing retained option is enabled for replay. |
| `mark.link` | yes | — |
| `block.setType` | yes | — |
| `block.setAttributes` | yes | Retained alignment command. |
| `block.wrap` | yes | Retained blockquote toggle. |
| `block.unwrap` | yes | Retained blockquote toggle. |
| `block.move` | yes | Retained block move path. |
| `block.indent` | yes | Retained block indentation path. |
| `block.outdent` | yes | Retained block outdentation path. |
| `list.create` | yes | Retained list toggle. |
| `list.setPreset` | yes | Retained list toggle accepts preset styles. |
| `list.setStyle` | yes | Retained list toggle accepts explicit styles. |
| `list.indent` | yes | Retained list depth path. |
| `list.outdent` | yes | Retained list depth path. |
| `list.move` | yes | Retained list/block move path existed; a product no-op is a parity finding, not an exclusion. |
| `list.move.reverse` | yes | Same retained move path in the opposite direction. |
| `list.create.numbered` | yes | Retained ordered-list toggle. |
| `list.setChecked` | yes | Retained checklist/item checked commands. |
| `list.restartNumbering` | no | Retained engine had no restart-numbering capability. |
| `list.continueNumbering` | no | Retained engine had no continue-numbering capability. |
| `list.unwrap` | yes | Retained list toggle unwraps an existing list. |
| `table.insert` | yes | Retained table insertion command. |
| `table.mergeCells` | yes | Retained merge command. |
| `table.splitCell` | yes | Retained split command. |
| `table.insertRow` | yes | Retained row insertion command. |
| `table.removeRow` | yes | Retained row removal command. |
| `table.insertColumn` | yes | Retained column insertion command. |
| `table.removeColumn` | yes | Retained column removal command. |
| `table.setHeader` | yes | Retained header-cell/row/column commands. |
| `table.moveRow` | no | Retained table engine had no row-reordering capability. |
| `table.moveColumn` | no | Retained table engine had no column-reordering capability. |
| `table.remove` | yes | Retained table removal command. |
| `atom.insert.image` | no | Generated intent exercises provider-backed picker/upload; retained had only a local image path. |
| `atom.resize` | yes | Retained image resize path. |
| `atom.update` | yes | Retained image attribute update path. |
| `atom.delete` | yes | Retained image deletion path. |
| `atom.insert.video` | no | Retained engine never supported video insertion. |
| `atom.insert.audio` | no | Retained engine never supported audio insertion. |
| `atom.insert.formula` | yes | Retained formula insertion path. |

**Totals:** 49 generated intents; 42 comparable; 7 valid exclusions. The 11
comparable intents not yet in the browser route are the ten named list intents
and `table.insert`; they are not part of the seven-intent exclusion waiver.

## D. Gate results and test accounting

### Gate 13 — retained/canonical replay

**QUALIFIED / OPEN.** The three-browser evidence route ran 31 named comparable
intents in each browser. The bounded list smoke ran 5/5 retained/canonical
cases. Every browser produced the same four divergences:

| Browser | Named intents compared | Divergences | First divergent intent(s) |
|---|---:|---:|---|
| Chromium | 31 | 4 | `block.quote` (selection-only), `block.code` (selection-only), `table.insertColumn` (expected-normalization), `table.setHeader` (visual-only) |
| Firefox | 31 | 4 | Same four intents and classifications |
| WebKit | 31 | 4 | Same four intents and classifications |

The first divergence for each isolated replay is the intent itself; the
hashes are `c80caa69`, `42993efd`, `a6e7cf8a`, and `53f070fa`. The browser
evidence test is intentionally an evidence collector: it records differences
and does not turn them into a waiver.

Existing retained shadow evidence remains useful but does not close the named
matrix:

| Harness | Cases / seed | Result |
|---|---:|---|
| Inline retained shadow | 3,000 / `0x1A4F2026` | No semantic/data-loss divergence; all 12 mark tools exercised. |
| Block retained shadow | 3,000 / `0xB10C2026` | No semantic/data-loss divergence; quote/code selection-only differences remain. |
| List retained shadow | 1,000 / `0xD0A10300` | 1,000 equivalent, no divergence; five modes, not all ten named list intents. |
| Table retained shadow | 2,100 / `0x7AB1E006` | 1,500 equivalent; 300 `expected-normalization` (column add), 300 `visual-only` (header); no semantic/data-loss. |
| Atom retained shadow | 2,100 / `0xA70B2027` | 900 equivalent-serialization, 600 expected-normalization security cases; no semantic/data-loss/unknown. |

The earlier five-session/49-intent canonical-vs-canonical replay still passes
and proves determinism, but it is not retained equivalence evidence.

### Gate 14 — zero behaviour change

**OPEN for the two block selection differences.** The raw browser replay has
four differences, but `table.insertColumn` and `table.setHeader` match the
already-reviewed Phase 6 column-insertion and header-toggle catalogue entries;
their disposition is now a documentation cross-reference rather than new 8b
behavior. `block.quote` and `block.code` remain unresolved selection
differences. The 11 comparable intents absent from the browser replay are an
additional evidence gap. No divergence was silently accepted as equivalent.

### Gate 16 — prior suites

| Suite | Before Delta 2 | Current | Removed tests |
|---|---:|---:|---|
| Core Vitest | 423 passed | 423 passed | None |
| React Vitest | 235 passed | 237 passed | None; two DOCX/PDF guard tests added |
| Playwright all projects | 240 total (235 passed, 5 intentional skips) | 243 total (236 passed, 2 failed, 5 intentional skips) in the full run; the two failures were WebKit Phase 3 cases | None |

The two failing full-run artifacts were:

- `canonical-surface.spec.ts:421` — “replays 1,000 privacy-safe comparator
  scenarios in this browser” (WebKit).
- `canonical-surface.spec.ts:465` — “Backspace merges into the deepest
  preceding descendant and Delete mirrors forward” (WebKit).

Each test passed when rerun alone in WebKit (`2 passed`). This is recorded as
a recurring/full-suite resource flake, not hidden as a pass. The earlier
WebKit list-Enter timeout did not appear under the isolated rerun, but the
full-suite WebKit failures mean Gate 16 is qualified rather than clean.

### Verification commands

```text
pnpm run lint                                      # passed
pnpm --filter smartrte-core test                   # 51 files, 423 passed
pnpm --filter smartrte-react test                  # 43 files, 237 passed
pnpm --filter smartrte-react e2e                   # 243 tests scheduled; two WebKit failures in full run
pnpm --filter smartrte-react exec vitest run \
  src/adapters/phase8bExportGuard.test.ts           # 2 passed
pnpm --filter smartrte-react exec playwright test \
  e2e/canonical-authority.spec.ts \
  --grep "runs the retained/canonical command replay" \
  --project=chromium --project=firefox --project=webkit # 3 passed
```

## E. Known gaps and uncertainty

1. The required all-comparable browser replay is incomplete: 11 comparable
   named intents still rely on existing model corpora or have no retained
   browser command runner.
2. Table and atom adapter comparators do not yet return semantic selection, so
   12 of the 31 direct browser checks compare structure only.
3. `block.quote` and `block.code` selection mapping differs between retained
   and canonical adapters. The existing Phase 5 corpus already exposed this;
   this delta confirms it in all three browsers rather than hiding it.
4. `table.insertColumn` and `table.setHeader` retain the previously observed
   structural/visual differences, now cross-referenced to the approved Phase
   6 catalogue. They are not a new 8b behavior change; the two block selection
   differences remain the Gate-14 blocker.
5. Full-suite WebKit is resource-sensitive: the two Phase 3 tests pass alone
   but failed in the 243-test run. A clean full run is still required.
6. Provider-backed media insertion and DOCX/PDF browser workflows remain
   legitimate non-comparable surfaces. They are not evidence of parity.

## F. Shadow results and export guard

The retained/canonical browser route emits hash-only records. Across all three
browsers the result was four differences per run, with no browser-specific
classification drift. There was no document text in the route annotation.
The atom smoke corpus ran 7 cases per browser (2 equivalent, 3
equivalent-serialization, and 2 expected-normalization security cases); it
reported no semantic, data-loss, or unknown classification.

The independent DOCX/PDF guard passed 2/2 tests:

- DOCX export produced `word/document.xml`, then Mammoth import recovered the
  heading and paragraph text.
- PDF print export emitted the expected heading/paragraph HTML, which was
  parsed back into the canonical document without importing a rollback bridge.

`docs/MIGRATION_ADAPTER_INVENTORY.md` now requires this guard to pass before
and after each of the four rollback-bridge deletion commits. The format guard
therefore remains in place when the editing-state bridges are removed.

## G. Readiness and residual waiver

Promotion is **not safe yet**. Before an owner can promote the flag, the
following must be resolved:

1. Add retained replay counterparts for the 11 comparable intents missing
   from the browser route, including semantic selection after each intent.
2. Verify or fix the two block selection differences. The two table
   differences are closed by the Phase 6 catalogue cross-reference recorded
   below; they are not a new 8b behavior change.
3. Produce a clean three-browser full regression run, or document and fix the
   WebKit resource flake so Gate 16 is genuinely green.
4. Keep the DOCX/PDF export guard green before and after each bridge deletion.

The residual waiver candidate is limited to these seven intents, and no others:

- `list.restartNumbering` and `list.continueNumbering`: no retained capability.
- `table.moveRow` and `table.moveColumn`: no retained table reordering.
- `atom.insert.image`: provider-backed host flow did not exist on the retained
  path.
- `atom.insert.video` and `atom.insert.audio`: no retained insertion capability.

Codex is not accepting that waiver on the owner's behalf. The owner must
explicitly accept the seven exclusions; the 11 comparable missing replays and
the two unresolved block selection differences cannot be bundled into that
waiver.

## H. Scope leakage

No new editing feature, command semantics, plugin runtime, clipboard parser,
or authority promotion was added.

The only new runtime surface is the playground-only `?gate13Replay=1` evidence
route. It imports retained test harnesses solely for comparison and is not
reachable from the product toolbar. The table shadow helper was hardened for
table removal/null serialization, and the DOCX/PDF guard was added as test-only
coverage. The four rollback bridges remain present and no deletion sequence was
started.

## Explicit owner decision required

The implementation is ready for review, not promotion. Gate 13 is qualified
with a precise list of missing comparable intents and selection gaps; Gate 14
is open on two unresolved block-selection differences after the two table
differences were cross-referenced to approved Phase 6 exceptions; Gate 16 is
qualified by two full-suite WebKit failures that pass in isolation. The flag
must remain off and all four rollback bridges must remain until the remaining
items receive an explicit owner decision.

## Owner review disposition (2026-08-07)

The owner accepts the residual waiver **for exactly seven intents and no
others**: `list.restartNumbering`, `list.continueNumbering`, `table.moveRow`,
`table.moveColumn`, `atom.insert.image`, `atom.insert.video`, and
`atom.insert.audio`. The 11 comparable intents missing from the browser replay,
the two unresolved block-selection differences, and the WebKit full-suite
failures are not included in that waiver and remain open. The two table
differences are closed as documentation-only cross-references below.

The two table differences are confirmed as the Phase 6 correction classes:
`table.insertColumn` is the same column-insertion `expected-normalization`
case documented in `docs/PHASE6_BEHAVIOR_CHANGE_CATALOGUE.md` item 1, and
`table.setHeader` is the same header-toggle `visual-only` case documented
there and in `docs/PHASE_6_COMPLETION_REPORT.md`. The current hashes are from a
fixed 2×2 replay fixture; the Phase 6 hashes were generated per scenario from
the seeded 2,100-case corpus, so hash equality is not expected. This is a
documentation close against the already-approved Phase 6 catalogue, not a new
Gate-14 behavior change and not an expansion of the seven-intent waiver. The
Phase 8b disposition list now points to those Phase 6 entries instead of
re-litigating them.

The `block.quote` and `block.code` differences are the previously catalogued
Phase 5 selection-only family, not new semantic or data-loss behavior. Phase 5
recorded 858/3,000 Node cases (429 quote, 429 code) and 286/1,000 cases per
browser (143 quote, 143 code) in
`docs/PHASE5_BLOCK_BEHAVIOR_CHANGES.md`; Delta 3 reproduces the same comparator
classification in a new fixed replay fixture (`c80caa69` and `42993efd`). The
specific route hashes are new fixture instances, so the human cursor
verification remains outstanding rather than being silently closed.

The next authorized work order is therefore narrow: complete retained replay
coverage for the 11 comparable intents, and investigate the recurring WebKit
full-suite contention/resource failure. Promotion and rollback-bridge deletion
remain owner decisions after those gates are re-evaluated.
