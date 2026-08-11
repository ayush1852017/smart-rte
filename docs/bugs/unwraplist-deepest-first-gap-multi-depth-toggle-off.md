# `unwrapList` only unwraps items that are direct children of the resolved list — a multi-depth selection silently leaves deeper items nested

**Status:** Open — found and deliberately deferred, not resolved
**Area:** list / commands
**First reported:** 2026-08-11 (this session, found while investigating a user report but not confirmed as the cause of that specific report)

## Symptom

When a selection spans multiple nesting depths at once (e.g. a fully-selected multi-level nested list), the scope resolver correctly produces one unified `list-selection` scope covering every touched item across all depths — but `unwrapList` (`packages/core/src/foundation/list/commands.ts`) silently ignores any of those touched items that aren't *direct* children of the single list it resolves to (via `directItemIndexes`). Practically: select a multi-level nested list fully and click the already-active toggle-off button, and only the top-level items get unwrapped; deeper items stay nested.

## Reproduction

Confirmed by direct code reading (`directItemIndexes` filters `scope.items` down to direct children of the target list node only, silently dropping items belonging to nested lists further down). **Not independently confirmed as the cause of any specific user-reported symptom** — a related "1. duplication" report from the same session was investigated with three separate reproduction attempts and none reproduced, so this gap's real-world impact is unconfirmed, even though the code-level gap itself is real and precisely diagnosed.

## Root cause

`unwrapList` groups the scope by `listScopes(scope)`, resolving to the single list each entry names, and only unwraps items that are direct children of that specific list node — it has no logic to recurse into and separately handle nested lists that also contain touched items.

## Fix

**Not implemented.** A correct fix requires processing nesting levels deepest-first and recomputing positions against a progressively-updated intermediate document as each level is unwrapped, rather than the current approach of computing every operation from one static initial document snapshot. Confirmed via code search that no command in `packages/core/src/foundation/{list,block,table}/commands.ts` currently uses this "operate against a progressively-updated document" pattern — this would be new architecture for this command layer, not a small patch, and was deliberately not attempted speculatively.

## Regression coverage

None — not yet fixed.

## Related/similar issues

- [mixed-list-scope-indent-outdent-disabled-incorrectly](mixed-list-scope-indent-outdent-disabled-incorrectly.md) — the one **confirmed real** bug in the broader "list scope resolution across mixed/multi-depth selections" family; this file's gap is a plausible but unconfirmed sibling issue, not proven to share a user-visible symptom with it.
- [mixed-depth-select-retype-stray-numbering-not-reproducible](mixed-depth-select-retype-stray-numbering-not-reproducible.md) — the report this gap was found while investigating; explicitly **not confirmed** as the same bug.
- Per `docs/PHASE_ROADMAP_8B_12B.md`, Phase 6's coarse table-operation debt and Phase 8c's planned fine-grained table operations may need the same "progressively-updated document" capability this fix would require — worth scoping together rather than solving twice, when either is picked up.
