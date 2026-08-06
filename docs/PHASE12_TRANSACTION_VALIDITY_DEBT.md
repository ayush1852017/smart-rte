# Phase 12 blocker: transaction-level validity

> **Superseded numbering (2026-08-06):** this file's "Phase 12" means the old
> bundle of "collaboration or rebasing." As of
> `docs/PHASE_ROADMAP_8B_12B.md`, the fix described below is **Phase 8c item
> 1** (per-transaction validity, done ahead of the Phase 10 plugin API
> freeze), and collaboration itself is split into **Phase 12a**
> (versioning/async review, v1.1) and **Phase 12b** (real-time collaboration,
> v2). The technical content below is still accurate; only the phase number
> in the title and prose is stale.

Phase 6 table commands currently replace a complete table because the operation
runtime requires schema validity after every individual operation. Fine-grained
row/column/span edits can pass through temporarily invalid geometry even though
the committed transaction is valid.

Before collaboration or rebasing is designed in Phase 12, change the invariant
from per-operation validity to **per-transaction validity**:

- operations remain pure and self-inverting;
- intermediate document states are private to atomic transaction application;
- structural/schema validity is asserted after all originating and
  normalization operations have run, before commit;
- any failure rolls back the entire transaction;
- transaction mapping and collaboration transport preserve the complete atomic
  operation sequence.

Until that change, whole-table `replaceNode` is intentional. Collaboration must
not treat it as the desired long-term granularity.

