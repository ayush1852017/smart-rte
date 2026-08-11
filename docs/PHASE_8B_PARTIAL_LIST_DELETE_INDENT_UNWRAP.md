# Phase 8b: partial list Delete and post-unwrap Indent

All canonical reproductions and browser checks in this note use
`?canonicalAuthority=1`. The authority flag was not promoted and no rollback
bridge was deleted.

## 1. Partial selection of list items and Delete

### Reproduction and root cause

The regression was confirmed for a range whose end was the first editable
position of the following list item. The deletion plan itself already had the
right distinction: a proper subset removes selected siblings, while an
all-children selection replaces the list with the required empty paragraph
(`packages/core/src/foundation/surface/input.ts:351-472`). The resolver supplied
the wrong item set to that plan.

`resolveScope` used interval overlap for list items. A list item's structural
interval includes its wrapper and first block, so a range ending at the first
text position of item 4 overlapped item 4 even though the selection had not
entered item 4. In the two-item case, selecting item 1 through the start of
item 2 therefore resolved both items; the existing `allChildren` branch then
correctly removed the whole list. This was a resolver boundary error, not a
renderer, normalizer, or command error.

The preceding tests were not equivalent to this repro. The five-item unit case
and the browser case selected proper subsets, but both ended inside the last
selected item's text. They could catch an unconditional whole-list replacement,
but not an endpoint-at-content-start over-selection. The new two-item case
makes that distinction explicit.

### Fix

For a range whose endpoints are in the same list, `touchedListItems` now
excludes the endpoint item when the endpoint is its first editable content
position (`packages/core/src/foundation/scope/resolveScope.ts:605-629`). The
endpoint check walks through the item and its first block to the first editable
entry (`resolveScope.ts:641-655`), so it is not tied to a particular paragraph
shape. This follows the semantic selection contract: a block endpoint at
offset zero is excluded, while an endpoint at that block's end is included.

The deletion plan was intentionally left unchanged. It still preserves the
containing list for a subset and uses the whole-list replacement only when all
direct children are selected. Backspace uses the same structural deletion
route; its partial-selection path is covered as well.

### Regression coverage

`packages/core/src/foundation/phase2_5.test.ts:737-796` now tests, in one
fixture family:

- Five-item list, forward subset (items 2–3), preserving items 1, 4, and 5's
  IDs.
- Five-item list ending exactly at item 4's first content position, preserving
  items 1, 4, and 5.
- The same five-item subset through Backspace, preserving the same IDs.
- Two-item list selecting only item 1, leaving a valid one-item list with item
  2's original ID.
- Whole-list selection, still replaced by one valid empty paragraph.

The resolver-specific endpoint assertion is at
`packages/core/src/foundation/scope/scope.test.ts:216-224`. The native browser
path selects item 2 through the first position of item 4 in a five-item ordered
list and presses Delete; it asserts the surviving IDs and text at
`packages/react/e2e/canonical-authority.spec.ts:1121-1156`. The existing
multi-block/whole-list browser cases remain green.

### Retained comparison

The retained list/transaction suites pass, and no retained implementation
provided an equivalent semantic list-item range replay for this exact endpoint
case. Accordingly this is recorded as a canonical resolver regression exposed
by the new native-selection test, not as evidence that every legacy browser
path has identical endpoint semantics. No retained code was changed.

## 2. Indent after outdent unwrap

### Reproduction and semantic diagnosis

The observed state was checked on the canonical surface. After repeated
outdent, the nested item becomes a plain paragraph when depth-zero outdent
unwraps its list. `list.indent` is deliberately list-only in the frozen Phase 3
contract: it requires a `list-selection` and a preceding same-level list-item
sibling (`docs/PHASE_3_COMPLETION_REPORT.md:99`,
`packages/core/src/foundation/list/commands.ts:209-235`). It does not promote a
plain paragraph into a list. Plain-block promotion is the separate
`createList` operation (`packages/core/src/foundation/list/commands.ts:105-150`).

Therefore this is not a command-legality bug and not a stale coupled toolbar
state bug. The list Indent button being unavailable after the unwrap is the
correct state under the current contract. The reachable operation is Bullets,
Numbering, or another list-creation/preset control; those controls remain
available for a plain block. Items 1 and 2 are independent: the Delete fix is a
scope endpoint correction, while post-unwrap Indent is the intended distinction
between list-only indentation and list creation.

### Regression coverage

The browser regression at
`packages/react/e2e/canonical-authority.spec.ts:1158-1193` constructs a nested
item, outdents it to the plain-block state, asserts that `Indent list item` is
disabled and `Bulleted list` is enabled, then invokes Bullets and verifies the
unwrapped content is placed in a new list item. This records the supported
workflow rather than silently making `list.indent` acquire new semantics.

The toolbar's independent state derivation remains at
`packages/react/src/components/CanonicalAuthorityEditor.tsx:173-186,558-559`:
`canIndent` is computed only from selected list-item indexes, while list
creation dispatches `createList` for block scope. No production command or
toolbar implementation change was needed for this item.

### Retained comparison

Retained list and toolbar suites pass, with no corresponding retained defect
observed. The retained path was not changed. If product policy later requires
Indent itself to promote plain paragraphs, that is a new command-contract
decision and should be specified separately rather than inferred from this
report.

## Regression accounting

| Suite | Before this work | After this work | Removed tests |
|---|---:|---:|---|
| Core Vitest | 51 files / 450 passed | **51 files / 452 passed** | None; one endpoint/deletion case family and one resolver case added (two test cases) |
| React Vitest | 43 files / 240 passed | **43 files / 240 passed** | None |
| Playwright, three browsers | 312 scheduled / 301 passed / 6 failed / 5 skipped | **318 scheduled / 307 passed / 6 failed / 5 skipped** | None; two browser tests added (six browser instances) |

All focused cases for the new endpoint, native subset selection, whole-list
deletion, and post-unwrap list creation passed in Chromium, Firefox, and
WebKit. The six failures in the full browser run are unchanged known failures:
`canonical-authority.spec.ts:463` (generated session, all three browsers) and
`canonical-toolbar-routing.spec.ts:77` (broad toolbar route, all three
browsers), each timing out on the intentionally disabled “Grow selected atom”
button. No new Delete or list-state failure appeared. No test was removed.

`pnpm run lint` passes, including the phase contract scripts and both package
TypeScript checks. `git diff --check` also passes.

No flag promotion or rollback-bridge deletion was performed.
