# Published npm versions (smartrte-react@0.3.4, smartrte-core@0.2.1) predate the entire canonical rebuild, but local package.json still claims those exact numbers

**Status:** Fixed (documented for Phase 9 semver planning; no code changed by this entry — the actual version bump is Phase 9 §2.6's job)
**Area:** packaging / semver / publish
**First reported:** 2026-08-13, discovered during Phase 9 pre-work (§1.1, checking for real consumers of `canonicalAuthorityFlag` before deciding its fate)

## Symptom

`packages/react/package.json` and `packages/core/package.json` declare versions `0.3.4` and `0.2.1` respectively. `npm view smartrte-react version` / `npm view smartrte-core version` return the exact same numbers — but pulling the actual published tarballs (`npm pack smartrte-react@0.3.4`, `npm pack smartrte-core@0.2.1`) shows a completely different codebase: no `foundation/` directory in core at all (just the old flat `model.js`/`tree.js`/`transaction.js`/`commands/` legacy engine), and react's published `dist/` has `components/ClassicEditor.js` with no `ClassicEditorAuthority.js`, `CanonicalAuthorityEditor.js`, or `canonicalAuthorityFlag.js` anywhere.

## Reproduction

```
npm view smartrte-react versions --json   # latest: 0.3.4, no newer version exists
npm view smartrte-core versions --json    # latest: 0.2.1, no newer version exists
npm pack smartrte-react@0.3.4 && tar -tzf smartrte-react-0.3.4.tgz | grep -i classiceditor
npm pack smartrte-core@0.2.1 && tar -tzf smartrte-core-0.2.1.tgz | grep -i foundation
```

## Root cause

The entire canonical architecture (Phases 1 through 8b — the foundation model, canonical command layer, `CanonicalAuthorityEditor`, `canonicalAuthorityFlag`, and everything Phase 8b closeout just retired) was built without ever bumping either package's version number. The local `package.json` version fields are stale leftovers from before this rebuild started, not aspirational/in-progress version numbers for a pending publish.

## Fix

None applicable to this entry — this is a finding, not a defect to patch. The actual fix is Phase 9 §2.6 (semver/changelog/publish policy): decide and apply real version numbers before any future publish, given the scale of undisclosed breaking changes already sitting on top of the last real release. Confirmed directly relevant to §1.1 (`canonicalAuthorityFlag` disposition): since the flag never shipped in any published version, there is no possible external consumer depending on its presence, which resolves that decision to "remove entirely" with certainty rather than inference.

## Regression coverage

Not applicable (packaging/process fact, not a code path).

## Related/similar issues

- [full-e2e-suite-definition-was-incomplete](full-e2e-suite-definition-was-incomplete.md) — a different "the assumed authoritative state didn't match reality" pattern from the same project, worth checking together if a future publish/release-readiness question comes up.
- Phase 9 spec (`docs/` — see the Phase 9 kickoff conversation) §2.6 is where this must actually be resolved before any publish happens.
