# `replaceValue` crashes when the new document's first block is an atomic node with empty children

**Status:** Fixed
**Area:** react / `canonicalEditorRuntime.ts` (`firstTextSelection`) / atoms
**First reported:** 2026-08-19, discovered while writing a Phase 11 Tier 2 undo/redo e2e test that seeds a document starting with a `block_image`.
**Related files:** `packages/react/src/canonicalEditorRuntime.ts` (`firstTextSelection`, `replaceValue`)

## Symptom

Calling `CanonicalEditorRuntime.replaceValue(doc)` with a document whose first top-level block is an atomic node (e.g. `block_image`, `block_formula`, `video`, `audio`) with an empty `children` array throws `"A position cannot resolve inside an atomic node; address its owning container boundary."`, uncaught, crashing the React component (no error boundary), leaving `[contenteditable="true"]` never rendered.

## Reproduction

```js
runtime.replaceValue({
  schemaVersion: runtime.editor.schema.version,
  revision: runtime.editor.state.revision + 1,
  document: { type: "doc", id: "doc", children: [
    { type: "block_image", id: "img", attrs: { src: "...", alt: "x", decorative: false, status: "ready", width: 200, height: 150 }, children: [] },
  ] },
});
```
Throws immediately inside `replaceValue`. A document with the same atom placed *after* a paragraph does not reproduce it — `firstTextSelection` finds the paragraph first and never visits the atom.

## Root cause

`firstTextSelection` (`canonicalEditorRuntime.ts:89-104`) walks the document looking for the first block-group node it can treat as a text-caret target, using: `spec?.group === "block" && (children.length === 0 || children.every(child => isTextNode(child) || ...group === "inline"))`. An atomic node (`block_image`, `block_formula`, `video`, `audio`) is `group: "block"` and, when freshly authored with no content, has `children.length === 0` — satisfying this condition even though atomic nodes never accept a text position inside them at all. The heuristic never checked `spec.atomic`.

## Fix

Added `!spec.atomic` to the condition in `firstTextSelection`, so an atomic node is never selected as a text-caret target regardless of its children array's length. Empty/all-inline non-atomic blocks (the actual intent of the heuristic) are unaffected.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`, "coalesces two successive atom-resize clicks into one undo step" (Phase 11 Tier 2) seeds a document with `block_image` before a trailing paragraph and calls `replaceValue` — this is the reproduction shape, now passing on all 3 browsers. No dedicated unit test for `firstTextSelection` in isolation exists (it's a private helper in `canonicalEditorRuntime.ts`); the e2e coverage above is the practical regression guard.

## Related/similar issues

None found connecting to this specific helper. Discovered incidentally while building unrelated Undo/Redo coverage (Phase 11 Tier 2), not from a user report.
