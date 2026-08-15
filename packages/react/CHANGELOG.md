# Changelog

## 0.3.5

- Remove the always-on drag handle that appeared next to every line, list item, and table.
- Keep list-style and blockquote changes scoped to the selection instead of bleeding into unrelated parts of the document.
- Fix blockquote and code block corrupting each other, or losing content, when toggled in sequence without reselecting text in between.
- Preserve code blocks and blockquotes nested inside each other, including on list items, instead of one silently stripping the other.
- Fix the toolbar's active-state indicators (and the code block toggle itself) going stale on list items after removing an enclosing blockquote.
- Stop pasted or existing blockquotes/code blocks from losing their border and internal spacing when the source HTML carries conflicting inline styles.

## 0.3.4

- Make foreground and background colours deterministic across paragraphs, lists, and table-cell text selections.
- Preserve foreground colour when highlighting text and render authored colours correctly in dark mode.
- Show the effective foreground and background colours at the caret in the toolbar and picker.
- Keep the table-cell fill picker and context menu open during live colour dragging, including multi-cell selections.

## 0.3.3

- Keep the responsive More-actions menu inside narrow viewports and above the editor canvas.
- Make long mobile action menus independently scrollable with touch-friendly overscroll behavior.

## 0.3.2

- Preserve paragraph and heading blocks when creating, restyling, or removing lists.
- Keep list conversion inside table cells, including legacy cells containing direct text and line breaks.
- Prevent list elements from being inserted beneath table rows or replacing table cells.
- Make nested-list Tab and Shift+Tab deterministic, depth-aware, selection-preserving, and independently styled.
- Remove the redundant standalone unlink control; links remain removable from the edit-link popover.
- Use a recognizable chain-link icon and consolidate document import/export formats into labeled menus.
- Redesign the editor chrome for Sootr with semantic toolbar groups, consistent outlined icons, Align/Move/Insert menus, responsive overflow, dark-theme tokens, and keyboard-accessible popovers.
- Keep formulas at the saved caret after dialog interaction, align checklist controls with their content, and render visible split-button chevrons.
- Restore list selections before Move-menu indentation, synchronize controls for newly created checklist items, render explicit checked borders/ticks, and keep Media discoverable without a custom adapter.

## 0.3.1

- Make caret-based superscript and subscript toggling deterministic in controlled React applications.
- Preserve normal text before and after script spans and prevent nested superscript/subscript markup.

## 0.3.0

- Rebuild list selection and conversion behavior for checklists, bullets, numbers, alphabetic lists, and Roman numerals.
- Support list-aware blockquotes and code blocks.
- Make heading and font-size changes deterministic across carets and multi-block selections.
- Add left, center, right, and justified block alignment, including list items, code blocks, and table cells.
- Redesign link insertion and editing with accessible fields, validation, display-text editing, removal, opening, and secure new-tab links.
- Add regression coverage for formatting, lists, links, table cells, and document serialization.
