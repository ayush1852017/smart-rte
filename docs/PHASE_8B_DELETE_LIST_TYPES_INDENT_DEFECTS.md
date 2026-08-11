# Phase 8b multi-block Delete, list-type, and indent/outdent note

All canonical reproductions and browser checks in this note use
`?canonicalAuthority=1`. The authority flag was not promoted and no rollback
bridge was deleted.

## 1. Multi-block Delete

### Reproduction and root cause

The reported structural Delete gap was confirmed in the canonical input path.
The old path was designed for one inline owner: a selection spanning list-item
paths reached `queueRangeDeletion`, whose cross-parent branch threw
`Cross-parent text deletion is outside the canonical test surface contract`
(`packages/core/src/foundation/surface/input.ts:300-312` in the pre-fix path).
For a blockquote/code node selection, the browser's projected native range was
also re-imported as text before deletion, so the semantic node selection was
lost and no structural target was produced. The visible result was a silent
no-op (and, for cross-parent text, an input-path exception) rather than removal
of the selected blocks.

This was an input/scope-dispatch defect, not a renderer or list-command defect.

### Fix

`structuralDeletionPlan` now resolves structural selections to node IDs and
plans descending sibling removals or a containing-structure replacement. It
handles `list-selection`, `block-range`, `container-tree`, `mixed`, and node
selections without assuming a shared inline parent
(`packages/core/src/foundation/surface/input.ts:351-472`). `deleteRange` chooses
this plan for non-text selections and selections crossing structural parents,
then maps the caret through a preview of the operations
(`packages/core/src/foundation/surface/input.ts:745-772`).

Node selections are preserved while handling Delete/Backspace and replacement;
the renderer's native contents are not converted into a text selection before
the semantic node operation runs (`packages/core/src/foundation/surface/input.ts:1015-1028`).
Ordinary same-owner character deletion still uses the existing inline path.

### Regression coverage

The following focused tests are new:

- Multi-item list range: `packages/core/src/foundation/phase2_5.test.ts:657-678`.
- Node-selected blockquote and code block: `phase2_5.test.ts:680-713`.
- Mixed list/plain-block selection: `phase2_5.test.ts:715-735`.
- Product route covering the same list and block selections:
  `packages/react/e2e/canonical-authority.spec.ts:1079-1149`.

The focused product test passed in Chromium, Firefox, and WebKit (3/3). The
existing select-all Delete cases also pass, so this does not replace the
whole-document clear path.

The retained editor's existing list/transaction suites pass and no matching
retained structural-node Delete scenario failed. The retained path does not
provide an equivalent canonical node-selection replay for quote/code, so this
is recorded as “no retained counterpart observed,” not as a claim that every
legacy browser path is equivalent.

## 2. List types beyond bullet/numbered

### Fresh diagnosis

No current regression was reproduced. The previous nested-selection resolver
coverage still passes (`packages/core/src/foundation/scope/scope.test.ts:181-211`),
and the pure command transition/preset checks still pass
(`packages/core/src/foundation/list/commands.test.ts:134-166`). The toolbar
regressions were rerun against a fresh build and fresh Playwright Vite server:

- Top-level preset route: `packages/react/e2e/canonical-authority.spec.ts:948-968`
  — six exposed legacy aliases, all 3 browsers.
- Nested preset route: `canonical-authority.spec.ts:970-1015` — all twelve
  configured `SMART_LIST_PRESETS`, including ordered paren/outline/leading-zero
  and the non-default bullet presets, all 3 browsers.

The select is populated directly from `SMART_LIST_PRESETS`
(`packages/react/src/components/CanonicalAuthorityEditor.tsx:545-556`), and
the command call is `setListPreset` at `:548`. There is no current evidence of
a command-layer failure, missing nested-list option, or stale toolbar state.
The fresh package build and the new browser server rule out the most likely
stale-dev-tab explanation for this run.

The remaining gap is repro specificity: the top-level test intentionally
exercises the six historically exposed aliases while the nested test exercises
all twelve. If the issue persists, the failing preset ID, exact control
(Bullets/Numbering/Checklist versus List preset), selection shape (collapsed
caret or range), and nesting depth are required. Without that information,
claiming a new fix would be guesswork.

The retained list tests and retained toolbar routes pass; no retained list-type
regression was observed. No code change was needed for this item.

## 3. Indent/outdent disabled at maximum depth

### Reproduction and shared-cause check

The reported disabled-both-buttons state was not reproducible on the current
canonical build. Direct command execution remains legal after indenting an item
into a nested list: `packages/core/src/foundation/list/commands.test.ts:203-218`
asserts that `outdentList` returns operations and restores the original sibling
layout.

The toolbar derives the two capabilities independently. `canIndent` only checks
whether the selected direct child has a preceding sibling
(`packages/react/src/components/CanonicalAuthorityEditor.tsx:173-186`), while
the Outdent button is disabled only when the resolved scope is not a
`list-selection` (`CanonicalAuthorityEditor.tsx:558-559`). Thus reaching the
maximum legal indent disables Indent without coupling that state to Outdent.

The browser regressions cover both a single item and a contiguous multi-item
selection:

- `packages/react/e2e/canonical-authority.spec.ts:1017-1051` — maximum-depth
  Indent disabled, Outdent enabled; repeated outdent returns to the outer
  structure.
- `canonical-authority.spec.ts:1053-1077` — same assertion for a multi-item
  selection.

All six browser instances pass. The single-item test deliberately clicks
Outdent twice because Phase 3 defines depth-zero Outdent as an unwrap, so it is
still legal once at depth zero; the final disabled state is asserted only after
that unwrap.

Items 2 and 3 do **not** share a cause. List-type selection uses the
`setListPreset` command and preset select; indent/outdent state uses the current
list-scope indexes and independent legality. Both command and toolbar evidence
are green, so no speculative UI patch was made. If both still appear disabled
in a manual session, capture the exact selection and the resolved scope kind;
that would be a different stale-selection/environment report.

The retained list suite shows no corresponding failure. No retained code was
changed.

## Regression accounting

| Suite | Before this work | After this work | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 446 passed | **51 files / 450 passed** | None; four focused tests added |
| React Vitest | 43 files / 240 passed | **43 files / 240 passed** | None |
| Playwright, three browsers | 303 scheduled / 292 passed / 6 failed / 5 skipped | **312 scheduled / 301 passed / 6 failed / 5 skipped** | None; nine scheduled cases added (three tests × three browsers) |

All nine new browser cases passed. The six failures in the full run are the
same pre-existing atom-picker failures: `canonical-authority.spec.ts:463`
(generated session, three browsers) and `canonical-toolbar-routing.spec.ts:77`
(broad toolbar route, three browsers), each timing out on the disabled “Grow
selected atom” button. No new Delete, list-preset, or indent/outdent failure
was introduced.

`pnpm run lint` now passes, including all phase contract scripts and both
package TypeScript checks. As a small boundary cleanup while validating the
preset route, `SMART_LIST_PRESETS` is imported from the package root in
`packages/react/src/components/CanonicalAuthorityEditor.tsx:55` and is no
longer re-exported across the foundation boundary. Core build, both Vitest
suites, focused browser checks, and `git diff --check` also pass.

No flag promotion or rollback-bridge deletion was performed.
