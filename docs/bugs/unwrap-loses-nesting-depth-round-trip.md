# Unwrapping a nested list item lost all depth information; re-listing always produced a flat list

**Status:** Fixed
**Area:** list / commands
**First reported:** 2026-08-10/11 (this session)

## Symptom

Removing list formatting from an item (via the toggle-off toolbar button, double-Enter exit, or Backspace-outdent-to-unwrap) dropped all record of how deeply nested that item had been. Re-applying a list type to that content afterward always produced a single flat list, regardless of the original nesting.

## Reproduction

Confirmed by direct code reading first (no existing mechanism anywhere stamped depth on unwrap, and `createList` only ever grouped by exact parent path, building one flat list per contiguous run) — then confirmed live via a 3-level nested-list unwrap-then-relist sequence, both via direct unit construction and via the toolbar's toggle-off button in the browser.

A dedicated research pass confirmed **no existing "flat sequence with depth hints → nested tree" builder exists anywhere in this codebase** — checked DOCX import (mammoth handles this internally, not exposed), Markdown import (gets pre-nested structure from remark, never needs this), and the legacy list engine (only single-step indent/outdent, no whole-outline reconstruction). This was new code, not a reuse of existing logic.

## Root cause

`unwrapOne`/`unwrapList` (`packages/core/src/foundation/list/commands.ts`) cloned unwrapped content as-is with no depth stamping. `createList` grouped selected blocks by exact parent path and always built one flat list per contiguous run, with no concept of variable depth within a selection.

## Fix

New `listAncestorDepth` helper computes how many list ancestors sit above a given list. `withDepthStamp` stamps the existing `indentLevel` attribute (already used elsewhere for paragraph indentation, already rendered/serialized in HTML/Markdown/DOCX — deliberately reused rather than inventing a parallel attribute) onto content when it's unwrapped out of a nested list. `createList` was rewritten with a recursive `buildListItems` that reconstructs nesting from those stamps via a stack-based algorithm, clamping any depth jump to at most +1 past the previous item — mirroring `indentList`'s own "only nest under the immediately preceding sibling" rule, so reconstructed output is always structurally valid without special-case validation. All in `packages/core/src/foundation/list/commands.ts`.

**A real bug in this fix's own first implementation, caught by its own test, not by inspection:** item IDs were initially consumed out of document order — the deepest/nested item could grab an ID meant for an earlier sibling, because the recursive nested-list build was embedded in an object-literal `children:` expression that evaluated before the outer item's own ID was claimed. Fixed by hoisting the ID claim to the top of each loop iteration.

ID pools at the three real `createList` call sites (including the legacy DOM-authoritative bridge, which is reachable by default since `canonicalAuthorityFlag` defaults off) were widened to accommodate the new worst-case node count, or this fix would throw once nested content reached those call sites.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: `"preserves nesting depth across an unwrap-then-relist round trip"` (3-level round trip, node identity preserved), `"clamps a depth jump greater than one when rebuilding a list"`. `packages/react/e2e/canonical-authority.spec.ts`: `"reconstructs nesting after unwrapping a nested item and re-listing it"`, 3/3 browsers.

## Related/similar issues

- [list-split-numbering-restarts-instead-of-continuing](list-split-numbering-restarts-instead-of-continuing.md) — a second real bug found in this same `unwrapOne` function while investigating a related report, fixed in the same area.
- [unwraplist-deepest-first-gap-multi-depth-toggle-off](unwraplist-deepest-first-gap-multi-depth-toggle-off.md) — a related, still-**open** gap in the same command family.
