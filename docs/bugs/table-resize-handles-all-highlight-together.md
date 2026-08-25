# Every row/column resize handle highlighted blue during a single drag

**Status:** Fixed
**Area:** react / TableResizeHandles.tsx
**First reported:** 2026-08-19, user screenshot showing every row boundary in a table lit up blue while dragging one resize handle.
**Related files:** `packages/react/src/components/TableResizeHandles.tsx`.

## Symptom

Dragging a single row (or column) resize handle highlighted every handle of that kind, not just the one being dragged.

## Reproduction

Confirmed directly: `dragging` state only tracked `{ kind, position }`, never which specific boundary index was being dragged. The highlight condition (`background: dragging?.kind === "row" ? primary : transparent`) matched every row handle simultaneously whenever any row handle was being dragged.

## Root cause

A straightforward missing comparison, introduced when `TableResizeHandles.tsx` was first built (Phase 11.5 §2.2) - the highlight logic checked only `dragging.kind`, never `dragging.index === boundary.index`.

## Fix

`dragging` state now includes `index`; both highlight conditions compare `dragging.index === boundary.index` in addition to `kind`.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts` - "highlights only the resize handle actually being dragged": drags column handle 0, asserts its own background changed while handle 1's stayed transparent, all 3 browsers.

## Related/similar issues

[table-resize-moves-unrelated-columns](table-resize-moves-unrelated-columns.md) - the same component, found in the same post-Phase-11.5 investigation window, different mechanism (rendering size vs. this highlight-state bug).
