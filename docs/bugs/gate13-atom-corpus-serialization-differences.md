# Gate 13: atom corpus showed 5 of 7 scenarios diverging — 2 were a test-harness bug, 1 was a real, now-corrected divergence

**Status:** Fixed. A hard CI assertion now pins the exact expected shape in both the Node-side 2,100-case corpus and the 7-scenario browser replay.
**Area:** atom / test infra (retained-vs-canonical replay)
**First reported:** 2026-08-12 (this re-audit — flagging that it existed unreported); investigated and fixed same day.

## Symptom

The same replay harness that produces the "42 comparable intents" table also emits a separate `atomCorpus` result: of 7 atom scenarios compared between retained and canonical, only 2 were reported fully equivalent. The other 5 diverged — 3 classified `equivalent-serialization` (i.e. unexplained), 2 classified `expected-normalization`.

## Root cause

Two separate things, found by diffing the actual per-scenario legacy/canonical HTML output (not just the classification counts):

1. **Test-harness bug, not a product bug.** `atomShadowComparator.ts`'s `canonical()` helper built its `<div>` fixture with `ownerDocument.createElement("div")` but never attached it to `document.body`. jsdom's `Selection.addRange()` silently no-ops on a range whose container isn't connected to the document, so `domSelection.rangeCount` was `0` by the time `executeDomCanonicalAtomInsert` (`packages/react/src/adapters/domInlineAtomCommandBridge.ts`) checked it, and the insert bridge returned `null` immediately — for every scenario that goes through that path, regardless of input. This produced two false divergences (`formula.insert`, `image.insert`) and, more importantly, meant the two "expected" security-rejection scenarios (`image.reject-javascript`, `image.reject-html-data`) were never actually exercising `insertAtom`'s URL validation — they only *looked* correct because the same harness bug made every insert fail unconditionally, insert or reject alike.
2. **One real, previously-unclassified divergence.** `image.update`: the retained/legacy image-resize path drops the `alt` attribute when only `width`/`height` change; canonical's `updateAtom` correctly preserves it. Canonical is more correct here (no data loss), but nothing had reviewed or labeled this difference before.

## Fix

- `packages/react/src/test-harness/atomShadowComparator.ts`: `canonical()` now appends its fixture `root` to `ownerDocument.body` before touching `Selection`, and removes it in a `finally` block. This alone fixed `formula.insert` and `image.insert` to genuinely match, and made the two reject-scenarios exercise real validation instead of accidentally-correct no-ops.
- Added `correction: "canonical-preserves-alt-on-resize"` to the `image.update` scenario definition so it's an explicitly reviewed, named correction like the other two, instead of falling into the generic `equivalent-serialization` bucket.
- Net result: of 7 scenarios, 4 are genuinely equivalent and 3 diverge, all three now named and reviewed (`unsafe-resource-url-rejected`, `unsafe-data-mime-rejected`, `canonical-preserves-alt-on-resize`). Zero unexplained (`equivalent-serialization`) divergences remain.

## Regression coverage

- `packages/react/src/test-harness/atomShadowComparator.test.ts` (2,100-case Node corpus): now asserts `divergences["equivalent-serialization"]` is `undefined`, `divergences["expected-normalization"]` is exactly `900`, and `corrections` equals exactly the three named keys at 300 each — any new unexplained divergence fails this test.
- `packages/react/e2e/canonical-authority.spec.ts` ("runs the retained/canonical command replay"): now asserts `result.atomCorpus.scenarios === 7`, `.equivalent === 4`, and `.divergences` equals exactly `{ "expected-normalization": 3 }` — the gap where this metric wasn't asserted on at all is closed.

## Related/similar issues

- [gate13-block-quote-code-selection-mapping-difference](gate13-block-quote-code-selection-mapping-difference.md), [gate13-table-normalization-differences](gate13-table-normalization-differences.md), [gate13-list-command-selection-and-style-differences](gate13-list-command-selection-and-style-differences.md) — the other Gate 13 clusters.
- If a future jsdom-based shadow comparator is added for another DOM-authoritative bridge, check whether its fixture root is connected to `document` before trusting a `Selection`/`Range`-dependent codepath to exercise real behavior — this exact bug shape (detached root → silently-failing `addRange` → misleadingly "safe" no-op) could recur.
