pub mod doc;
pub mod ops;
pub mod history;
pub mod selection;
pub mod import_export;
pub mod comments;

use serde::{Deserialize, Serialize};
use doc::{CellStyle, Doc, Node, Table, TableCell, TableRow};
use history::History;
use serde_json::Value;
use crate::comments::CommentThread;
use crate::selection::SelectionRange;

// Types moved into doc.rs

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

    // Table ops (stubs)
    pub fn insert_table(&mut self, rows: u32, cols: u32) {
        self.history.record_before_change(&self.doc);
        let mut table = Table::default();
        table.rows = (0..rows)
            .map(|_| TableRow {
                cells: (0..cols)
                    .map(|_| TableCell { text: String::new(), colspan: 1, rowspan: 1, style: CellStyle::default(), placeholder: false })
                    .collect(),
            })
            .collect();
        table.column_widths = vec![120; cols as usize];
        self.doc.nodes.push(Node::Table(table));
    }
    pub fn add_row(&mut self, at: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let cols = t.rows.first().map(|r| r.cells.len()).unwrap_or(0);
            let new_row = TableRow { cells: (0..cols).map(|_| TableCell { text: String::new(), colspan: 1, rowspan: 1, style: CellStyle::default(), placeholder: false }).collect() };
            let idx = (at as usize).min(t.rows.len());
            t.rows.insert(idx, new_row);
        }
    }
    pub fn add_col(&mut self, at: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            for row in &mut t.rows {
                let idx = (at as usize).min(row.cells.len());
                row.cells.insert(idx, TableCell { text: String::new(), colspan: 1, rowspan: 1, style: CellStyle::default(), placeholder: false });
            }
            let idx = (at as usize).min(t.column_widths.len());
            if t.column_widths.is_empty() { t.column_widths = vec![120; t.rows.first().map(|r| r.cells.len()).unwrap_or(0)]; }
            t.column_widths.insert(idx, 120);
        }
    }
    pub fn move_row(&mut self, from: u32, to: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let len = t.rows.len();
            let from = (from as usize).min(len.saturating_sub(1));
            let to = (to as usize).min(len.saturating_sub(1));
            if from != to {
                let row = t.rows.remove(from);
                t.rows.insert(to, row);
            }
        }
    }
    pub fn move_col(&mut self, from: u32, to: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            for row in &mut t.rows {
                let len = row.cells.len();
                if len == 0 { continue; }
                let from = (from as usize).min(len.saturating_sub(1));
                let to = (to as usize).min(len.saturating_sub(1));
                if from != to {
                    let cell = row.cells.remove(from);
                    row.cells.insert(to, cell);
                }
            }
            if !t.column_widths.is_empty() {
                let len = t.column_widths.len();
                let from = (from as usize).min(len.saturating_sub(1));
                let to = (to as usize).min(len.saturating_sub(1));
                if from != to {
                    let w = t.column_widths.remove(from);
                    t.column_widths.insert(to, w);
                }
            }
        }
    }
    pub fn merge_cells(&mut self, sr: u32, sc: u32, er: u32, ec: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let (sr, sc, er, ec) = (
                sr.min(er),
                sc.min(ec),
                er.max(sr),
                ec.max(sc),
            );
            let start_r = sr as usize; let start_c = sc as usize; let end_r = er as usize; let end_c = ec as usize;
            if start_r >= t.rows.len() { return; }
            if start_c >= t.rows[start_r].cells.len() { return; }
            let rowspan = (end_r - start_r + 1) as u32;
            let colspan = (end_c - start_c + 1) as u32;
            // Set span on top-left cell
            let mut text = String::new();
            for r in start_r..=end_r {
                for c in start_c..=end_c {
                    if r == start_r && c == start_c {
                        continue;
                    }
                    let cell = &mut t.rows[r].cells[c];
                    if !cell.text.is_empty() {
                        if !text.is_empty() { text.push(' '); }
                        text.push_str(&cell.text);
                    }
                }
            }
            {
                let cell = &mut t.rows[start_r].cells[start_c];
                if !text.is_empty() {
                    if !cell.text.is_empty() { cell.text.push(' '); }
                    cell.text.push_str(&text);
                }
                cell.rowspan = rowspan;
                cell.colspan = colspan;
            }
            // Mark other cells as placeholders
            for r in start_r..=end_r {
                for c in start_c..=end_c {
                    if r == start_r && c == start_c { continue; }
                    let cell = &mut t.rows[r].cells[c];
                    cell.placeholder = true;
                    cell.text.clear();
                }
            }
        }
    }
    pub fn split_cell(&mut self, r: u32, c: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let (r, c) = (r as usize, c as usize);
            if r >= t.rows.len() { return; }
            if c >= t.rows[r].cells.len() { return; }
            let cell = t.rows[r].cells[c].clone();
            let rowspan = cell.rowspan.max(1);
            let colspan = cell.colspan.max(1);
            // Reset the master cell
            let master = &mut t.rows[r].cells[c];
            master.rowspan = 1; master.colspan = 1;
            // Clear placeholders within the span
            for rr in r..(r + rowspan as usize) {
                for cc in c..(c + colspan as usize) {
                    if rr == r && cc == c { continue; }
                    if rr < t.rows.len() && cc < t.rows[rr].cells.len() {
                        let ph = &mut t.rows[rr].cells[cc];
                        ph.placeholder = false;
                        ph.text.clear();
                        ph.rowspan = 1;
                        ph.colspan = 1;
                    }
                }
            }
        }
    }
    pub fn set_cell_style(&mut self, r: u32, c: u32, style_json: &str) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let (r, c) = (r as usize, c as usize);
            if r >= t.rows.len() { return; }
            if c >= t.rows[r].cells.len() { return; }
            if let Ok(new_style) = serde_json::from_str::<CellStyle>(style_json) {
                let mut style = t.rows[r].cells[c].style.clone();
                // Shallow-merge new fields into existing style
                if new_style.background.is_some() { style.background = new_style.background; }
                if new_style.border.is_some() { style.border = new_style.border; }
                t.rows[r].cells[c].style = style;
            }
        }
    }
    pub fn set_column_width(&mut self, col: u32, px: u32) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            let col = col as usize;
            if t.column_widths.len() < t.rows.first().map(|r| r.cells.len()).unwrap_or(0) {
                t.column_widths = vec![120; t.rows.first().map(|r| r.cells.len()).unwrap_or(0)];
            }
            if col < t.column_widths.len() {
                t.column_widths[col] = px;
            }
        }
    }
    pub fn set_freeze(&mut self, header: bool, first_col: bool) {
        self.history.record_before_change(&self.doc);
        if let Some(Node::Table(t)) = self.doc.nodes.iter_mut().find(|n| matches!(n, Node::Table(_))) {
            t.freeze_header = header;
            t.freeze_first_col = first_col;
        }
    }

    // History stubs
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
        if let Some(t) = self.doc.threads.iter_mut().find(|t| t.id == thread_id) {
            self.history.record_before_change(&self.doc);
            t.set_resolved(resolved);
        }
    }
}

fn current_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_table() {
        let mut core = EditorCore::new_empty();
        core.insert_table(6, 8);
        let table = core
            .doc
            .nodes
            .iter()
            .find_map(|n| if let Node::Table(t) = n { Some(t) } else { None })
            .unwrap();
        assert_eq!(table.rows.len(), 6);
        assert_eq!(table.rows[0].cells.len(), 8);
    }
}
