# Phase 6 carry-forward audit completed during Phase 7

- **Selection mapping:** a cursor in an untouched cell now maps by stable
  descendant ID through whole-table `replaceNode`. The row-insert fixture maps
  `[0,1,0,0]` to `[0,2,0,0]` without reporting deletion.
- **50×50 history memory:** one row-insert history entry stores **1,625,365
  bytes** across forward and inverse payloads. Filling the 200-entry cap with
  operations of that size would retain approximately **325,073,000 bytes**,
  before JavaScript object overhead. This is a material known cost of the Phase
  6 whole-table replacement deviation. Phase 12's transaction-validity work
  should enable granular operations; a byte-budget eviction policy may need to
  move earlier if table-heavy usage is observed.
- **2,000-block performance:** the figures were already present in
  `PERFORMANCE_TRENDS.md`: final medians were 9.6 ms Chromium, 4 ms Firefox, and
  6 ms WebKit. The extreme-document issue remains concentrated at 10,000
  mounted blocks.
- **Word-like mid-table headers:** the import fixture promotes the preceding
  body row into the leading header region rather than silently downgrading the
  imported mid-table header. All text survives and the repaired table validates.
  This is deterministic but can change visual header semantics; it remains an
  intentional consequence of Phase 6's contiguous-leading-header invariant.
