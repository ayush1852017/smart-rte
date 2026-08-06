# Temporary Migration Adapter Inventory

**Active canonical-product adapter count: 0.**

The rollback implementation deliberately retains four DOM-authoritative bridges.
**`canonicalAuthorityFlag` defaults to off**, so these bridges are the shipped
default path today, not a dormant fallback — they only become unreachable once
canonical authority is explicitly enabled (globally, per tenant, or per
document). They remain a real exception to repository-wide single authority and
are counted below.

| Marker | Introduced | Deletion owner | Purpose |
|---|---|---|---|
| `canonical-list-dom-roundtrip` | Phase 3 | rollback removal after flag promotion | Legacy rollback only. Parses a bounded list DOM fragment, executes pure canonical commands, and renders it back. |
| `canonical-inline-dom-roundtrip` | Phase 4 | rollback removal after flag promotion | Legacy rollback only. Parses selected inline owners and renders mark changes back. |
| `canonical-block-dom-roundtrip` | Phase 5 | rollback removal after flag promotion | Legacy rollback only. Parses a bounded block parent and renders structural changes back. |
| `canonical-clipboard-dom-insert` | Phase 8a | rollback removal after flag promotion | Legacy rollback only. Uses sanitized canonical HTML and Range insertion; the canonical product pipeline inserts fragments as operations. |

**Marker text currently in source:** all four rollback bridges carry a
`ROLLBACK_ADAPTER:` comment. The three DOM-command bridges
(`canonicalListCommandBridge.ts`, `canonicalInlineCommandBridge.ts`,
`domBlockCommandBridge.ts`) and `canonicalClipboardRuntime.ts` were renamed
from `MIGRATION_ADAPTER:` in commit `033c975` ("refactor(react): remove active
DOM authority primitives") once they stopped being active migration scaffolding
and became pure rollback scaffolding. The contract scripts no longer count
marker strings; they inspect the protected behaviour, and the Phase 8b gate
rejects forbidden authority primitives on the canonical product graph.

Phase 8b retires the adapters from the canonical product graph rather than
deleting the only runtime rollback implementation before promotion. The
active-product count is therefore zero, and the count of retained rollback
bridges is four. Every bridge that becomes reachable from canonical authority
must carry a `ROLLBACK_ADAPTER` marker and fail the Phase 8b contract gate; the
older `MIGRATION_ADAPTER` marker name is retired.

**Phase 8b Gate 12 tracker wording:** the four adapters are unreachable **only
while canonical authority is enabled**; with the flag at its default (off),
they are the live default path, and deletion is triggered after flag
promotion. Their retained existence is the rollback mechanism required by
Gate 1, not a pre-promotion failure. Post-promotion deletion remains mandatory
and is the event that closes the repository-wide exception.
