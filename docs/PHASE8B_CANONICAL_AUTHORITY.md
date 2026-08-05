# Phase 8b canonical authority contract

## State ownership

Canonical mode is uncontrolled. `defaultValue` is read once when the retained
`CanonicalEditorRuntime` is constructed. Prop changes never recreate the editor
and never replace its document. Hosts replace content explicitly through
`SmartEditorHandle.replaceValue`, receive one `onChange` event per committed
transaction, and choose their own persistence debounce.

External replacement starts a new history epoch. By default selection resets to
the first editable position. With `keepSelection: true`, the runtime preserves
the active owner by stable node ID and clamps its inline offset; if that owner no
longer exists it resets to the first editable position.

Dirty state compares the current revision with the last revision passed to
`markSaved`. A checkpoint contains the persisted envelope, exact selection,
stored marks, and saved revision. Restoring a checkpoint replaces the state and
history epoch without recreating the editor instance.

## Rollout flag

`canonicalAuthorityFlag` resolves direct component override, document, tenant,
then global. Development default is off. Promotion requires the Phase 8b replay,
composition, browser regression, and performance gates. Operations may flip the
flag globally, per tenant, or per document without a redeploy.

The persisted envelope is identical on both paths. A canonical document is
accepted by the rollback parser/serializer gate; stable IDs may be absent after
a legacy edit, which is why the rollback path is temporary.

## Rollback exception

The canonical product path has zero DOM/model authority adapters. The dormant
legacy implementation still contains four rollback bridges and is DOM-authoritative
when the flag is off. Repository-wide single authority is therefore qualified
until rollout promotion deletes that implementation. This is recorded openly in
`MIGRATION_ADAPTER_INVENTORY.md`.

