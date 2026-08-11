# Phase 8b list/table/blockquote defect note

## Scope and result

The five reports were investigated on the canonical-authority surface
(`?canonicalAuthority=1`) before making the fixes. Group A was one shared
boundary-position defect. Group B contained two command defects that looked
similar but did not share an implementation. The table-height hypothesis was
not a row-height arithmetic bug in the model; it was a merge-content/layout
problem, with a renderer guard for stale cell presentation.

No feature flag was promoted and no rollback bridge was deleted.

## Group A — quote boundaries (bugs 2 and 4)

### Reproduction

- A list inside a blockquote, followed by Enter twice on the empty depth-zero
  item, produced an apparently exited list position from which Backspace or
  Delete could become inert.
- With adjacent blockquotes, the canonical model had no guaranteed editable
  position before the first quote, between quotes, or after the final quote.

The focused regression matrix now passes for both deletion directions and for
document start, inter-quote, and document-end positions.

### Hypothesis

**Confirmed.** These were the same missing invariant: structural block edges
were not guaranteed to have a canonical editable owner, and keyboard movement
only inspected an immediate sibling. The Enter-Enter case additionally exposed
stale selection handling when an empty paragraph was removed or a forward
merge crossed a structural parent.

### Root cause and fix

1. `packages/core/src/foundation/boundaries.ts:12-40,75-120` adds a shared
   `foundation.editable-boundaries` normalizer. It inserts deterministic empty
   paragraphs before/after quote, table, atomic-block, and isolating-block
   boundaries when no editable block is present. This is a model invariant,
   not a DOM `<br>` workaround.
2. `packages/core/src/foundation/editor.ts:166-187,228-245` applies the same
   boundary invariant during construction and explicit replacement, maps the
   incoming selection through the inserted positions, and registers the
   normalizer for transactions.
3. `packages/core/src/foundation/surface/input.ts:826-878` resolves structural
   siblings through their nearest editable owner and walks logical editable
   owners across nested containers. It no longer tries to put the caret on a
   quote/table node itself.
4. `packages/core/src/foundation/surface/input.ts:651-745` handles the list-exit
   blank-line case by removing the empty owner and mapping the caret to the
   nearest content. Forward deletion now preserves the current owner ID and
   maps the selection through the replace/remove pair; backward deletion keeps
   the preceding owner. This also avoids retiring the block that owns the
   active caret.
5. `packages/core/src/foundation/schema.ts:382-388` repairs an empty imported
   blockquote with a real paragraph so the same invariant holds for malformed
   input.

### Regression tests

- `packages/core/src/foundation/phase2_5.test.ts:341-397` covers Enter-Enter
  inside a quoted list, Backspace, forward Delete, schema validity, and the
  resulting selection.
- `packages/core/src/foundation/phase2_5.test.ts:399-422` covers editable
  positions before, between, and after adjacent quotes, `posToDom`, and arrow
  traversal.
- `packages/react/e2e/canonical-authority.spec.ts:464-500` covers the product
  list-exit Backspace and select-all deletion paths; the focused Chromium
  checks passed.

## Group B — list marker replacement and quote wrapping (bugs 1 and 5)

### Hypothesis

**Not confirmed as a shared implementation defect.** Both symptoms were
“addition instead of replacement/promotion” at the visible level, but the
commands are independent:

- list type changes operate on list attributes;
- blockquote wrapping operates on structural ancestor scope.

Fixing one shared helper would have been the wrong abstraction.

### Bug 1 — competing list markers

The canonical list state retained `preset` while adding a concrete `style`.
The renderer consequently had two competing list-type signals (`ol`/`ul`
  selection plus a CSS marker style), which appeared as both markers.

The command-layer fix is in
`packages/core/src/foundation/list/commands.ts:275-285`: `setListPreset`
clears `style`, and `setListStyle` clears `preset` while preserving the
requested `checkable` state. This makes type changes a single state transition;
the renderer at `packages/core/src/foundation/surface/renderer.ts:90-108`
now receives one authoritative marker definition.

`packages/core/src/foundation/list/commands.test.ts:134-147` tests
numbered → bulleted → checklist → numbered transitions and asserts the
inactive marker attribute is absent at every step.

The retained engine uses one `style` field and replaces the containing list
(`packages/core/src/legacyCommands/list.ts:120-185`); its existing bridge test
(`packages/react/src/adapters/domCommandBridge.test.ts:17-43`) does not produce
competing markers. No retained duplicate-marker regression was found.

### Bug 5 — one quote around the whole list

The canonical `wrapBlocks` command previously treated selected paragraphs in a
list as independent block siblings. The fix promotes each selected block to
its nearest list ancestor, de-duplicates ancestors, and replaces that list
with one blockquote at `packages/core/src/foundation/block/commands.ts:35-62`
and `124-157`. `unwrapBlocks` performs the symmetric ancestor lookup and
restores complete children at `commands.ts:159-182`.

`packages/core/src/foundation/block/commands.test.ts:76-89` asserts one
blockquote containing one list, then byte-identical list structure and IDs
after unwrapping. The retained engine already passes the equivalent test in
`packages/react/src/test-harness/blockShadowComparator.test.ts:15-30`, so this
was a canonical-only migration regression; no retained fix was required.

## Independent bug 3 — merged cells multiply row height

### Reproduction and hypothesis

The reported 2×/3×/4× height effect was reproduced by the focused model/DOM
regression fixture with horizontal merges of one-line cells. **The suspected arithmetic bug was
not confirmed:** row height is stored once on `table_row`, and
`tableFromPlacements` preserves that row attribute at
`packages/core/src/foundation/table/commands.ts:88-104`; no merge code summed
cell heights.

The actual cause was content assembly. Each source cell contributed its own
placeholder/one-line paragraph to the merged anchor, producing N stacked line
boxes in one row. A stale cell-level `height` style/attribute could compound
the effect when a DOM cell was reused after a legacy operation.

### Fix locations

- `packages/core/src/foundation/table/commands.ts:26-65,225-249` now
  concatenates simple one-paragraph paragraph/heading content in reading order
  while preserving marks and all text. Empty placeholders do not become extra
  lines. Complex content (multiple blocks, lists, quotes, block atoms) retains
  block boundaries intentionally; its intrinsic height may legitimately grow
  with the content.
- `packages/core/src/foundation/surface/renderer.ts:155-177` treats row height
  as row-level canonical state and removes stale cell `height`, `min-height`,
  `max-height`, and `height` attributes during cell synchronization. This is a
  renderer hygiene guard, not a visible-height cap.

### Regression tests

- `packages/core/src/foundation/table/table.test.ts:150-164` merges 2, 3, and
  4 one-line cells, asserting row height remains 48, all text is conserved in
  one anchor paragraph, and geometry remains valid.
- `packages/core/src/foundation/phase2_5.test.ts:424-458` verifies stale cell
  height presentation is cleared while the row remains `48px`.
- `packages/react/e2e/canonical-toolbar-routing.spec.ts:159-180` verifies the
  product merge route leaves one editable paragraph rather than stacking empty
  source placeholders.

The retained DOM bridge still projects a row height onto anchor cells in
`packages/react/src/adapters/domTableCommandBridge.ts:87-105`; that is a
retained-path presentation behavior, not the canonical model fix. It was not
changed in this work order. The canonical report therefore does not claim that
the legacy path has been corrected.

## Verification and regression accounting

Focused Chromium product checks passed for retained/canonical replay, immediate
Enter caret placement, bottom scrolling, list-exit Backspace, and select-all
Backspace/Delete: **6 passed**.

| Suite | Before this work order | After | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 429 passed in the starting worktree | 51 files / **433 passed** | none; four focused regressions were added |
| React Vitest | 43 files / 240 passed | 43 files / **240 passed** | none |
| Playwright (published prior report) | 243 scheduled: 238 passed, 5 skipped | 252 discovered in the current worktree: **247 passed, 5 skipped, 0 failed** | none; the current +9 cases were already present before this work order |

The first full browser run after the initial deletion fix caught a real
forward-deletion identity regression (3 browser failures plus the replay route).
The fix was to preserve the active/current block on forward merges and map the
selection through the operations. The final full three-browser run passed all
247 non-skipped cases. The two historically recurring WebKit Phase 3 tests
(comparator replay and deepest-descendant Backspace/Delete) passed in this run;
the earlier isolated-vs-full-suite flake remains documented, but did not
reappear here. No test was removed.

Core and React suites, root contract lint, TypeScript lint, and `git diff
--check` are green. The canonical flag remains an owner-controlled rollout
decision, and rollback-bridge deletion remains untouched.

## Retained comparison summary

| Bug | Retained result | Canonical result after fix |
|---|---|---|
| 1 — list marker replacement | Single-style retained list; no duplicate marker in retained tests | Single authoritative `style` or `preset`; transition test passes |
| 2 — quoted-list exit deletion | No equivalent retained boundary regression was found in the retained harness | Backspace and Delete leave a valid reachable position |
| 4 — quote start/end/between positions | Retained DOM behavior was not changed; no canonical model invariant exists there | Shared boundary normalizer and owner traversal provide all three positions |
| 5 — quote around list | Retained wraps once (test passes) | Canonical now wraps once and unwraps symmetrically |
| 3 — merged row height | Retained bridge still applies row height to anchor cells; not modified | Canonical merge collapses simple inline content and clears stale cell height presentation |

The remaining residual risk is the retained table bridge’s cell-height styling
and the fact that complex merged content can legitimately increase intrinsic
row height. Neither is hidden behind a cap or labelled as solved by the
canonical one-line regression.
