# Phase 8b mixed scope, block-type dropdown, checklist, and list-preset note

All product checks in this note use `?canonicalAuthority=1`. The authority flag
was not promoted and no rollback bridge was deleted.

## 1. Mixed list scope after partial outdent

### Reproduction and diagnosis

The screenshot sequence was reproduced with a selection spanning nested list
items and a sibling item. After two Outdent operations, one selected item was
unwrapped to a paragraph while the other selected items remained in a nested
list. The resolved scope was genuinely `mixed`, containing a
`list-selection` part and a `block-range` part; this was not a disabled
single-list selection.

The first exact repro also exposed a second command-layer defect: the
depth-zero `unwrapOne` path dropped nested-list descendants while unwrapping a
list item. That loss made the resulting scope look like a plain block range
and masked the mixed-scope toolbar problem. `unwrapOne` now clones all item
children, including nested lists, at
`packages/core/src/foundation/list/commands.ts:152-175`.

After descendants were preserved, the remaining disabled-toolbar cause was in
the React state derivation. `CanonicalAuthorityEditor` only recognized
`scope.kind === "list-selection"`; a mixed scope therefore made both controls
fall through to disabled even though the list component was still actionable.
The list command layer already recursively consumes list parts of a mixed
scope (`packages/core/src/foundation/list/commands.ts:53-59`), so this was a
toolbar/resolved-scope interpretation gap, not a new command implementation.

### Decision and fix

The Phase 3 mixed-scope policy is used: list commands operate on eligible list
parts and ignore plain-block parts. Indent is enabled when at least one
selected list part has a preceding same-level sibling; Outdent is enabled when
there is any list part, because depth-zero outdent-to-unwrap remains legal.
This avoids disabling a valid list action merely because the same selection
also contains a plain block. If no selected list part has a legal predecessor,
Indent remains disabled while Outdent can still be enabled.

`listSelectionParts` and the per-list state/legality calculations are at
`packages/react/src/components/CanonicalAuthorityEditor.tsx:78-87,183-204`.
The button wiring is at `CanonicalAuthorityEditor.tsx:594-595`.

### Regression coverage

`packages/react/e2e/canonical-authority.spec.ts:1173-1239` reproduces the
multi-depth screenshot shape, asserts the post-operation scope contains both
`list-selection` and `block-range`, asserts the root contains both list and
paragraph nodes, verifies both controls are enabled, and performs another
Indent to prove the state remains actionable. It passes in Chromium, Firefox,
and WebKit (9/9 focused browser cases).

The retained editor has no equivalent canonical `MixedScope` resolution path;
its existing list/toolbar suites remain green and no retained code was
changed. This is recorded as a canonical toolbar/scope regression, not as a
claim that native editing has identical mixed-selection semantics.

## 2. Block-type dropdown synchronization

### Cause and fix

The dropdown used `defaultValue="paragraph"`. React applies that only during
initial mounting, so later model selection changes could move the caret to a
heading or code block while the displayed value stayed stale. The block type
was not a command or renderer defect.

`blockTypeAt` now derives the current block type by walking the model path,
and the select is controlled with `value={currentBlockType}` at
`packages/react/src/components/CanonicalAuthorityEditor.tsx:205-222,538-550`.

### Regression coverage and retained comparison

`canonical-authority.spec.ts:1241-1264` moves the caret paragraph → heading 2
→ code block → paragraph and asserts the select value after each move. The
test passes in all three browsers (3/3). No equivalent canonical dropdown
state exists in the retained path; retained editing code and suites were not
changed.

## 3. Checklist toggle and border/ring artifact

### Causes

The two symptoms share the projected-control lifecycle but had two concrete
missing pieces, not one CSS-only cause:

* **Toggle no-op:** the canonical surface's click listener handled atom
  controls only. There was no `check-control` route to resolve the containing
  list item and call `setListChecked`. The new route is in
  `packages/core/src/foundation/surface/input.ts:550-580`; it preserves the
  current model selection while committing the checked-state transaction.
* **Visual artifact/state:** the renderer set `aria-checked` but did not set
  the `data-checked` attribute consumed by the checklist pseudo-element rules.
  It now projects `data-checked` and a state-specific accessible label at
  `packages/core/src/foundation/surface/renderer.ts:112-130`. The theme resets
  the native button border/outline and supplies only an intentional
  focus-visible ring at `packages/react/src/theme.ts:290-303`. The checkbox
  square's pseudo-element border remains intentional; the unwanted outer
  button border/ring is gone.

### Regression coverage and retained comparison

`canonical-authority.spec.ts:1266-1295` checks initial `aria-checked`, computed
button border/outline, the intentional pseudo border, click-to-checked with
the updated label, and click-to-unchecked. It passes in Chromium, Firefox, and
WebKit (3/3). The retained editor has its own projected checkbox event/reset
path (`packages/react/src/components/ClassicEditor.tsx:1084-1121`) and its
retained checklist tests remain green; no retained behavior was changed.

## 4. List-preset discoverability assessment

This item was assessed as a UX question; no new preset-command matrix was
written. Prior direct-command and toolbar coverage already exercises the
configured presets in three browsers.

The functional barrier is not the command layer. The canonical toolbar's
control was an unlabeled-looking placeholder select and did not reflect the
active `attrs.preset` while the caret moved. It now remains addressable as
`aria-label="List preset"`, has the clarifying `title="List type / preset"`,
and is controlled by the current single-list preset at
`CanonicalAuthorityEditor.tsx:581-589`. A selected preset therefore remains
visible after application and while moving within that list. Mixed or
multi-list selections intentionally show the placeholder and disable the
single-list preset chooser rather than pretending one value is active.

The remaining discoverability limitation is deliberate but worth noting:
plain Bullets, Numbering, and Checklist are separate buttons, while the
preset select is the control for named multi-level schemes. A raw style list
without a named preset has no unique preset value to display, so it correctly
falls back to the placeholder. The title and controlled value materially
clarify the control, but a future product pass could add a visible “Preset”
toolbar label or an active-style summary for those raw-style lists.

## Regression accounting

No tests were removed.

| Suite | Before this work | After this work | Notes |
|---|---:|---:|---|
| Core Vitest | 51 files / 452 tests | **51 files / 453 tests** | One nested-descendant unwrap regression added |
| React Vitest | 43 files / 240 tests | **43 files / 240 tests** | No tests removed |
| Focused browser regressions | — | **9/9 passed** | Three tests × Chromium/Firefox/WebKit |
| Full Playwright | 324 scheduled / 313 passed / 6 failed / 5 skipped | **333 scheduled / 321 passed / 7 failed / 5 skipped** | Nine tests added; no removals |

The final full browser run's seven failures are existing/known paths outside
this batch: the generated authority session at
`packages/react/e2e/canonical-authority.spec.ts:463` (three browsers), the
atom-resize step in `canonical-toolbar-routing.spec.ts:77` (three browsers),
and the Chromium-only toolbar-created final blockquote boundary check at
`canonical-authority.spec.ts:560`. The new mixed-scope, dropdown, and
checklist cases are green in every browser. `pnpm run lint`, both package
TypeScript checks, the full core suite, the full React suite, and
`git diff --check` pass. No test was removed.

The canonical flag remains owner-controlled; promotion and rollback-bridge
deletion are intentionally still out of scope.
