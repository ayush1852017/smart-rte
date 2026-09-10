# The Blockquote toolbar button never showed as active when the caret was inside a blockquote

**Status:** Fixed
**Area:** react - `CanonicalAuthorityEditor.tsx`
**First reported:** 2026-09-10 — "Don't you think if blockquote is applied then it should show as active if cursor is there?"

## Symptom

Unlike every other toggle-style toolbar tool (Bold, Bulleted list, Numbered list, Checklist, ...), the "Blockquote" button never reflected caret/selection state at all - clicking into already-quoted content, or quoting text, left the button looking identical to its "not active" state.

## Root cause

The button was rendered with no `pressed` prop:

```tsx
<ToolbarButton icon="quote" label="Quote" ariaLabel="Blockquote" disabled={readOnly} onClick={toggleBlockquote} />
```

Not a missing capability - the exact detection logic already existed, just scoped to click-time only: `toggleBlockquote` itself resolves the caret's ancestors and looks for the nearest `blockquote` to decide whether to unwrap (already inside one) or wrap (not inside one). That same computation was simply never surfaced to the button's own `pressed` display state.

## Fix

Added `currentBlockquoteActive`, computed once per render via the identical ancestor walk `toggleBlockquote` already performs (`runtime.editor.resolve({ pos: selection.head }).ancestors`, reversed, find `blockquote`) - deliberately reusing the same logic rather than writing a second, potentially-diverging one, matching how `listStyleActive` already keeps the list toggle buttons' "looks active" and "clicking again removes it" in sync with each other. Wired to the button's `pressed` prop.

## Regression coverage

New test in `e2e/canonical-authority.spec.ts`, "the Blockquote button shows pressed when the caret is inside a blockquote, and un-pressed once it isn't": confirms `aria-pressed="false"` initially, `"true"` immediately after quoting the selected text, `"false"` again once the caret moves to an unquoted paragraph, and `"true"` again once it moves back into the quoted content. Passed 3/3 browsers.

Full suites: react unit 151/151, typecheck clean.
