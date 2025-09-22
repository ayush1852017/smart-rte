use wasm_bindgen::prelude::*;
use smart_rte_core::EditorCore;

#[wasm_bindgen]
pub struct Editor {
    core: EditorCore,
}

#[wasm_bindgen]
impl Editor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Editor {
        Editor { core: EditorCore::new_empty() }
    }

    pub fn new_empty() -> Editor { Self::new() }

    pub fn from_json(json: String) -> Editor {
        let core = EditorCore::from_json(&json).unwrap_or_else(|_| EditorCore::new_empty());
        Editor { core }
    }

    pub fn to_json(&self) -> String { self.core.to_json() }
    pub fn to_html(&self) -> String { self.core.to_html() }
    pub fn to_markdown(&self) -> String { self.core.to_markdown() }

    pub fn to_delta(&self) -> String { self.core.to_delta() }
    pub fn from_delta(&mut self, delta_json: String) { self.core.from_delta(&delta_json) }

    // Table ops
    pub fn insert_table(&mut self, rows: u32, cols: u32) { self.core.insert_table(rows, cols) }
    pub fn add_row(&mut self, at: u32) { self.core.add_row(at) }
    pub fn add_col(&mut self, at: u32) { self.core.add_col(at) }
    pub fn move_row(&mut self, from: u32, to: u32) { self.core.move_row(from, to) }
    pub fn move_col(&mut self, from: u32, to: u32) { self.core.move_col(from, to) }
    pub fn delete_row(&mut self, at: u32) { self.core.delete_row(at) }
    pub fn delete_col(&mut self, at: u32) { self.core.delete_col(at) }
    pub fn merge_cells(&mut self, sr: u32, sc: u32, er: u32, ec: u32) { self.core.merge_cells(sr, sc, er, ec) }
    pub fn split_cell(&mut self, r: u32, c: u32) { self.core.split_cell(r, c) }
    pub fn set_cell_style(&mut self, r: u32, c: u32, style_json: String) { self.core.set_cell_style(r, c, &style_json) }
    pub fn set_cell_text(&mut self, r: u32, c: u32, text: String) { self.core.set_cell_text(r, c, &text) }
    pub fn set_column_width(&mut self, col: u32, px: u32) { self.core.set_column_width(col, px) }
    pub fn set_freeze(&mut self, header: bool, first_col: bool) { self.core.set_freeze(header, first_col) }

    // Blocks: MCQ & InfoBox
    pub fn insert_mcq(&mut self, multiple: bool) { self.core.insert_mcq(multiple) }
    pub fn update_mcq(&mut self, index: u32, question: String, options_json: String, multiple: bool) { self.core.update_mcq(index, &question, &options_json, multiple) }
    pub fn insert_infobox(&mut self, kind: String, text: String) { self.core.insert_infobox(&kind, &text) }
    pub fn update_infobox(&mut self, index: u32, kind: String, text: String) { self.core.update_infobox(index, &kind, &text) }
    pub fn insert_formula_inline(&mut self, tex: String) { self.core.insert_formula_inline(&tex) }
    pub fn insert_formula_block(&mut self, tex: String) { self.core.insert_formula_block(&tex) }
    pub fn set_paragraph_text(&mut self, index: u32, text: String) { self.core.set_paragraph_text(index, &text) }
    pub fn insert_formula_inline_at(&mut self, after_index: u32, tex: String) { self.core.insert_formula_inline_at(after_index, &tex) }
    pub fn insert_formula_block_at(&mut self, after_index: u32, tex: String) { self.core.insert_formula_block_at(after_index, &tex) }
    pub fn insert_image_at(&mut self, after_index: u32, src: String, alt: String) { self.core.insert_image_at(after_index, &src, &alt) }
    pub fn insert_paragraph(&mut self, at: u32, text: String) { self.core.insert_paragraph(at, &text) }
    pub fn delete_node(&mut self, at: u32) { self.core.delete_node(at) }
    pub fn insert_table_at(&mut self, after_index: u32, rows: u32, cols: u32) { self.core.insert_table_at(after_index, rows, cols) }

    // History
    pub fn undo(&mut self) { self.core.undo() }
    pub fn redo(&mut self) { self.core.redo() }

    // Comments
    pub fn add_comment(&mut self, anchor_json: String, text: String) -> String { self.core.add_comment(&anchor_json, &text) }
    pub fn resolve_comment(&mut self, thread_id: String, resolved: bool) { self.core.resolve_comment(&thread_id, resolved) }

    // Inline formatting
    pub fn set_text_style(&mut self, index: u32, start: u32, end: u32, style_json: String) {
        self.core.set_text_style(index, start, end, &style_json)
    }
    pub fn set_cell_text_style(&mut self, r: u32, c: u32, start: u32, end: u32, style_json: String) {
        self.core.set_cell_text_style(r, c, start, end, &style_json)
    }
    pub fn set_row_height(&mut self, r: u32, px: u32) { self.core.set_row_height(r, px) }
}

#[wasm_bindgen]
impl Editor {
    // Indexed table ops (table node index aware)
    pub fn set_cell_text_at(&mut self, table_idx: u32, r: u32, c: u32, text: String) { self.core.set_cell_text_at(table_idx, r, c, &text) }
    pub fn set_cell_style_at(&mut self, table_idx: u32, r: u32, c: u32, style_json: String) { self.core.set_cell_style_at(table_idx, r, c, &style_json) }
    pub fn set_cell_text_style_at(&mut self, table_idx: u32, r: u32, c: u32, start: u32, end: u32, style_json: String) { self.core.set_cell_text_style_at(table_idx, r, c, start, end, &style_json) }
    pub fn set_column_width_at(&mut self, table_idx: u32, col: u32, px: u32) { self.core.set_column_width_at(table_idx, col, px) }
    pub fn set_freeze_at(&mut self, table_idx: u32, header: bool, first_col: bool) { self.core.set_freeze_at(table_idx, header, first_col) }
    pub fn add_row_at(&mut self, table_idx: u32, at: u32) { self.core.add_row_at(table_idx, at) }
    pub fn add_col_at(&mut self, table_idx: u32, at: u32) { self.core.add_col_at(table_idx, at) }
    pub fn delete_row_at(&mut self, table_idx: u32, at: u32) { self.core.delete_row_at(table_idx, at) }
    pub fn delete_col_at(&mut self, table_idx: u32, at: u32) { self.core.delete_col_at(table_idx, at) }
    pub fn merge_cells_at(&mut self, table_idx: u32, sr: u32, sc: u32, er: u32, ec: u32) { self.core.merge_cells_at(table_idx, sr, sc, er, ec) }
    pub fn split_cell_at(&mut self, table_idx: u32, r: u32, c: u32) { self.core.split_cell_at(table_idx, r, c) }
    pub fn set_row_height_specific(&mut self, table_idx: u32, r: u32, px: u32) { self.core.set_row_height_at(table_idx, r, px) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test::wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn wasm_sanity() {
        let mut e = Editor::new_empty();
        e.insert_table(2, 3);
        assert!(e.to_json().contains("\"Table\""));
    }
}
