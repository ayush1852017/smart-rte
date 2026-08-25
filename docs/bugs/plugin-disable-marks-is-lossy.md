# `repair()` silently drops any unrecognized mark on ordinary document load, not just via plugin-disable

**Status:** Fixed (2026-08-19, Phase 11 Tier 0). Originally filed as a Phase 10 plugin-disable-safety limitation, then re-scoped to a general `repair()` data-loss bug via a plugin-independent reproduction, then fixed in the same pass.
**Area:** foundation / schema (document load/repair) — not plugin-specific
**First reported:** 2026-08-18, during Phase 10's disable/re-enable property testing (gates 7/8)
**Related files:** `packages/core/src/foundation/schema.ts` (`baseSchema.marks`'s `unknown-mark` entry, `repair()`'s mark-filtering loop, `restoreUnknownMarks`), `packages/core/src/foundation/editor.ts:176,234` (both call `repair()` on every ordinary document load/replace), `packages/core/src/foundation/plugin/disableSafety.test.ts`, `packages/core/src/foundation/foundation.test.ts`

## Symptom

Any document containing a mark type the *current* schema does not register used to lose that mark silently on `repair()` — no error, no preserved trace, just gone, with `validate()` reporting the result as fully valid. Reachable via ordinary document load/replace (`editor.ts:176`, `:234`), independent of any plugin registry or disable/enable action — first noticed via Phase 10's disable-safety property testing, but not limited to that path.

## Reproduction

**Plugin-disable path** (the originally filed repro): `packages/core/src/foundation/plugin/disableSafety.test.ts`, "marks plugin: disable then re-enable round-trips losslessly" — disable the marks plugin, `repair()` against the reduced schema, the bold mark is preserved as an `unknown-mark` sentinel; re-enabling restores it byte-for-byte.

**Plugin-independent path** (confirms the general scope, and now the general fix): `packages/core/src/foundation/foundation.test.ts`, "preserves an unrecognized mark as unknown-mark on ordinary repair, independent of any plugin registry, and restores it once recognized again" — a document with a mark type that has never existed in any plugin or schema version, run through `repair()` directly against the plain `foundationSchema`, no plugin registry or disable/enable call anywhere in the call graph. The mark now survives `repair()` (as `{ type: "unknown-mark", attrs: { originalType, originalAttrs } }`) and round-trips back to its original type via `restoreUnknownMarks` once a schema recognizes it again.

## Root cause

The disable-safety mechanism Phase 10 built for **node** types (`repair()`'s node-handling branch) demotes a node whose `type` isn't in the current schema to `{ type: "unknown", attrs: { originalType, originalGroup, raw, editable: false } }`, fully preserved and restorable (`restoreUnknownNodes`). Marks live in `schema.marks`, not `schema.nodes`, and are carried as an array on inline text nodes rather than as nodes of their own — `repair()`'s **separate** mark-filtering code path had no equivalent preservation mechanism, simply dropping an unrecognized mark from the array (`remove-invalid-mark`) with no backup kept anywhere. This predated Phase 10 entirely and was not gated behind the plugin system in any way — `repair(document, schema)` takes a plain `SmartSchema`, and nothing about how that schema was constructed changes the behavior.

## Fix

Mirrored the node-side `unknown` mechanism on the mark side, reusing the existing `marks: SmartMark[]` array (no `SmartTextNode` shape change, since text nodes have no `attrs` bag to add a side-channel to):

- `packages/core/src/foundation/schema.ts`'s `baseSchema.marks` now base-registers an `unknown-mark` type (`{ originalType, originalAttrs }` attributes), unconditionally present the same way the `unknown` node type is.
- `repair()`'s mark-filtering loop: a mark whose type isn't registered at all (`!markSpec`) is now preserved as `{ type: "unknown-mark", attrs: { originalType: mark.type, originalAttrs: mark.attrs } }` and recorded as `preserve-unknown-mark`, instead of being dropped as `remove-invalid-mark`. A mark whose type *is* registered but still fails the parent's allowlist, attribute validation, or an `excludes` conflict is unchanged — still correctly dropped, since that's a different (locally-invalid, not "unknown") case. The final accepted-marks array is re-sorted through `canonicalMarkOrder`, since substituting a mark's type string can change its correct canonical sort position.
- New `restoreUnknownMarks(document, schema)` mirrors `restoreUnknownNodes`: walks text nodes, replaces any `unknown-mark` whose `attrs.originalType` is now present in `schema.marks` with the real `{ type, attrs }`, then re-sorts.

## Regression coverage

- `packages/core/src/foundation/plugin/disableSafety.test.ts`'s marks describe block now asserts a full disable → `preserve-unknown-mark` → re-enable → `restoreUnknownMarks` round trip equal to the original document, matching the pattern the other four built-in plugins already use (previously asserted the opposite — that re-enabling could *not* restore the mark).
- `packages/core/src/foundation/foundation.test.ts`'s new test (see Reproduction above) covers the plugin-independent path directly against `foundationSchema`, with no plugin registry involved — the general scope is now machine-verified, not only documented.
- Full suite: core 595/595, react 92/92, full 3-browser e2e 253 passed / 5 skipped / 0 failed (unchanged from the pre-fix baseline — this fix is additive-only to `repair()`'s mark path and touches no other behavior).

## Related/similar issues

[input-ts-not-wired-to-plugin-shortcut-dispatch](input-ts-not-wired-to-plugin-shortcut-dispatch.md) — the other Phase 11 Tier 0 stop-condition item, fixed in the same pass; unrelated root cause (keyboard dispatch wiring, not schema repair), grouped only by both being Phase 10 exit-review findings.
