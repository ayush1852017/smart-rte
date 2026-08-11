# Indent button disabled after outdenting a nested item all the way into a plain paragraph

**Status:** Not a bug (working as designed)
**Area:** list / toolbar
**First reported:** unknown — backfilled from `docs/PHASE_8B_PARTIAL_LIST_DELETE_INDENT_UNWRAP.md`

## Symptom

After repeatedly outdenting a nested list item until it fully unwraps into a plain paragraph (no longer part of any list), the Indent toolbar button becomes disabled/unavailable.

## Reproduction

Checked directly on the canonical surface.

## Root cause

None — by design. List indent is deliberately list-only: it requires an existing `list-selection` scope and a preceding same-level list-item sibling to nest under. It does not, and is not supposed to, promote a plain paragraph into becoming a new list item. Promoting plain content into a list is intentionally a *separate* operation (list creation, i.e. the Bullets/Numbering/Checklist buttons), not something Indent is supposed to also do.

## Fix

None — explicitly "not a command-legality bug and not a stale coupled toolbar state bug." The correct workflow for a user in this state is to use the list-creation controls (Bullets/Numbering), which remain available on a plain block.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: constructs a nested item, outdents it to plain-block state, asserts "Indent list item" is disabled and "Bulleted list" is enabled, invokes Bullets, verifies content lands correctly in a new list item — this test records the supported workflow rather than treating `list.indent`'s semantics as something to change.

## Related/similar issues

- [indent-outdent-max-depth-disabled-together-not-a-bug](indent-outdent-max-depth-disabled-together-not-a-bug.md) — a different "indent seems wrongly disabled" report, also not a bug, different scenario.
- [list-depth-zero-subset-case-taxonomy](list-depth-zero-subset-case-taxonomy.md) — a closely related, more detailed investigation distinguishing "at depth zero, still in the list" (controls stay enabled, correct) from "already unwrapped to a plain block" (this file's case, Indent correctly disabled).
