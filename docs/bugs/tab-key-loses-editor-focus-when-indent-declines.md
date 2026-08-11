# Pressing Tab where indent legitimately has nothing to do moved keyboard focus out of the editor entirely

**Status:** Fixed
**Area:** input / selection / toolbar
**First reported:** 2026-08-11 (this session — reported as "Tab still not working where my cursor is placed," after a related but different Tab bug had already been fixed and clarified as correct behavior)

## Symptom

Pressing Tab at a cursor position where `indentList` legitimately has no valid predecessor to nest under (e.g. the first item of a list) appeared to do nothing — and, worse, subsequent typing didn't land in the editor at all, since keyboard focus had silently moved elsewhere.

## Reproduction

Confirmed directly: focused the editor, placed the cursor on a list's first (and only) item, pressed Tab, inspected `document.activeElement` before and after. Before: the contenteditable editor. After: a `<button>` element in the toolbar. Focus had genuinely left the editor.

## Root cause

The keyboard handler for Tab (`packages/core/src/foundation/surface/input.ts`) only called `event.preventDefault()` *after* confirming `indentList`/`outdentList` produced operations to apply. When the command correctly declined (no valid predecessor — not a bug in itself, see [indent-outdent-max-depth-disabled-together-not-a-bug](indent-outdent-max-depth-disabled-together-not-a-bug.md) and related files for why that decline is correct), `preventDefault()` never ran, so the browser's native Tab-key behavior took over: moving keyboard focus to the next focusable element in the page, per standard browser tab-navigation semantics.

## Fix

`preventDefault()` now fires unconditionally whenever the cursor is in a list item and not inside a table — Tab is always the editor's to handle in that context, whether or not there's a legal indent/outdent available, matching how contentEditable areas conventionally absorb Tab rather than letting it escape to page navigation. `packages/core/src/foundation/surface/input.ts`.

## Regression coverage

`packages/react/e2e/canonical-authority.spec.ts`: `"keeps keyboard focus inside the editor when Tab has no legal indent to apply"` — places cursor on a list's only item (no legal indent target), presses Tab, asserts the editor is still focused, then types immediately afterward and confirms the keystroke landed in the editor (not just that focus superficially stayed). 3/3 browsers.

## Related/similar issues

- [indent-drags-whole-subtree-instead-of-hoisting-children](indent-drags-whole-subtree-instead-of-hoisting-children.md) — the other Tab-related bug found in the same reporting thread, in `indentList`'s command logic rather than the keyboard handler.
- [checklist-space-key-hijacked-by-toggle](checklist-space-key-hijacked-by-toggle.md) — the same general class of bug (a keyboard handler not correctly owning a key it should fully control), a different key, found independently earlier in the project.
