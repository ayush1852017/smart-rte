pub mod doc;
pub mod ops;
pub mod history;
pub mod selection;
pub mod import_export;
pub mod comments;

use serde_json::Value;
use doc::{Doc, Node, Table, TableCell, TableRow, CellStyle};
use history::History;
use comments::CommentThread;
use selection::SelectionRange;

#[derive(Debug, Default)]
pub struct EditorCore {
    pub doc: Doc,
    pub history: History,
}

impl EditorCore {
    pub fn new_empty() -> Self {
        Self { doc: Doc::default(), history: History::default() }
    }

    pub fn from_json(json: &str) -> serde_json::Result<Self> {
        let doc: Doc = serde_json::from_str(json)?;
        Ok(Self { doc, history: History::default() })
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.doc).unwrap_or_else(|_| "{}".to_string())
    }

    pub fn to_html(&self) -> String {
        crate::import_export::to_html(&self.doc)
    }

    pub fn to_markdown(&self) -> String {
        crate::import_export::to_markdown(&self.doc)
    }

    pub fn to_delta(&self) -> String {
        let v = crate::import_export::to_quill_delta(&self.doc);
        serde_json::to_string(&v).unwrap_or_else(|_| "{\"ops\":[]}".to_string())
    }

    pub fn from_delta(&mut self, delta_json: &str) {
        if let Ok(v) = serde_json::from_str::<Value>(delta_json) {
            self.history.record_before_change(&self.doc);
            self.doc = crate::import_export::from_quill_delta(&v);
        }
    }

    // Table ops
    pub fn insert_table(&mut self, rows: u32, cols: u32) { ops::insert_table(&mut self.doc, rows, cols, &mut self.history); }
    pub fn add_row(&mut self, at: u32) { ops::add_row(&mut self.doc, at, &mut self.history); }
    pub fn add_col(&mut self, at: u32) { ops::add_col(&mut self.doc, at, &mut self.history); }
    pub fn move_row(&mut self, from: u32, to: u32) { ops::move_row(&mut self.doc, from, to, &mut self.history); }
    pub fn move_col(&mut self, from: u32, to: u32) { ops::move_col(&mut self.doc, from, to, &mut self.history); }
    pub fn delete_row(&mut self, at: u32) { ops::delete_row(&mut self.doc, at, &mut self.history); }
    pub fn delete_col(&mut self, at: u32) { ops::delete_col(&mut self.doc, at, &mut self.history); }
    pub fn merge_cells(&mut self, sr: u32, sc: u32, er: u32, ec: u32) { ops::merge_cells(&mut self.doc, sr, sc, er, ec, &mut self.history); }
    pub fn split_cell(&mut self, r: u32, c: u32) { ops::split_cell(&mut self.doc, r, c, &mut self.history); }
    pub fn set_cell_style(&mut self, r: u32, c: u32, style_json: &str) { ops::set_cell_style(&mut self.doc, r, c, style_json, &mut self.history); }
    pub fn set_cell_text(&mut self, r: u32, c: u32, text: &str) {
        self.history.record_before_change(&self.doc);
        if let Some(t) = self.doc.nodes.iter_mut().find_map(|n| match n { Node::Table(t) => Some(t), _ => None }) {
            let ri = r as usize;
            let ci = c as usize;
            if ri < t.rows.len() && ci < t.rows[ri].cells.len() {
                t.rows[ri].cells[ci].text = text.to_string();
            }
        }
    }
    pub fn set_column_width(&mut self, col: u32, px: u32) { ops::set_column_width(&mut self.doc, col, px, &mut self.history); }
    pub fn set_freeze(&mut self, header: bool, first_col: bool) { ops::set_freeze(&mut self.doc, header, first_col, &mut self.history); }

    // Blocks: MCQ & InfoBox & Formula
    pub fn insert_mcq(&mut self, multiple: bool) { ops::insert_mcq(&mut self.doc, multiple, &mut self.history); }
    pub fn update_mcq(&mut self, index: u32, question: &str, options_json: &str, multiple: bool) {
        let opts: Option<Vec<crate::doc::MCQOption>> = serde_json::from_str(options_json).ok();
        ops::update_mcq(&mut self.doc, index as usize, Some(question.to_string()), opts, Some(multiple), &mut self.history);
    }
    pub fn insert_infobox(&mut self, kind: &str, text: &str) { ops::insert_infobox(&mut self.doc, kind, text, &mut self.history); }
    pub fn update_infobox(&mut self, index: u32, kind: &str, text: &str) { ops::update_infobox(&mut self.doc, index as usize, Some(kind.to_string()), Some(text.to_string()), &mut self.history); }
    pub fn insert_formula_inline(&mut self, tex: &str) { ops::insert_formula_inline(&mut self.doc, tex, &mut self.history); }
    pub fn insert_formula_block(&mut self, tex: &str) { ops::insert_formula_block(&mut self.doc, tex, &mut self.history); }
    pub fn set_paragraph_text(&mut self, index: u32, text: &str) { ops::set_paragraph_text(&mut self.doc, index as usize, text, &mut self.history); }
    pub fn insert_formula_inline_at(&mut self, after_index: u32, tex: &str) { ops::insert_formula_inline_at(&mut self.doc, after_index as usize, tex, &mut self.history); }
    pub fn insert_formula_block_at(&mut self, after_index: u32, tex: &str) { ops::insert_formula_block_at(&mut self.doc, after_index as usize, tex, &mut self.history); }
    pub fn insert_image_at(&mut self, after_index: u32, src: &str, alt: &str) { ops::insert_image_at(&mut self.doc, after_index as usize, src, alt, &mut self.history); }
    pub fn insert_paragraph(&mut self, at: u32, text: &str) { ops::insert_paragraph(&mut self.doc, at, text, &mut self.history); }
    pub fn delete_node(&mut self, at: u32) { ops::delete_node(&mut self.doc, at as usize, &mut self.history); }
    pub fn insert_table_at(&mut self, after_index: u32, rows: u32, cols: u32) { ops::insert_table_at(&mut self.doc, after_index as usize, rows, cols, &mut self.history); }

    // Inline formatting
    pub fn set_text_style(&mut self, index: u32, start: u32, end: u32, style_json: &str) {
        ops::set_text_style(&mut self.doc, index as usize, start as usize, end as usize, style_json, &mut self.history);
    }
    pub fn set_cell_text_style(&mut self, r: u32, c: u32, start: u32, end: u32, style_json: &str) {
        ops::set_cell_text_style(&mut self.doc, r, c, start as usize, end as usize, style_json, &mut self.history);
    }
    pub fn set_row_height(&mut self, r: u32, px: u32) { ops::set_row_height(&mut self.doc, r, px, &mut self.history); }

    // Table-indexed variants
    pub fn set_cell_text_at(&mut self, table_idx: u32, r: u32, c: u32, text: &str) { ops::set_cell_text_at(&mut self.doc, table_idx as usize, r, c, text, &mut self.history); }
    pub fn set_cell_style_at(&mut self, table_idx: u32, r: u32, c: u32, style_json: &str) { ops::set_cell_style_at(&mut self.doc, table_idx as usize, r, c, style_json, &mut self.history); }
    pub fn set_cell_text_style_at(&mut self, table_idx: u32, r: u32, c: u32, start: u32, end: u32, style_json: &str) { ops::set_cell_text_style_at(&mut self.doc, table_idx as usize, r, c, start as usize, end as usize, style_json, &mut self.history); }
    pub fn set_column_width_at(&mut self, table_idx: u32, col: u32, px: u32) { ops::set_column_width_at(&mut self.doc, table_idx as usize, col, px, &mut self.history); }
    pub fn set_freeze_at(&mut self, table_idx: u32, header: bool, first_col: bool) { ops::set_freeze_at(&mut self.doc, table_idx as usize, header, first_col, &mut self.history); }
    pub fn add_row_at(&mut self, table_idx: u32, at: u32) { ops::add_row_at(&mut self.doc, table_idx as usize, at, &mut self.history); }
    pub fn add_col_at(&mut self, table_idx: u32, at: u32) { ops::add_col_at(&mut self.doc, table_idx as usize, at, &mut self.history); }
    pub fn delete_row_at(&mut self, table_idx: u32, at: u32) { ops::delete_row_at(&mut self.doc, table_idx as usize, at, &mut self.history); }
    pub fn delete_col_at(&mut self, table_idx: u32, at: u32) { ops::delete_col_at(&mut self.doc, table_idx as usize, at, &mut self.history); }
    pub fn merge_cells_at(&mut self, table_idx: u32, sr: u32, sc: u32, er: u32, ec: u32) { ops::merge_cells_at(&mut self.doc, table_idx as usize, sr, sc, er, ec, &mut self.history); }
    pub fn split_cell_at(&mut self, table_idx: u32, r: u32, c: u32) { ops::split_cell_at(&mut self.doc, table_idx as usize, r, c, &mut self.history); }
    pub fn set_row_height_at(&mut self, table_idx: u32, r: u32, px: u32) { ops::set_row_height_at(&mut self.doc, table_idx as usize, r, px, &mut self.history); }

    // History
    pub fn undo(&mut self) { let _ = self.history.undo(&mut self.doc); }
    pub fn redo(&mut self) { let _ = self.history.redo(&mut self.doc); }

    // Comments
    pub fn add_comment(&mut self, anchor_json: &str, text: &str) -> String {
        let anchor: Option<SelectionRange> = serde_json::from_str(anchor_json).ok();
        self.history.record_before_change(&self.doc);
        let id = format!("thread-{}", self.doc.threads.len() + 1);
        let mut thread = CommentThread::new(id.clone(), anchor);
        thread.add_message("user".into(), text.into(), current_time_ms());
        self.doc.threads.push(thread);
        id
    }

    pub fn resolve_comment(&mut self, thread_id: &str, resolved: bool) {
        let idx = self.doc.threads.iter().position(|t| t.id == thread_id);
        if let Some(i) = idx {
            self.history.record_before_change(&self.doc);
            if let Some(t) = self.doc.threads.get_mut(i) {
                t.set_resolved(resolved);
            }
        }
    }
}

fn current_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}
