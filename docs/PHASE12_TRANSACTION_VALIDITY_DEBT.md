# Phase 12 blocker: transaction-level validity

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

