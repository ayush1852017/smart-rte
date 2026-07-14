# Changelog

## 0.3.2

- Preserve paragraph and heading blocks when creating, restyling, or removing lists.
- Keep list conversion inside table cells, including legacy cells containing direct text and line breaks.
- Prevent list elements from being inserted beneath table rows or replacing table cells.
- Make nested-list Tab and Shift+Tab deterministic, depth-aware, selection-preserving, and independently styled.
- Remove the redundant standalone unlink control; links remain removable from the edit-link popover.
- Use a recognizable chain-link icon and consolidate document import/export formats into labeled menus.

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
