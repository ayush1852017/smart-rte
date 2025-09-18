//! Selection model with robust anchors and mapping across table operations.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Anchor {
    Text { node_index: usize, char_offset: usize },
    TableCell { table_node_index: usize, row: usize, col: usize, char_offset: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SelectionRange {
    pub start: Anchor,
    pub end: Anchor,
}

impl SelectionRange {
    pub fn normalize(&mut self) {
        // For now, do nothing; ranges can be cross-node. Future: implement ordering.
    }

    pub fn map_table_row_insert(&mut self, table_node_index: usize, at_row: usize) {
        map_anchor_row_insert(&mut self.start, table_node_index, at_row);
        map_anchor_row_insert(&mut self.end, table_node_index, at_row);
    }

    pub fn map_table_col_insert(&mut self, table_node_index: usize, at_col: usize) {
        map_anchor_col_insert(&mut self.start, table_node_index, at_col);
        map_anchor_col_insert(&mut self.end, table_node_index, at_col);
    }

    pub fn map_table_row_move(&mut self, table_node_index: usize, from: usize, to: usize) {
        map_anchor_row_move(&mut self.start, table_node_index, from, to);
        map_anchor_row_move(&mut self.end, table_node_index, from, to);
    }

    pub fn map_table_col_move(&mut self, table_node_index: usize, from: usize, to: usize) {
        map_anchor_col_move(&mut self.start, table_node_index, from, to);
        map_anchor_col_move(&mut self.end, table_node_index, from, to);
    }

    pub fn map_table_merge(&mut self, table_node_index: usize, sr: usize, sc: usize, er: usize, ec: usize) {
        map_anchor_merge(&mut self.start, table_node_index, sr, sc, er, ec);
        map_anchor_merge(&mut self.end, table_node_index, sr, sc, er, ec);
    }

    pub fn map_table_split(&mut self, _table_node_index: usize, _r: usize, _c: usize) {
        // Split does not require adjustment for anchors inside the master cell.
    }
}

fn map_anchor_row_insert(anchor: &mut Anchor, table_node_index: usize, at_row: usize) {
    if let Anchor::TableCell { table_node_index: tni, row, .. } = anchor {
        if *tni == table_node_index && *row >= at_row { *row += 1; }
    }
}

fn map_anchor_col_insert(anchor: &mut Anchor, table_node_index: usize, at_col: usize) {
    if let Anchor::TableCell { table_node_index: tni, col, .. } = anchor {
        if *tni == table_node_index && *col >= at_col { *col += 1; }
    }
}

fn map_anchor_row_move(anchor: &mut Anchor, table_node_index: usize, from: usize, to: usize) {
    if let Anchor::TableCell { table_node_index: tni, row, .. } = anchor {
        if *tni != table_node_index { return; }
        if *row == from { *row = to; }
        else if from < to {
            if *row > from && *row <= to { *row -= 1; }
        } else if to < from {
            if *row >= to && *row < from { *row += 1; }
        }
    }
}

fn map_anchor_col_move(anchor: &mut Anchor, table_node_index: usize, from: usize, to: usize) {
    if let Anchor::TableCell { table_node_index: tni, col, .. } = anchor {
        if *tni != table_node_index { return; }
        if *col == from { *col = to; }
        else if from < to {
            if *col > from && *col <= to { *col -= 1; }
        } else if to < from {
            if *col >= to && *col < from { *col += 1; }
        }
    }
}

fn map_anchor_merge(anchor: &mut Anchor, table_node_index: usize, sr: usize, sc: usize, er: usize, ec: usize) {
    if let Anchor::TableCell { table_node_index: tni, row, col, .. } = anchor {
        if *tni != table_node_index { return; }
        let (min_r, min_c, max_r, max_c) = (sr.min(er), sc.min(ec), sr.max(er), sc.max(ec));
        if *row >= min_r && *row <= max_r && *col >= min_c && *col <= max_c {
            *row = min_r; *col = min_c;
        }
    }
}


