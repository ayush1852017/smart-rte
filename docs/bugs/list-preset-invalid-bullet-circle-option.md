# List preset dropdown offered a "Bullet · circle" option that wasn't a real preset

**Status:** Fixed
**Area:** list / toolbar / schema
**First reported:** 2026-08-10 (this project's ongoing list-toolbar bug hunt)
**Related files:** `docs/PHASE_8B_MIXED_CHECKBOX_PRESET_REOPEN.md`

## Symptom

The "List preset" toolbar dropdown showed a 13th option, "Bullet · circle" (`bullet-circle`), alongside the 12 real presets. Selecting it set a model attribute (`attrs.preset = "bullet-circle"`) that wasn't a member of the canonical preset catalog, so anything calling `getSmartListPreset("bullet-circle")` (e.g. depth-to-style lookup) got back `undefined` — a latent crash/undefined-behavior risk, not just a cosmetic issue.

## Reproduction

Confirmed via source inspection, not live reproduction of a crash: `packages/react/src/components/CanonicalAuthorityEditor.tsx` had a hardcoded `<option value="bullet-circle">Bullet · circle</option>` sitting outside the loop that generates the other 12 options from `SMART_LIST_PRESETS.map(...)`. At that time the same string also appeared in legacy format handling and a test fixture, but it was never a member of the actual preset catalog used by `getSmartListPreset`/`isSmartListPreset`. The current source intentionally retains it only in negative regression fixtures (`packages/core/src/listPresets.test.ts:22` and `packages/core/src/foundation/list/commands.test.ts:336-339`).

## Root cause

An id that partially existed in four places but was never added to the one canonical catalog (`packages/core/src/listPresets.ts` at the time; superseded by `packages/core/src/foundation/list/presets.ts`, see Fix) that the dropdown's real options and `getSmartListPreset`/`isSmartListPreset` are generated from and validated against.

## Fix

- New canonical catalog: `packages/core/src/foundation/list/presets.ts` — "the only list preset catalog accepted by canonical commands and schema" (`FOUNDATION_SMART_LIST_PRESETS`, `isFoundationSmartListPreset`).
- `setListPreset`/`createList` in `packages/core/src/foundation/list/commands.ts` now validate against `isFoundationSmartListPreset` and no-op (return `[]`) rather than accept an invalid preset id.
- The stray `bullet-circle` `<option>` was removed from the toolbar dropdown as part of the same fix (landed via a parallel work session, Codex, mid-project; independently confirmed by re-grepping — the dropdown now only renders from `SMART_LIST_PRESETS.map(...)`).

## Regression coverage

`packages/core/src/foundation/list/commands.test.ts`: `"rejects a preset ID that is outside the canonical catalog"` — asserts `setListPreset` no-ops for `"bullet-circle"` and that a document already carrying that invalid preset fails `validate()`.

## Related/similar issues

- [list-preset-not-rendering-only-model-changed](list-preset-not-rendering-only-model-changed.md) — same investigation round, different root cause (renderer attribute projection, not catalog validation).
