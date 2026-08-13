# Changelog

## 1.0.0-beta.1

**BREAKING CHANGE.** `ClassicEditor` is now unconditionally the canonical, schema-driven editor (`CanonicalAuthorityEditor` underneath). The DOM-authoritative legacy editor and its rollback path have been fully removed; every published version through 0.3.4 defaulted to the DOM-authoritative implementation, so this changes real runtime behavior for every existing consumer, not just internals.

- Promote the canonical editing engine to sole production authority. Removed `LegacyClassicEditor` (the previous default), the runtime rollback flag, and all four of its DOM-authoritative command bridges.
- Add a documented, tested headless facade: `CanonicalEditorRuntime` / `SmartEditorHandle` (`createCanonicalEditorRuntime`) has zero React dependency and can drive a full editing session — mount, edit, checkpoint/restore, get/replace value — against a plain DOM element with no React runtime involved.
- Wire DOCX, PDF, and Markdown import/export to `smartrte-core`'s new format codecs, replacing the previous ad hoc, partially DOM-dependent adapters.
- Add live KaTeX rendering for formula content, including accessible MathML output.
- Depends on `smartrte-core@1.0.0-beta.1`.

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
