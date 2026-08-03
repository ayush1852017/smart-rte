# Phase 5 block behaviour-change catalogue

This catalogue was written while the retained legacy block harness and the
canonical engine both remained executable, before deleting any production
legacy block mutation path.

Shadow equivalence is normalized canonical document structure with node IDs
stripped, plus semantic selection position. Operation streams are not compared:
the engines deliberately use different operation vocabularies and the legacy
model has no stable node identity.

## Intentional changes

1. Paragraph/heading conversion preserves the block's canonical ID. Legacy had
   no stable ID and replaced the block. This protects future annotations and
   collaboration references.
2. Paragraph/heading conversion preserves every inline mark. Legacy removed
   `fontSize` while producing a heading; canonical conversion leaves mark policy
   to the mark engine.
3. Entering a code block strips marks because `code_block` declares `marks: ""`.
   The text is retained. Legacy serialized code as a separate `codeBlock` shape.
4. Alignment and indentation are canonical attributes (`align`, `indentLevel`),
   rendered as CSS only at the DOM boundary. Unrelated presentation styles on
   staged-migration DOM nodes are retained by the adapter.
5. Blockquote unwrap removes exactly one nesting level. Nested quotes are not
   flattened.
6. Quoting list content wraps the complete list shell, not individual `li`
   elements or split list-shell fragments.
7. Moving past the start/end boundary is a no-op. A contiguous selected run is
   moved as one unit.
8. Code-block Tab inserts a tab character; Ctrl/Cmd+Enter exits before only at
   offset zero and otherwise creates an adjacent paragraph after the block.
9. Quote and code conversion preserve the semantic native selection, including
   direction. The retained legacy replacement commands report a different
   selection for these structural conversions; the three-browser corpus labels
   those cases `selection-only` (143 quote + 143 code per 1,000 scenarios).
10. Alignment inside a list item is stored and rendered on its content block,
    not duplicated onto `li`. Reading order and visual alignment are unchanged.

No item above permits data loss. Mark removal on conversion to code is explicit
schema enforcement and preserves all text.
