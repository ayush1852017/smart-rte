//! Commands/operations for editing.

use crate::doc::{CellStyle, Doc, Node, Table, TableCell, TableRow, MCQBlock, MCQOption, InfoBox, InlineSpan, InlineStyle};
use crate::history::History;
use serde_json::Value;

#[derive(Debug, Default)]
pub struct OpsContext {
    pub history: History,
}

impl OpsContext {
    pub fn new() -> Self {
        Self::default()
    }
}


pub fn insert_table(doc: &mut Doc, rows: u32, cols: u32, history: &mut History) {
    history.record_before_change(doc);
    let mut table = Table::default();
    table.rows = (0..rows).map(|_| {
        TableRow { cells: (0..cols).map(|_| TableCell::default()).collect(), height_px: None }
    }).collect();
    table.column_widths = vec![120; cols as usize];
    doc.nodes.push(Node::Table(table));
}

/// Insert a new table after the given index (i.e., at position index+1).
pub fn insert_table_at(doc: &mut Doc, after_index: usize, rows: u32, cols: u32, history: &mut History) {
    history.record_before_change(doc);
    let mut table = Table::default();
    table.rows = (0..rows).map(|_| {
        TableRow { cells: (0..cols).map(|_| TableCell::default()).collect(), height_px: None }
    }).collect();
    table.column_widths = vec![120; cols as usize];
    let at = (after_index + 1).min(doc.nodes.len());
    doc.nodes.insert(at, Node::Table(table));
}

pub fn add_row(doc: &mut Doc, at: u32, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let cols = t.column_widths.len().max(t.rows.get(0).map(|r| r.cells.len()).unwrap_or(0));
        let row = TableRow { cells: (0..cols).map(|_| TableCell::default()).collect(), height_px: None };
        let idx = (at as usize).min(t.rows.len());
        t.rows.insert(idx, row);
    }
}

pub fn add_col(doc: &mut Doc, at: u32, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let idx = (at as usize).min(t.column_widths.len());
        for r in &mut t.rows {
            let ci = idx.min(r.cells.len());
            r.cells.insert(ci, TableCell::default());
        }
        t.column_widths.insert(idx, 120);
    }
}

pub fn delete_row(doc: &mut Doc, at: u32, history: &mut History) {
    if !has_table(doc) { return; }
    let idx = at as usize;
    let len = match first_table_indices(doc).and_then(|ti| match &doc.nodes[ti] { Node::Table(t) => Some(t.rows.len()), _ => None }) { Some(l) => l, None => return };
    if idx >= len { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) { t.rows.remove(idx); }
}

pub fn delete_col(doc: &mut Doc, at: u32, history: &mut History) {
    if !has_table(doc) { return; }
    let idx = at as usize;
    let len = match first_table_indices(doc).and_then(|ti| match &doc.nodes[ti] { Node::Table(t) => Some(t.column_widths.len()), _ => None }) { Some(l) => l, None => return };
    if idx >= len { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        for r in &mut t.rows {
            if idx < r.cells.len() { r.cells.remove(idx); }
        }
        if idx < t.column_widths.len() { t.column_widths.remove(idx); }
    }
}

pub fn move_row(doc: &mut Doc, from: u32, to: u32, history: &mut History) {
    if !has_table(doc) { return; }
    // Compute bounds without holding mutable borrow
    let (len, from_i, to_i) = if let Some(ti) = first_table_indices(doc) {
        let t = &doc.nodes[ti];
        if let Node::Table(tref) = t {
            let len = tref.rows.len();
            let from_i = (from as usize).min(len.saturating_sub(1));
            let to_i = (to as usize).min(len.saturating_sub(1));
            (len, from_i, to_i)
        } else { return; }
    } else { return; };
    if from_i == to_i || from_i >= len { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let row = t.rows.remove(from_i);
        t.rows.insert(to_i, row);
    }
}

pub fn move_col(doc: &mut Doc, from: u32, to: u32, history: &mut History) {
    if !has_table(doc) { return; }
    let (len, from_i, to_i) = if let Some(ti) = first_table_indices(doc) {
        let t = match &doc.nodes[ti] { Node::Table(t) => t, _ => return };
        let len = t.column_widths.len();
        let from_i = (from as usize).min(len.saturating_sub(1));
        let to_i = (to as usize).min(len.saturating_sub(1));
        (len, from_i, to_i)
    } else { return; };
    if from_i == to_i || from_i >= len { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        for r in &mut t.rows {
            if from_i < r.cells.len() {
                let cell = r.cells.remove(from_i);
                let ti = to_i.min(r.cells.len());
                r.cells.insert(ti, cell);
            }
        }
        let w = t.column_widths.remove(from_i);
        t.column_widths.insert(to_i, w);
    }
}

pub fn merge_cells(doc: &mut Doc, sr: u32, sc: u32, er: u32, ec: u32, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let (sr, sc, er, ec) = (
            sr as usize,
            sc as usize,
            er as usize,
            ec as usize,
        );
        if sr >= t.rows.len() || er >= t.rows.len() { return; }
        let min_r = sr.min(er);
        let max_r = sr.max(er);
        let min_c = sc.min(ec);
        let max_c = sc.max(ec);
        if min_c >= t.rows[min_r].cells.len() || max_c >= t.rows[min_r].cells.len() { return; }
        // Top-left cell becomes master
        let master = &mut t.rows[min_r].cells[min_c];
        master.colspan = (max_c - min_c + 1) as u32;
        master.rowspan = (max_r - min_r + 1) as u32;
        // Mark covered cells as placeholders
        for r in min_r..=max_r {
            for c in min_c..=max_c {
                if r == min_r && c == min_c { continue; }
                if r < t.rows.len() && c < t.rows[r].cells.len() {
                    t.rows[r].cells[c].placeholder = true;
                }
            }
        }
    }
}

pub fn split_cell(doc: &mut Doc, r: u32, c: u32, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let r = r as usize;
        let c = c as usize;
        if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        let (rowspan, colspan) = {
            let cell = &mut t.rows[r].cells[c];
            let rs = cell.rowspan.max(1);
            let cs = cell.colspan.max(1);
            cell.rowspan = 1;
            cell.colspan = 1;
            (rs as usize, cs as usize)
        };
        // Unmark placeholders within the previous span area
        for rr in r..(r + rowspan) {
            if rr >= t.rows.len() { break; }
            for cc in c..(c + colspan) {
                if cc >= t.rows[rr].cells.len() { break; }
                t.rows[rr].cells[cc].placeholder = false;
            }
        }
    }
}

pub fn set_cell_style(doc: &mut Doc, r: u32, c: u32, style_json: &str, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let r = r as usize;
        let c = c as usize;
        if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        if let Ok(v) = serde_json::from_str::<Value>(style_json) {
            let mut incoming = CellStyle::default();
            if let Some(bg) = v.get("background").and_then(|v| v.as_str()) {
                incoming.background = Some(bg.to_string());
            }
            if let Some(border) = v.get("border").and_then(|v| v.as_object()) {
                let color = border.get("color").and_then(|v| v.as_str()).unwrap_or("#000").to_string();
                let width_px = border.get("width_px").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                incoming.border = Some(crate::doc::BorderStyle { color, width_px });
            }
            t.rows[r].cells[c].style.merge(&incoming);
        }
    }
}

/// Apply inline text style to a paragraph range by splitting spans or creating new ones.
/// If the paragraph has no spans yet, it will be initialized from the plain text.
pub fn set_text_style(doc: &mut Doc, index: usize, start: usize, end: usize, style_json: &str, history: &mut History) {
    if let Some(Node::Paragraph { text, spans }) = doc.nodes.get(index) {
        let total_len = text.len();
        let s = start.min(total_len);
        let e = end.min(total_len).max(s);
        let style_v: Value = match serde_json::from_str(style_json) { Ok(v) => v, Err(_) => Value::Null };
        let mut style = InlineStyle::default();
        if style_v.get("bold").and_then(|v| v.as_bool()).unwrap_or(false) { style.bold = true; }
        if style_v.get("italic").and_then(|v| v.as_bool()).unwrap_or(false) { style.italic = true; }
        if style_v.get("underline").and_then(|v| v.as_bool()).unwrap_or(false) { style.underline = true; }
        if let Some(c) = style_v.get("color").and_then(|v| v.as_str()) { style.color = Some(c.to_string()); }
        if let Some(h) = style_v.get("highlight").and_then(|v| v.as_str()) { style.highlight = Some(h.to_string()); }
        if let Some(fs) = style_v.get("font_size_px").and_then(|v| v.as_u64()) { style.font_size_px = Some(fs as u32); }

        history.record_before_change(doc);
        // Build spans if absent
        let mut spans_vec: Vec<InlineSpan> = if let Some(sp) = spans.clone() { sp } else {
            if text.is_empty() { vec![] } else { vec![InlineSpan { text: text.clone(), style: InlineStyle::default() }] }
        };
        // Rebuild with styled range
        let mut acc: Vec<InlineSpan> = Vec::new();
        let mut pos = 0usize;
        for span in spans_vec.into_iter() {
            let len = span.text.len();
            let span_start = pos;
            let span_end = pos + len;
            if e <= span_start || s >= span_end {
                // No overlap
                acc.push(span);
            } else {
                let local_s = s.saturating_sub(span_start).min(len);
                let local_e = e.saturating_sub(span_start).min(len);
                if local_s > 0 {
                    acc.push(InlineSpan { text: span.text[..local_s].to_string(), style: span.style.clone() });
                }
                if local_s < local_e {
                    let mid_txt = &span.text[local_s..local_e];
                    // Merge: overlay style flags and fields
                    let mut merged = span.style.clone();
                    if style.bold { merged.bold = true; }
                    if style.italic { merged.italic = true; }
                    if style.underline { merged.underline = true; }
                    if style.color.is_some() { merged.color = style.color.clone(); }
                    if style.highlight.is_some() { merged.highlight = style.highlight.clone(); }
                    if style.font_size_px.is_some() { merged.font_size_px = style.font_size_px; }
                    acc.push(InlineSpan { text: mid_txt.to_string(), style: merged });
                }
                if local_e < len {
                    acc.push(InlineSpan { text: span.text[local_e..].to_string(), style: span.style });
                }
            }
            pos += len;
        }
        if let Some(Node::Paragraph { text: t, spans: sp }) = doc.nodes.get_mut(index) {
            *t = t.clone();
            if acc.is_empty() { *sp = None; } else { *sp = Some(acc); }
        }
    }
}

/// Apply inline style to table cell text range. Works like set_text_style but on cell's text/spans.
pub fn set_cell_text_style(doc: &mut Doc, r: u32, c: u32, start: usize, end: usize, style_json: &str, history: &mut History) {
    if let Some(t) = first_table_mut(doc) {
        let r = r as usize; let c = c as usize;
        if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        let cell = &t.rows[r].cells[c];
        let text = &cell.text;
        let total_len = text.len();
        let s = start.min(total_len);
        let e = end.min(total_len).max(s);
        let style_v: Value = match serde_json::from_str(style_json) { Ok(v) => v, Err(_) => Value::Null };
        let mut style = InlineStyle::default();
        if style_v.get("bold").and_then(|v| v.as_bool()).unwrap_or(false) { style.bold = true; }
        if style_v.get("italic").and_then(|v| v.as_bool()).unwrap_or(false) { style.italic = true; }
        if style_v.get("underline").and_then(|v| v.as_bool()).unwrap_or(false) { style.underline = true; }
        if let Some(chex) = style_v.get("color").and_then(|v| v.as_str()) { style.color = Some(chex.to_string()); }
        if let Some(h) = style_v.get("highlight").and_then(|v| v.as_str()) { style.highlight = Some(h.to_string()); }
        if let Some(fs) = style_v.get("font_size_px").and_then(|v| v.as_u64()) { style.font_size_px = Some(fs as u32); }

        history.record_before_change(doc);
        // Build spans if absent
        let mut spans_vec: Vec<InlineSpan> = if let Some(sp) = t.rows[r].cells[c].spans.clone() { sp } else {
            if text.is_empty() { vec![] } else { vec![InlineSpan { text: text.clone(), style: InlineStyle::default() }] }
        };
        let mut acc: Vec<InlineSpan> = Vec::new();
        let mut pos = 0usize;
        for span in spans_vec.into_iter() {
            let len = span.text.len();
            let span_start = pos;
            let span_end = pos + len;
            if e <= span_start || s >= span_end {
                acc.push(span);
            } else {
                let local_s = s.saturating_sub(span_start).min(len);
                let local_e = e.saturating_sub(span_start).min(len);
                if local_s > 0 {
                    acc.push(InlineSpan { text: span.text[..local_s].to_string(), style: span.style.clone() });
                }
                if local_s < local_e {
                    let mid_txt = &span.text[local_s..local_e];
                    let mut merged = span.style.clone();
                    if style.bold { merged.bold = true; }
                    if style.italic { merged.italic = true; }
                    if style.underline { merged.underline = true; }
                    if style.color.is_some() { merged.color = style.color.clone(); }
                    if style.highlight.is_some() { merged.highlight = style.highlight.clone(); }
                    if style.font_size_px.is_some() { merged.font_size_px = style.font_size_px; }
                    acc.push(InlineSpan { text: mid_txt.to_string(), style: merged });
                }
                if local_e < len {
                    acc.push(InlineSpan { text: span.text[local_e..].to_string(), style: span.style });
                }
            }
            pos += len;
        }
        t.rows[r].cells[c].spans = if acc.is_empty() { None } else { Some(acc) };
    }
}

/// Set row height in pixels (minimum 12)
pub fn set_row_height(doc: &mut Doc, r: u32, px: u32, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let ri = r as usize;
        if ri >= t.rows.len() { return; }
        t.rows[ri].height_px = Some(px.max(12));
    }
}

pub fn set_column_width(doc: &mut Doc, col: u32, px: u32, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        let col = col as usize;
        if col >= t.column_widths.len() {
            t.column_widths.resize(col + 1, 120);
        }
        t.column_widths[col] = px.max(20);
    }
}

pub fn set_freeze(doc: &mut Doc, header: bool, first_col: bool, history: &mut History) {
    if !has_table(doc) { return; }
    history.record_before_change(doc);
    if let Some(t) = first_table_mut(doc) {
        t.freeze_header = header;
        t.freeze_first_col = first_col;
    }
}

fn first_table_mut(doc: &mut Doc) -> Option<&mut Table> {
    doc.nodes.iter_mut().find_map(|n| match n { Node::Table(t) => Some(t), _ => None })
}

fn first_table_indices(doc: &Doc) -> Option<usize> {
    doc.nodes.iter().position(|n| matches!(n, Node::Table(_)))
}

fn has_table(doc: &Doc) -> bool { first_table_indices(doc).is_some() }

fn table_mut_at(doc: &mut Doc, table_node_index: usize) -> Option<&mut Table> {
    match doc.nodes.get_mut(table_node_index) {
        Some(Node::Table(t)) => Some(t),
        _ => None,
    }
}

// ---- Indexed variants (operate on a specific table node index) ----

pub fn set_cell_text_at(doc: &mut Doc, table_node_index: usize, r: u32, c: u32, text: &str, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let ri = r as usize; let ci = c as usize;
        if ri < t.rows.len() && ci < t.rows[ri].cells.len() {
            t.rows[ri].cells[ci].text = text.to_string();
        }
    }
}

pub fn set_cell_style_at(doc: &mut Doc, table_node_index: usize, r: u32, c: u32, style_json: &str, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let r = r as usize; let c = c as usize;
        if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        if let Ok(v) = serde_json::from_str::<Value>(style_json) {
            let mut incoming = CellStyle::default();
            if let Some(bg) = v.get("background").and_then(|v| v.as_str()) { incoming.background = Some(bg.to_string()); }
            if let Some(border) = v.get("border").and_then(|v| v.as_object()) {
                let color = border.get("color").and_then(|v| v.as_str()).unwrap_or("#000").to_string();
                let width_px = border.get("width_px").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                incoming.border = Some(crate::doc::BorderStyle { color, width_px });
            }
            t.rows[r].cells[c].style.merge(&incoming);
        }
    }
}

pub fn set_cell_text_style_at(doc: &mut Doc, table_node_index: usize, r: u32, c: u32, start: usize, end: usize, style_json: &str, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let r = r as usize; let c = c as usize;
        if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        let cell = &t.rows[r].cells[c];
        let text = &cell.text;
        let total_len = text.len();
        let s = start.min(total_len);
        let e = end.min(total_len).max(s);
        let style_v: Value = match serde_json::from_str(style_json) { Ok(v) => v, Err(_) => Value::Null };
        let mut style = InlineStyle::default();
        if style_v.get("bold").and_then(|v| v.as_bool()).unwrap_or(false) { style.bold = true; }
        if style_v.get("italic").and_then(|v| v.as_bool()).unwrap_or(false) { style.italic = true; }
        if style_v.get("underline").and_then(|v| v.as_bool()).unwrap_or(false) { style.underline = true; }
        if let Some(chex) = style_v.get("color").and_then(|v| v.as_str()) { style.color = Some(chex.to_string()); }
        if let Some(h) = style_v.get("highlight").and_then(|v| v.as_str()) { style.highlight = Some(h.to_string()); }
        if let Some(fs) = style_v.get("font_size_px").and_then(|v| v.as_u64()) { style.font_size_px = Some(fs as u32); }

        history.record_before_change(doc);
        let mut spans_vec: Vec<InlineSpan> = if let Some(sp) = t.rows[r].cells[c].spans.clone() { sp } else {
            if text.is_empty() { vec![] } else { vec![InlineSpan { text: text.clone(), style: InlineStyle::default() }] }
        };
        let mut acc: Vec<InlineSpan> = Vec::new();
        let mut pos = 0usize;
        for span in spans_vec.into_iter() {
            let len = span.text.len();
            let span_start = pos; let span_end = pos + len;
            if e <= span_start || s >= span_end { acc.push(span); } else {
                let local_s = s.saturating_sub(span_start).min(len);
                let local_e = e.saturating_sub(span_start).min(len);
                if local_s > 0 { acc.push(InlineSpan { text: span.text[..local_s].to_string(), style: span.style.clone() }); }
                if local_s < local_e {
                    let mid_txt = &span.text[local_s..local_e];
                    let mut merged = span.style.clone();
                    if style.bold { merged.bold = true; }
                    if style.italic { merged.italic = true; }
                    if style.underline { merged.underline = true; }
                    if style.color.is_some() { merged.color = style.color.clone(); }
                    if style.highlight.is_some() { merged.highlight = style.highlight.clone(); }
                    if style.font_size_px.is_some() { merged.font_size_px = style.font_size_px; }
                    acc.push(InlineSpan { text: mid_txt.to_string(), style: merged });
                }
                if local_e < len { acc.push(InlineSpan { text: span.text[local_e..].to_string(), style: span.style }); }
            }
            pos += len;
        }
        if let Some(t2) = table_mut_at(doc, table_node_index) {
            t2.rows[r].cells[c].spans = if acc.is_empty() { None } else { Some(acc) };
        }
    }
}

pub fn set_column_width_at(doc: &mut Doc, table_node_index: usize, col: u32, px: u32, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let col = col as usize;
        if col >= t.column_widths.len() { t.column_widths.resize(col + 1, 120); }
        t.column_widths[col] = px.max(20);
    }
}

pub fn set_freeze_at(doc: &mut Doc, table_node_index: usize, header: bool, first_col: bool, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = table_mut_at(doc, table_node_index) {
        t.freeze_header = header; t.freeze_first_col = first_col;
    }
}

pub fn add_row_at(doc: &mut Doc, table_node_index: usize, at: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        history.record_before_change(doc);
        let cols = t.column_widths.len().max(t.rows.get(0).map(|r| r.cells.len()).unwrap_or(0));
        let row = TableRow { cells: (0..cols).map(|_| TableCell::default()).collect(), height_px: None };
        let idx = (at as usize).min(t.rows.len());
        t.rows.insert(idx, row);
    }
}

pub fn add_col_at(doc: &mut Doc, table_node_index: usize, at: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        history.record_before_change(doc);
        let idx = (at as usize).min(t.column_widths.len());
        for r in &mut t.rows {
            let ci = idx.min(r.cells.len());
            r.cells.insert(ci, TableCell::default());
        }
        t.column_widths.insert(idx, 120);
    }
}

pub fn delete_row_at(doc: &mut Doc, table_node_index: usize, at: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let idx = at as usize; if idx >= t.rows.len() { return; }
        history.record_before_change(doc);
        t.rows.remove(idx);
    }
}

pub fn delete_col_at(doc: &mut Doc, table_node_index: usize, at: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let idx = at as usize; if idx >= t.column_widths.len() { return; }
        history.record_before_change(doc);
        for r in &mut t.rows { if idx < r.cells.len() { r.cells.remove(idx); } }
        t.column_widths.remove(idx);
    }
}

pub fn merge_cells_at(doc: &mut Doc, table_node_index: usize, sr: u32, sc: u32, er: u32, ec: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        history.record_before_change(doc);
        let (sr, sc, er, ec) = (sr as usize, sc as usize, er as usize, ec as usize);
        if sr >= t.rows.len() || er >= t.rows.len() { return; }
        let min_r = sr.min(er); let max_r = sr.max(er); let min_c = sc.min(ec); let max_c = sc.max(ec);
        if min_c >= t.rows[min_r].cells.len() || max_c >= t.rows[min_r].cells.len() { return; }
        let master = &mut t.rows[min_r].cells[min_c];
        master.colspan = (max_c - min_c + 1) as u32; master.rowspan = (max_r - min_r + 1) as u32;
        for r in min_r..=max_r { for c in min_c..=max_c { if r == min_r && c == min_c { continue; }
            if r < t.rows.len() && c < t.rows[r].cells.len() { t.rows[r].cells[c].placeholder = true; } } }
    }
}

pub fn split_cell_at(doc: &mut Doc, table_node_index: usize, r: u32, c: u32, history: &mut History) {
    if let Some(t) = table_mut_at(doc, table_node_index) {
        history.record_before_change(doc);
        let r = r as usize; let c = c as usize; if r >= t.rows.len() || c >= t.rows[r].cells.len() { return; }
        let (rowspan, colspan) = { let cell = &mut t.rows[r].cells[c]; let rs = cell.rowspan.max(1); let cs = cell.colspan.max(1); cell.rowspan = 1; cell.colspan = 1; (rs as usize, cs as usize) };
        for rr in r..(r + rowspan) { if rr >= t.rows.len() { break; } for cc in c..(c + colspan) { if cc >= t.rows[rr].cells.len() { break; } t.rows[rr].cells[cc].placeholder = false; } }
    }
}

pub fn set_row_height_at(doc: &mut Doc, table_node_index: usize, r: u32, px: u32, history: &mut History) {
    history.record_before_change(doc);
    if let Some(t) = table_mut_at(doc, table_node_index) {
        let ri = r as usize; if ri >= t.rows.len() { return; }
        t.rows[ri].height_px = Some(px.max(12));
    }
}

// --- MCQ and InfoBox ops ---
pub fn insert_mcq(doc: &mut Doc, multiple: bool, history: &mut History) {
    history.record_before_change(doc);
    let block = MCQBlock { question: "New question".into(), options: vec![
        MCQOption { text: "Option A".into(), correct: false },
        MCQOption { text: "Option B".into(), correct: false },
        MCQOption { text: "Option C".into(), correct: false },
        MCQOption { text: "Option D".into(), correct: false },
    ], multiple };
    doc.nodes.push(Node::MCQBlock(block));
}

// --- Formula ops ---
pub fn insert_formula_inline(doc: &mut Doc, tex: &str, history: &mut History) {
    history.record_before_change(doc);
    doc.nodes.push(Node::FormulaInline { tex: tex.to_string() });
}

pub fn insert_formula_block(doc: &mut Doc, tex: &str, history: &mut History) {
    history.record_before_change(doc);
    doc.nodes.push(Node::FormulaBlock { tex: tex.to_string() });
}

// --- Paragraph/text ops and insert-at helpers ---
pub fn set_paragraph_text(doc: &mut Doc, index: usize, text: &str, history: &mut History) {
    let is_para = matches!(doc.nodes.get(index), Some(Node::Paragraph { .. }));
    if !is_para { return; }
    history.record_before_change(doc);
    if let Some(Node::Paragraph { text: t, spans: _ }) = doc.nodes.get_mut(index) {
        *t = text.to_string();
    }
}

pub fn insert_formula_inline_at(doc: &mut Doc, after_index: usize, tex: &str, history: &mut History) {
    history.record_before_change(doc);
    let at = (after_index + 1).min(doc.nodes.len());
    doc.nodes.insert(at, Node::FormulaInline { tex: tex.to_string() });
}

pub fn insert_formula_block_at(doc: &mut Doc, after_index: usize, tex: &str, history: &mut History) {
    history.record_before_change(doc);
    let at = (after_index + 1).min(doc.nodes.len());
    doc.nodes.insert(at, Node::FormulaBlock { tex: tex.to_string() });
}

pub fn insert_image_at(doc: &mut Doc, after_index: usize, src: &str, alt: &str, history: &mut History) {
    history.record_before_change(doc);
    let at = (after_index + 1).min(doc.nodes.len());
    doc.nodes.insert(at, Node::Image { src: src.to_string(), alt: alt.to_string() });
}

pub fn insert_paragraph(doc: &mut Doc, at: u32, text: &str, history: &mut History) {
    history.record_before_change(doc);
    let idx = (at as usize).min(doc.nodes.len());
    doc.nodes.insert(idx, Node::Paragraph { text: text.to_string(), spans: None });
}

pub fn update_mcq(doc: &mut Doc, index: usize, question: Option<String>, options: Option<Vec<MCQOption>>, multiple: Option<bool>, history: &mut History) {
    history.record_before_change(doc);
    if let Some(Node::MCQBlock(b)) = doc.nodes.get_mut(index) {
        if let Some(q) = question { b.question = q; }
        if let Some(opts) = options { b.options = opts; }
        if let Some(m) = multiple { b.multiple = m; }
    }
}

pub fn insert_infobox(doc: &mut Doc, kind: &str, text: &str, history: &mut History) {
    history.record_before_change(doc);
    doc.nodes.push(Node::InfoBox(InfoBox { kind: kind.to_string(), text: text.to_string() }));
}

pub fn update_infobox(doc: &mut Doc, index: usize, kind: Option<String>, text: Option<String>, history: &mut History) {
    history.record_before_change(doc);
    if let Some(Node::InfoBox(b)) = doc.nodes.get_mut(index) {
        if let Some(k) = kind { b.kind = k; }
        if let Some(t) = text { b.text = t; }
    }
}

/// Delete the node at the provided index if it exists.
/// This is used by the UI to remove images, tables, formulas, etc.
pub fn delete_node(doc: &mut Doc, at: usize, history: &mut History) {
    if at >= doc.nodes.len() { return; }
    history.record_before_change(doc);
    doc.nodes.remove(at);
}
