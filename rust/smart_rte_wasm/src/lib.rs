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
    pub fn merge_cells(&mut self, sr: u32, sc: u32, er: u32, ec: u32) { self.core.merge_cells(sr, sc, er, ec) }
    pub fn split_cell(&mut self, r: u32, c: u32) { self.core.split_cell(r, c) }
    pub fn set_cell_style(&mut self, r: u32, c: u32, style_json: String) { self.core.set_cell_style(r, c, &style_json) }
    pub fn set_column_width(&mut self, col: u32, px: u32) { self.core.set_column_width(col, px) }
    pub fn set_freeze(&mut self, header: bool, first_col: bool) { self.core.set_freeze(header, first_col) }

    // History
    pub fn undo(&mut self) { self.core.undo() }
    pub fn redo(&mut self) { self.core.redo() }

    // Comments
    pub fn add_comment(&mut self, anchor_json: String, text: String) -> String { self.core.add_comment(&anchor_json, &text) }
    pub fn resolve_comment(&mut self, thread_id: String, resolved: bool) { self.core.resolve_comment(&thread_id, resolved) }
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
