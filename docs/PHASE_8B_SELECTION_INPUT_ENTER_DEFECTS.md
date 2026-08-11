# Phase 8b selection, input, and Enter-split defects

All product reproductions in this note used `?canonicalAuthority=1`. The
retained editor was used only for comparison; it was not changed, and neither
the authority flag nor the rollback bridges were promoted/removed.

## Group A — direction-independent arrow collapse

### Reproduction

The defect reproduced at the model/input boundary. The same range with
`anchor → head` and `head → anchor` reversed collapsed to different positions
when a plain ArrowLeft/ArrowRight was dispatched. The expected document-order
endpoints were not being used.

### Root cause and fix

This was an input-pipeline bug, not a renderer or resolver bug. The plain-arrow
path in `packages/core/src/foundation/surface/input.ts:1061-1076` read
`selection.head` directly. `head` intentionally changes with drag direction;
therefore a reverse drag made Left and Right collapse to the wrong endpoint.

The handler now computes `normalizedRange(selection)` and uses `range.from` for
Left and `range.to` for Right. It is restricted to non-collapsed text
selections, so node/cell navigation retains its existing atom/table behavior.

Regression coverage is in
`packages/core/src/foundation/phase2_5.test.ts:473-501`: forward and reverse
selections are each collapsed with Left and Right and must produce identical
document-order endpoints. The test passes. No retained equivalent uses this
canonical anchor/head handler, and no retained regression was observed.

## Group B — basic input and list types

The three symptoms do **not** share one dispatch/debounce cause. They are three
different outcomes at three layers.

### B1 — consecutive spaces

The reported failure was not reproducible in the current canonical surface.
Four consecutive `insertText` spaces remain four spaces in the live model, and
the caret advances after every input. There is no whitespace-collapsing
normalizer on the editing path; whitespace collapsing remains a serialization
concern.

Evidence:

- `packages/core/src/foundation/phase2_5.test.ts:504-516` dispatches four
  `beforeinput` events and asserts `"x    "` plus the final offset.
- `packages/react/e2e/canonical-authority.spec.ts:797-810` performs the same
  action through the browser surface. It passed in Chromium, Firefox, and
  WebKit.

No code change was needed for B1. The retained/native path also has no
corresponding failure in its existing browser coverage. The earlier observation
was therefore a stale/manual-surface observation rather than a currently
reproducible model defect.

### B2 — select-all followed by Backspace/Delete

This did reproduce, especially for structural documents. The native
select-all was present, but the model-level whole-document check failed for a
resolved inline owner because the end comparison used the inline text value
rather than its numeric UTF-16 length. Consequently `isWholeDocumentRange` did
not select the canonical clear-document path.

The fix is in `packages/core/src/foundation/surface/input.ts:263-280`: the
document-end calculation now compares the offset with
`inlineText(node).length`. The existing whole-document deletion path at
`:595-605` then emits the schema-valid single empty paragraph and maps the
caret to `[0], offset 0`.

Coverage now includes:

- plain, list, table, and block-atom documents in
  `packages/core/src/foundation/phase2_5.test.ts:518-540`;
- native Ctrl/Cmd+A plus Backspace/Delete on ordinary content in
  `packages/react/e2e/canonical-authority.spec.ts:741-756`;
- native Ctrl/Cmd+A plus Backspace/Delete on a mixed list/table/atom document
  in `packages/react/e2e/canonical-authority.spec.ts:758-795`.

The mixed browser regression ran **6/6** (two deletion keys × three browsers).
The retained editor uses its native deletion path and showed no corresponding
failure; no retained code was changed.

### B3 — list types beyond plain bullet/numbered

The pure list commands were already capable of the configured presets. The
direct command matrix in `packages/core/src/foundation/list/commands.test.ts:149-166`
covers bullet-disc/circle/square and ordered-decimal/upper-alpha/upper-roman.
The marker replacement transition is covered at `:134-147`; the command clears
the competing attribute in `packages/core/src/foundation/list/commands.ts:275-285`.

The end-to-end checklist symptom exposed a separate renderer projection bug:
the list `checkable` state changed in the model, but reference-identity subtree
skipping left the projected checkbox's `aria-checked` stale. The model and
toolbar routing were correct. `syncListProjections` in
`packages/core/src/foundation/surface/renderer.ts:531-549`, called from both
initial and incremental render at `:571-599`, reconciles list/list-item
projections idempotently from current model attributes.

The focused toolbar regression at
`packages/react/e2e/canonical-toolbar-routing.spec.ts:51-61` passed 3/3
browsers. This is therefore a renderer projection fix, not a new list command
implementation. The broader pre-existing toolbar workflow still stops later
at the unrelated disabled “Grow selected atom” control
(`canonical-toolbar-routing.spec.ts:63-109`); that failure is not being hidden
under the list result.

The retained list engine uses its own DOM bridge and did not show this stale
checkbox projection in retained coverage. No retained code was changed.

## Group C — Enter split loses inline marks

### Reproduction

The defect reproduced with a split inside a differently sized, bold, and
coloured run. The text after the caret moved to a new block, but its marks were
lost/defaulted. The model showed the loss; this was not merely a CSS paint
problem. The “content rearranged below” symptom was not model corruption: the
later block retained its original ID and text, and the apparent movement was a
consequence of the malformed split/selection projection.

### Root cause and fix

This was a block/input split problem with a stored-mark transaction side effect;
the renderer was not the source of the dropped marks.

1. The old Enter path flattened the tail into plain text instead of preserving
   each child run. `splitInlineChildren` at
   `packages/core/src/foundation/surface/input.ts:201-231` now partitions text
   children without flattening marks and carries hard breaks/inline atoms as
   indivisible children.
2. `insertParagraph` at `input.ts:658-694` uses that partition and resolves
   marks at the exact split position through `marksAtInsertion`.
3. `marksAtInsertion` at `packages/core/src/foundation/marks/stored.ts:6-32`
   applies the inclusive-boundary rule rather than treating the whole block as
   one mark set.
4. A structural transaction would ordinarily clear stored marks. The explicit
   `storedMarksExplicit` distinction in
   `packages/core/src/foundation/editor.ts:43-49,115-118,295-299` preserves the
   marks active at the new block's caret for the next insertion.

Regression coverage:

- multi-mark mid-run split, exact later-node identity/text, and caret/stored
  marks: `packages/core/src/foundation/phase2_5.test.ts:542-573`;
- mark-boundary split and unchanged later structure:
  `phase2_5.test.ts:575-594`;
- product Enter split through the canonical surface:
  `packages/react/e2e/canonical-authority.spec.ts:834-878`.

The focused product test passed in all three browsers. The retained editor uses
the browser/legacy split path rather than this canonical partitioner; no
matching retained regression was observed and no retained code was changed.

## Regression accounting

| Suite | Before this batch | After this batch | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 435 passed | **51 files / 441 passed** | None; six focused unit cases added |
| React Vitest | 43 files / 240 passed | **43 files / 240 passed** | None |
| Full Playwright run | 270 scheduled / 253 passed / 12 failed / 5 skipped | **282 scheduled / 264 passed / 13 failed / 5 skipped** | None |

The additional complex-document browser cases added after that full run are
listed as **288 tests** by Playwright and were independently run **6/6**.
No test was removed.

The 13 failures in the full run were disclosed rather than counted as passing:

- generated complete command-session replay, all three browsers;
- the existing toolbar-created final blockquote boundary case, Chromium;
- composition between atoms, all three browsers;
- the existing list Enter start/mid/end case, all three browsers;
- the existing broad toolbar route, all three browsers, at the later atom
  selection/resize step.

The recurring WebKit comparator/backspace-delete flake from the prior work
order did **not** reappear in this run. The list Enter failure is a separate,
already-known canonical-surface failure and is not being relabelled as fixed by
this batch. `pnpm run lint` (including all phase contract scripts and both
TypeScript package lints), both Vitest suites, the focused browser regressions,
and `git diff --check` pass.

## Disposition

- Group A was a genuine anchor/head normalization bug and is fixed at the input
  layer.
- Group B had no shared cause: B1 is not currently reproducible, B2 was a
  whole-document endpoint comparison bug, and B3 was a stale renderer
  projection. Each has focused evidence.
- Group C was a model-visible mark-partitioning/stored-mark bug; later content
  was not reordered or corrupted.

The canonical-authority flag remains an owner-controlled rollout decision.
Rollback-bridge deletion remains untouched.
