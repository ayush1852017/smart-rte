# `restoreUnknownNodes`/`restoreUnknownMarks` were built, tested, and never called from any real load path

**Status:** Fixed
**Area:** core / plugin disable-safety
**First reported:** 2026-08-30, found while verifying round-trip safety for the new capability-preset mechanism (`packages/react/src/capabilityPresets.ts`, built for `docs/SOOTR_MIGRATION_READINESS.md` gap #3)
**Related files:** `packages/core/src/foundation/schema.ts` (`repair`, `restoreUnknownNodes`, `restoreUnknownMarks`), `packages/core/src/foundation/editor.ts` (`FoundationEditor` constructor, `replaceState`), `packages/core/src/foundation/plugin/disableSafety.test.ts`

## Symptom

Not a user-visible symptom - found while explicitly verifying (per this project's own standing instruction to verify round-trip safety "explicitly rather than assume") that content demoted to `unknown` by a restricted plugin set would correctly restore when loaded back into a full-featured editor instance. It did not: loading a document containing a previously-demoted `unknown` node into a `FoundationEditor` constructed with a schema that recognizes the original type left it as `unknown` forever, rather than restoring it.

## Root cause

`repair()` (demote an unrecognized node/mark type to `unknown`/`unknown-mark`, preserving the original content in `attrs.raw`/`attrs.originalAttrs`) is called automatically by both `FoundationEditor`'s constructor and `replaceState()`, on every document load. Its inverse, `restoreUnknownNodes`/`restoreUnknownMarks` (turn a matching `unknown` node back into its real type, when the *current* schema recognizes `attrs.originalType`), exists, is correctly implemented, and is exercised thoroughly in `plugin/disableSafety.test.ts` (5 tests, all passing, both directions) - but grepping the entire core and react source trees (outside tests) found **zero real call sites**. The "demote" half of disable-safety was fully wired into production; the "restore" half was built and proven correct in isolation but never connected to anything a real consumer's document-loading path would ever hit.

Practical consequence: any host that ever disables a plugin, saves content, later re-enables the plugin, and loads that content back — exactly the shape the capability-preset mechanism's own round-trip-safety guarantee depends on — would have found the previously-demoted content permanently stuck as an inert `unknown` placeholder, never actually restored, even though the data needed to restore it was faithfully preserved the whole time.

## Fix

`packages/core/src/foundation/editor.ts`: both the `FoundationEditor` constructor and `replaceState()` now call `restoreUnknownMarks(restoreUnknownNodes(repaired.doc, this.schema), this.schema)` immediately after `repair()`, before the existing boundary-operation and validation steps. Safe and side-effect-free for every existing document: `restoreUnknownNodes`/`restoreUnknownMarks` only ever act on an `unknown`/`unknown-mark` node whose recorded `originalType` the *current* schema recognizes - a document with no such nodes (the overwhelming majority of all existing content) round-trips through both calls as a complete no-op.

## Regression coverage

`packages/react/src/capabilityPresets.test.ts` - "a table created under 'full' round-trips safely as unknown under 'simple', and restores exactly under 'full' again": exercises the full real cycle (full → persist → load under simple, confirm demoted → persist → load under full again, confirm restored) through the actual `CanonicalEditorRuntime`/`FoundationEditor` path a real consumer uses, not just the raw `repair()`/`restoreUnknownNodes()` functions directly (which `disableSafety.test.ts` already covered, and is why this gap wasn't caught until a *different* feature needed the full round-trip through the real load path).

## Related/similar issues

Same general shape as this project's other "built, tested in isolation, never wired into the real path" findings (Phase 10's `pluginRuntime.ts`, Tier 0's `resolveShortcut` before `input.ts` was fixed to call it, `MediaManager.tsx` before Phase 11.5 wired it in) - confirmed by checking for real call sites outside tests before assuming a tested function is actually reachable in production.
