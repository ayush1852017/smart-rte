# List Enter-to-exit silently failed (threw internally) when exiting from the middle of a list

**Status:** Fixed
**Area:** list / selection / input
**First reported:** unknown — backfilled from `docs/PHASE_8B_LIST_ENTER_LIST_TYPES_CODE_CHECKLIST.md`

## Symptom

In the browser this presented as Enter appearing to do nothing, or repeated empty items appearing instead of exiting the list — no visible error, just a no-op-looking failure.

## Reproduction

Reproduced in the core input path for an empty item in the *middle* of a depth-zero list: first Enter creates the empty item (normal behavior); second Enter should exit the list via list-unwrap but instead the underlying operation failed.

## Root cause

The low-level unwrap function correctly *requires* a caller-supplied new node ID whenever the unwrapped run sits between existing list items (a "middle split" — the list has to be split into two list nodes around the exited content). The Enter-exit code path was calling it without supplying that ID, so it threw `"list.unwrap middle split requires a caller-provided splitListId"`. This was **not** a missing-editable-boundary issue and not a detection bug — the empty-item check and the depth check were both reached correctly; only the command's *input payload* was incomplete. A list-specific "isolating boundary" rule was considered and explicitly rejected as the wrong fix, since a list is a non-isolating container whose exit operation is supposed to create a paragraph, not treat the list edge as impassable.

**Why it was silent:** the thrown exception aborted the transaction before commit, leaving the UI in its pre-Enter state — which reads to a user as "Enter did nothing" rather than as a visible error, since nothing in the input pipeline surfaced the exception to the interface.

## Fix

The Enter-exit ID parameter (`splitListId`) is now a **required** field rather than optional, in `packages/core/src/foundation/list/input.ts`. The empty-item branch supplies it only when the exit is actually interior to the list (trailing/single-item exits don't need a split, since there's nothing after them to split off). The canonical surface and the legacy React list bridge both now generate and pass a deterministic, caller-owned ID at the call site. Nested empty items still outdent one level before a depth-zero list can be exited — that part of the behavior was already correct and unchanged.

## Regression coverage

`packages/core/src/foundation/phase2_5.test.ts`: 5-item list, Enter on a middle item then Enter again on the new empty item (model becomes list/paragraph/list, item IDs preserved); 5-item trailing exit; single-item exit plus Backspace/Delete around the resulting paragraph. `packages/core/src/foundation/list/input.test.ts`: depth-two empty item outdents before exiting. `packages/react/e2e/canonical-authority.spec.ts`: product list-exit check, 3/3 browsers. Note: the retained/legacy editor doesn't call this unwrap function at all (it uses a native DOM list path), so it structurally cannot hit this exception — no retained-parity claim is made either way.

## Related/similar issues

- [quoted-list-enter-enter-exit-leaves-delete-inert](quoted-list-enter-enter-exit-leaves-delete-inert.md) — a different, earlier bug in the same general "Enter exits a list" feature, unrelated root cause (missing boundary invariant, not a missing command parameter).
- [double-enter-list-exit-not-reproducible](double-enter-list-exit-not-reproducible.md) — a much later report of "double-Enter doesn't exit the list" that could NOT be reproduced against current source. If a similar report recurs, check this file's fix is still present before assuming it's the same bug resurfacing — the mechanism here (missing split ID) is a plausible-sounding but different explanation than what that later investigation found (nothing broken, likely a stale build).
