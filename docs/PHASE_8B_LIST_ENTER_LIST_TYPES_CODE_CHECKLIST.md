# Phase 8b list Enter, list-type, code-in-quote, and checklist note

Surface tested: `?canonicalAuthority=1`. No flag promotion or rollback-bridge
deletion was performed.

## 1. List Enter-to-exit

### Reproduction and cause

The failure reproduced in the core input path for an empty item in the middle
of a depth-zero list. The first Enter created the empty item; the second Enter
entered `list.unwrap`. `unwrapOne` correctly requires a new ID when the
unwrapped run is between list items, but `enterInList` passed `{}`. The handler
therefore threw at `packages/core/src/foundation/list/commands.ts:152-175`
(`list.unwrap middle split requires a caller-provided splitListId`) instead of
committing an exit transaction. In the browser this looked like repeated empty
items or an ignored Enter.

This was an operation-input/detection bug, not a missing editable-boundary
position. The empty-item and depth checks were reached; the command payload was
incomplete. `foundation.editable-boundaries` deliberately treats blockquote,
table, atomic, and isolating blocks as outside-edge boundaries at
`packages/core/src/foundation/boundaries.ts:18-25`; a list is a non-isolating
container whose exit operation creates the paragraph, so adding a list-specific
boundary rule would have been the wrong fix.

### Fix

`ListEnterIds.splitListId` is now required at
`packages/core/src/foundation/list/input.ts:20-29`. The empty-item branch at
`packages/core/src/foundation/list/input.ts:174-190` supplies it only when the
item is an interior item; trailing and single-item exits keep the existing
list, paragraph result. The canonical surface and React list bridge now supply
the deterministic caller-owned ID (`packages/core/src/foundation/surface/input.ts:658-663`;
`packages/react/src/adapters/canonicalListCommandBridge.ts:450-455`). Nested
empty items still outdent before a depth-zero list can be exited.

### Regression coverage

- Five-item list, Enter on item 3, then Enter on the new empty item: the model
  becomes `list, paragraph, list`, preserving all item IDs —
  `packages/core/src/foundation/phase2_5.test.ts:471-505`.
- Five-item trailing exit: `packages/core/src/foundation/phase2_5.test.ts:507-536`.
- Single-item exit plus Backspace/Delete around the resulting paragraph:
  `packages/core/src/foundation/phase2_5.test.ts:383-469`.
- Depth-two empty item outdents first:
  `packages/core/src/foundation/list/input.test.ts:76-86`.
- Existing product list-exit browser check passed in Chromium, Firefox, and
  WebKit (`canonical-authority.spec.ts:1275`, 3/3).

The retained editor does not call `unwrapList`—it uses its native DOM list
path—so it cannot produce this specific exception. Its existing list tests
remain green; no claim is made that the native browser Enter behavior is a
dual-engine semantic comparison for this newly added canonical case.

**Shared-boundary hypothesis: not confirmed.** The fix is at the list input /
command boundary, not in the boundary normalizer.

## 2. List-type reconciliation and nested presets

### Diagnosis

The pure commands were not regressed. Existing direct-command coverage for the
canonical preset transitions remains green (`packages/core/src/foundation/list/commands.test.ts:134-166`),
including replacement of the old marker rather than adding a second marker.
The canonical toolbar did expose a control, but it exposed only six choices and
the ranged nested selection was resolving to the outer list. The scope index's
ancestor intervals include descendant content by design, so the old
`touchedListItems` traversal promoted a selection inside the child list to its
parent.

This is therefore case **(c): a nested-selection scope gap plus a toolbar
exposure gap**, not a command regression. The retained editor already recurses
through descendant lists in `applyListPresetHierarchy`
(`packages/react/src/components/ClassicEditor.tsx:1189-1205`) and its hierarchy
test passes (`packages/react/src/components/ClassicEditor.list.test.tsx:406-436`).

### Fix

For a ranged selection whose endpoints belong to the same nearest list,
`touchedListItems` now filters to that list at
`packages/core/src/foundation/scope/resolveScope.ts:605-627`. Cross-level
selections retain the broader promotion behavior.

The canonical toolbar now consumes the shared `SMART_LIST_PRESETS` registry,
exported from the foundation surface at
`packages/core/src/foundation/index.ts:24-26`, and renders all 12 configured
presets plus the historical `bullet-circle` alias at
`packages/react/src/components/CanonicalAuthorityEditor.tsx:545-556`. No
preset-specific command bodies were added.

### Regression coverage

- Direct nested ranged scope resolves to `listId: "inner"`:
  `packages/core/src/foundation/scope/scope.test.ts:190-195`.
- Nested toolbar routing exercises all 12 presets in all three browsers:
  `packages/react/e2e/canonical-authority.spec.ts:970-1012`, 3/3 passed.
- Existing top-level preset routing and retained/canonical replay both passed
  in all three browsers (6/6).

**Shared-cause result:** the “only bullets/numbers” report had two layers. The
command layer was sound; nested ranged resolution was wrong, and the canonical
toolbar was under-exposing the registry. Both are now corrected. The retained
engine did not show this nested-selection failure in its hierarchy tests.

## 3. Code block inside blockquote

### Reproduction and cause

The nested case was reproduced against the canonical surface after the current
input/renderer state was loaded. It inserts a newline inside the code block;
the quote remains a single wrapper and no list/quote exit occurs. A standalone
code block uses the same path. `insertParagraph` checks list input first and
then calls `insertCodeBlockNewline` at
`packages/core/src/foundation/surface/input.ts:658-669`; the code command
identifies the owner by its exact path at
`packages/core/src/foundation/block/input.ts:12-38`. A blockquote ancestor does
not change that lookup or intercept the event.

**Shared-boundary hypothesis: not confirmed.** No handler-precedence or scope
failure was present in the current canonical path, so no speculative boundary
patch was made.

### Regression coverage and retained comparison

The core regression is `packages/core/src/foundation/phase2_5.test.ts:538-560`.
The product regression is `packages/react/e2e/canonical-authority.spec.ts:1055-1089`.
The latter passed in Chromium, Firefox, and WebKit (3/3). The retained editor
uses native `<pre>` editing; its retained block harness and code/list tests are
green, but it has no equivalent quote-plus-code Enter test, so retained parity
is not claimed beyond the absence of a reproduced defect.

## 4. Checklist checkbox overlap

### Reproduction and cause

The overlap reproduced for both top-level and nested checklist items. The
canonical projected control was put in grid column 1, but the playground's
global `button` rule (`packages/react/playground/src/index.css:45`) supplied
`padding: 0.6em 1.2em`, a border, and a large intrinsic width. The control then
extended into column 2. This was a renderer
CSS contract issue, not a model or ARIA issue.

### Fix

The checklist selector at `packages/react/src/theme.ts:276-329` now resets
button defaults (`padding`, border, radius, background, font, appearance,
width, and box sizing) while retaining the existing grid placement and
`data-smart-ui` projection. DOM placement and the checkbox role/state were not
changed. The retained path already applied an inline reset at
`packages/react/src/components/ClassicEditor.tsx:1093-1115`, which is why this
was canonical-only.

### Regression coverage

`packages/react/e2e/canonical-authority.spec.ts:1091-1129` measures the control
and content rectangles for top-level and nested checklist items and asserts a
non-negative gap plus grid columns 1/2. It passed in all three browsers (3/3).

## Regression accounting

No tests were removed.

| Suite | Before this batch | After this batch |
|---|---:|---:|
| Core Vitest | 51 files / 442 tests | **51 files / 446 tests** |
| React Vitest | 43 files / 240 tests | **43 files / 240 tests** |
| Full Playwright | 282 scheduled / 264 passed / 13 failed / 5 skipped | **303 scheduled / 292 passed / 6 failed / 5 skipped** |

The six remaining browser failures are the pre-existing disabled `Grow selected
atom` step in `canonical-toolbar-routing.spec.ts:77`, and the same route inside
the generated authority session at `canonical-authority.spec.ts:463`, in each
of Chromium, Firefox, and WebKit. They time out waiting for a disabled button;
they are unrelated to these four fixes. The recurring WebKit Phase 3
list-Enter/backspace contention failure did not recur in this run. The focused
regressions above were all green across the three browsers.

`git diff --check`, core build/lint, React lint, the full core suite, and the
full React unit suite pass. No flag promotion or rollback-bridge deletion was
performed.
