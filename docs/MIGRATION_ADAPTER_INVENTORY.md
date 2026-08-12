# Temporary Migration Adapter Inventory

**Status: closed.** As of Phase 8b final closeout (2026-08-12), `canonicalAuthorityFlag`
is promoted to on-by-default, `LegacyClassicEditor` and all four rollback
bridges below are deleted, and canonical authority is the repository's only
editor implementation. **Active canonical-product adapter count: 0. Retained
rollback bridge count: 0.** This file is kept as a historical record of what
existed and why, not as a live inventory — nothing described below remains in
source.

| Marker | Introduced | Deleted | Purpose (historical) |
|---|---|---|---|
| `canonical-list-dom-roundtrip` | Phase 3 | 2026-08-12, `e15a326` | Legacy rollback only. Parsed a bounded list DOM fragment, executed pure canonical commands, and rendered it back. |
| `canonical-inline-dom-roundtrip` | Phase 4 | 2026-08-12, `c034ef8` | Legacy rollback only. Parsed selected inline owners and rendered mark changes back. Also doubled as the canonical side of the Gate 13/14 inline shadow-comparison test infrastructure (`inlineShadowComparator.ts`), which was retired alongside it — that parity evidence can no longer be regenerated. |
| `canonical-block-dom-roundtrip` | Phase 5 | 2026-08-12, `45c6832` | Legacy rollback only. Parsed a bounded block parent and rendered structural changes back. Also doubled as the canonical side of the Gate 13/14 block shadow-comparison test infrastructure (`blockShadowComparator.ts`), retired alongside it for the same reason. |
| `canonical-clipboard-dom-insert` | Phase 8a | 2026-08-12, `7915bc9` | Legacy rollback only. Used sanitized canonical HTML and Range insertion; the canonical product pipeline had always inserted fragments as operations instead. |

## What actually happened at closeout, in order

1. `LegacyClassicEditor` (`packages/react/src/components/ClassicEditor.tsx`,
   6,069 lines) was retired first (`60adfb7`), since all four bridges were its
   command engine with no other implementation underneath — deleting them
   first would not have compiled. This was a breaking change to the published
   package: `LegacyClassicEditor` was a separate, directly-importable public
   export independent of the flag, and is now gone. `ClassicEditorAuthority`
   (exported as `ClassicEditor`) unconditionally renders
   `CanonicalAuthorityEditor`; legacy-only props are accepted and ignored for
   source compatibility, not removed outright.
2. The two cleanly-scoped bridges (clipboard, Phase 8a; list, Phase 3) were
   deleted with no further fallout — nothing else depended on them.
3. The two dual-purpose bridges (inline, Phase 4; block, Phase 5) required
   also retiring the Gate 13/14 shadow-comparator test infrastructure that
   used them as canonical's side of a retained-vs-canonical comparison
   (`inlineShadowComparator.ts`/`blockShadowComparator.ts` and their 3,000-case
   corpus tests, `legacyInlineEngine.ts`/`legacyBlockEngine.ts`'s frozen legacy
   snapshots, and 19 of the browser replay's 42 comparable intents in
   `Gate13ReplaySurface.tsx` — `comparableIntents` now asserts `23`, not `42`).
   This parity evidence cannot be regenerated going forward; that is the
   accepted, intended consequence of closing Gate 14, per owner decision.
4. Retiring `LegacyClassicEditor` also broke 30 e2e tests (in 5 files) that
   depended on its DOM-mutation-observer input model and hadn't been run
   during verification, because this project's informal "full e2e suite"
   definition (2 of 12 spec files) was itself incomplete. See
   `docs/PHASE_8B_FINAL_CLOSEOUT.md` §1 for the full incident and the
   coverage-gap table; those 5 files were retired with the gap tracked as
   prioritized follow-up, not silently dropped.

## Deletion-sequence export guard

`packages/react/src/adapters/phase8bExportGuard.test.ts` was run before and
after every one of the four bridge-deletion commits, per the original plan.
It calls the DOCX and PDF format adapters directly, without mounting any
editor or importing any rollback bridge — confirming format export/import
never depended on the rollback path. It passed at every step.
