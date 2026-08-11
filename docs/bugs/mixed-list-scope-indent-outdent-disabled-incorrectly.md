# Indent/Outdent disabled for a selection mixing list items and a plain block, even though the list part was still actionable

**Status:** Fixed
**Area:** list / toolbar / selection
**First reported:** unknown — backfilled from `docs/PHASE_8B_MIXED_SCOPE_DROPDOWN_CHECKLIST_PRESET.md` (§1)

## Symptom

A selection spanning nested list items and a sibling plain block (e.g. after a partial unwrap) resolved to a genuinely "mixed" scope (part list, part plain block). Once in this state, the toolbar's Indent/Outdent controls went disabled entirely — even though the list portion of the selection was still legitimately actionable.

## Reproduction

Reproduced from a screenshot-driven repro sequence spanning nested list items and a sibling item, then outdenting twice — after the second outdent, one selected item was unwrapped to a plain paragraph while the other selected items remained in a nested list, producing a real mixed scope (a `list-selection` part plus a `block-range` part), not a disabled/invalid selection.

The first exact repro attempt also exposed a **second, independent command-layer defect** that initially masked this bug: the depth-zero `unwrapOne` path was dropping nested-list descendants while unwrapping a list item, which made the resulting scope look like a plain block range with no list part at all (rather than a genuine mixed scope) — hiding the real toolbar bug behind a content-loss bug. That descendant-loss issue was fixed first (nested lists now become sibling block content instead of being dropped), which was necessary before the toolbar bug beneath it could even be observed correctly.

## Root cause

Once descendants were correctly preserved, the remaining toolbar bug was in the React state derivation: the canonical toolbar's list-state computation only recognized `scope.kind === "list-selection"` — a mixed scope made both Indent and Outdent fall through to disabled, even though the list command layer already correctly consumed list *parts* of a mixed scope and ignored the plain-block parts. This was a toolbar/resolved-scope interpretation gap, not a missing command capability.

## Fix

The established mixed-scope policy (list commands act on list parts of a selection, ignore plain-block parts) is now respected by the toolbar too: Indent is enabled when at least one selected list part has a preceding same-level sibling; Outdent is enabled whenever there is any list part at all, since depth-zero outdent-to-unwrap remains legal. This avoids disabling a valid list action just because the same selection also happens to contain a plain block. `packages/react/src/components/CanonicalAuthorityEditor.tsx`.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: reproduces the multi-depth screenshot shape, asserts the post-operation scope contains both a list-selection part and a block-range part, asserts the root contains both list and paragraph nodes, verifies both controls are enabled, and performs another Indent to prove the state remains genuinely actionable (not just visually enabled). 9/9 focused browser cases (3 tests × 3 browsers). The retained editor has no equivalent canonical mixed-scope resolution path; its own list/toolbar suites remain green and no retained code was changed — this is recorded as a canonical toolbar/scope regression, not a claim that native editing has identical mixed-selection semantics.

## Related/similar issues

- [indent-outdent-max-depth-disabled-together-not-a-bug](indent-outdent-max-depth-disabled-together-not-a-bug.md) and [list-depth-zero-subset-case-taxonomy](list-depth-zero-subset-case-taxonomy.md) — several other "indent/outdent disabled" reports that turned out **not** to be bugs, unlike this one. This is the one confirmed real defect in that family — check this file first if a new "indent/outdent shouldn't be disabled here" report comes in involving a mixed list+plain-block selection specifically.
- [unwraplist-deepest-first-gap-multi-depth-toggle-off](unwraplist-deepest-first-gap-multi-depth-toggle-off.md) — a later, related, still-**open** gap in a different command (`unwrapList` itself, not the toolbar's enabled-state logic) for selections spanning multiple list *depths* at once.
