Flag confirmed: both repro tests run against the canonical-authority path with `?canonicalAuthority=1`; the retained/legacy surface was not used.

# Phase 8b Bug 4 Re-open: Editable Boundaries Around Final Blockquotes

## Reproduction result

The reported gap was real for direct placement below a trailing quote. A native selection collapsed at the editable root (`DIV`, offset equal to the root child count), while the model selection remained `{ path: [], offset: 3 }`. The document already contained the boundary paragraph, but the input path treated the root structural position as a text caret, so the visible caret was not projected into that paragraph.

The select-all → Down path was also added and exercised exactly. It did not reproduce as a failure in the current Chromium, Firefox, or WebKit harness: each browser collapsed into the trailing paragraph. It is retained as a regression test because it exercises the separate native-collapse route and protects against a browser-specific recurrence. This is not a flag mismatch.

The toolbar-created path (list → blockquote at the document end) is covered as well. It produces one trailing paragraph through the boundary normalizer and remains navigable after select-all → Down.

## Root cause

`foundation.editable-boundaries` was doing its model job: `packages/core/src/foundation/boundaries.ts:12-17, 103-128` inserts deterministic empty paragraphs around boundary blocks, including a literal final blockquote. The existing adjacent-quote test therefore proved that paragraphs existed, but it did not prove that a native root-boundary selection was converted into one of those paragraph positions.

The missing layer was the input selection bridge, not schema repair or the renderer. `packages/core/src/foundation/surface/input.ts:1117-1155` accepted `renderer.mapping.domToPos(...)` verbatim. For a root boundary, `domToPos` correctly returns a structural document position; `syncSelectionFromDom` then stored that structural position as a text selection. No inline owner existed for `ownerAt()` or for a visible caret. The existing owner traversal in `moveCaret` is only used for owned keyboard movement and was not applied to arbitrary native selection changes.

## Fix

`packages/core/src/foundation/surface/input.ts:143-182` adds `editablePositionForStructuralBoundary`. It resolves a structural DOM point to the nearest direct editable sibling first (so a boundary paragraph wins over text nested in the preceding quote), then falls back to nested owner traversal. Bias is direction-aware: collapsed root-start points prefer the following owner, root-end points prefer the preceding owner; non-collapsed anchor/head endpoints use forward/backward bias.

`packages/core/src/foundation/surface/input.ts:1124-1159` now normalizes both native endpoints before scope resolution and immediately re-projects the model selection through `renderer.render`. That second step is required: updating only the model would leave the browser caret on the root `DIV` and the next input would still appear inert.

No boundary normalizer, command, or renderer workaround was added for this defect. The normalizer guarantees the target paragraph; the input bridge now maps native structural positions to it.

## Regression coverage

Two distinct browser tests were added in `packages/react/e2e/canonical-authority.spec.ts`:

- `reaches the editable position after a literal final blockquote`: installs a document whose input has a blockquote as its literal final node, places the native range at the root end, dispatches `selectionchange`, and asserts the model/native caret is in the inserted trailing paragraph.
- `select-all then Down collapses to the editable position after a final blockquote`: performs Ctrl/Cmd+A followed by Down and asserts the collapsed selection is the trailing paragraph.

An additional product-path regression, `keeps a toolbar-created final blockquote boundary editable`, creates the list-to-blockquote case through the canonical toolbar before exercising select-all → Down. The original Group A unit coverage remains unchanged in `packages/core/src/foundation/phase2_5.test.ts:341-422`; it still covers list exit/backward and forward deletion plus adjacent quote boundaries. The new tests are intentionally not substitutions for those cases.

## Verification

- Core focused Group A/unit file: `phase2_5.test.ts` — 21/21 tests passed.
- Core full suite: 51 files, 433/433 tests passed before and after; no tests removed.
- React full unit suite: 43 files, 240/240 tests passed before and after; no tests removed.
- Canonical Group A browser regressions: 18/18 passed across Chromium, Firefox, and WebKit (the two exact paths, toolbar-created path, list-exit deletion, and select-all Backspace/Delete).
- The three-browser run of the complete product suite was started at 258 scheduled tests (the two exact tests added before that run increased the prior 252-test schedule); it was stopped while still running at 243/258. No failure was reported before it was stopped, so this is not counted as a full-suite pass. The later toolbar-created test was verified separately in the 18-test Group A run above.
- Package and root TypeScript/contract lint passed, including `foundation.editable-boundaries` and the canonical-authority contract checks.

No test was removed, no feature flag was promoted, and no rollback bridge was deleted. The remaining full-suite runtime/flake investigation is unchanged from the prior report; it is not being silently counted as a pass here.
