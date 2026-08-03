# Smart RTE Core

Framework-agnostic document model, selection, transaction, history, and
normalization primitives. This package is not yet wired into the published
React editor; it establishes the compatibility-safe migration boundary.

## Foundation contract

The frozen Phase 1/C0 kernel is available from the dedicated subpath:

```ts
import {
  createFoundationEditor,
  foundationSchema,
  resolveScope,
  type ResolvedPos,
  type SmartTransaction,
} from "smartrte-core/foundation";
```

The package root remains the compatibility API for the current React adapter.
New kernel and Phase 2 resolver work must use `smartrte-core/foundation`; do not
extend the legacy raw-path contracts. `pnpm run lint:foundation-boundary`
enforces that boundary. Root promotion is an explicit Phase 3 list-migration
exit criterion. See `docs/FOUNDATION_CONTRACT.md` in the repository for the
locked decisions and `docs/SEMANTIC_SELECTION_CONTRACT.md` for Phase 2.
The persistent apply, incremental index, renderer, and browser-input contracts
are recorded in `docs/CANONICAL_EDITING_SURFACE.md`.
