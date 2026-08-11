# Splitting an ordered list mid-way (via unwrap) silently restarted the trailing portion's numbering at 1

**Status:** Fixed
**Area:** list / commands
**First reported:** 2026-08-11 (this session, found while investigating an Enter-key repro, not the original complaint)

## Symptom

When an item exiting a list (e.g. via repeated Enter, or the single-item toggle-off button) sat in the *middle* of an ordered list, the list had to split into two separate list nodes around the exit point. The trailing portion silently restarted its numbering at "1." instead of continuing from where the original list left off.

## Reproduction

Found while precisely reproducing a user-reported Enter-key sequence: seeded a 5-item numbered list, pressed Enter repeatedly on an item until it exited the list from the middle, inspected the resulting model. Confirmed via `attrs.start` on the split-off list node — it was absent, meaning it would render starting from 1 by default.

## Root cause

`unwrapOne` (`packages/core/src/foundation/list/commands.ts`), when a middle unwrap forces a list to split into two nodes, copied the original list's `attrs` verbatim onto the trailing split-off portion — but never computed or set a continuing `start` value, so the trailing list rendered as if it were a brand-new list starting at 1.

## Fix

The split-off trailing list now computes `start` from the original list's own `start` (defaulting to 1) plus how many items came before the split point, so numbering continues seamlessly. `packages/core/src/foundation/list/commands.ts`. Harmless for unordered lists — `start` is simply unused/ignored there.

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: `"continues ordered-list numbering across a middle unwrap split instead of restarting at 1"` — covers both the default-start case and composing correctly with an already-restarted list (`start: 10`).

## Related/similar issues

- [unwrap-loses-nesting-depth-round-trip](unwrap-loses-nesting-depth-round-trip.md) — a different bug in the same function, found and fixed in the same investigation.
